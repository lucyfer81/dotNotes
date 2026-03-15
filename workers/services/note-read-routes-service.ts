import type { Hono } from "hono";
import {
	getNoteById,
	listNotesWithSearchMode,
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
}
