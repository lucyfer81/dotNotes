import type { Hono } from "hono";
import {
	clampInt,
	hasOwn,
	isRecord,
	jsonError,
	jsonOk,
	parseObjectBody,
	readOptionalString,
	readRequiredString,
} from "./common-service";
import { getNoteById } from "./note-query-service";
import {
	deleteNoteRelation,
	getNoteRelationById,
	listNoteRelations,
	normalizeNoteRelationSource,
	normalizeNoteRelationSourceFilter,
	normalizeNoteRelationStatus,
	normalizeNoteRelationStatusFilter,
	normalizeNoteRelationType,
	normalizeRelationScore,
	upsertNoteRelation,
} from "./note-relations-service";

export function registerNoteRelationRoutes(app: Hono<{ Bindings: Env }>): void {
	app.get("/api/notes/:id/relations", async (c) => {
		const noteId = c.req.param("id");
		const note = await getNoteById(c.env.DB, noteId);
		if (!note || note.deletedAt) {
			return jsonError(c, 404, "Note not found");
		}

		const status = normalizeNoteRelationStatusFilter(c.req.query("status"));
		const source = normalizeNoteRelationSourceFilter(c.req.query("source"));
		const limit = clampInt(c.req.query("limit"), 20, 1, 100);
		const offset = clampInt(c.req.query("offset"), 0, 0, 10000);
		const items = await listNoteRelations(c.env.DB, noteId, {
			status,
			source,
			limit,
			offset,
		});
		return jsonOk(c, {
			noteId,
			items,
			paging: {
				limit,
				offset,
				count: items.length,
			},
			filters: {
				status,
				source,
			},
		});
	});

	app.post("/api/notes/:id/relations/bulk-upsert", async (c) => {
		const noteId = c.req.param("id");
		const note = await getNoteById(c.env.DB, noteId);
		if (!note || note.deletedAt) {
			return jsonError(c, 404, "Note not found");
		}

		const payload = await parseObjectBody(c);
		if (!payload || !Array.isArray(payload.items)) {
			return jsonError(c, 400, "`items` must be an array");
		}

		const results = [];
		for (let index = 0; index < payload.items.length; index += 1) {
			const item = payload.items[index];
			if (!isRecord(item)) {
				return jsonError(c, 400, `Relation item #${index + 1} is invalid`);
			}
			const otherNoteId = readRequiredString(item, "otherNoteId");
			if (!otherNoteId) {
				return jsonError(c, 400, `Relation item #${index + 1} requires \`otherNoteId\``);
			}
			if (otherNoteId === noteId) {
				return jsonError(c, 400, "Relation cannot target the same note");
			}
			const otherNote = await getNoteById(c.env.DB, otherNoteId);
			if (!otherNote || otherNote.deletedAt) {
				return jsonError(c, 400, `Relation item #${index + 1} references a missing note`);
			}
			const relationType = normalizeNoteRelationType(readOptionalString(item, "relationType")) ?? "related";
			const status = normalizeNoteRelationStatus(readOptionalString(item, "status")) ?? "accepted";
			const source = normalizeNoteRelationSource(readOptionalString(item, "source")) ?? "manual";
			const relation = await upsertNoteRelation(c.env.DB, {
				noteId,
				otherNoteId,
				relationType,
				status,
				source,
				score: normalizeRelationScore(readOptionalFloat(item, "score")),
				reason: readOptionalString(item, "reason") ?? "",
				evidenceExcerpt: readOptionalString(item, "evidenceExcerpt"),
				provider: readOptionalString(item, "provider"),
				model: readOptionalString(item, "model"),
			});
			if (!relation) {
				return jsonError(c, 500, "Failed to save relation");
			}
			results.push(relation);
		}

		return jsonOk(c, {
			noteId,
			items: results,
		}, 201);
	});

	app.patch("/api/notes/:id/relations/:relationId", async (c) => {
		const noteId = c.req.param("id");
		const relationId = c.req.param("relationId");
		const note = await getNoteById(c.env.DB, noteId);
		if (!note || note.deletedAt) {
			return jsonError(c, 404, "Note not found");
		}

		const payload = await parseObjectBody(c);
		if (!payload) {
			return jsonError(c, 400, "Invalid JSON body");
		}

		const existing = await getNoteRelationById(c.env.DB, noteId, relationId);
		if (!existing) {
			return jsonError(c, 404, "Relation not found");
		}

		const relationType = hasOwn(payload, "relationType")
			? normalizeNoteRelationType(readOptionalString(payload, "relationType"))
			: existing.relationType;
		if (!relationType) {
			return jsonError(c, 400, "Invalid relationType");
		}
		const status = hasOwn(payload, "status")
			? normalizeNoteRelationStatus(readOptionalString(payload, "status"))
			: existing.status;
		if (!status) {
			return jsonError(c, 400, "Invalid status");
		}
		const source = hasOwn(payload, "source")
			? normalizeNoteRelationSource(readOptionalString(payload, "source"))
			: existing.source;
		if (!source) {
			return jsonError(c, 400, "Invalid source");
		}

		const updated = await upsertNoteRelation(c.env.DB, {
			noteId,
			otherNoteId: existing.otherNote.id,
			relationType,
			status,
			source,
			score: hasOwn(payload, "score")
				? normalizeRelationScore(readOptionalFloat(payload, "score"), existing.score)
				: existing.score,
			reason: hasOwn(payload, "reason")
				? (readOptionalString(payload, "reason") ?? "")
				: existing.reason,
			evidenceExcerpt: hasOwn(payload, "evidenceExcerpt")
				? readOptionalString(payload, "evidenceExcerpt")
				: existing.evidenceExcerpt,
			provider: hasOwn(payload, "provider")
				? readOptionalString(payload, "provider")
				: existing.provider,
			model: hasOwn(payload, "model")
				? readOptionalString(payload, "model")
				: existing.model,
		});
		if (!updated) {
			return jsonError(c, 500, "Failed to update relation");
		}
		return jsonOk(c, updated);
	});

	app.delete("/api/notes/:id/relations/:relationId", async (c) => {
		const noteId = c.req.param("id");
		const relationId = c.req.param("relationId");
		const note = await getNoteById(c.env.DB, noteId);
		if (!note || note.deletedAt) {
			return jsonError(c, 404, "Note not found");
		}
		const deleted = await deleteNoteRelation(c.env.DB, noteId, relationId);
		if (!deleted) {
			return jsonError(c, 404, "Relation not found");
		}
		return jsonOk(c, { id: relationId, deleted: true });
	});
}

function readOptionalFloat(obj: Record<string, unknown>, key: string): number | null {
	const value = obj[key];
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return null;
}
