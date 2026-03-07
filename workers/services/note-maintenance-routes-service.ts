import type { Hono } from "hono";
import {
	getBodyR2ThresholdBytes,
	getNotesBucket,
} from "./note-storage-service";
import { syncNoteFtsContent } from "./note-query-service";
import {
	clampInt,
	jsonError,
	jsonOk,
	parseBooleanLike,
	parseObjectBody,
	readOptionalNumber,
} from "./common-service";

const NOTE_BODY_R2_PREFIX = "note-bodies";

export function registerNoteMaintenanceRoutes(app: Hono<{ Bindings: Env }>): void {
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
			await syncNoteFtsContent(c.env.DB, item.id, undefined, undefined, item.bodyText);
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
}
