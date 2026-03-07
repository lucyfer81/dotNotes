import type { Hono } from "hono";
import { getNoteById } from "./note-query-service";
import {
	clampInt,
	jsonError,
	jsonOk,
	parseBooleanLike,
	parseCsv,
	parseObjectBody,
	placeholders,
	readOptionalNumber,
	readOptionalString,
} from "./common-service";
import {
	enqueueNoteIndexJob,
	ensureNoteIndexSchema,
	processPendingIndexJobs,
	scheduleIndexProcessing,
} from "./index-core-service";

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

export function registerIndexRoutes(app: Hono<{ Bindings: Env }>): void {
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
}
