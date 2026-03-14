import { placeholders } from "./common-service";
import { getTagNameMaxLength, getTagPerNoteLimit, slugify } from "./note-query-service";

type TagRow = {
	id: string;
	name: string;
	color: string;
	createdAt: string;
	noteCount?: number;
};

export type NoteRelationType =
	| "similar"
	| "complements"
	| "contrasts"
	| "same_project"
	| "same_area"
	| "related";

export type NoteRelationStatus = "suggested" | "accepted" | "rejected";
export type NoteRelationStatusFilter = NoteRelationStatus | "all";
export type NoteRelationSource = "ai" | "manual";
export type NoteRelationSourceFilter = NoteRelationSource | "all";

export type NoteRelationListItem = {
	id: string;
	relationType: NoteRelationType;
	status: NoteRelationStatus;
	source: NoteRelationSource;
	score: number;
	reason: string;
	evidenceExcerpt: string | null;
	provider: string | null;
	model: string | null;
	createdAt: string;
	updatedAt: string;
	otherNote: {
		id: string;
		slug: string;
		title: string;
		excerpt: string;
		updatedAt: string;
	};
};

type NoteRelationRow = {
	id: string;
	relationType: NoteRelationType;
	status: NoteRelationStatus;
	source: NoteRelationSource;
	score: number;
	reason: string;
	evidenceExcerpt: string | null;
	provider: string | null;
	model: string | null;
	createdAt: string;
	updatedAt: string;
	otherNoteId: string;
	otherSlug: string;
	otherTitle: string;
	otherExcerpt: string;
	otherUpdatedAt: string;
};

const DEFAULT_TAG_NAME_MAX_LENGTH = 48;

export async function fetchTagsForSingleNote(db: D1Database, noteId: string): Promise<TagRow[]> {
	const { results } = await db.prepare(
		`SELECT
			t.id,
			t.name,
			t.color,
			t.created_at AS createdAt
		 FROM tags t
		 JOIN note_tags nt ON nt.tag_id = t.id
		 WHERE nt.note_id = ?
		 ORDER BY t.name ASC`,
	)
		.bind(noteId)
		.all<TagRow>();
	return results;
}

export async function fetchTagsByNoteIds(db: D1Database, noteIds: string[]): Promise<Map<string, TagRow[]>> {
	const mapping = new Map<string, TagRow[]>();
	if (noteIds.length === 0) {
		return mapping;
	}
	const marks = placeholders(noteIds.length);
	const { results } = await db.prepare(
		`SELECT
			nt.note_id AS noteId,
			t.id,
			t.name,
			t.color,
			t.created_at AS createdAt
		 FROM note_tags nt
		 JOIN tags t ON t.id = nt.tag_id
		 WHERE nt.note_id IN (${marks})
		 ORDER BY t.name ASC`,
	)
		.bind(...noteIds)
		.all<{ noteId: string } & TagRow>();

	for (const row of results) {
		const list = mapping.get(row.noteId) ?? [];
		list.push({
			id: row.id,
			name: row.name,
			color: row.color,
			createdAt: row.createdAt,
		});
		mapping.set(row.noteId, list);
	}
	return mapping;
}

export async function resolveTagIds(
	env: Env,
	db: D1Database,
	tagIdsInput: string[],
	tagNamesInput: string[],
): Promise<{ tagIds: string[]; missingTagIds: string[]; ignoredTagNames: string[] }> {
	const uniqueTagIds = [...new Set(tagIdsInput)];
	const uniqueTagNames = normalizeTagNames(tagNamesInput, getTagNameMaxLength(env));
	const tagNameLimit = getTagPerNoteLimit(env);
	const acceptedTagNames = uniqueTagNames.slice(0, tagNameLimit);
	const ignoredTagNames = uniqueTagNames.slice(tagNameLimit);

	const resolvedIds = new Set<string>();
	let missingTagIds: string[] = [];

	if (uniqueTagIds.length > 0) {
		const marks = placeholders(uniqueTagIds.length);
		const { results } = await db
			.prepare(`SELECT id FROM tags WHERE id IN (${marks})`)
			.bind(...uniqueTagIds)
			.all<{ id: string }>();
		const existing = new Set(results.map((row) => row.id));
		missingTagIds = uniqueTagIds.filter((id) => !existing.has(id));
		for (const id of existing) {
			resolvedIds.add(id);
		}
	}

	for (const name of acceptedTagNames) {
		const found = await db
			.prepare("SELECT id FROM tags WHERE name = ? COLLATE NOCASE LIMIT 1")
			.bind(name)
			.first<{ id: string }>();
		if (found?.id) {
			resolvedIds.add(found.id);
			continue;
		}
		const newId = crypto.randomUUID();
		await db.prepare("INSERT INTO tags (id, name, color) VALUES (?, ?, ?)")
			.bind(newId, name, "#64748b")
			.run();
		resolvedIds.add(newId);
	}

	return { tagIds: [...resolvedIds], missingTagIds, ignoredTagNames };
}

export function normalizeTagNames(values: string[], maxLength: number): string[] {
	const unique = new Set<string>();
	for (const value of values) {
		const normalized = normalizeTagName(value, maxLength);
		if (normalized) {
			unique.add(normalized);
		}
	}
	return [...unique];
}

export function normalizeTagName(value: string, maxLength = DEFAULT_TAG_NAME_MAX_LENGTH): string {
	const trimmed = value.trim().toLowerCase();
	if (!trimmed) {
		return "";
	}
	const normalized = trimmed
		.replace(/\s+/g, "-")
		.replace(/[^\p{L}\p{N}_-]+/gu, "-")
		.replace(/-+/g, "-")
		.replace(/^[-_]+|[-_]+$/g, "")
		.slice(0, maxLength);
	return normalized;
}

export async function listOrphanTags(
	db: D1Database,
	limit: number,
): Promise<Array<{ id: string; name: string; color: string; createdAt: string }>> {
	const { results } = await db.prepare(
		`SELECT
			t.id,
			t.name,
			t.color,
			t.created_at AS createdAt
		 FROM tags t
		 LEFT JOIN note_tags nt ON nt.tag_id = t.id
		 WHERE nt.note_id IS NULL
		 ORDER BY t.created_at ASC
		 LIMIT ?`,
	)
		.bind(limit)
		.all<{ id: string; name: string; color: string; createdAt: string }>();
	return results;
}

export async function mergeTags(db: D1Database, sourceTagId: string, targetTagId: string): Promise<number> {
	const movedCount = await db.prepare(
		"SELECT COUNT(DISTINCT note_id) AS count FROM note_tags WHERE tag_id = ?",
	)
		.bind(sourceTagId)
		.first<number>("count");
	await db.prepare(
		`INSERT OR IGNORE INTO note_tags (note_id, tag_id)
		 SELECT note_id, ?
		 FROM note_tags
		 WHERE tag_id = ?`,
	)
		.bind(targetTagId, sourceTagId)
		.run();
	await db.prepare("DELETE FROM note_tags WHERE tag_id = ?")
		.bind(sourceTagId)
		.run();
	await db.prepare("DELETE FROM tags WHERE id = ?")
		.bind(sourceTagId)
		.run();
	return movedCount ?? 0;
}

export async function detachAndDeleteTag(db: D1Database, tagId: string): Promise<number> {
	const detached = await db.prepare("SELECT COUNT(*) AS count FROM note_tags WHERE tag_id = ?")
		.bind(tagId)
		.first<number>("count");
	await db.prepare("DELETE FROM note_tags WHERE tag_id = ?")
		.bind(tagId)
		.run();
	await db.prepare("DELETE FROM tags WHERE id = ?")
		.bind(tagId)
		.run();
	return detached ?? 0;
}

export async function replaceNoteTags(db: D1Database, noteId: string, tagIds: string[]): Promise<void> {
	await db.prepare("DELETE FROM note_tags WHERE note_id = ?").bind(noteId).run();
	if (tagIds.length === 0) {
		return;
	}
	const statements = tagIds.map((tagId) =>
		db.prepare("INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)").bind(noteId, tagId),
	);
	await db.batch(statements);
}

export async function replaceNoteLinks(
	db: D1Database,
	sourceNoteId: string,
	linkSlugs: string[],
): Promise<{ inserted: number; unresolvedSlugs: string[] }> {
	await db.prepare("DELETE FROM note_links WHERE source_note_id = ?")
		.bind(sourceNoteId)
		.run();

	if (linkSlugs.length === 0) {
		return { inserted: 0, unresolvedSlugs: [] };
	}

	const uniqueSlugs = [...new Set(linkSlugs.map((slug) => slugify(slug)))];
	if (uniqueSlugs.length === 0) {
		return { inserted: 0, unresolvedSlugs: [] };
	}

	const marks = placeholders(uniqueSlugs.length);
	const { results } = await db.prepare(
		`SELECT id, slug
		 FROM notes
		 WHERE slug IN (${marks})
		   AND deleted_at IS NULL`,
	)
		.bind(...uniqueSlugs)
		.all<{ id: string; slug: string }>();

	const foundSlugSet = new Set(results.map((row) => row.slug));
	const unresolvedSlugs = uniqueSlugs.filter((slug) => !foundSlugSet.has(slug));
	const targetRows = results.filter((row) => row.id !== sourceNoteId);

	if (targetRows.length === 0) {
		return { inserted: 0, unresolvedSlugs };
	}

	const statements = targetRows.map((target) =>
		db.prepare(
			"INSERT INTO note_links (source_note_id, target_note_id, anchor_text) VALUES (?, ?, ?)",
		)
			.bind(sourceNoteId, target.id, target.slug),
	);
	await db.batch(statements);
	return { inserted: targetRows.length, unresolvedSlugs };
}

export function normalizeNoteRelationType(value: string | null | undefined): NoteRelationType | null {
	if (
		value === "similar" ||
		value === "complements" ||
		value === "contrasts" ||
		value === "same_project" ||
		value === "same_area" ||
		value === "related"
	) {
		return value;
	}
	return null;
}

export function normalizeNoteRelationStatus(value: string | null | undefined): NoteRelationStatus | null {
	if (value === "suggested" || value === "accepted" || value === "rejected") {
		return value;
	}
	return null;
}

export function normalizeNoteRelationStatusFilter(value: string | null | undefined): NoteRelationStatusFilter {
	if (value === "suggested" || value === "accepted" || value === "rejected" || value === "all") {
		return value;
	}
	return "accepted";
}

export function normalizeNoteRelationSource(value: string | null | undefined): NoteRelationSource | null {
	if (value === "ai" || value === "manual") {
		return value;
	}
	return null;
}

export function normalizeNoteRelationSourceFilter(value: string | null | undefined): NoteRelationSourceFilter {
	if (value === "ai" || value === "manual" || value === "all") {
		return value;
	}
	return "all";
}

export function normalizeRelationScore(value: number | null | undefined, fallback = 0.5): number {
	if (!Number.isFinite(value)) {
		return fallback;
	}
	return Math.max(0, Math.min(1, value ?? fallback));
}

export async function listNoteRelations(
	db: D1Database,
	noteId: string,
	options: {
		status: NoteRelationStatusFilter;
		source: NoteRelationSourceFilter;
		limit: number;
		offset: number;
	},
): Promise<NoteRelationListItem[]> {
	const conditions = [
		"(nr.note_id_low = ? OR nr.note_id_high = ?)",
		"n.deleted_at IS NULL",
	];
	const params: Array<string | number> = [noteId, noteId];
	if (options.status !== "all") {
		conditions.push("nr.status = ?");
		params.push(options.status);
	}
	if (options.source !== "all") {
		conditions.push("nr.source = ?");
		params.push(options.source);
	}
	params.push(options.limit, options.offset);

	const { results } = await db.prepare(
		`SELECT
			nr.id,
			nr.relation_type AS relationType,
			nr.status,
			nr.source,
			nr.score,
			nr.reason,
			nr.evidence_excerpt AS evidenceExcerpt,
			nr.provider,
			nr.model,
			nr.created_at AS createdAt,
			nr.updated_at AS updatedAt,
			n.id AS otherNoteId,
			n.slug AS otherSlug,
			n.title AS otherTitle,
			n.excerpt AS otherExcerpt,
			n.updated_at AS otherUpdatedAt
		 FROM note_relations nr
		 JOIN notes n
		   ON n.id = CASE
				WHEN nr.note_id_low = ? THEN nr.note_id_high
				ELSE nr.note_id_low
			END
		 WHERE ${conditions.join(" AND ")}
		 ORDER BY nr.updated_at DESC, nr.created_at DESC
		 LIMIT ?
		 OFFSET ?`,
	)
		.bind(noteId, ...params)
		.all<NoteRelationRow>();
	return results.map(mapNoteRelationRow);
}

export async function getNoteRelationById(
	db: D1Database,
	noteId: string,
	relationId: string,
): Promise<NoteRelationListItem | null> {
	const row = await db.prepare(
		`SELECT
			nr.id,
			nr.relation_type AS relationType,
			nr.status,
			nr.source,
			nr.score,
			nr.reason,
			nr.evidence_excerpt AS evidenceExcerpt,
			nr.provider,
			nr.model,
			nr.created_at AS createdAt,
			nr.updated_at AS updatedAt,
			n.id AS otherNoteId,
			n.slug AS otherSlug,
			n.title AS otherTitle,
			n.excerpt AS otherExcerpt,
			n.updated_at AS otherUpdatedAt
		 FROM note_relations nr
		 JOIN notes n
		   ON n.id = CASE
				WHEN nr.note_id_low = ? THEN nr.note_id_high
				ELSE nr.note_id_low
			END
		 WHERE nr.id = ?
		   AND (nr.note_id_low = ? OR nr.note_id_high = ?)
		   AND n.deleted_at IS NULL
		 LIMIT 1`,
	)
		.bind(noteId, relationId, noteId, noteId)
		.first<NoteRelationRow>();
	return row ? mapNoteRelationRow(row) : null;
}

export async function upsertNoteRelation(
	db: D1Database,
	input: {
		noteId: string;
		otherNoteId: string;
		relationType: NoteRelationType;
		status: NoteRelationStatus;
		source: NoteRelationSource;
		score: number;
		reason: string;
		evidenceExcerpt?: string | null;
		provider?: string | null;
		model?: string | null;
	},
): Promise<NoteRelationListItem | null> {
	const pair = canonicalizeNoteRelationPair(input.noteId, input.otherNoteId);
	const relationId = crypto.randomUUID();
	await db.prepare(
		`INSERT INTO note_relations (
			id,
			note_id_low,
			note_id_high,
			relation_type,
			status,
			source,
			score,
			reason,
			evidence_excerpt,
			provider,
			model
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(note_id_low, note_id_high) DO UPDATE SET
			relation_type = excluded.relation_type,
			status = excluded.status,
			source = excluded.source,
			score = excluded.score,
			reason = excluded.reason,
			evidence_excerpt = excluded.evidence_excerpt,
			provider = excluded.provider,
			model = excluded.model`,
	)
		.bind(
			relationId,
			pair.low,
			pair.high,
			input.relationType,
			input.status,
			input.source,
			normalizeRelationScore(input.score),
			input.reason,
			input.evidenceExcerpt ?? null,
			input.provider ?? null,
			input.model ?? null,
		)
		.run();
	return getNoteRelationByPair(db, input.noteId, pair.low, pair.high);
}

export async function deleteNoteRelation(
	db: D1Database,
	noteId: string,
	relationId: string,
): Promise<boolean> {
	const result = await db.prepare(
		`DELETE FROM note_relations
		 WHERE id = ?
		   AND (note_id_low = ? OR note_id_high = ?)`,
	)
		.bind(relationId, noteId, noteId)
		.run();
	return !!result.success && (result.meta?.changes ?? 0) > 0;
}

function canonicalizeNoteRelationPair(noteIdA: string, noteIdB: string): { low: string; high: string } {
	return noteIdA < noteIdB
		? { low: noteIdA, high: noteIdB }
		: { low: noteIdB, high: noteIdA };
}

async function getNoteRelationByPair(
	db: D1Database,
	noteId: string,
	noteIdLow: string,
	noteIdHigh: string,
): Promise<NoteRelationListItem | null> {
	const row = await db.prepare(
		`SELECT
			nr.id,
			nr.relation_type AS relationType,
			nr.status,
			nr.source,
			nr.score,
			nr.reason,
			nr.evidence_excerpt AS evidenceExcerpt,
			nr.provider,
			nr.model,
			nr.created_at AS createdAt,
			nr.updated_at AS updatedAt,
			n.id AS otherNoteId,
			n.slug AS otherSlug,
			n.title AS otherTitle,
			n.excerpt AS otherExcerpt,
			n.updated_at AS otherUpdatedAt
		 FROM note_relations nr
		 JOIN notes n
		   ON n.id = CASE
				WHEN nr.note_id_low = ? THEN nr.note_id_high
				ELSE nr.note_id_low
			END
		 WHERE nr.note_id_low = ?
		   AND nr.note_id_high = ?
		   AND n.deleted_at IS NULL
		 LIMIT 1`,
	)
		.bind(noteId, noteIdLow, noteIdHigh)
		.first<NoteRelationRow>();
	return row ? mapNoteRelationRow(row) : null;
}

function mapNoteRelationRow(row: NoteRelationRow): NoteRelationListItem {
	return {
		id: row.id,
		relationType: row.relationType,
		status: row.status,
		source: row.source,
		score: normalizeRelationScore(row.score),
		reason: row.reason,
		evidenceExcerpt: row.evidenceExcerpt,
		provider: row.provider,
		model: row.model,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		otherNote: {
			id: row.otherNoteId,
			slug: row.otherSlug,
			title: row.otherTitle,
			excerpt: row.otherExcerpt,
			updatedAt: row.otherUpdatedAt,
		},
	};
}
