import type { Hono } from "hono";
import {
	PARA_MAIN_FOLDER_ID_SET,
	PRESET_FOLDER_ID_SET,
	ensurePresetFolders,
	folderExists,
	slugify,
} from "./note-query-service";
import {
	hasOwn,
	jsonError,
	jsonOk,
	parseObjectBody,
	readOptionalNumber,
	readOptionalString,
	readRequiredString,
} from "./common-service";

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

export function registerFolderRoutes(app: Hono<{ Bindings: Env }>): void {
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
}
