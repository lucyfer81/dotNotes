import type { Hono } from "hono";
import {
	buildNoteStatusWhere,
	getTagNameMaxLength,
	normalizeNoteStatus,
} from "./note-query-service";
import {
	detachAndDeleteTag,
	listOrphanTags,
	mergeTags,
	normalizeTagName,
} from "./note-relations-service";
import {
	clampInt,
	hasOwn,
	jsonError,
	jsonOk,
	parseBooleanLike,
	parseObjectBody,
	readOptionalNumber,
	readOptionalString,
	readRequiredString,
} from "./common-service";

type TagRow = {
	id: string;
	name: string;
	color: string;
	createdAt: string;
	noteCount?: number;
};

export function registerTagRoutes(app: Hono<{ Bindings: Env }>): void {
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
}
