import type { Hono } from "hono";
import {
	buildExcerpt,
	ensurePresetFolders,
	ensureUniqueSlug,
	folderExists,
	getNoteById,
	getTagPerNoteLimit,
	normalizeStorageType,
	slugify,
	syncNoteFtsContent,
} from "./note-query-service";
import {
	deleteObjectsFromR2,
	hydrateNoteBodyFromR2,
	listAssetKeysByNoteId,
	resolveBodyStorageForCreate,
	resolveBodyStorageForUpdate,
} from "./note-storage-service";
import {
	fetchTagsForSingleNote,
	replaceNoteTags,
	resolveTagIds,
} from "./note-relations-service";
import {
	extractTagNames,
	hasOwn,
	jsonError,
	jsonOk,
	parseBooleanLike,
	parseObjectBody,
	readNullableString,
	readOptionalNumber,
	readOptionalString,
	readRequiredString,
	toStringArray,
} from "./common-service";
import {
	enqueueNoteIndexJob,
	purgeNoteIndexData,
	scheduleIndexProcessing,
} from "./index-core-service";

export function registerNoteWriteRoutes(app: Hono<{ Bindings: Env }>): void {
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

		let resolvedBody;
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
		await syncNoteFtsContent(c.env.DB, noteId, title, excerpt, resolvedBody.plainBodyText);

		await replaceNoteTags(c.env.DB, noteId, tagIds);
		const queuedAction = isArchived ? "delete" : "upsert";
		await enqueueNoteIndexJob(c.env.DB, noteId, queuedAction);
		scheduleIndexProcessing(c, 1);

		const created = await getNoteById(c.env.DB, noteId);
		const tags = await fetchTagsForSingleNote(c.env.DB, noteId);
		const hydrated = created ? await hydrateNoteBodyFromR2(c.env, created) : null;

		return jsonOk(c, { ...(hydrated ?? {}), tags }, 201);
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

		let resolvedBody;
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
		await syncNoteFtsContent(c.env.DB, noteId, nextTitle, nextExcerpt, resolvedBody.plainBodyText);

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

		const indexAction = nextIsArchived ? "delete" : "upsert";
		await enqueueNoteIndexJob(c.env.DB, noteId, indexAction);
		scheduleIndexProcessing(c, 1);

		const updated = await getNoteById(c.env.DB, noteId);
		const tags = await fetchTagsForSingleNote(c.env.DB, noteId);
		const hydrated = updated ? await hydrateNoteBodyFromR2(c.env, updated) : null;
		return jsonOk(c, { ...(hydrated ?? {}), tags });
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
		return jsonOk(c, { ...(updated ?? {}), tags });
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
		return jsonOk(c, { ...(restored ?? {}), tags });
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
}
