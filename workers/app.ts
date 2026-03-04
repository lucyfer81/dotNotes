import type { Context } from "hono";
import { Hono } from "hono";
import { createRequestHandler } from "react-router";

type AppContext = Context<{ Bindings: Env }>;
type TagMode = "any" | "all";

type FolderRow = {
	id: string;
	parentId: string | null;
	name: string;
	slug: string;
	sortOrder: number;
	createdAt: string;
	updatedAt: string;
	noteCount?: number;
};

type TagRow = {
	id: string;
	name: string;
	color: string;
	createdAt: string;
	noteCount?: number;
};

type NoteRow = {
	id: string;
	slug: string;
	title: string;
	folderId: string;
	storageType: "d1" | "r2";
	bodyText: string | null;
	bodyR2Key: string | null;
	excerpt: string;
	sizeBytes: number;
	wordCount: number;
	isPinned: number;
	isArchived: number;
	deletedAt: string | null;
	createdAt: string;
	updatedAt: string;
};

const LINK_PATTERN = /\[\[([^\[\]]+)\]\]/g;
type PresetFolder = {
	id: string;
	name: string;
	slug: string;
	sortOrder: number;
	isParaMain: boolean;
};

const PRESET_FOLDERS: PresetFolder[] = [
	{ id: "folder-00-inbox", name: "00-Inbox", slug: "00-inbox", sortOrder: 0, isParaMain: false },
	{ id: "folder-10-projects", name: "10-Projects", slug: "10-projects", sortOrder: 10, isParaMain: true },
	{ id: "folder-20-areas", name: "20-Areas", slug: "20-areas", sortOrder: 20, isParaMain: true },
	{ id: "folder-30-resource", name: "30-Resource", slug: "30-resource", sortOrder: 30, isParaMain: true },
	{ id: "folder-40-archive", name: "40-Archive", slug: "40-archive", sortOrder: 40, isParaMain: true },
];
const PRESET_FOLDER_ID_SET = new Set(PRESET_FOLDERS.map((folder) => folder.id));
const PARA_MAIN_FOLDER_ID_SET = new Set(
	PRESET_FOLDERS.filter((folder) => folder.isParaMain).map((folder) => folder.id),
);

const app = new Hono<{ Bindings: Env }>();

app.onError((error, c) => {
	console.error("Unhandled API error", error);
	return jsonError(c, 500, "Internal server error", String(error));
});

app.get("/api/folders", async (c) => {
	await ensurePresetFolders(c.env.DB);

	const sql = `
		SELECT
			f.id,
			f.parent_id AS parentId,
			f.name,
			f.slug,
			f.sort_order AS sortOrder,
			f.created_at AS createdAt,
			f.updated_at AS updatedAt,
			COUNT(n.id) AS noteCount
		FROM folders f
		LEFT JOIN notes n
			ON n.folder_id = f.id
			AND n.deleted_at IS NULL
			AND n.is_archived = 0
		GROUP BY f.id
		ORDER BY COALESCE(f.parent_id, ''), f.sort_order ASC, f.name ASC
	`;
	const { results } = await c.env.DB.prepare(sql).all<FolderRow>();
	return jsonOk(c, results);
});

app.post("/api/folders", async (c) => {
	const payload = await parseObjectBody(c);
	if (!payload) {
		return jsonError(c, 400, "Invalid JSON body");
	}
	await ensurePresetFolders(c.env.DB);

	const name = readRequiredString(payload, "name");
	if (!name) {
		return jsonError(c, 400, "`name` is required");
	}

	const parentId = readRequiredString(payload, "parentId");
	if (!parentId) {
		return jsonError(c, 400, "`parentId` is required and must be a PARA main folder");
	}
	if (!PARA_MAIN_FOLDER_ID_SET.has(parentId)) {
		return jsonError(c, 400, "parentId must be one of PARA main folders: Projects/Areas/Resource/Archive");
	}
	if (!(await folderExists(c.env.DB, parentId))) {
		return jsonError(c, 400, "Parent folder does not exist");
	}

	const sortOrder = readOptionalNumber(payload, "sortOrder") ?? 0;
	const slug = slugify(readOptionalString(payload, "slug") ?? name);
	const id = readOptionalString(payload, "id") ?? crypto.randomUUID();

	const conflict = await c.env.DB.prepare(
		`SELECT id FROM folders
		 WHERE COALESCE(parent_id, '__root__') = COALESCE(?, '__root__')
		   AND (name = ? OR slug = ?)
		 LIMIT 1`,
	)
		.bind(parentId, name, slug)
		.first<{ id: string }>();

	if (conflict) {
		return jsonError(c, 409, "Folder name or slug already exists in this level");
	}

	await c.env.DB.prepare(
		`INSERT INTO folders (id, parent_id, name, slug, sort_order)
		 VALUES (?, ?, ?, ?, ?)`,
	)
		.bind(id, parentId, name, slug, sortOrder)
		.run();

	const created = await c.env.DB.prepare(
		`SELECT id, parent_id AS parentId, name, slug, sort_order AS sortOrder,
				created_at AS createdAt, updated_at AS updatedAt
		 FROM folders WHERE id = ?`,
	)
		.bind(id)
		.first<FolderRow>();

	return jsonOk(c, created, 201);
});

app.patch("/api/folders/:id", async (c) => {
	const folderId = c.req.param("id");
	const payload = await parseObjectBody(c);
	if (!payload) {
		return jsonError(c, 400, "Invalid JSON body");
	}
	await ensurePresetFolders(c.env.DB);

	const existing = await c.env.DB.prepare(
		`SELECT id, parent_id AS parentId, name, slug, sort_order AS sortOrder
		 FROM folders WHERE id = ?`,
	)
		.bind(folderId)
		.first<FolderRow>();
	if (!existing) {
		return jsonError(c, 404, "Folder not found");
	}
	if (PRESET_FOLDER_ID_SET.has(folderId)) {
		return jsonError(c, 400, "Preset root folders are immutable");
	}

	const nextName = hasOwn(payload, "name")
		? readRequiredString(payload, "name")
		: existing.name;
	if (!nextName) {
		return jsonError(c, 400, "`name` cannot be empty");
	}

	const nextParentId = hasOwn(payload, "parentId")
		? readRequiredString(payload, "parentId")
		: existing.parentId;
	if (!nextParentId) {
		return jsonError(c, 400, "Folder must belong to one PARA main folder");
	}
	if (!PARA_MAIN_FOLDER_ID_SET.has(nextParentId)) {
		return jsonError(c, 400, "parentId must be one of PARA main folders: Projects/Areas/Resource/Archive");
	}
	if (!(await folderExists(c.env.DB, nextParentId))) {
		return jsonError(c, 400, "Parent folder does not exist");
	}
	if (nextParentId === folderId) {
		return jsonError(c, 400, "Folder cannot be its own parent");
	}

	const nextSortOrder = hasOwn(payload, "sortOrder")
		? (readOptionalNumber(payload, "sortOrder") ?? 0)
		: existing.sortOrder;
	const requestedSlug = hasOwn(payload, "slug")
		? readOptionalString(payload, "slug")
		: existing.slug;
	const nextSlug = slugify(requestedSlug ?? nextName);

	const conflict = await c.env.DB.prepare(
		`SELECT id FROM folders
		 WHERE id <> ?
		   AND COALESCE(parent_id, '__root__') = COALESCE(?, '__root__')
		   AND (name = ? OR slug = ?)
		 LIMIT 1`,
	)
		.bind(folderId, nextParentId, nextName, nextSlug)
		.first<{ id: string }>();
	if (conflict) {
		return jsonError(c, 409, "Folder name or slug already exists in this level");
	}

	await c.env.DB.prepare(
		`UPDATE folders
		 SET parent_id = ?, name = ?, slug = ?, sort_order = ?
		 WHERE id = ?`,
	)
		.bind(nextParentId, nextName, nextSlug, nextSortOrder, folderId)
		.run();

	const updated = await c.env.DB.prepare(
		`SELECT id, parent_id AS parentId, name, slug, sort_order AS sortOrder,
				created_at AS createdAt, updated_at AS updatedAt
		 FROM folders WHERE id = ?`,
	)
		.bind(folderId)
		.first<FolderRow>();

	return jsonOk(c, updated);
});

app.get("/api/tags", async (c) => {
	const sql = `
		SELECT
			t.id,
			t.name,
			t.color,
			t.created_at AS createdAt,
			COUNT(nt.note_id) AS noteCount
		FROM tags t
		LEFT JOIN note_tags nt ON nt.tag_id = t.id
		LEFT JOIN notes n
			ON n.id = nt.note_id
			AND n.deleted_at IS NULL
			AND n.is_archived = 0
		GROUP BY t.id
		ORDER BY t.name ASC
	`;
	const { results } = await c.env.DB.prepare(sql).all<TagRow>();
	return jsonOk(c, results);
});

app.post("/api/tags", async (c) => {
	const payload = await parseObjectBody(c);
	if (!payload) {
		return jsonError(c, 400, "Invalid JSON body");
	}

	const name = readRequiredString(payload, "name");
	if (!name) {
		return jsonError(c, 400, "`name` is required");
	}

	const color = readOptionalString(payload, "color") ?? "#64748b";
	const id = readOptionalString(payload, "id") ?? crypto.randomUUID();

	const existing = await c.env.DB.prepare(
		"SELECT id FROM tags WHERE name = ? COLLATE NOCASE LIMIT 1",
	)
		.bind(name)
		.first<{ id: string }>();
	if (existing) {
		return jsonError(c, 409, "Tag already exists");
	}

	await c.env.DB.prepare("INSERT INTO tags (id, name, color) VALUES (?, ?, ?)")
		.bind(id, name, color)
		.run();

	const created = await c.env.DB.prepare(
		"SELECT id, name, color, created_at AS createdAt FROM tags WHERE id = ?",
	)
		.bind(id)
		.first<TagRow>();

	return jsonOk(c, created, 201);
});

app.patch("/api/tags/:id", async (c) => {
	const tagId = c.req.param("id");
	const payload = await parseObjectBody(c);
	if (!payload) {
		return jsonError(c, 400, "Invalid JSON body");
	}

	const current = await c.env.DB.prepare(
		"SELECT id, name, color, created_at AS createdAt FROM tags WHERE id = ?",
	)
		.bind(tagId)
		.first<TagRow>();
	if (!current) {
		return jsonError(c, 404, "Tag not found");
	}

	const nextName = hasOwn(payload, "name")
		? readRequiredString(payload, "name")
		: current.name;
	if (!nextName) {
		return jsonError(c, 400, "`name` cannot be empty");
	}
	const nextColor = hasOwn(payload, "color")
		? (readOptionalString(payload, "color") ?? "#64748b")
		: current.color;

	const conflict = await c.env.DB.prepare(
		"SELECT id FROM tags WHERE id <> ? AND name = ? COLLATE NOCASE LIMIT 1",
	)
		.bind(tagId, nextName)
		.first<{ id: string }>();
	if (conflict) {
		return jsonError(c, 409, "Tag name already exists");
	}

	await c.env.DB.prepare("UPDATE tags SET name = ?, color = ? WHERE id = ?")
		.bind(nextName, nextColor, tagId)
		.run();

	const updated = await c.env.DB.prepare(
		"SELECT id, name, color, created_at AS createdAt FROM tags WHERE id = ?",
	)
		.bind(tagId)
		.first<TagRow>();

	return jsonOk(c, updated);
});

app.get("/api/notes", async (c) => {
	const folderId = c.req.query("folderId") ?? null;
	const tagIds = parseCsv(c.req.query("tagIds"));
	const tagMode = normalizeTagMode(c.req.query("tagMode"));
	const keyword = (c.req.query("q") ?? "").trim();
	const includeArchived = parseBoolean(c.req.query("includeArchived"));
	const limit = clampInt(c.req.query("limit"), 20, 1, 100);
	const offset = clampInt(c.req.query("offset"), 0, 0, 10000);

	const where: string[] = ["n.deleted_at IS NULL"];
	const params: Array<string | number> = [];

	if (!includeArchived) {
		where.push("n.is_archived = 0");
	}
	if (folderId) {
		where.push("n.folder_id = ?");
		params.push(folderId);
	}
	if (keyword) {
		const search = `%${keyword}%`;
		where.push("(n.title LIKE ? OR n.excerpt LIKE ? OR COALESCE(n.body_text, '') LIKE ?)");
		params.push(search, search, search);
	}
	if (tagIds.length > 0) {
		const marks = placeholders(tagIds.length);
		if (tagMode === "all") {
			where.push(
				`n.id IN (
					SELECT nt.note_id
					FROM note_tags nt
					WHERE nt.tag_id IN (${marks})
					GROUP BY nt.note_id
					HAVING COUNT(DISTINCT nt.tag_id) = ?
				)`,
			);
			params.push(...tagIds, tagIds.length);
		} else {
			where.push(
				`EXISTS (
					SELECT 1 FROM note_tags nt
					WHERE nt.note_id = n.id AND nt.tag_id IN (${marks})
				)`,
			);
			params.push(...tagIds);
		}
	}

	const sql = `
		SELECT
			n.id,
			n.slug,
			n.title,
			n.folder_id AS folderId,
			n.storage_type AS storageType,
			n.body_text AS bodyText,
			n.body_r2_key AS bodyR2Key,
			n.excerpt,
			n.size_bytes AS sizeBytes,
			n.word_count AS wordCount,
			n.is_pinned AS isPinned,
			n.is_archived AS isArchived,
			n.deleted_at AS deletedAt,
			n.created_at AS createdAt,
			n.updated_at AS updatedAt
		FROM notes n
		WHERE ${where.join(" AND ")}
		ORDER BY n.is_pinned DESC, n.updated_at DESC
		LIMIT ? OFFSET ?
	`;
	params.push(limit, offset);

	const { results: notes } = await c.env.DB.prepare(sql)
		.bind(...params)
		.all<NoteRow>();

	const tagsByNote = await fetchTagsByNoteIds(c.env.DB, notes.map((item) => item.id));
	return jsonOk(c, {
		items: notes.map((note) => ({
			...note,
			tags: tagsByNote.get(note.id) ?? [],
		})),
		paging: { limit, offset, count: notes.length },
		filters: { folderId, tagIds, tagMode, keyword, includeArchived },
	});
});

app.get("/api/notes/:id", async (c) => {
	const noteId = c.req.param("id");
	const note = await getNoteById(c.env.DB, noteId);
	if (!note || note.deletedAt) {
		return jsonError(c, 404, "Note not found");
	}
	const tags = await fetchTagsForSingleNote(c.env.DB, noteId);
	return jsonOk(c, { ...note, tags });
});

app.get("/api/notes/:id/links", async (c) => {
	const noteId = c.req.param("id");
	const note = await getNoteById(c.env.DB, noteId);
	if (!note || note.deletedAt) {
		return jsonError(c, 404, "Note not found");
	}

	const { results: outbound } = await c.env.DB.prepare(
		`SELECT
			nl.target_note_id AS noteId,
			n.slug,
			n.title,
			n.updated_at AS updatedAt,
			nl.anchor_text AS anchorText
		 FROM note_links nl
		 JOIN notes n ON n.id = nl.target_note_id
		 WHERE nl.source_note_id = ?
		   AND n.deleted_at IS NULL
		 ORDER BY n.updated_at DESC`,
	)
		.bind(noteId)
		.all();

	const { results: inbound } = await c.env.DB.prepare(
		`SELECT
			nl.source_note_id AS noteId,
			n.slug,
			n.title,
			n.updated_at AS updatedAt,
			nl.anchor_text AS anchorText
		 FROM note_links nl
		 JOIN notes n ON n.id = nl.source_note_id
		 WHERE nl.target_note_id = ?
		   AND n.deleted_at IS NULL
		 ORDER BY n.updated_at DESC`,
	)
		.bind(noteId)
		.all();

	return jsonOk(c, { noteId, outbound, inbound });
});

app.post("/api/notes", async (c) => {
	const payload = await parseObjectBody(c);
	if (!payload) {
		return jsonError(c, 400, "Invalid JSON body");
	}
	await ensurePresetFolders(c.env.DB);

	const title = readRequiredString(payload, "title");
	if (!title) {
		return jsonError(c, 400, "`title` is required");
	}

	const folderId = readRequiredString(payload, "folderId");
	if (!folderId) {
		return jsonError(c, 400, "`folderId` is required");
	}
	if (!(await folderExists(c.env.DB, folderId))) {
		return jsonError(c, 400, "Folder does not exist");
	}

	const storageType = normalizeStorageType(payload.storageType);
	if (!storageType) {
		return jsonError(c, 400, "`storageType` must be `d1` or `r2`");
	}

	const bodyTextInput = readNullableString(payload, "bodyText");
	const bodyR2KeyInput = readNullableString(payload, "bodyR2Key");
	const noteId = readOptionalString(payload, "id") ?? crypto.randomUUID();
	const initialSlug = slugify(readOptionalString(payload, "slug") ?? title);
	const slug = await ensureUniqueSlug(c.env.DB, initialSlug);
	const isPinned = parseBooleanLike(payload.isPinned) ? 1 : 0;
	const isArchived = parseBooleanLike(payload.isArchived) ? 1 : 0;

	let bodyText: string | null = bodyTextInput;
	let bodyR2Key: string | null = bodyR2KeyInput;
	if (storageType === "d1") {
		bodyText = bodyText ?? "";
		bodyR2Key = null;
	} else {
		bodyText = null;
		if (!bodyR2Key) {
			return jsonError(c, 400, "`bodyR2Key` is required when storageType is `r2`");
		}
	}

	const tagIdsInput = toStringArray(payload.tagIds);
	const tagNamesInput = [
		...toStringArray(payload.tagNames),
		...extractTagNames(payload.tags),
	];
	const { tagIds, missingTagIds } = await resolveTagIds(c.env.DB, tagIdsInput, tagNamesInput);
	if (missingTagIds.length > 0) {
		return jsonError(c, 400, "Some tagIds do not exist", missingTagIds.join(","));
	}

	const excerpt = readOptionalString(payload, "excerpt") ?? buildExcerpt(bodyText ?? "");
	const sizeBytes =
		readOptionalNumber(payload, "sizeBytes") ??
		(bodyText ? byteLength(bodyText) : 0);
	const wordCount =
		readOptionalNumber(payload, "wordCount") ??
		(bodyText ? countWords(bodyText) : 0);

	await c.env.DB.prepare(
		`INSERT INTO notes (
			id, slug, title, folder_id, storage_type,
			body_text, body_r2_key, excerpt,
			size_bytes, word_count, is_pinned, is_archived
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			noteId,
			slug,
			title,
			folderId,
			storageType,
			bodyText,
			bodyR2Key,
			excerpt,
			sizeBytes,
			wordCount,
			isPinned,
			isArchived,
		)
		.run();

	await replaceNoteTags(c.env.DB, noteId, tagIds);

	const explicitLinkSlugs = hasOwn(payload, "linkSlugs")
		? toStringArray(payload.linkSlugs)
		: null;
	const desiredLinkSlugs = explicitLinkSlugs ?? (bodyText ? extractLinkSlugs(bodyText) : []);
	const linkResult = await replaceNoteLinks(c.env.DB, noteId, desiredLinkSlugs);

	const created = await getNoteById(c.env.DB, noteId);
	const tags = await fetchTagsForSingleNote(c.env.DB, noteId);

	return jsonOk(
		c,
		{
			...(created as NoteRow),
			tags,
			links: linkResult,
		},
		201,
	);
});

app.put("/api/notes/:id", async (c) => {
	const noteId = c.req.param("id");
	const payload = await parseObjectBody(c);
	if (!payload) {
		return jsonError(c, 400, "Invalid JSON body");
	}
	await ensurePresetFolders(c.env.DB);

	const existing = await getNoteById(c.env.DB, noteId);
	if (!existing || existing.deletedAt) {
		return jsonError(c, 404, "Note not found");
	}

	const nextTitle = hasOwn(payload, "title")
		? readRequiredString(payload, "title")
		: existing.title;
	if (!nextTitle) {
		return jsonError(c, 400, "`title` cannot be empty");
	}

	const nextFolderId = hasOwn(payload, "folderId")
		? readRequiredString(payload, "folderId")
		: existing.folderId;
	if (!nextFolderId || !(await folderExists(c.env.DB, nextFolderId))) {
		return jsonError(c, 400, "Folder does not exist");
	}

	const storageTypeCandidate = hasOwn(payload, "storageType")
		? normalizeStorageType(payload.storageType)
		: existing.storageType;
	if (!storageTypeCandidate) {
		return jsonError(c, 400, "`storageType` must be `d1` or `r2`");
	}
	const nextStorageType = storageTypeCandidate;

	let nextBodyText = hasOwn(payload, "bodyText")
		? readNullableString(payload, "bodyText")
		: existing.bodyText;
	let nextBodyR2Key = hasOwn(payload, "bodyR2Key")
		? readNullableString(payload, "bodyR2Key")
		: existing.bodyR2Key;

	if (nextStorageType === "d1") {
		nextBodyText = nextBodyText ?? "";
		nextBodyR2Key = null;
	} else {
		nextBodyText = null;
		if (!nextBodyR2Key) {
			return jsonError(c, 400, "`bodyR2Key` is required when storageType is `r2`");
		}
	}

	const requestedSlug = hasOwn(payload, "slug")
		? readOptionalString(payload, "slug")
		: existing.slug;
	const nextSlug = await ensureUniqueSlug(
		c.env.DB,
		slugify(requestedSlug ?? nextTitle),
		noteId,
	);

	const nextIsPinned = hasOwn(payload, "isPinned")
		? (parseBooleanLike(payload.isPinned) ? 1 : 0)
		: existing.isPinned;
	const nextIsArchived = hasOwn(payload, "isArchived")
		? (parseBooleanLike(payload.isArchived) ? 1 : 0)
		: existing.isArchived;
	const nextExcerpt = hasOwn(payload, "excerpt")
		? (readOptionalString(payload, "excerpt") ?? buildExcerpt(nextBodyText ?? ""))
		: buildExcerpt(nextBodyText ?? existing.bodyText ?? "");
	const nextSizeBytes = hasOwn(payload, "sizeBytes")
		? (readOptionalNumber(payload, "sizeBytes") ?? 0)
		: nextBodyText
			? byteLength(nextBodyText)
			: existing.sizeBytes;
	const nextWordCount = hasOwn(payload, "wordCount")
		? (readOptionalNumber(payload, "wordCount") ?? 0)
		: nextBodyText
			? countWords(nextBodyText)
			: existing.wordCount;

	await c.env.DB.prepare(
		`UPDATE notes
		 SET slug = ?,
			 title = ?,
			 folder_id = ?,
			 storage_type = ?,
			 body_text = ?,
			 body_r2_key = ?,
			 excerpt = ?,
			 size_bytes = ?,
			 word_count = ?,
			 is_pinned = ?,
			 is_archived = ?
		 WHERE id = ?`,
	)
		.bind(
			nextSlug,
			nextTitle,
			nextFolderId,
			nextStorageType,
			nextBodyText,
			nextBodyR2Key,
			nextExcerpt,
			nextSizeBytes,
			nextWordCount,
			nextIsPinned,
			nextIsArchived,
			noteId,
		)
		.run();

	const tagIdsInput = hasOwn(payload, "tagIds")
		? toStringArray(payload.tagIds)
		: null;
	const tagNamesInput = hasOwn(payload, "tagNames") || hasOwn(payload, "tags")
		? [...toStringArray(payload.tagNames), ...extractTagNames(payload.tags)]
		: null;
	if (tagIdsInput || tagNamesInput) {
		const { tagIds, missingTagIds } = await resolveTagIds(
			c.env.DB,
			tagIdsInput ?? [],
			tagNamesInput ?? [],
		);
		if (missingTagIds.length > 0) {
			return jsonError(c, 400, "Some tagIds do not exist", missingTagIds.join(","));
		}
		await replaceNoteTags(c.env.DB, noteId, tagIds);
	}

	let linkResult: { inserted: number; unresolvedSlugs: string[] } | null = null;
	const shouldSyncLinks =
		hasOwn(payload, "linkSlugs") ||
		(nextStorageType === "d1" && hasOwn(payload, "bodyText"));
	if (shouldSyncLinks) {
		const explicitLinkSlugs = hasOwn(payload, "linkSlugs")
			? toStringArray(payload.linkSlugs)
			: null;
		const desired = explicitLinkSlugs ??
			(nextStorageType === "d1" && nextBodyText ? extractLinkSlugs(nextBodyText) : []);
		linkResult = await replaceNoteLinks(c.env.DB, noteId, desired);
	}

	const updated = await getNoteById(c.env.DB, noteId);
	const tags = await fetchTagsForSingleNote(c.env.DB, noteId);
	return jsonOk(c, { ...(updated as NoteRow), tags, links: linkResult });
});

app.delete("/api/notes/:id", async (c) => {
	const noteId = c.req.param("id");
	const result = await c.env.DB.prepare(
		`UPDATE notes
		 SET deleted_at = CURRENT_TIMESTAMP
		 WHERE id = ? AND deleted_at IS NULL`,
	)
		.bind(noteId)
		.run();

	if (!result.success || (result.meta?.changes ?? 0) === 0) {
		return jsonError(c, 404, "Note not found");
	}

	return jsonOk(c, { id: noteId, deleted: true });
});

app.all("/api/*", (c) => jsonError(c, 404, "API route not found"));

app.get("*", (c) => {
	const requestHandler = createRequestHandler(
		() => import("virtual:react-router/server-build"),
		import.meta.env.MODE,
	);

	return requestHandler(c.req.raw, {
		cloudflare: { env: c.env, ctx: c.executionCtx },
	});
});

function jsonOk<T>(c: AppContext, data: T, status: 200 | 201 = 200) {
	return c.json({ ok: true, data }, status);
}

function jsonError(c: AppContext, status: 400 | 404 | 409 | 500, error: string, details?: string) {
	return c.json({ ok: false, error, details }, status);
}

async function parseObjectBody(c: AppContext): Promise<Record<string, unknown> | null> {
	const body = await c.req.json<unknown>().catch(() => null);
	if (!isRecord(body)) {
		return null;
	}
	return body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(obj, key);
}

function readRequiredString(obj: Record<string, unknown>, key: string): string | null {
	const value = obj[key];
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function readOptionalString(obj: Record<string, unknown>, key: string): string | null {
	const value = obj[key];
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function readNullableString(obj: Record<string, unknown>, key: string): string | null {
	if (!hasOwn(obj, key) || obj[key] === null) {
		return null;
	}
	if (typeof obj[key] !== "string") {
		return null;
	}
	return obj[key].trim();
}

function readOptionalNumber(obj: Record<string, unknown>, key: string): number | null {
	const value = obj[key];
	if (typeof value === "number" && Number.isFinite(value)) {
		return Math.trunc(value);
	}
	if (typeof value === "string" && value.trim().length > 0) {
		const parsed = Number.parseInt(value, 10);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return null;
}

function parseBooleanLike(value: unknown): boolean {
	if (typeof value === "boolean") {
		return value;
	}
	if (typeof value === "number") {
		return value === 1;
	}
	if (typeof value === "string") {
		return value.toLowerCase() === "true" || value === "1";
	}
	return false;
}

function parseBoolean(value: string | undefined): boolean {
	return value === "true" || value === "1";
}

function parseCsv(value: string | undefined): string[] {
	if (!value) {
		return [];
	}
	const seen = new Set<string>();
	for (const item of value.split(",")) {
		const trimmed = item.trim();
		if (trimmed) {
			seen.add(trimmed);
		}
	}
	return [...seen];
}

function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const unique = new Set<string>();
	for (const item of value) {
		if (typeof item !== "string") {
			continue;
		}
		const trimmed = item.trim();
		if (trimmed.length > 0) {
			unique.add(trimmed);
		}
	}
	return [...unique];
}

function extractTagNames(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const unique = new Set<string>();
	for (const item of value) {
		if (typeof item === "string") {
			const trimmed = item.trim();
			if (trimmed) {
				unique.add(trimmed);
			}
			continue;
		}
		if (isRecord(item) && typeof item.name === "string") {
			const trimmed = item.name.trim();
			if (trimmed) {
				unique.add(trimmed);
			}
		}
	}
	return [...unique];
}

function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
	if (!value) {
		return fallback;
	}
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed)) {
		return fallback;
	}
	return Math.min(max, Math.max(min, parsed));
}

function normalizeTagMode(value: string | undefined): TagMode {
	return value === "all" ? "all" : "any";
}

function normalizeStorageType(value: unknown): "d1" | "r2" | null {
	if (value === undefined || value === null || value === "") {
		return "d1";
	}
	if (value === "d1" || value === "r2") {
		return value;
	}
	return null;
}

function placeholders(count: number): string {
	return Array.from({ length: count }, () => "?").join(", ");
}

function slugify(input: string): string {
	const base = input
		.toLowerCase()
		.trim()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
	if (base.length > 0) {
		return base;
	}
	return `note-${crypto.randomUUID().slice(0, 8)}`;
}

function buildExcerpt(text: string, max = 180): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (normalized.length <= max) {
		return normalized;
	}
	return `${normalized.slice(0, max)}...`;
}

function byteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

function countWords(value: string): number {
	const matches = value.trim().match(/\S+/g);
	return matches ? matches.length : 0;
}

function extractLinkSlugs(value: string): string[] {
	const unique = new Set<string>();
	for (const match of value.matchAll(LINK_PATTERN)) {
		const raw = match[1]?.trim();
		if (!raw) {
			continue;
		}
		unique.add(slugify(raw));
	}
	return [...unique];
}

async function ensureUniqueSlug(db: D1Database, desiredSlug: string, excludeNoteId?: string): Promise<string> {
	const base = desiredSlug || `note-${crypto.randomUUID().slice(0, 8)}`;
	let candidate = base;
	let index = 1;

	while (true) {
		const conflict = excludeNoteId
			? await db
					.prepare("SELECT id FROM notes WHERE slug = ? AND id <> ? LIMIT 1")
					.bind(candidate, excludeNoteId)
					.first<{ id: string }>()
			: await db
					.prepare("SELECT id FROM notes WHERE slug = ? LIMIT 1")
					.bind(candidate)
					.first<{ id: string }>();
		if (!conflict) {
			return candidate;
		}
		candidate = `${base}-${index}`;
		index += 1;
	}
}

async function folderExists(db: D1Database, folderId: string): Promise<boolean> {
	const found = await db
		.prepare("SELECT id FROM folders WHERE id = ? LIMIT 1")
		.bind(folderId)
		.first<{ id: string }>();
	return Boolean(found);
}

async function ensurePresetFolders(db: D1Database): Promise<void> {
	const statements = PRESET_FOLDERS.map((folder) =>
		db.prepare(
			`INSERT OR IGNORE INTO folders (id, parent_id, name, slug, sort_order)
			 VALUES (?, NULL, ?, ?, ?)`,
		).bind(folder.id, folder.name, folder.slug, folder.sortOrder),
	);
	await db.batch(statements);
}

async function getNoteById(db: D1Database, noteId: string): Promise<NoteRow | null> {
	const note = await db.prepare(
		`SELECT
			id,
			slug,
			title,
			folder_id AS folderId,
			storage_type AS storageType,
			body_text AS bodyText,
			body_r2_key AS bodyR2Key,
			excerpt,
			size_bytes AS sizeBytes,
			word_count AS wordCount,
			is_pinned AS isPinned,
			is_archived AS isArchived,
			deleted_at AS deletedAt,
			created_at AS createdAt,
			updated_at AS updatedAt
		 FROM notes
		 WHERE id = ?
		 LIMIT 1`,
	)
		.bind(noteId)
		.first<NoteRow>();
	return note ?? null;
}

async function fetchTagsForSingleNote(db: D1Database, noteId: string): Promise<TagRow[]> {
	const { results } = await db.prepare(
		`SELECT
			t.id,
			t.name,
			t.color,
			t.created_at AS createdAt
		 FROM tags t
		 JOIN note_tags nt ON nt.tag_id = t.id
		 WHERE nt.note_id = ?
		 ORDER BY t.name ASC`,
	)
		.bind(noteId)
		.all<TagRow>();
	return results;
}

async function fetchTagsByNoteIds(db: D1Database, noteIds: string[]): Promise<Map<string, TagRow[]>> {
	const mapping = new Map<string, TagRow[]>();
	if (noteIds.length === 0) {
		return mapping;
	}
	const marks = placeholders(noteIds.length);
	const { results } = await db.prepare(
		`SELECT
			nt.note_id AS noteId,
			t.id,
			t.name,
			t.color,
			t.created_at AS createdAt
		 FROM note_tags nt
		 JOIN tags t ON t.id = nt.tag_id
		 WHERE nt.note_id IN (${marks})
		 ORDER BY t.name ASC`,
	)
		.bind(...noteIds)
		.all<{ noteId: string } & TagRow>();

	for (const row of results) {
		const list = mapping.get(row.noteId) ?? [];
		list.push({
			id: row.id,
			name: row.name,
			color: row.color,
			createdAt: row.createdAt,
		});
		mapping.set(row.noteId, list);
	}
	return mapping;
}

async function resolveTagIds(
	db: D1Database,
	tagIdsInput: string[],
	tagNamesInput: string[],
): Promise<{ tagIds: string[]; missingTagIds: string[] }> {
	const uniqueTagIds = [...new Set(tagIdsInput)];
	const uniqueTagNames = [...new Set(tagNamesInput.map((name) => name.trim()).filter(Boolean))];

	const resolvedIds = new Set<string>();
	let missingTagIds: string[] = [];

	if (uniqueTagIds.length > 0) {
		const marks = placeholders(uniqueTagIds.length);
		const { results } = await db
			.prepare(`SELECT id FROM tags WHERE id IN (${marks})`)
			.bind(...uniqueTagIds)
			.all<{ id: string }>();
		const existing = new Set(results.map((row) => row.id));
		missingTagIds = uniqueTagIds.filter((id) => !existing.has(id));
		for (const id of existing) {
			resolvedIds.add(id);
		}
	}

	for (const name of uniqueTagNames) {
		const found = await db
			.prepare("SELECT id FROM tags WHERE name = ? COLLATE NOCASE LIMIT 1")
			.bind(name)
			.first<{ id: string }>();
		if (found?.id) {
			resolvedIds.add(found.id);
			continue;
		}
		const newId = crypto.randomUUID();
		await db.prepare("INSERT INTO tags (id, name, color) VALUES (?, ?, ?)")
			.bind(newId, name, "#64748b")
			.run();
		resolvedIds.add(newId);
	}

	return { tagIds: [...resolvedIds], missingTagIds };
}

async function replaceNoteTags(db: D1Database, noteId: string, tagIds: string[]): Promise<void> {
	await db.prepare("DELETE FROM note_tags WHERE note_id = ?").bind(noteId).run();
	if (tagIds.length === 0) {
		return;
	}
	const statements = tagIds.map((tagId) =>
		db.prepare("INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)").bind(noteId, tagId),
	);
	await db.batch(statements);
}

async function replaceNoteLinks(
	db: D1Database,
	sourceNoteId: string,
	linkSlugs: string[],
): Promise<{ inserted: number; unresolvedSlugs: string[] }> {
	await db.prepare("DELETE FROM note_links WHERE source_note_id = ?")
		.bind(sourceNoteId)
		.run();

	if (linkSlugs.length === 0) {
		return { inserted: 0, unresolvedSlugs: [] };
	}

	const uniqueSlugs = [...new Set(linkSlugs.map((slug) => slugify(slug)))];
	if (uniqueSlugs.length === 0) {
		return { inserted: 0, unresolvedSlugs: [] };
	}

	const marks = placeholders(uniqueSlugs.length);
	const { results } = await db.prepare(
		`SELECT id, slug
		 FROM notes
		 WHERE slug IN (${marks})
		   AND deleted_at IS NULL`,
	)
		.bind(...uniqueSlugs)
		.all<{ id: string; slug: string }>();

	const foundSlugSet = new Set(results.map((row) => row.slug));
	const unresolvedSlugs = uniqueSlugs.filter((slug) => !foundSlugSet.has(slug));
	const targetRows = results.filter((row) => row.id !== sourceNoteId);

	if (targetRows.length === 0) {
		return { inserted: 0, unresolvedSlugs };
	}

	const statements = targetRows.map((target) =>
		db.prepare(
			"INSERT INTO note_links (source_note_id, target_note_id, anchor_text) VALUES (?, ?, ?)",
		)
			.bind(sourceNoteId, target.id, target.slug),
	);
	await db.batch(statements);
	return { inserted: targetRows.length, unresolvedSlugs };
}

export default app;
