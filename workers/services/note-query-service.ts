import type { Hono } from "hono";
import { jsonError, placeholders } from "./common-service";

type TagMode = "any" | "all";
type NoteStatusFilter = "active" | "archived" | "deleted" | "all";
type NoteSearchMode = "none" | "fts" | "like-fallback" | "hybrid";

type NoteRow = {
	id: string;
	slug: string;
	title: string;
	folderId: string;
	storageType: "d1" | "r2";
	bodyText: string | null;
	bodyR2Key: string | null;
	excerpt: string;
	sizeBytes: number;
	wordCount: number;
	isPinned: number;
	isArchived: number;
	deletedAt: string | null;
	createdAt: string;
	updatedAt: string;
	searchScore: number | null;
};

type ListNotesQueryInput = {
	folderId: string | null;
	tagIds: string[];
	tagMode: TagMode;
	keyword: string;
	status: NoteStatusFilter;
	limit: number;
	offset: number;
};

type PresetFolder = {
	id: string;
	name: string;
	slug: string;
	sortOrder: number;
	isParaMain: boolean;
};

const DEFAULT_INDEX_MAX_CHARS = 900;
const DEFAULT_INDEX_OVERLAP_CHARS = 120;
const DEFAULT_INDEX_RETRY_MAX_ATTEMPTS = 5;
const DEFAULT_INDEX_RETRY_BACKOFF_SECONDS = 30;
const DEFAULT_INDEX_VECTOR_DIMENSIONS = 64;
const DEFAULT_INDEX_EMBEDDING_MODEL = "hash-v1";
const DEFAULT_TAG_NAME_MAX_LENGTH = 48;
const DEFAULT_TAG_PER_NOTE_LIMIT = 12;
const DEFAULT_AI_RETRIEVAL_KEYWORD_MAX_CHARS = 96;

const PRESET_FOLDERS: PresetFolder[] = [
	{ id: "folder-00-inbox", name: "00-Inbox", slug: "00-inbox", sortOrder: 0, isParaMain: false },
	{ id: "folder-10-projects", name: "10-Projects", slug: "10-projects", sortOrder: 10, isParaMain: true },
	{ id: "folder-20-areas", name: "20-Areas", slug: "20-areas", sortOrder: 20, isParaMain: true },
	{ id: "folder-30-resource", name: "30-Resource", slug: "30-resource", sortOrder: 30, isParaMain: true },
	{ id: "folder-40-archive", name: "40-Archive", slug: "40-archive", sortOrder: 40, isParaMain: true },
];

export const PRESET_FOLDER_ID_SET = new Set(PRESET_FOLDERS.map((folder) => folder.id));
export const PARA_MAIN_FOLDER_ID_SET = new Set(
	PRESET_FOLDERS.filter((folder) => folder.isParaMain).map((folder) => folder.id),
);

export function registerApiFallbackRoutes(app: Hono<{ Bindings: Env }>): void {
	app.all("/api/*", (c) => jsonError(c, 404, "API route not found"));
}

function parseBoolean(value: string | undefined): boolean {
	return value === "true" || value === "1";
}

export function getTagNameMaxLength(env: Env): number {
	const ext = env as Env & { TAG_NAME_MAX_LENGTH?: string };
	const parsed = Number(ext.TAG_NAME_MAX_LENGTH);
	if (Number.isFinite(parsed) && parsed >= 16 && parsed <= 128) {
		return Math.trunc(parsed);
	}
	return DEFAULT_TAG_NAME_MAX_LENGTH;
}

export function getTagPerNoteLimit(env: Env): number {
	const ext = env as Env & { TAG_PER_NOTE_LIMIT?: string };
	const parsed = Number(ext.TAG_PER_NOTE_LIMIT);
	if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 64) {
		return Math.trunc(parsed);
	}
	return DEFAULT_TAG_PER_NOTE_LIMIT;
}

export function getIndexMaxChars(env: Env): number {
	const ext = env as Env & { INDEX_CHUNK_MAX_CHARS?: string };
	const parsed = Number(ext.INDEX_CHUNK_MAX_CHARS);
	if (Number.isFinite(parsed) && parsed >= 200 && parsed <= 5000) {
		return Math.trunc(parsed);
	}
	return DEFAULT_INDEX_MAX_CHARS;
}

export function getIndexOverlapChars(env: Env): number {
	const ext = env as Env & { INDEX_CHUNK_OVERLAP_CHARS?: string };
	const parsed = Number(ext.INDEX_CHUNK_OVERLAP_CHARS);
	if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1000) {
		return Math.trunc(parsed);
	}
	return DEFAULT_INDEX_OVERLAP_CHARS;
}

export function getIndexRetryMaxAttempts(env: Env): number {
	const ext = env as Env & { INDEX_RETRY_MAX_ATTEMPTS?: string };
	const parsed = Number(ext.INDEX_RETRY_MAX_ATTEMPTS);
	if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 20) {
		return Math.trunc(parsed);
	}
	return DEFAULT_INDEX_RETRY_MAX_ATTEMPTS;
}

export function getIndexRetryBackoffSeconds(env: Env): number {
	const ext = env as Env & { INDEX_RETRY_BACKOFF_SECONDS?: string };
	const parsed = Number(ext.INDEX_RETRY_BACKOFF_SECONDS);
	if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 600) {
		return Math.trunc(parsed);
	}
	return DEFAULT_INDEX_RETRY_BACKOFF_SECONDS;
}

export function getIndexVectorDimensions(env: Env): number {
	const ext = env as Env & { INDEX_VECTOR_DIMENSIONS?: string };
	const parsed = Number(ext.INDEX_VECTOR_DIMENSIONS);
	if (Number.isFinite(parsed) && parsed >= 8 && parsed <= 2048) {
		return Math.trunc(parsed);
	}
	return DEFAULT_INDEX_VECTOR_DIMENSIONS;
}

export function getIndexEmbeddingModel(env: Env): string {
	const ext = env as Env & { INDEX_EMBEDDING_MODEL?: string };
	const candidate = typeof ext.INDEX_EMBEDDING_MODEL === "string" ? ext.INDEX_EMBEDDING_MODEL.trim() : "";
	return candidate || DEFAULT_INDEX_EMBEDDING_MODEL;
}

export function getNotesVectorIndex(
	env: Env,
): (
	| Pick<VectorizeIndex, "upsert" | "deleteByIds" | "query">
	| Pick<Vectorize, "upsert" | "deleteByIds" | "query">
) | null {
	const ext = env as Env & {
		NOTES_VECTOR_INDEX?: (
			| Pick<VectorizeIndex, "upsert" | "deleteByIds" | "query">
			| Pick<Vectorize, "upsert" | "deleteByIds" | "query">
		);
	};
	return ext.NOTES_VECTOR_INDEX ?? null;
}

export async function listNotesWithSearchMode(
	db: D1Database,
	input: ListNotesQueryInput,
): Promise<{ notes: NoteRow[]; mode: NoteSearchMode }> {
	if (!input.keyword) {
		const notes = await queryNotesWithLike(db, input, false);
		return { notes, mode: "none" };
	}

	const ftsMatchQuery = buildFtsMatchQuery(input.keyword);
	if (!ftsMatchQuery) {
		const notes = await queryNotesWithLikeResilient(db, input, true);
		return { notes, mode: "like-fallback" };
	}

	try {
		const notes = await queryNotesWithFts(db, input, ftsMatchQuery);
		return { notes, mode: "fts" };
	} catch (error) {
		console.error("FTS query failed, falling back to LIKE", error);
		const notes = await queryNotesWithLikeResilient(db, input, true);
		return { notes, mode: "like-fallback" };
	}
}

async function queryNotesWithLikeResilient(
	db: D1Database,
	input: ListNotesQueryInput,
	includeKeyword: boolean,
): Promise<NoteRow[]> {
	try {
		return await queryNotesWithLike(db, input, includeKeyword);
	} catch (error) {
		if (!includeKeyword || !isLikePatternTooComplexError(error) || !input.keyword) {
			throw error;
		}
		const reducedKeyword = normalizeKeywordForLike(input.keyword);
		if (!reducedKeyword || reducedKeyword === input.keyword) {
			console.error("LIKE pattern too complex and cannot reduce keyword", error);
			return [];
		}
		console.error("LIKE pattern too complex, retry with reduced keyword", {
			originalLength: input.keyword.length,
			reducedLength: reducedKeyword.length,
		});
		return queryNotesWithLike(db, {
			...input,
			keyword: reducedKeyword,
		}, includeKeyword);
	}
}

async function queryNotesWithFts(
	db: D1Database,
	input: ListNotesQueryInput,
	ftsMatchQuery: string,
): Promise<NoteRow[]> {
	const { where, params } = buildNotesListWhere("n", input);
	const escapedPrefix = `${escapeLikePattern(input.keyword)}%`;
	const sql = `
		WITH fts_hits AS (
			SELECT
				rowid AS noteRowId,
				bm25(notes_fts, 12.0, 4.0, 1.0) AS rank
			FROM notes_fts
			WHERE notes_fts MATCH ?
		)
		SELECT
			n.id,
			n.slug,
			n.title,
			n.folder_id AS folderId,
			n.storage_type AS storageType,
			n.body_text AS bodyText,
			n.body_r2_key AS bodyR2Key,
			n.excerpt,
			n.size_bytes AS sizeBytes,
			n.word_count AS wordCount,
			n.is_pinned AS isPinned,
			n.is_archived AS isArchived,
			n.deleted_at AS deletedAt,
			n.created_at AS createdAt,
			n.updated_at AS updatedAt,
			fh.rank AS searchScore
		FROM notes n
		JOIN fts_hits fh ON fh.noteRowId = n.rowid
		${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
		ORDER BY
			CASE WHEN LOWER(n.title) = LOWER(?) THEN 0 ELSE 1 END ASC,
			CASE WHEN LOWER(n.title) LIKE LOWER(?) ESCAPE '\\' THEN 0 ELSE 1 END ASC,
			fh.rank ASC,
			n.is_pinned DESC,
			COALESCE(n.deleted_at, n.updated_at) DESC
		LIMIT ? OFFSET ?
	`;

	const bindings: Array<string | number> = [
		ftsMatchQuery,
		...params,
		input.keyword,
		escapedPrefix,
		input.limit,
		input.offset,
	];
	const { results } = await db.prepare(sql).bind(...bindings).all<NoteRow>();
	return results;
}

async function queryNotesWithLike(
	db: D1Database,
	input: ListNotesQueryInput,
	includeKeyword: boolean,
): Promise<NoteRow[]> {
	const { where, params } = buildNotesListWhere("n", input);
	let escapedPrefix = "";
	if (includeKeyword && input.keyword) {
		const escapedLike = `%${escapeLikePattern(input.keyword)}%`;
		escapedPrefix = `${escapeLikePattern(input.keyword)}%`;
		where.push(
			"(n.title LIKE ? ESCAPE '\\' OR n.excerpt LIKE ? ESCAPE '\\' OR COALESCE(n.body_text, '') LIKE ? ESCAPE '\\')",
		);
		params.push(escapedLike, escapedLike, escapedLike);
	}

	const sql = `
		SELECT
			n.id,
			n.slug,
			n.title,
			n.folder_id AS folderId,
			n.storage_type AS storageType,
			n.body_text AS bodyText,
			n.body_r2_key AS bodyR2Key,
			n.excerpt,
			n.size_bytes AS sizeBytes,
			n.word_count AS wordCount,
			n.is_pinned AS isPinned,
			n.is_archived AS isArchived,
			n.deleted_at AS deletedAt,
			n.created_at AS createdAt,
			n.updated_at AS updatedAt,
			NULL AS searchScore
		FROM notes n
		${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
		ORDER BY
			${includeKeyword && input.keyword
				? "CASE WHEN LOWER(n.title) = LOWER(?) THEN 0 ELSE 1 END ASC,\n\t\t\tCASE WHEN LOWER(n.title) LIKE LOWER(?) ESCAPE '\\\\' THEN 0 ELSE 1 END ASC,"
				: ""}
			CASE WHEN n.deleted_at IS NULL THEN 0 ELSE 1 END ASC,
			n.is_pinned DESC,
			COALESCE(n.deleted_at, n.updated_at) DESC
		LIMIT ? OFFSET ?
	`;

	const orderParams: Array<string | number> = [];
	if (includeKeyword && input.keyword) {
		orderParams.push(input.keyword, escapedPrefix);
	}
	const bindings = [...params, ...orderParams, input.limit, input.offset];
	const { results } = await db.prepare(sql).bind(...bindings).all<NoteRow>();
	return results;
}

function buildNotesListWhere(
	alias: string,
	input: Pick<ListNotesQueryInput, "folderId" | "tagIds" | "tagMode" | "status">,
): { where: string[]; params: Array<string | number> } {
	const where: string[] = [buildNoteStatusWhere(alias, input.status)];
	const params: Array<string | number> = [];

	if (input.folderId) {
		where.push(`${alias}.folder_id = ?`);
		params.push(input.folderId);
	}
	if (input.tagIds.length > 0) {
		const marks = placeholders(input.tagIds.length);
		if (input.tagMode === "all") {
			where.push(
				`${alias}.id IN (
					SELECT nt.note_id
					FROM note_tags nt
					WHERE nt.tag_id IN (${marks})
					GROUP BY nt.note_id
					HAVING COUNT(DISTINCT nt.tag_id) = ?
				)`,
			);
			params.push(...input.tagIds, input.tagIds.length);
		} else {
			where.push(
				`EXISTS (
					SELECT 1 FROM note_tags nt
					WHERE nt.note_id = ${alias}.id AND nt.tag_id IN (${marks})
				)`,
			);
			params.push(...input.tagIds);
		}
	}
	return { where, params };
}

function buildFtsMatchQuery(keyword: string): string {
	const tokens = keyword
		.trim()
		.split(/\s+/u)
		.map((item) => item.trim())
		.filter((item) => item.length > 0)
		.map((item) => item.replace(/"/g, "\"\""));
	if (tokens.length === 0) {
		return "";
	}
	return tokens.map((token) => `"${token}"*`).join(" AND ");
}

function escapeLikePattern(value: string): string {
	return value.replace(/[\\%_]/g, "\\$&");
}

function normalizeKeywordForLike(value: string): string {
	const trimmed = value.replace(/\s+/gu, " ").trim();
	if (!trimmed) {
		return "";
	}
	const tokens = trimmed.match(/[\p{L}\p{N}]{1,24}/gu) ?? [];
	const candidate = tokens.length > 0 ? tokens.slice(0, 10).join(" ") : trimmed;
	return candidate.slice(0, DEFAULT_AI_RETRIEVAL_KEYWORD_MAX_CHARS);
}

function isLikePatternTooComplexError(error: unknown): boolean {
	if (!error) {
		return false;
	}
	const message = String(error);
	return message.includes("LIKE or GLOB pattern too complex");
}

export function normalizeTagMode(value: string | undefined): TagMode {
	return value === "all" ? "all" : "any";
}

export function normalizeNoteStatus(
	value: string | undefined,
	legacyIncludeArchived: string | undefined,
): NoteStatusFilter {
	if (value === "active" || value === "archived" || value === "deleted" || value === "all") {
		return value;
	}
	if (parseBoolean(legacyIncludeArchived)) {
		return "all";
	}
	return "active";
}

export function buildNoteStatusWhere(alias: string, status: NoteStatusFilter): string {
	if (status === "active") {
		return `${alias}.deleted_at IS NULL AND ${alias}.is_archived = 0`;
	}
	if (status === "archived") {
		return `${alias}.deleted_at IS NULL AND ${alias}.is_archived = 1`;
	}
	if (status === "deleted") {
		return `${alias}.deleted_at IS NOT NULL`;
	}
	return "1 = 1";
}

export function matchesNoteStatus(note: Pick<NoteRow, "isArchived" | "deletedAt">, status: NoteStatusFilter): boolean {
	if (status === "all") {
		return true;
	}
	if (status === "deleted") {
		return note.deletedAt !== null;
	}
	if (status === "archived") {
		return note.deletedAt === null && note.isArchived === 1;
	}
	return note.deletedAt === null && note.isArchived === 0;
}

export function normalizeStorageType(value: unknown): "d1" | "r2" | null {
	if (value === undefined || value === null || value === "") {
		return "d1";
	}
	if (value === "d1" || value === "r2") {
		return value;
	}
	return null;
}

export function slugify(input: string): string {
	const base = input
		.toLowerCase()
		.trim()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
	if (base.length > 0) {
		return base;
	}
	return `note-${crypto.randomUUID().slice(0, 8)}`;
}

export function buildExcerpt(text: string, max = 180): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (normalized.length <= max) {
		return normalized;
	}
	return `${normalized.slice(0, max)}...`;
}

export function buildTitle(content: string): string {
	const firstLine = content
		.split("\n")
		.map((line) => line.replace(/^#+\s*/, "").trim())
		.find((line) => line.length > 0);
	if (!firstLine) {
		return "快速记录";
	}
	return firstLine.length > 32 ? `${firstLine.slice(0, 32)}...` : firstLine;
}

export function extractHashTags(content: string): string[] {
	const tags = new Set<string>();
	for (const match of content.matchAll(/#([^\s#]+)/g)) {
		const value = match[1]?.trim();
		if (value) {
			tags.add(value);
		}
	}
	return [...tags].slice(0, 8);
}

export function countWords(value: string): number {
	const matches = value.trim().match(/\S+/g);
	return matches ? matches.length : 0;
}

export async function ensureUniqueSlug(db: D1Database, desiredSlug: string, excludeNoteId?: string): Promise<string> {
	const base = desiredSlug || `note-${crypto.randomUUID().slice(0, 8)}`;
	let candidate = base;
	let index = 1;

	while (true) {
		const conflict = excludeNoteId
			? await db
					.prepare("SELECT id FROM notes WHERE slug = ? AND id <> ? LIMIT 1")
					.bind(candidate, excludeNoteId)
					.first<{ id: string }>()
			: await db
					.prepare("SELECT id FROM notes WHERE slug = ? LIMIT 1")
					.bind(candidate)
					.first<{ id: string }>();
		if (!conflict) {
			return candidate;
		}
		candidate = `${base}-${index}`;
		index += 1;
	}
}

export async function folderExists(db: D1Database, folderId: string): Promise<boolean> {
	const found = await db
		.prepare("SELECT id FROM folders WHERE id = ? LIMIT 1")
		.bind(folderId)
		.first<{ id: string }>();
	return Boolean(found);
}

export async function ensurePresetFolders(db: D1Database): Promise<void> {
	const statements = PRESET_FOLDERS.map((folder) =>
		db.prepare(
			`INSERT OR IGNORE INTO folders (id, parent_id, name, slug, sort_order)
			 VALUES (?, NULL, ?, ?, ?)`,
		).bind(folder.id, folder.name, folder.slug, folder.sortOrder),
	);
	await db.batch(statements);
}

export async function getNoteById(db: D1Database, noteId: string): Promise<NoteRow | null> {
	const note = await db.prepare(
		`SELECT
			id,
			slug,
			title,
			folder_id AS folderId,
			storage_type AS storageType,
			body_text AS bodyText,
			body_r2_key AS bodyR2Key,
			excerpt,
			size_bytes AS sizeBytes,
			word_count AS wordCount,
			is_pinned AS isPinned,
			is_archived AS isArchived,
			deleted_at AS deletedAt,
			created_at AS createdAt,
			updated_at AS updatedAt,
			NULL AS searchScore
		 FROM notes
		 WHERE id = ?
		 LIMIT 1`,
	)
		.bind(noteId)
		.first<NoteRow>();
	return note ?? null;
}

export async function syncNoteFtsContent(
	db: D1Database,
	noteId: string,
	titleInput?: string,
	excerptInput?: string,
	bodyTextInput?: string,
): Promise<void> {
	const note = await db.prepare(
		`SELECT
			rowid AS rowId,
			title,
			excerpt,
			COALESCE(body_text, '') AS bodyText
		 FROM notes
		 WHERE id = ?
		 LIMIT 1`,
	)
		.bind(noteId)
		.first<{ rowId: number; title: string; excerpt: string; bodyText: string }>();
	if (!note) {
		return;
	}
	const title = titleInput ?? note.title;
	const excerpt = excerptInput ?? note.excerpt;
	const bodyText = bodyTextInput ?? note.bodyText;
	await db.prepare("DELETE FROM notes_fts WHERE rowid = ?")
		.bind(note.rowId)
		.run();
	await db.prepare(
		`INSERT INTO notes_fts(rowid, title, excerpt, body_text)
		 VALUES (?, ?, ?, ?)`,
	)
		.bind(note.rowId, title, excerpt, bodyText)
		.run();
}
