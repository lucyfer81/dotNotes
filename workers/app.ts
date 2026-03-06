import type { Context } from "hono";
import { Hono } from "hono";
import { createRequestHandler } from "react-router";

type AppContext = Context<{ Bindings: Env }>;
type TagMode = "any" | "all";
type NoteStatusFilter = "active" | "archived" | "deleted" | "all";

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
	searchScore: number | null;
};
type NoteSearchMode = "none" | "fts" | "like-fallback";
type ListNotesQueryInput = {
	folderId: string | null;
	tagIds: string[];
	tagMode: TagMode;
	keyword: string;
	status: NoteStatusFilter;
	limit: number;
	offset: number;
};
type AssetRow = {
	id: string;
	noteId: string;
	r2Key: string;
	fileName: string | null;
	mimeType: string;
	sizeBytes: number;
	width: number | null;
	height: number | null;
	sha256: string | null;
	createdAt: string;
};
type NoteBodyStorageResult = {
	storageType: "d1" | "r2";
	bodyText: string | null;
	bodyR2Key: string | null;
	plainBodyText: string;
	sizeBytes: number;
	wordCount: number;
};
type NoteChunkRow = {
	id: string;
	noteId: string;
	chunkIndex: number;
	chunkText: string;
	tokenCount: number;
	embeddingModel: string | null;
	vectorId: string | null;
	createdAt: string;
};
type IndexAction = "upsert" | "delete";
type IndexJobStatus = "pending" | "processing" | "success" | "failed";
type NoteIndexJobRow = {
	noteId: string;
	action: IndexAction;
	status: IndexJobStatus;
	attemptCount: number;
	chunkCount: number;
	lastError: string | null;
	nextRetryAt: string | null;
	lastIndexedAt: string | null;
	createdAt: string;
	updatedAt: string;
};
type NoteIndexProcessResult = {
	noteId: string;
	action: IndexAction;
	status: "success" | "failed";
	chunkCount: number;
	error: string | null;
	attemptCount: number;
};

const DEFAULT_BODY_R2_THRESHOLD_BYTES = 64 * 1024;
const NOTE_BODY_R2_PREFIX = "note-bodies";
const ASSET_R2_PREFIX = "assets";
const DEFAULT_INDEX_MAX_CHARS = 900;
const DEFAULT_INDEX_OVERLAP_CHARS = 120;
const DEFAULT_INDEX_RETRY_MAX_ATTEMPTS = 5;
const DEFAULT_INDEX_RETRY_BACKOFF_SECONDS = 30;
const DEFAULT_INDEX_VECTOR_DIMENSIONS = 64;
const DEFAULT_INDEX_EMBEDDING_MODEL = "hash-v1";
const DEFAULT_TAG_NAME_MAX_LENGTH = 48;
const DEFAULT_TAG_PER_NOTE_LIMIT = 12;
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
	const status = normalizeNoteStatus(c.req.query("status"), c.req.query("includeArchived"));
	const noteStatusWhere = buildNoteStatusWhere("n", status);
	const sql = `
		SELECT
			t.id,
			t.name,
			t.color,
			t.created_at AS createdAt,
			COUNT(n.id) AS noteCount
		FROM tags t
		LEFT JOIN note_tags nt ON nt.tag_id = t.id
		LEFT JOIN notes n
			ON n.id = nt.note_id
			AND ${noteStatusWhere}
		GROUP BY t.id
		HAVING COUNT(n.id) > 0
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

	const rawName = readRequiredString(payload, "name");
	if (!rawName) {
		return jsonError(c, 400, "`name` is required");
	}
	const name = normalizeTagName(rawName, getTagNameMaxLength(c.env));
	if (!name) {
		return jsonError(c, 400, "Tag name is invalid after normalization");
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
		? normalizeTagName(readRequiredString(payload, "name") ?? "", getTagNameMaxLength(c.env))
		: current.name;
	if (!nextName) {
		return jsonError(c, 400, "Tag name is invalid after normalization");
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

app.post("/api/tags/merge", async (c) => {
	const payload = await parseObjectBody(c);
	if (!payload) {
		return jsonError(c, 400, "Invalid JSON body");
	}
	const sourceTagId = readRequiredString(payload, "sourceTagId");
	const targetTagId = readRequiredString(payload, "targetTagId");
	if (!sourceTagId || !targetTagId) {
		return jsonError(c, 400, "`sourceTagId` and `targetTagId` are required");
	}
	if (sourceTagId === targetTagId) {
		return jsonError(c, 400, "sourceTagId and targetTagId must be different");
	}

	const [source, target] = await Promise.all([
		c.env.DB.prepare("SELECT id, name FROM tags WHERE id = ? LIMIT 1")
			.bind(sourceTagId)
			.first<{ id: string; name: string }>(),
		c.env.DB.prepare("SELECT id, name FROM tags WHERE id = ? LIMIT 1")
			.bind(targetTagId)
			.first<{ id: string; name: string }>(),
	]);
	if (!source || !target) {
		return jsonError(c, 404, "Source or target tag not found");
	}

	const moved = await mergeTags(c.env.DB, sourceTagId, targetTagId);
	return jsonOk(c, {
		sourceTagId,
		targetTagId,
		sourceName: source.name,
		targetName: target.name,
		movedNoteCount: moved,
		deletedSource: true,
	});
});

app.delete("/api/tags/:id", async (c) => {
	const tagId = c.req.param("id");
	const targetTagId = (c.req.query("targetTagId") ?? "").trim() || null;
	const tag = await c.env.DB.prepare("SELECT id, name FROM tags WHERE id = ? LIMIT 1")
		.bind(tagId)
		.first<{ id: string; name: string }>();
	if (!tag) {
		return jsonError(c, 404, "Tag not found");
	}

	if (targetTagId) {
		if (targetTagId === tagId) {
			return jsonError(c, 400, "targetTagId must be different from tag id");
		}
		const target = await c.env.DB.prepare("SELECT id, name FROM tags WHERE id = ? LIMIT 1")
			.bind(targetTagId)
			.first<{ id: string; name: string }>();
		if (!target) {
			return jsonError(c, 404, "targetTagId not found");
		}
		const moved = await mergeTags(c.env.DB, tagId, targetTagId);
		return jsonOk(c, {
			id: tagId,
			deleted: true,
			migratedToTagId: targetTagId,
			migratedNoteCount: moved,
		});
	}

	const detached = await detachAndDeleteTag(c.env.DB, tagId);
	return jsonOk(c, {
		id: tagId,
		deleted: true,
		migratedToTagId: null,
		migratedNoteCount: 0,
		detachedNoteCount: detached,
	});
});

app.post("/api/tags/cleanup", async (c) => {
	const payload = (await parseObjectBody(c)) ?? {};
	const dryRun = parseBooleanLike(payload.dryRun);
	const limit = clampInt(
		typeof payload.limit === "string" ? payload.limit : String(readOptionalNumber(payload, "limit") ?? 100),
		100,
		1,
		500,
	);

	const orphanTags = await listOrphanTags(c.env.DB, limit);
	if (!dryRun && orphanTags.length > 0) {
		const statements = orphanTags.map((item) =>
			c.env.DB.prepare("DELETE FROM tags WHERE id = ?").bind(item.id),
		);
		await c.env.DB.batch(statements);
	}
	return jsonOk(c, {
		dryRun,
		limit,
		orphaned: orphanTags.length,
		deleted: dryRun ? 0 : orphanTags.length,
		tags: orphanTags,
	});
});

app.get("/api/notes", async (c) => {
	const folderId = c.req.query("folderId") ?? null;
	const tagIds = parseCsv(c.req.query("tagIds"));
	const tagMode = normalizeTagMode(c.req.query("tagMode"));
	const keyword = (c.req.query("q") ?? "").trim();
	const status = normalizeNoteStatus(c.req.query("status"), c.req.query("includeArchived"));
	const limit = clampInt(c.req.query("limit"), 20, 1, 100);
	const offset = clampInt(c.req.query("offset"), 0, 0, 10000);
	const { notes, mode } = await listNotesWithSearchMode(c.env.DB, {
		folderId,
		tagIds,
		tagMode,
		keyword,
		status,
		limit,
		offset,
	});
	const hydratedNotes = await hydrateNoteBodiesFromR2(c.env, notes);

	const tagsByNote = await fetchTagsByNoteIds(c.env.DB, hydratedNotes.map((item) => item.id));
	return jsonOk(c, {
		items: hydratedNotes.map((note) => ({
			...note,
			tags: tagsByNote.get(note.id) ?? [],
		})),
		paging: { limit, offset, count: hydratedNotes.length },
		filters: { folderId, tagIds, tagMode, keyword, status },
		search: { mode, keyword },
	});
});

app.get("/api/notes/:id", async (c) => {
	const noteId = c.req.param("id");
	const note = await getNoteById(c.env.DB, noteId);
	if (!note || note.deletedAt) {
		return jsonError(c, 404, "Note not found");
	}
	const tags = await fetchTagsForSingleNote(c.env.DB, noteId);
	const hydrated = await hydrateNoteBodyFromR2(c.env, note);
	return jsonOk(c, { ...hydrated, tags });
});

app.get("/api/notes/:id/links", async (c) => {
	const noteId = c.req.param("id");
	const statusParam = c.req.query("status");
	const status = normalizeNoteStatus(statusParam, c.req.query("includeArchived"));
	const note = await getNoteById(c.env.DB, noteId);
	if (!note) {
		return jsonError(c, 404, "Note not found");
	}
	if (!statusParam && note.deletedAt) {
		return jsonError(c, 404, "Note not found");
	}
	if (statusParam && !matchesNoteStatus(note, status)) {
		return jsonError(c, 404, "Note not found");
	}
	const linkNoteWhere = statusParam
		? buildNoteStatusWhere("n", status)
		: "n.deleted_at IS NULL";

	const { results: outbound } = await c.env.DB.prepare(
		`SELECT
			nl.target_note_id AS noteId,
			n.slug,
			n.title,
			COALESCE(n.deleted_at, n.updated_at) AS updatedAt,
			nl.anchor_text AS anchorText
		 FROM note_links nl
		 JOIN notes n ON n.id = nl.target_note_id
		 WHERE nl.source_note_id = ?
		   AND ${linkNoteWhere}
		 ORDER BY COALESCE(n.deleted_at, n.updated_at) DESC`,
	)
		.bind(noteId)
		.all();

	const { results: inbound } = await c.env.DB.prepare(
		`SELECT
			nl.source_note_id AS noteId,
			n.slug,
			n.title,
			COALESCE(n.deleted_at, n.updated_at) AS updatedAt,
			nl.anchor_text AS anchorText
		 FROM note_links nl
		 JOIN notes n ON n.id = nl.source_note_id
		 WHERE nl.target_note_id = ?
		   AND ${linkNoteWhere}
		 ORDER BY COALESCE(n.deleted_at, n.updated_at) DESC`,
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

	const bodyTextInput = readNullableString(payload, "bodyText") ?? "";
	const bodyR2KeyInput = readNullableString(payload, "bodyR2Key");
	const noteId = readOptionalString(payload, "id") ?? crypto.randomUUID();
	const initialSlug = slugify(readOptionalString(payload, "slug") ?? title);
	const slug = await ensureUniqueSlug(c.env.DB, initialSlug);
	const isPinned = parseBooleanLike(payload.isPinned) ? 1 : 0;
	const isArchived = parseBooleanLike(payload.isArchived) ? 1 : 0;

	let resolvedBody: NoteBodyStorageResult;
	try {
		resolvedBody = await resolveBodyStorageForCreate(c.env, {
			noteId,
			requestedStorageType: storageType,
			bodyText: bodyTextInput,
			bodyR2Key: bodyR2KeyInput,
		});
	} catch (error) {
		return jsonError(c, 500, "Failed to resolve note body storage", String(error));
	}

	const tagIdsInput = toStringArray(payload.tagIds);
	const tagNamesInput = [
		...toStringArray(payload.tagNames),
		...extractTagNames(payload.tags),
	];
	const { tagIds, missingTagIds, ignoredTagNames } = await resolveTagIds(
		c.env,
		c.env.DB,
		tagIdsInput,
		tagNamesInput,
	);
	if (missingTagIds.length > 0) {
		return jsonError(c, 400, "Some tagIds do not exist", missingTagIds.join(","));
	}
	if (ignoredTagNames.length > 0) {
		return jsonError(
			c,
			400,
			`Too many tag names, max ${getTagPerNoteLimit(c.env)}`,
			ignoredTagNames.join(","),
		);
	}

	const excerpt = readOptionalString(payload, "excerpt") ?? buildExcerpt(resolvedBody.plainBodyText);
	const sizeBytes =
		readOptionalNumber(payload, "sizeBytes") ??
		resolvedBody.sizeBytes;
	const wordCount =
		readOptionalNumber(payload, "wordCount") ??
		resolvedBody.wordCount;

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
			resolvedBody.storageType,
			resolvedBody.bodyText,
			resolvedBody.bodyR2Key,
			excerpt,
			sizeBytes,
			wordCount,
			isPinned,
			isArchived,
		)
		.run();

	await replaceNoteTags(c.env.DB, noteId, tagIds);

	const desiredLinkSlugs = hasOwn(payload, "linkSlugs")
		? toStringArray(payload.linkSlugs)
		: [];
	const linkResult = await replaceNoteLinks(c.env.DB, noteId, desiredLinkSlugs);
	const queuedAction: IndexAction = isArchived ? "delete" : "upsert";
	await enqueueNoteIndexJob(c.env.DB, noteId, queuedAction);
	scheduleIndexProcessing(c, 1);

	const created = await getNoteById(c.env.DB, noteId);
	const tags = await fetchTagsForSingleNote(c.env.DB, noteId);
	const hydrated = created ? await hydrateNoteBodyFromR2(c.env, created) : null;

	return jsonOk(
		c,
		{
			...(hydrated as NoteRow),
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
	const nextBodyTextInput = hasOwn(payload, "bodyText")
		? readNullableString(payload, "bodyText")
		: undefined;
	const nextBodyR2KeyInput = hasOwn(payload, "bodyR2Key")
		? readNullableString(payload, "bodyR2Key")
		: undefined;

	let resolvedBody: NoteBodyStorageResult;
	try {
		resolvedBody = await resolveBodyStorageForUpdate(c.env, {
			noteId,
			requestedStorageType: storageTypeCandidate,
			bodyTextInput: nextBodyTextInput,
			bodyR2KeyInput: nextBodyR2KeyInput,
			existing,
		});
	} catch (error) {
		return jsonError(c, 500, "Failed to resolve note body storage", String(error));
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
		? (readOptionalString(payload, "excerpt") ?? buildExcerpt(resolvedBody.plainBodyText))
		: buildExcerpt(resolvedBody.plainBodyText);
	const nextSizeBytes = hasOwn(payload, "sizeBytes")
		? (readOptionalNumber(payload, "sizeBytes") ?? 0)
		: resolvedBody.sizeBytes;
	const nextWordCount = hasOwn(payload, "wordCount")
		? (readOptionalNumber(payload, "wordCount") ?? 0)
		: resolvedBody.wordCount;

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
			resolvedBody.storageType,
			resolvedBody.bodyText,
			resolvedBody.bodyR2Key,
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
		const { tagIds, missingTagIds, ignoredTagNames } = await resolveTagIds(
			c.env,
			c.env.DB,
			tagIdsInput ?? [],
			tagNamesInput ?? [],
		);
		if (missingTagIds.length > 0) {
			return jsonError(c, 400, "Some tagIds do not exist", missingTagIds.join(","));
		}
		if (ignoredTagNames.length > 0) {
			return jsonError(
				c,
				400,
				`Too many tag names, max ${getTagPerNoteLimit(c.env)}`,
				ignoredTagNames.join(","),
			);
		}
		await replaceNoteTags(c.env.DB, noteId, tagIds);
	}

	let linkResult: { inserted: number; unresolvedSlugs: string[] } | null = null;
	const shouldSyncLinks = hasOwn(payload, "linkSlugs");
	if (shouldSyncLinks) {
		const desired = toStringArray(payload.linkSlugs);
		linkResult = await replaceNoteLinks(c.env.DB, noteId, desired);
	}
	const indexAction: IndexAction = nextIsArchived ? "delete" : "upsert";
	await enqueueNoteIndexJob(c.env.DB, noteId, indexAction);
	scheduleIndexProcessing(c, 1);

	const updated = await getNoteById(c.env.DB, noteId);
	const tags = await fetchTagsForSingleNote(c.env.DB, noteId);
	const hydrated = updated ? await hydrateNoteBodyFromR2(c.env, updated) : null;
	return jsonOk(c, { ...(hydrated as NoteRow), tags, links: linkResult });
});

app.delete("/api/notes/:id", async (c) => {
	const noteId = c.req.param("id");
	const result = await c.env.DB.prepare(
		`UPDATE notes
		 SET deleted_at = CURRENT_TIMESTAMP,
			 is_archived = 0
		 WHERE id = ? AND deleted_at IS NULL`,
	)
		.bind(noteId)
		.run();

	if (!result.success || (result.meta?.changes ?? 0) === 0) {
		return jsonError(c, 404, "Note not found");
	}
	await enqueueNoteIndexJob(c.env.DB, noteId, "delete");
	scheduleIndexProcessing(c, 1);

	return jsonOk(c, { id: noteId, deleted: true });
});

app.patch("/api/notes/:id/archive", async (c) => {
	const noteId = c.req.param("id");
	const payload = await parseObjectBody(c);
	const existing = await getNoteById(c.env.DB, noteId);
	if (!existing) {
		return jsonError(c, 404, "Note not found");
	}
	if (existing.deletedAt) {
		return jsonError(c, 409, "Deleted note cannot be archived");
	}

	const archived = payload && hasOwn(payload, "archived")
		? (parseBooleanLike(payload.archived) ? 1 : 0)
		: (existing.isArchived ? 0 : 1);

	await c.env.DB.prepare(
		`UPDATE notes
		 SET is_archived = ?
		 WHERE id = ? AND deleted_at IS NULL`,
	)
		.bind(archived, noteId)
		.run();
	await enqueueNoteIndexJob(c.env.DB, noteId, archived ? "delete" : "upsert");
	scheduleIndexProcessing(c, 1);

	const updated = await getNoteById(c.env.DB, noteId);
	const tags = await fetchTagsForSingleNote(c.env.DB, noteId);
	return jsonOk(c, { ...(updated as NoteRow), tags });
});

app.patch("/api/notes/:id/restore", async (c) => {
	const noteId = c.req.param("id");
	const existing = await getNoteById(c.env.DB, noteId);
	if (!existing) {
		return jsonError(c, 404, "Note not found");
	}
	if (!existing.deletedAt) {
		return jsonError(c, 409, "Note is not deleted");
	}

	await c.env.DB.prepare(
		`UPDATE notes
		 SET deleted_at = NULL,
			 is_archived = 0
		 WHERE id = ?`,
	)
		.bind(noteId)
		.run();
	await enqueueNoteIndexJob(c.env.DB, noteId, "upsert");
	scheduleIndexProcessing(c, 1);

	const restored = await getNoteById(c.env.DB, noteId);
	const tags = await fetchTagsForSingleNote(c.env.DB, noteId);
	return jsonOk(c, { ...(restored as NoteRow), tags });
});

app.delete("/api/notes/:id/hard", async (c) => {
	const noteId = c.req.param("id");
	const existing = await getNoteById(c.env.DB, noteId);
	if (!existing) {
		return jsonError(c, 404, "Note not found");
	}
	if (!existing.deletedAt) {
		return jsonError(c, 409, "Only deleted notes can be permanently removed");
	}

	const assetKeys = await listAssetKeysByNoteId(c.env.DB, noteId);
	await deleteObjectsFromR2(c.env, [
		...assetKeys,
		existing.bodyR2Key,
	]);
	await purgeNoteIndexData(c.env, noteId);

	await c.env.DB.prepare("DELETE FROM notes WHERE id = ?")
		.bind(noteId)
		.run();

	return jsonOk(c, { id: noteId, deleted: true, hardDeleted: true });
});

app.get("/api/notes/:id/assets", async (c) => {
	const noteId = c.req.param("id");
	const note = await getNoteById(c.env.DB, noteId);
	if (!note || note.deletedAt) {
		return jsonError(c, 404, "Note not found");
	}
	const { results } = await c.env.DB.prepare(
		`SELECT
			id,
			note_id AS noteId,
			r2_key AS r2Key,
			file_name AS fileName,
			mime_type AS mimeType,
			size_bytes AS sizeBytes,
			width,
			height,
			sha256,
			created_at AS createdAt
		 FROM assets
		 WHERE note_id = ?
		 ORDER BY created_at DESC`,
	)
		.bind(noteId)
		.all<AssetRow>();
	return jsonOk(c, results.map((item) => ({
		...item,
		downloadUrl: buildAssetDownloadUrl(item.id),
	})));
});

app.post("/api/assets/upload", async (c) => {
	const form = await c.req.formData().catch(() => null);
	if (!form) {
		return jsonError(c, 400, "Invalid form data");
	}
	const noteIdRaw = form.get("noteId");
	const noteId = typeof noteIdRaw === "string" ? noteIdRaw.trim() : "";
	if (!noteId) {
		return jsonError(c, 400, "`noteId` is required");
	}
	const note = await getNoteById(c.env.DB, noteId);
	if (!note || note.deletedAt) {
		return jsonError(c, 404, "Note not found");
	}
	const fileValue = form.get("file");
	if (!(fileValue instanceof File)) {
		return jsonError(c, 400, "`file` is required");
	}
	if (fileValue.size <= 0) {
		return jsonError(c, 400, "Empty file is not allowed");
	}

	const bucket = getNotesBucket(c.env);
	if (!bucket) {
		return jsonError(c, 500, "R2 bucket binding `NOTES_BUCKET` is missing");
	}

	const assetId = crypto.randomUUID();
	const fileName = sanitizeFileName(fileValue.name || "attachment");
	const r2Key = `${ASSET_R2_PREFIX}/${noteId}/${assetId}-${fileName}`;
	const binary = await fileValue.arrayBuffer();
	await bucket.put(r2Key, binary, {
		httpMetadata: {
			contentType: fileValue.type || "application/octet-stream",
		},
	});

	const sha256 = await sha256Hex(binary);
	await c.env.DB.prepare(
		`INSERT INTO assets (
			id, note_id, r2_key, file_name, mime_type, size_bytes, width, height, sha256
		) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
	)
		.bind(
			assetId,
			noteId,
			r2Key,
			fileName,
			fileValue.type || "application/octet-stream",
			fileValue.size,
			sha256,
		)
		.run();

	const created = await c.env.DB.prepare(
		`SELECT
			id,
			note_id AS noteId,
			r2_key AS r2Key,
			file_name AS fileName,
			mime_type AS mimeType,
			size_bytes AS sizeBytes,
			width,
			height,
			sha256,
			created_at AS createdAt
		 FROM assets
		 WHERE id = ?`,
	)
		.bind(assetId)
		.first<AssetRow>();

	return jsonOk(c, {
		...(created as AssetRow),
		downloadUrl: buildAssetDownloadUrl(assetId),
	}, 201);
});

app.get("/api/assets/:id/content", async (c) => {
	const assetId = c.req.param("id");
	const asset = await c.env.DB.prepare(
		`SELECT
			id,
			note_id AS noteId,
			r2_key AS r2Key,
			file_name AS fileName,
			mime_type AS mimeType,
			size_bytes AS sizeBytes,
			width,
			height,
			sha256,
			created_at AS createdAt
		 FROM assets
		 WHERE id = ?
		 LIMIT 1`,
	)
		.bind(assetId)
		.first<AssetRow>();
	if (!asset) {
		return jsonError(c, 404, "Asset not found");
	}

	const bucket = getNotesBucket(c.env);
	if (!bucket) {
		return jsonError(c, 500, "R2 bucket binding `NOTES_BUCKET` is missing");
	}
	const object = await bucket.get(asset.r2Key);
	if (!object) {
		return jsonError(c, 404, "Asset object not found");
	}

	const headers = new Headers();
	headers.set("Content-Type", asset.mimeType || "application/octet-stream");
	headers.set("Cache-Control", "public, max-age=300");
	if (asset.fileName) {
		headers.set("Content-Disposition", `inline; filename="${asset.fileName.replace(/"/g, "'")}"`);
	}
	return new Response(object.body, { status: 200, headers });
});

app.delete("/api/assets/:id", async (c) => {
	const assetId = c.req.param("id");
	const asset = await c.env.DB.prepare(
		`SELECT
			id,
			note_id AS noteId,
			r2_key AS r2Key,
			file_name AS fileName,
			mime_type AS mimeType,
			size_bytes AS sizeBytes,
			width,
			height,
			sha256,
			created_at AS createdAt
		 FROM assets
		 WHERE id = ?
		 LIMIT 1`,
	)
		.bind(assetId)
		.first<AssetRow>();
	if (!asset) {
		return jsonError(c, 404, "Asset not found");
	}

	await deleteObjectsFromR2(c.env, [asset.r2Key]);
	await c.env.DB.prepare("DELETE FROM assets WHERE id = ?")
		.bind(assetId)
		.run();
	return jsonOk(c, { id: assetId, deleted: true });
});

app.post("/api/notes/storage/migrate", async (c) => {
	const payload = (await parseObjectBody(c)) ?? {};
	const dryRun = parseBooleanLike(payload.dryRun);
	const limit = clampInt(
		typeof payload.limit === "string" ? payload.limit : String(readOptionalNumber(payload, "limit") ?? "50"),
		50,
		1,
		200,
	);
	const minBytes = clampInt(
		typeof payload.minBytes === "string"
			? payload.minBytes
			: String(readOptionalNumber(payload, "minBytes") ?? getBodyR2ThresholdBytes(c.env)),
		getBodyR2ThresholdBytes(c.env),
		1,
		5_000_000,
	);

	const bucket = getNotesBucket(c.env);
	if (!bucket) {
		return jsonError(c, 500, "R2 bucket binding `NOTES_BUCKET` is missing");
	}

	const { results } = await c.env.DB.prepare(
		`SELECT
			id,
			body_text AS bodyText,
			size_bytes AS sizeBytes
		 FROM notes
		 WHERE storage_type = 'd1'
		   AND body_text IS NOT NULL
		   AND size_bytes >= ?
		   AND deleted_at IS NULL
		 ORDER BY updated_at DESC
		 LIMIT ?`,
	)
		.bind(minBytes, limit)
		.all<{ id: string; bodyText: string; sizeBytes: number }>();

	const migrated: string[] = [];
	for (const item of results) {
		if (dryRun) {
			migrated.push(item.id);
			continue;
		}
		const bodyR2Key = `${NOTE_BODY_R2_PREFIX}/${item.id}.md`;
		await bucket.put(bodyR2Key, item.bodyText, {
			httpMetadata: { contentType: "text/markdown; charset=utf-8" },
		});
		await c.env.DB.prepare(
			`UPDATE notes
			 SET storage_type = 'r2',
				 body_text = NULL,
				 body_r2_key = ?
			 WHERE id = ?`,
		)
			.bind(bodyR2Key, item.id)
			.run();
		migrated.push(item.id);
	}

	return jsonOk(c, {
		dryRun,
		limit,
		minBytes,
		scanned: results.length,
		migrated: migrated.length,
		noteIds: migrated,
	});
});

app.get("/api/index/jobs", async (c) => {
	await ensureNoteIndexSchema(c.env.DB);
	const statusInput = c.req.query("status");
	const limit = clampInt(c.req.query("limit"), 50, 1, 200);
	const offset = clampInt(c.req.query("offset"), 0, 0, 5000);
	const statuses = parseCsv(statusInput).filter(
		(item): item is IndexJobStatus =>
			item === "pending" || item === "processing" || item === "success" || item === "failed",
	);
	const where: string[] = [];
	const params: Array<string | number> = [];
	if (statuses.length > 0) {
		where.push(`j.status IN (${placeholders(statuses.length)})`);
		params.push(...statuses);
	}

	const sql = `
		SELECT
			j.note_id AS noteId,
			j.action,
			j.status,
			j.attempt_count AS attemptCount,
			j.chunk_count AS chunkCount,
			j.last_error AS lastError,
			j.next_retry_at AS nextRetryAt,
			j.last_indexed_at AS lastIndexedAt,
			j.created_at AS createdAt,
			j.updated_at AS updatedAt,
			n.title AS noteTitle
		FROM note_index_jobs j
		LEFT JOIN notes n ON n.id = j.note_id
		${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
		ORDER BY
			CASE j.status
				WHEN 'failed' THEN 0
				WHEN 'pending' THEN 1
				WHEN 'processing' THEN 2
				ELSE 3
			END ASC,
			j.updated_at DESC
		LIMIT ? OFFSET ?
	`;
	const { results } = await c.env.DB.prepare(sql)
		.bind(...params, limit, offset)
		.all<NoteIndexJobRow & { noteTitle: string | null }>();
	return jsonOk(c, {
		items: results,
		paging: { limit, offset, count: results.length },
	});
});

app.post("/api/index/process", async (c) => {
	const payload = (await parseObjectBody(c)) ?? {};
	const limit = clampInt(
		typeof payload.limit === "string" ? payload.limit : String(readOptionalNumber(payload, "limit") ?? 5),
		5,
		1,
		50,
	);
	const processed = await processPendingIndexJobs(c.env, limit);
	return jsonOk(c, {
		limit,
		processed: processed.length,
		results: processed,
	});
});

app.post("/api/index/rebuild", async (c) => {
	const payload = (await parseObjectBody(c)) ?? {};
	const dryRun = parseBooleanLike(payload.dryRun);
	const includeDeleted = parseBooleanLike(payload.includeDeleted);
	const includeArchived = parseBooleanLike(payload.includeArchived);
	const limit = clampInt(
		typeof payload.limit === "string" ? payload.limit : String(readOptionalNumber(payload, "limit") ?? 500),
		500,
		1,
		2000,
	);
	const noteId = readOptionalString(payload, "noteId");

	const where: string[] = [];
	const params: Array<string | number> = [];
	if (!includeDeleted) {
		where.push("deleted_at IS NULL");
	}
	if (!includeArchived) {
		where.push("is_archived = 0");
	}
	if (noteId) {
		where.push("id = ?");
		params.push(noteId);
	}

	const sql = `
		SELECT id, deleted_at AS deletedAt, is_archived AS isArchived
		FROM notes
		${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
		ORDER BY updated_at DESC
		LIMIT ?
	`;
	const { results } = await c.env.DB.prepare(sql)
		.bind(...params, limit)
		.all<{ id: string; deletedAt: string | null; isArchived: number }>();

	const pending: Array<{ noteId: string; action: IndexAction }> = results.map((row) => ({
		noteId: row.id,
		action: row.deletedAt || row.isArchived ? "delete" : "upsert",
	}));
	if (!dryRun) {
		for (const item of pending) {
			await enqueueNoteIndexJob(c.env.DB, item.noteId, item.action);
		}
		scheduleIndexProcessing(c, Math.min(10, pending.length || 1));
	}

	return jsonOk(c, {
		dryRun,
		limit,
		enqueued: pending.length,
		items: pending,
	});
});

app.post("/api/notes/:id/index/retry", async (c) => {
	const noteId = c.req.param("id");
	const existing = await getNoteById(c.env.DB, noteId);
	if (!existing) {
		return jsonError(c, 404, "Note not found");
	}
	const action: IndexAction = existing.deletedAt || existing.isArchived ? "delete" : "upsert";
	await enqueueNoteIndexJob(c.env.DB, noteId, action);
	const processed = await processPendingIndexJobs(c.env, 1);
	return jsonOk(c, {
		noteId,
		action,
		processed: processed[0] ?? null,
	});
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

function getNotesBucket(env: Env): R2Bucket | null {
	return "NOTES_BUCKET" in env && env.NOTES_BUCKET ? env.NOTES_BUCKET : null;
}

function getBodyR2ThresholdBytes(env: Env): number {
	const value = "BODY_R2_THRESHOLD_BYTES" in env ? Number(env.BODY_R2_THRESHOLD_BYTES) : Number.NaN;
	if (Number.isFinite(value) && value > 0) {
		return Math.trunc(value);
	}
	return DEFAULT_BODY_R2_THRESHOLD_BYTES;
}

function getTagNameMaxLength(env: Env): number {
	const ext = env as Env & { TAG_NAME_MAX_LENGTH?: string };
	const parsed = Number(ext.TAG_NAME_MAX_LENGTH);
	if (Number.isFinite(parsed) && parsed >= 16 && parsed <= 128) {
		return Math.trunc(parsed);
	}
	return DEFAULT_TAG_NAME_MAX_LENGTH;
}

function getTagPerNoteLimit(env: Env): number {
	const ext = env as Env & { TAG_PER_NOTE_LIMIT?: string };
	const parsed = Number(ext.TAG_PER_NOTE_LIMIT);
	if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 64) {
		return Math.trunc(parsed);
	}
	return DEFAULT_TAG_PER_NOTE_LIMIT;
}

function getIndexMaxChars(env: Env): number {
	const ext = env as Env & { INDEX_CHUNK_MAX_CHARS?: string };
	const parsed = Number(ext.INDEX_CHUNK_MAX_CHARS);
	if (Number.isFinite(parsed) && parsed >= 200 && parsed <= 5000) {
		return Math.trunc(parsed);
	}
	return DEFAULT_INDEX_MAX_CHARS;
}

function getIndexOverlapChars(env: Env): number {
	const ext = env as Env & { INDEX_CHUNK_OVERLAP_CHARS?: string };
	const parsed = Number(ext.INDEX_CHUNK_OVERLAP_CHARS);
	if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1000) {
		return Math.trunc(parsed);
	}
	return DEFAULT_INDEX_OVERLAP_CHARS;
}

function getIndexRetryMaxAttempts(env: Env): number {
	const ext = env as Env & { INDEX_RETRY_MAX_ATTEMPTS?: string };
	const parsed = Number(ext.INDEX_RETRY_MAX_ATTEMPTS);
	if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 20) {
		return Math.trunc(parsed);
	}
	return DEFAULT_INDEX_RETRY_MAX_ATTEMPTS;
}

function getIndexRetryBackoffSeconds(env: Env): number {
	const ext = env as Env & { INDEX_RETRY_BACKOFF_SECONDS?: string };
	const parsed = Number(ext.INDEX_RETRY_BACKOFF_SECONDS);
	if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 600) {
		return Math.trunc(parsed);
	}
	return DEFAULT_INDEX_RETRY_BACKOFF_SECONDS;
}

function getIndexVectorDimensions(env: Env): number {
	const ext = env as Env & { INDEX_VECTOR_DIMENSIONS?: string };
	const parsed = Number(ext.INDEX_VECTOR_DIMENSIONS);
	if (Number.isFinite(parsed) && parsed >= 8 && parsed <= 2048) {
		return Math.trunc(parsed);
	}
	return DEFAULT_INDEX_VECTOR_DIMENSIONS;
}

function getIndexEmbeddingModel(env: Env): string {
	const ext = env as Env & { INDEX_EMBEDDING_MODEL?: string };
	const candidate = typeof ext.INDEX_EMBEDDING_MODEL === "string" ? ext.INDEX_EMBEDDING_MODEL.trim() : "";
	return candidate || DEFAULT_INDEX_EMBEDDING_MODEL;
}

function getNotesVectorIndex(env: Env): (Pick<VectorizeIndex, "upsert" | "deleteByIds"> | Pick<Vectorize, "upsert" | "deleteByIds">) | null {
	const ext = env as Env & { NOTES_VECTOR_INDEX?: VectorizeIndex | Vectorize };
	return ext.NOTES_VECTOR_INDEX ?? null;
}

async function resolveBodyStorageForCreate(
	env: Env,
	input: {
		noteId: string;
		requestedStorageType: "d1" | "r2";
		bodyText: string;
		bodyR2Key: string | null;
	},
): Promise<NoteBodyStorageResult> {
	const plainBodyText = input.bodyText;
	const sizeBytes = byteLength(plainBodyText);
	const wordCount = countWords(plainBodyText);
	const threshold = getBodyR2ThresholdBytes(env);
	const bucket = getNotesBucket(env);

	if (input.requestedStorageType === "r2") {
		const key = input.bodyR2Key || `${NOTE_BODY_R2_PREFIX}/${input.noteId}.md`;
		if (!input.bodyR2Key) {
			if (!bucket) {
				throw new Error("R2 bucket binding `NOTES_BUCKET` is missing");
			}
			await bucket.put(key, plainBodyText, {
				httpMetadata: { contentType: "text/markdown; charset=utf-8" },
			});
		}
		return {
			storageType: "r2",
			bodyText: null,
			bodyR2Key: key,
			plainBodyText,
			sizeBytes,
			wordCount,
		};
	}

	if (sizeBytes > threshold) {
		if (!bucket) {
			throw new Error("R2 bucket binding `NOTES_BUCKET` is missing");
		}
		const key = `${NOTE_BODY_R2_PREFIX}/${input.noteId}.md`;
		await bucket.put(key, plainBodyText, {
			httpMetadata: { contentType: "text/markdown; charset=utf-8" },
		});
		return {
			storageType: "r2",
			bodyText: null,
			bodyR2Key: key,
			plainBodyText,
			sizeBytes,
			wordCount,
		};
	}

	return {
		storageType: "d1",
		bodyText: plainBodyText,
		bodyR2Key: null,
		plainBodyText,
		sizeBytes,
		wordCount,
	};
}

async function resolveBodyStorageForUpdate(
	env: Env,
	input: {
		noteId: string;
		requestedStorageType: "d1" | "r2";
		bodyTextInput: string | null | undefined;
		bodyR2KeyInput: string | null | undefined;
		existing: NoteRow;
	},
): Promise<NoteBodyStorageResult> {
	const bodyChanged = input.bodyTextInput !== undefined;
	const storageChanged = input.requestedStorageType !== input.existing.storageType;
	const bodyR2KeyChanged = input.bodyR2KeyInput !== undefined;
	const noStorageMutation = !bodyChanged && !storageChanged && !bodyR2KeyChanged;

	if (noStorageMutation) {
		const plain = input.existing.storageType === "d1"
			? (input.existing.bodyText ?? "")
			: await readNoteBodyFromR2(env, input.existing.bodyR2Key);
		return {
			storageType: input.existing.storageType,
			bodyText: input.existing.bodyText,
			bodyR2Key: input.existing.bodyR2Key,
			plainBodyText: plain,
			sizeBytes: byteLength(plain),
			wordCount: countWords(plain),
		};
	}

	let plainBodyText = "";
	if (bodyChanged) {
		plainBodyText = input.bodyTextInput ?? "";
	} else if (input.existing.storageType === "d1") {
		plainBodyText = input.existing.bodyText ?? "";
	} else {
		plainBodyText = await readNoteBodyFromR2(env, input.existing.bodyR2Key);
	}

	const sizeBytes = byteLength(plainBodyText);
	const wordCount = countWords(plainBodyText);
	const threshold = getBodyR2ThresholdBytes(env);
	const bucket = getNotesBucket(env);

	if (input.requestedStorageType === "r2") {
		const key = input.bodyR2KeyInput ?? input.existing.bodyR2Key ?? `${NOTE_BODY_R2_PREFIX}/${input.noteId}.md`;
		const shouldWriteBody =
			bodyChanged ||
			!input.existing.bodyR2Key ||
			(input.bodyR2KeyInput !== undefined && input.bodyR2KeyInput !== input.existing.bodyR2Key);
		if (shouldWriteBody) {
			if (!bucket) {
				throw new Error("R2 bucket binding `NOTES_BUCKET` is missing");
			}
			await bucket.put(key, plainBodyText, {
				httpMetadata: { contentType: "text/markdown; charset=utf-8" },
			});
		}
		if (input.existing.bodyR2Key && input.existing.bodyR2Key !== key) {
			await deleteObjectsFromR2(env, [input.existing.bodyR2Key]);
		}
		return {
			storageType: "r2",
			bodyText: null,
			bodyR2Key: key,
			plainBodyText,
			sizeBytes,
			wordCount,
		};
	}

	if (sizeBytes > threshold) {
		if (!bucket) {
			throw new Error("R2 bucket binding `NOTES_BUCKET` is missing");
		}
		const key = input.existing.bodyR2Key ?? `${NOTE_BODY_R2_PREFIX}/${input.noteId}.md`;
		await bucket.put(key, plainBodyText, {
			httpMetadata: { contentType: "text/markdown; charset=utf-8" },
		});
		return {
			storageType: "r2",
			bodyText: null,
			bodyR2Key: key,
			plainBodyText,
			sizeBytes,
			wordCount,
		};
	}

	if (input.existing.bodyR2Key) {
		await deleteObjectsFromR2(env, [input.existing.bodyR2Key]);
	}
	return {
		storageType: "d1",
		bodyText: plainBodyText,
		bodyR2Key: null,
		plainBodyText,
		sizeBytes,
		wordCount,
	};
}

async function hydrateNoteBodiesFromR2(env: Env, notes: NoteRow[]): Promise<NoteRow[]> {
	return Promise.all(notes.map((note) => hydrateNoteBodyFromR2(env, note)));
}

async function hydrateNoteBodyFromR2(env: Env, note: NoteRow): Promise<NoteRow> {
	if (note.storageType !== "r2") {
		return note;
	}
	const text = await readNoteBodyFromR2(env, note.bodyR2Key);
	return {
		...note,
		bodyText: text,
	};
}

async function readNoteBodyFromR2(env: Env, bodyR2Key: string | null): Promise<string> {
	if (!bodyR2Key) {
		return "";
	}
	const bucket = getNotesBucket(env);
	if (!bucket) {
		return "";
	}
	const object = await bucket.get(bodyR2Key);
	if (!object) {
		return "";
	}
	return object.text();
}

async function deleteObjectsFromR2(env: Env, keys: Array<string | null | undefined>): Promise<void> {
	const bucket = getNotesBucket(env);
	if (!bucket) {
		return;
	}
	const filtered = [...new Set(keys.filter((key): key is string => Boolean(key)))];
	for (const key of filtered) {
		await bucket.delete(key);
	}
}

async function listNotesWithSearchMode(
	db: D1Database,
	input: ListNotesQueryInput,
): Promise<{ notes: NoteRow[]; mode: NoteSearchMode }> {
	if (!input.keyword) {
		const notes = await queryNotesWithLike(db, input, false);
		return { notes, mode: "none" };
	}

	const ftsMatchQuery = buildFtsMatchQuery(input.keyword);
	if (!ftsMatchQuery) {
		const notes = await queryNotesWithLike(db, input, true);
		return { notes, mode: "like-fallback" };
	}

	try {
		const notes = await queryNotesWithFts(db, input, ftsMatchQuery);
		return { notes, mode: "fts" };
	} catch (error) {
		console.error("FTS query failed, falling back to LIKE", error);
		const notes = await queryNotesWithLike(db, input, true);
		return { notes, mode: "like-fallback" };
	}
}

async function queryNotesWithFts(
	db: D1Database,
	input: ListNotesQueryInput,
	ftsMatchQuery: string,
): Promise<NoteRow[]> {
	const { where, params } = buildNotesListWhere("n", input);
	const escapedPrefix = `${escapeLikePattern(input.keyword)}%`;
	const sql = `
		WITH fts_hits AS (
			SELECT
				rowid AS noteRowId,
				bm25(notes_fts, 12.0, 4.0, 1.0) AS rank
			FROM notes_fts
			WHERE notes_fts MATCH ?
		)
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
			n.updated_at AS updatedAt,
			fh.rank AS searchScore
		FROM notes n
		JOIN fts_hits fh ON fh.noteRowId = n.rowid
		${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
		ORDER BY
			CASE WHEN LOWER(n.title) = LOWER(?) THEN 0 ELSE 1 END ASC,
			CASE WHEN LOWER(n.title) LIKE LOWER(?) ESCAPE '\\' THEN 0 ELSE 1 END ASC,
			fh.rank ASC,
			n.is_pinned DESC,
			COALESCE(n.deleted_at, n.updated_at) DESC
		LIMIT ? OFFSET ?
	`;

	const bindings: Array<string | number> = [
		ftsMatchQuery,
		...params,
		input.keyword,
		escapedPrefix,
		input.limit,
		input.offset,
	];
	const { results } = await db.prepare(sql).bind(...bindings).all<NoteRow>();
	return results;
}

async function queryNotesWithLike(
	db: D1Database,
	input: ListNotesQueryInput,
	includeKeyword: boolean,
): Promise<NoteRow[]> {
	const { where, params } = buildNotesListWhere("n", input);
	let escapedPrefix = "";
	if (includeKeyword && input.keyword) {
		const escapedLike = `%${escapeLikePattern(input.keyword)}%`;
		escapedPrefix = `${escapeLikePattern(input.keyword)}%`;
		where.push(
			"(n.title LIKE ? ESCAPE '\\' OR n.excerpt LIKE ? ESCAPE '\\' OR COALESCE(n.body_text, '') LIKE ? ESCAPE '\\')",
		);
		params.push(escapedLike, escapedLike, escapedLike);
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
			n.updated_at AS updatedAt,
			NULL AS searchScore
		FROM notes n
		${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
		ORDER BY
			${includeKeyword && input.keyword
				? "CASE WHEN LOWER(n.title) = LOWER(?) THEN 0 ELSE 1 END ASC,\n\t\t\tCASE WHEN LOWER(n.title) LIKE LOWER(?) ESCAPE '\\' THEN 0 ELSE 1 END ASC,"
				: ""}
			CASE WHEN n.deleted_at IS NULL THEN 0 ELSE 1 END ASC,
			n.is_pinned DESC,
			COALESCE(n.deleted_at, n.updated_at) DESC
		LIMIT ? OFFSET ?
	`;

	const orderParams: Array<string | number> = [];
	if (includeKeyword && input.keyword) {
		orderParams.push(input.keyword, escapedPrefix);
	}
	const bindings = [...params, ...orderParams, input.limit, input.offset];
	const { results } = await db.prepare(sql).bind(...bindings).all<NoteRow>();
	return results;
}

function buildNotesListWhere(
	alias: string,
	input: Pick<ListNotesQueryInput, "folderId" | "tagIds" | "tagMode" | "status">,
): { where: string[]; params: Array<string | number> } {
	const where: string[] = [buildNoteStatusWhere(alias, input.status)];
	const params: Array<string | number> = [];

	if (input.folderId) {
		where.push(`${alias}.folder_id = ?`);
		params.push(input.folderId);
	}
	if (input.tagIds.length > 0) {
		const marks = placeholders(input.tagIds.length);
		if (input.tagMode === "all") {
			where.push(
				`${alias}.id IN (
					SELECT nt.note_id
					FROM note_tags nt
					WHERE nt.tag_id IN (${marks})
					GROUP BY nt.note_id
					HAVING COUNT(DISTINCT nt.tag_id) = ?
				)`,
			);
			params.push(...input.tagIds, input.tagIds.length);
		} else {
			where.push(
				`EXISTS (
					SELECT 1 FROM note_tags nt
					WHERE nt.note_id = ${alias}.id AND nt.tag_id IN (${marks})
				)`,
			);
			params.push(...input.tagIds);
		}
	}
	return { where, params };
}

function buildFtsMatchQuery(keyword: string): string {
	const tokens = keyword
		.trim()
		.split(/\s+/u)
		.map((item) => item.trim())
		.filter((item) => item.length > 0)
		.map((item) => item.replace(/"/g, "\"\""));
	if (tokens.length === 0) {
		return "";
	}
	return tokens.map((token) => `"${token}"*`).join(" AND ");
}

function escapeLikePattern(value: string): string {
	return value.replace(/[\\%_]/g, "\\$&");
}

function normalizeTagMode(value: string | undefined): TagMode {
	return value === "all" ? "all" : "any";
}

function normalizeNoteStatus(
	value: string | undefined,
	legacyIncludeArchived: string | undefined,
): NoteStatusFilter {
	if (value === "active" || value === "archived" || value === "deleted" || value === "all") {
		return value;
	}
	if (parseBoolean(legacyIncludeArchived)) {
		return "all";
	}
	return "active";
}

function buildNoteStatusWhere(alias: string, status: NoteStatusFilter): string {
	if (status === "active") {
		return `${alias}.deleted_at IS NULL AND ${alias}.is_archived = 0`;
	}
	if (status === "archived") {
		return `${alias}.deleted_at IS NULL AND ${alias}.is_archived = 1`;
	}
	if (status === "deleted") {
		return `${alias}.deleted_at IS NOT NULL`;
	}
	return "1 = 1";
}

function matchesNoteStatus(note: Pick<NoteRow, "isArchived" | "deletedAt">, status: NoteStatusFilter): boolean {
	if (status === "all") {
		return true;
	}
	if (status === "deleted") {
		return note.deletedAt !== null;
	}
	if (status === "archived") {
		return note.deletedAt === null && note.isArchived === 1;
	}
	return note.deletedAt === null && note.isArchived === 0;
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
			updated_at AS updatedAt,
			NULL AS searchScore
		 FROM notes
		 WHERE id = ?
		 LIMIT 1`,
	)
		.bind(noteId)
		.first<NoteRow>();
	return note ?? null;
}

function buildAssetDownloadUrl(assetId: string): string {
	return `/api/assets/${encodeURIComponent(assetId)}/content`;
}

function sanitizeFileName(input: string): string {
	const trimmed = input.trim();
	const sanitized = trimmed
		.replace(/[^\p{L}\p{N}._-]+/gu, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 120);
	return sanitized || "attachment";
}

async function sha256Hex(value: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", value);
	const bytes = new Uint8Array(digest);
	return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function listAssetKeysByNoteId(db: D1Database, noteId: string): Promise<string[]> {
	const { results } = await db.prepare(
		`SELECT r2_key AS r2Key
		 FROM assets
		 WHERE note_id = ?`,
	)
		.bind(noteId)
		.all<{ r2Key: string }>();
	return results.map((item) => item.r2Key);
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
	env: Env,
	db: D1Database,
	tagIdsInput: string[],
	tagNamesInput: string[],
): Promise<{ tagIds: string[]; missingTagIds: string[]; ignoredTagNames: string[] }> {
	const uniqueTagIds = [...new Set(tagIdsInput)];
	const uniqueTagNames = normalizeTagNames(tagNamesInput, getTagNameMaxLength(env));
	const tagNameLimit = getTagPerNoteLimit(env);
	const acceptedTagNames = uniqueTagNames.slice(0, tagNameLimit);
	const ignoredTagNames = uniqueTagNames.slice(tagNameLimit);

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

	for (const name of acceptedTagNames) {
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

	return { tagIds: [...resolvedIds], missingTagIds, ignoredTagNames };
}

function normalizeTagNames(values: string[], maxLength: number): string[] {
	const unique = new Set<string>();
	for (const value of values) {
		const normalized = normalizeTagName(value, maxLength);
		if (normalized) {
			unique.add(normalized);
		}
	}
	return [...unique];
}

function normalizeTagName(value: string, maxLength = DEFAULT_TAG_NAME_MAX_LENGTH): string {
	const trimmed = value.trim().toLowerCase();
	if (!trimmed) {
		return "";
	}
	const normalized = trimmed
		.replace(/\s+/g, "-")
		.replace(/[^\p{L}\p{N}_-]+/gu, "-")
		.replace(/-+/g, "-")
		.replace(/^[-_]+|[-_]+$/g, "")
		.slice(0, maxLength);
	return normalized;
}

async function listOrphanTags(
	db: D1Database,
	limit: number,
): Promise<Array<{ id: string; name: string; color: string; createdAt: string }>> {
	const { results } = await db.prepare(
		`SELECT
			t.id,
			t.name,
			t.color,
			t.created_at AS createdAt
		 FROM tags t
		 LEFT JOIN note_tags nt ON nt.tag_id = t.id
		 WHERE nt.note_id IS NULL
		 ORDER BY t.created_at ASC
		 LIMIT ?`,
	)
		.bind(limit)
		.all<{ id: string; name: string; color: string; createdAt: string }>();
	return results;
}

async function mergeTags(db: D1Database, sourceTagId: string, targetTagId: string): Promise<number> {
	const movedCount = await db.prepare(
		"SELECT COUNT(DISTINCT note_id) AS count FROM note_tags WHERE tag_id = ?",
	)
		.bind(sourceTagId)
		.first<number>("count");
	await db.prepare(
		`INSERT OR IGNORE INTO note_tags (note_id, tag_id)
		 SELECT note_id, ?
		 FROM note_tags
		 WHERE tag_id = ?`,
	)
		.bind(targetTagId, sourceTagId)
		.run();
	await db.prepare("DELETE FROM note_tags WHERE tag_id = ?")
		.bind(sourceTagId)
		.run();
	await db.prepare("DELETE FROM tags WHERE id = ?")
		.bind(sourceTagId)
		.run();
	return movedCount ?? 0;
}

async function detachAndDeleteTag(db: D1Database, tagId: string): Promise<number> {
	const detached = await db.prepare("SELECT COUNT(*) AS count FROM note_tags WHERE tag_id = ?")
		.bind(tagId)
		.first<number>("count");
	await db.prepare("DELETE FROM note_tags WHERE tag_id = ?")
		.bind(tagId)
		.run();
	await db.prepare("DELETE FROM tags WHERE id = ?")
		.bind(tagId)
		.run();
	return detached ?? 0;
}

function scheduleIndexProcessing(c: AppContext, limit: number): void {
	if (!c.executionCtx || typeof c.executionCtx.waitUntil !== "function") {
		return;
	}
	c.executionCtx.waitUntil(
		processPendingIndexJobs(c.env, limit).catch((error) => {
			console.error("Background note index processing failed", error);
		}),
	);
}

async function ensureNoteIndexSchema(db: D1Database): Promise<void> {
	await db.prepare(
		`CREATE TABLE IF NOT EXISTS note_index_jobs (
			note_id TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
			action TEXT NOT NULL DEFAULT 'upsert' CHECK (action IN ('upsert', 'delete')),
			status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'success', 'failed')),
			attempt_count INTEGER NOT NULL DEFAULT 0,
			chunk_count INTEGER NOT NULL DEFAULT 0,
			last_error TEXT,
			next_retry_at TEXT,
			last_indexed_at TEXT,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
	).run();
	await db.prepare(
		"CREATE INDEX IF NOT EXISTS idx_note_index_jobs_status_retry ON note_index_jobs(status, next_retry_at, updated_at)",
	).run();
	await db.prepare(
		`CREATE TRIGGER IF NOT EXISTS trg_note_index_jobs_updated_at
		AFTER UPDATE ON note_index_jobs
		FOR EACH ROW
		WHEN NEW.updated_at = OLD.updated_at
		BEGIN
			UPDATE note_index_jobs SET updated_at = CURRENT_TIMESTAMP WHERE note_id = OLD.note_id;
		END`,
	).run();
}

async function enqueueNoteIndexJob(db: D1Database, noteId: string, action: IndexAction): Promise<void> {
	await ensureNoteIndexSchema(db);
	await db.prepare(
		`INSERT INTO note_index_jobs (
			note_id, action, status, attempt_count, chunk_count, last_error, next_retry_at, last_indexed_at
		) VALUES (?, ?, 'pending', 0, 0, NULL, NULL, NULL)
		ON CONFLICT(note_id) DO UPDATE SET
			action = excluded.action,
			status = 'pending',
			last_error = NULL,
			next_retry_at = NULL,
			updated_at = CURRENT_TIMESTAMP`,
	)
		.bind(noteId, action)
		.run();
}

async function processPendingIndexJobs(env: Env, limit: number): Promise<NoteIndexProcessResult[]> {
	await ensureNoteIndexSchema(env.DB);
	const { results } = await env.DB.prepare(
		`SELECT
			note_id AS noteId,
			action,
			status,
			attempt_count AS attemptCount
		 FROM note_index_jobs
		 WHERE status IN ('pending', 'failed')
		   AND (next_retry_at IS NULL OR next_retry_at <= datetime('now'))
		 ORDER BY
			CASE status
				WHEN 'failed' THEN 0
				ELSE 1
			END ASC,
			updated_at ASC
		 LIMIT ?`,
	)
		.bind(limit)
		.all<{ noteId: string; action: IndexAction; status: IndexJobStatus; attemptCount: number }>();

	const output: NoteIndexProcessResult[] = [];
	for (const job of results) {
		await env.DB.prepare(
			`UPDATE note_index_jobs
			 SET status = 'processing',
				 updated_at = CURRENT_TIMESTAMP
			 WHERE note_id = ?`,
		)
			.bind(job.noteId)
			.run();

		try {
			const chunkCount = await processSingleNoteIndexJob(env, job.noteId, job.action);
			await env.DB.prepare(
				`UPDATE note_index_jobs
				 SET status = 'success',
					 chunk_count = ?,
					 attempt_count = ?,
					 last_error = NULL,
					 next_retry_at = NULL,
					 last_indexed_at = CURRENT_TIMESTAMP,
					 updated_at = CURRENT_TIMESTAMP
				 WHERE note_id = ?`,
			)
				.bind(chunkCount, job.attemptCount + 1, job.noteId)
				.run();
			output.push({
				noteId: job.noteId,
				action: job.action,
				status: "success",
				chunkCount,
				error: null,
				attemptCount: job.attemptCount + 1,
			});
		} catch (error) {
			const attempts = job.attemptCount + 1;
			const maxAttempts = getIndexRetryMaxAttempts(env);
			const backoffSeconds = getIndexRetryBackoffSeconds(env) * Math.max(1, 2 ** (attempts - 1));
			const boundedBackoff = Math.min(backoffSeconds, 3600);
			const nextRetry = attempts >= maxAttempts ? null : toSqliteDatetime(Date.now() + boundedBackoff * 1000);
			await env.DB.prepare(
				`UPDATE note_index_jobs
				 SET status = 'failed',
					 attempt_count = ?,
					 last_error = ?,
					 next_retry_at = ?,
					 updated_at = CURRENT_TIMESTAMP
				 WHERE note_id = ?`,
			)
				.bind(attempts, String(error), nextRetry, job.noteId)
				.run();
			output.push({
				noteId: job.noteId,
				action: job.action,
				status: "failed",
				chunkCount: 0,
				error: String(error),
				attemptCount: attempts,
			});
		}
	}

	return output;
}

async function processSingleNoteIndexJob(env: Env, noteId: string, action: IndexAction): Promise<number> {
	if (action === "delete") {
		await clearNoteChunksAndVectors(env, noteId);
		return 0;
	}

	const note = await getNoteById(env.DB, noteId);
	if (!note || note.deletedAt || note.isArchived) {
		await clearNoteChunksAndVectors(env, noteId);
		return 0;
	}

	const hydrated = await hydrateNoteBodyFromR2(env, note);
	const bodyText = hydrated.bodyText ?? "";
	const chunks = buildNoteChunks(bodyText, getIndexMaxChars(env), getIndexOverlapChars(env));
	await upsertNoteChunksToVectorIndex(env, hydrated, chunks);
	return chunks.length;
}

function buildNoteChunks(
	bodyText: string,
	maxChars: number,
	overlapChars: number,
): Array<{ chunkIndex: number; chunkText: string; tokenCount: number }> {
	const normalized = bodyText.replace(/\r\n/g, "\n").trim();
	if (!normalized) {
		return [];
	}

	const paragraphs = normalized
		.split(/\n{2,}/u)
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
	const rawChunks: string[] = [];
	let current = "";
	for (const paragraph of paragraphs) {
		const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
		if (candidate.length <= maxChars) {
			current = candidate;
			continue;
		}
		if (current) {
			rawChunks.push(current);
		}
		if (paragraph.length <= maxChars) {
			current = paragraph;
			continue;
		}
		const longParagraphChunks = splitLongText(paragraph, maxChars, overlapChars);
		rawChunks.push(...longParagraphChunks.slice(0, -1));
		current = longParagraphChunks.at(-1) ?? "";
	}
	if (current) {
		rawChunks.push(current);
	}

	const finalChunks: string[] = [];
	for (let index = 0; index < rawChunks.length; index += 1) {
		const base = rawChunks[index] ?? "";
		const prev = finalChunks[index - 1];
		if (!prev || overlapChars <= 0) {
			finalChunks.push(base);
			continue;
		}
		const tail = prev.slice(Math.max(0, prev.length - overlapChars)).trim();
		const merged = `${tail}\n${base}`.trim();
		finalChunks.push(merged.length <= maxChars ? merged : merged.slice(merged.length - maxChars));
	}

	return finalChunks.map((chunkText, chunkIndex) => ({
		chunkIndex,
		chunkText,
		tokenCount: countWords(chunkText),
	}));
}

function splitLongText(text: string, maxChars: number, overlapChars: number): string[] {
	const stride = Math.max(1, maxChars - Math.max(0, overlapChars));
	const chunks: string[] = [];
	for (let start = 0; start < text.length; start += stride) {
		const slice = text.slice(start, start + maxChars).trim();
		if (slice) {
			chunks.push(slice);
		}
		if (start + maxChars >= text.length) {
			break;
		}
	}
	return chunks;
}

function buildHashEmbedding(text: string, dimensions: number): number[] {
	const vector = Array.from({ length: dimensions }, () => 0);
	for (let i = 0; i < text.length; i += 1) {
		const code = text.charCodeAt(i);
		const index = ((code * 31) + i * 17) % dimensions;
		vector[index] += ((code % 29) + 1) / 29;
	}
	let norm = 0;
	for (const value of vector) {
		norm += value * value;
	}
	const denominator = Math.sqrt(norm) || 1;
	return vector.map((value) => value / denominator);
}

async function buildVectorId(noteId: string, chunkIndex: number, chunkText: string): Promise<string> {
	const digest = await sha256Hex(new TextEncoder().encode(chunkText).buffer);
	return `${noteId}:${chunkIndex}:${digest.slice(0, 16)}`;
}

async function upsertNoteChunksToVectorIndex(
	env: Env,
	note: NoteRow,
	chunks: Array<{ chunkIndex: number; chunkText: string; tokenCount: number }>,
): Promise<void> {
	const vectorIndex = getNotesVectorIndex(env);
	if (!vectorIndex) {
		throw new Error("Vectorize binding `NOTES_VECTOR_INDEX` is missing");
	}

	const { results: existing } = await env.DB.prepare(
		`SELECT
			id,
			note_id AS noteId,
			chunk_index AS chunkIndex,
			chunk_text AS chunkText,
			token_count AS tokenCount,
			embedding_model AS embeddingModel,
			vector_id AS vectorId,
			created_at AS createdAt
		 FROM note_chunks
		 WHERE note_id = ?`,
	)
		.bind(note.id)
		.all<NoteChunkRow>();

	const dimensions = getIndexVectorDimensions(env);
	const model = getIndexEmbeddingModel(env);
	const vectorRecords: VectorizeVector[] = [];
	const chunkRows: Array<{ id: string; vectorId: string; chunkIndex: number; chunkText: string; tokenCount: number }> = [];
	for (const chunk of chunks) {
		const vectorId = await buildVectorId(note.id, chunk.chunkIndex, chunk.chunkText);
		vectorRecords.push({
			id: vectorId,
			values: buildHashEmbedding(chunk.chunkText, dimensions),
			metadata: {
				noteId: note.id,
				slug: note.slug,
				title: note.title,
				chunkIndex: chunk.chunkIndex,
			},
		});
		chunkRows.push({
			id: crypto.randomUUID(),
			vectorId,
			chunkIndex: chunk.chunkIndex,
			chunkText: chunk.chunkText,
			tokenCount: chunk.tokenCount,
		});
	}

	if (vectorRecords.length > 0) {
		await vectorIndex.upsert(vectorRecords);
	}
	const nextVectorIds = new Set(vectorRecords.map((item) => item.id));
	const staleVectorIds = existing
		.map((item) => item.vectorId)
		.filter((vectorId): vectorId is string =>
			typeof vectorId === "string" && vectorId.length > 0 && !nextVectorIds.has(vectorId),
		);
	if (staleVectorIds.length > 0) {
		await vectorIndex.deleteByIds(staleVectorIds);
	}

	await env.DB.prepare("DELETE FROM note_chunks WHERE note_id = ?")
		.bind(note.id)
		.run();
	if (chunkRows.length > 0) {
		const statements = chunkRows.map((item) =>
			env.DB.prepare(
				`INSERT INTO note_chunks (
					id, note_id, chunk_index, chunk_text, token_count, embedding_model, vector_id
				) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
				.bind(item.id, note.id, item.chunkIndex, item.chunkText, item.tokenCount, model, item.vectorId),
		);
		await env.DB.batch(statements);
	}
}

async function clearNoteChunksAndVectors(env: Env, noteId: string): Promise<void> {
	const { results } = await env.DB.prepare(
		`SELECT vector_id AS vectorId
		 FROM note_chunks
		 WHERE note_id = ?`,
	)
		.bind(noteId)
		.all<{ vectorId: string | null }>();
	const vectorIds = results
		.map((item) => item.vectorId)
		.filter((item): item is string => Boolean(item));
	if (vectorIds.length > 0) {
		const vectorIndex = getNotesVectorIndex(env);
		if (!vectorIndex) {
			throw new Error("Vectorize binding `NOTES_VECTOR_INDEX` is missing");
		}
		await vectorIndex.deleteByIds(vectorIds);
	}
	await env.DB.prepare("DELETE FROM note_chunks WHERE note_id = ?")
		.bind(noteId)
		.run();
}

async function purgeNoteIndexData(env: Env, noteId: string): Promise<void> {
	await ensureNoteIndexSchema(env.DB);
	await clearNoteChunksAndVectors(env, noteId);
	await env.DB.prepare("DELETE FROM note_index_jobs WHERE note_id = ?")
		.bind(noteId)
		.run();
}

function toSqliteDatetime(value: number): string {
	const date = new Date(value);
	const iso = date.toISOString();
	return iso.slice(0, 19).replace("T", " ");
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
