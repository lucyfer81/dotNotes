import {
	getIndexRetryBackoffSeconds,
	getIndexRetryMaxAttempts,
} from "./note-query-service";
import { processSingleNoteIndexJob } from "./index-chunk-service";
import { clearNoteChunksAndVectors } from "./index-vector-service";
import type {
	IndexAction,
	IndexJobStatus,
	NoteIndexProcessResult,
} from "./index-types";

export function scheduleIndexProcessing(c: {
	env: Env;
	executionCtx?: { waitUntil?: (promise: Promise<unknown>) => void };
}, limit: number): void {
	if (!c.executionCtx || typeof c.executionCtx.waitUntil !== "function") {
		return;
	}
	c.executionCtx.waitUntil(
		processPendingIndexJobs(c.env, limit).catch((error) => {
			console.error("Background note index processing failed", error);
		}),
	);
}

export async function ensureNoteIndexSchema(db: D1Database): Promise<void> {
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

export async function enqueueNoteIndexJob(db: D1Database, noteId: string, action: IndexAction): Promise<void> {
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

export async function processPendingIndexJobs(env: Env, limit: number): Promise<NoteIndexProcessResult[]> {
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

export async function purgeNoteIndexData(env: Env, noteId: string): Promise<void> {
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
