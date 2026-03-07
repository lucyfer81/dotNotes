import type { Hono } from "hono";
import { getNoteById } from "./note-query-service";
import {
	buildAssetDownloadUrl,
	deleteObjectsFromR2,
	getNotesBucket,
	sanitizeFileName,
	sha256Hex,
} from "./note-storage-service";
import {
	jsonError,
	jsonOk,
} from "./common-service";

const ASSET_R2_PREFIX = "assets";

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

export function registerAssetRoutes(app: Hono<{ Bindings: Env }>): void {
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
}
