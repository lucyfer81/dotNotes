import type { Hono } from "hono";
import {
	buildNoteStatusWhere,
	getNoteById,
	listNotesWithSearchMode,
	matchesNoteStatus,
	normalizeNoteStatus,
	normalizeTagMode,
} from "./note-query-service";
import {
	hydrateNoteBodiesFromR2,
	hydrateNoteBodyFromR2,
} from "./note-storage-service";
import {
	fetchTagsByNoteIds,
	fetchTagsForSingleNote,
} from "./note-relations-service";
import {
	clampInt,
	jsonError,
	jsonOk,
	parseCsv,
} from "./common-service";

export function registerNoteReadRoutes(app: Hono<{ Bindings: Env }>): void {
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
}
