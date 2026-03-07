import {
	buildNoteStatusWhere,
	getIndexVectorDimensions,
	getNotesVectorIndex,
	listNotesWithSearchMode,
	normalizeNoteStatus,
} from "./note-query-service";
import {
	clampInt,
	placeholders,
	readOptionalNumber,
	readOptionalString,
	readRequiredString,
} from "./common-service";
import { buildEmbeddingsForTexts } from "./ai-provider-service";
import type {
	AiContextChunkItem,
	AiContextNoteItem,
	AiContextRequestInput,
	NoteRow,
	NoteSearchMode,
	NoteStatusFilter,
} from "./ai-types";

const DEFAULT_AI_RETRIEVAL_KEYWORD_MAX_CHARS = 96;
const DEFAULT_AI_HYBRID_VECTOR_WEIGHT = 0.55;
const DEFAULT_AI_HYBRID_KEYWORD_WEIGHT = 0.45;

export function parseAiContextInput(payload: Record<string, unknown>): AiContextRequestInput | null {
	const query = readRequiredString(payload, "query");
	if (!query) {
		return null;
	}
	const noteId = readOptionalString(payload, "noteId");
	const limit = clampInt(
		typeof payload.limit === "string" ? payload.limit : String(readOptionalNumber(payload, "limit") ?? "6"),
		6,
		1,
		20,
	);
	const statusInput = readOptionalString(payload, "status");
	const status = normalizeNoteStatus(statusInput ?? undefined, undefined);
	return {
		query,
		noteId,
		limit,
		status,
	};
}

export async function buildAiContext(
	env: Env,
	input: AiContextRequestInput,
): Promise<{
	query: string;
	status: NoteStatusFilter;
	retrievedAt: string;
	searchMode: NoteSearchMode;
	notes: AiContextNoteItem[];
	chunks: AiContextChunkItem[];
}> {
	const retrievalQuery = normalizeKeywordForLike(input.query);
	const { notes, mode } = await listAiHybridNotes(env, {
		query: retrievalQuery,
		limit: input.limit * 2,
		status: input.status,
	});
	const filteredNotes = input.noteId
		? notes.filter((note) => note.id === input.noteId)
		: notes;
	const noteItems: AiContextNoteItem[] = filteredNotes.slice(0, input.limit).map((item) => ({
		noteId: item.id,
		slug: item.slug,
		title: item.title,
		snippet: (item.excerpt || "").slice(0, 240),
		updatedAt: item.updatedAt,
		searchScore: item.searchScore,
	}));
	let chunkItems: AiContextChunkItem[] = [];
	try {
		chunkItems = await listAiContextChunks(env.DB, {
			...input,
			query: retrievalQuery,
		});
	} catch (error) {
		console.error("AI context chunk lookup failed, skip chunks", error);
	}
	return {
		query: input.query,
		status: input.status,
		retrievedAt: new Date().toISOString(),
		searchMode: mode,
		notes: noteItems,
		chunks: chunkItems,
	};
}

async function listAiHybridNotes(
	env: Env,
	input: {
		query: string;
		limit: number;
		status: NoteStatusFilter;
	},
): Promise<{ notes: NoteRow[]; mode: NoteSearchMode }> {
	const { notes: keywordNotes, mode } = await listNotesWithSearchMode(env.DB, {
		folderId: null,
		tagIds: [],
		tagMode: "any",
		keyword: input.query,
		status: input.status,
		limit: Math.max(input.limit * 2, 24),
		offset: 0,
	});
	if (!input.query) {
		return {
			notes: keywordNotes.slice(0, input.limit),
			mode,
		};
	}

	const vectorHits = await queryAiVectorCandidates(env, {
		query: input.query,
		limit: input.limit,
	});
	if (vectorHits.length === 0) {
		return {
			notes: keywordNotes.slice(0, input.limit),
			mode,
		};
	}

	const vectorRows = await fetchNotesByIdsForAiContext(
		env.DB,
		vectorHits.map((item) => item.noteId),
		input.status,
	);
	const vectorRowsById = new Map(vectorRows.map((item) => [item.id, item] as const));
	const keywordRowsById = new Map(keywordNotes.map((item) => [item.id, item] as const));
	const scored = new Map<string, { note: NoteRow; keywordScore: number; vectorScore: number }>();

	for (let index = 0; index < keywordNotes.length; index += 1) {
		const note = keywordNotes[index];
		if (!note) {
			continue;
		}
		const keywordScore = clampFraction(1 - index / (keywordNotes.length + 1));
		const existing = scored.get(note.id);
		if (existing) {
			existing.keywordScore = Math.max(existing.keywordScore, keywordScore);
			continue;
		}
		scored.set(note.id, {
			note,
			keywordScore,
			vectorScore: 0,
		});
	}
	for (const hit of vectorHits) {
		const note = vectorRowsById.get(hit.noteId) ?? keywordRowsById.get(hit.noteId);
		if (!note) {
			continue;
		}
		const vectorScore = normalizeVectorSimilarityScore(hit.score);
		const existing = scored.get(hit.noteId);
		if (existing) {
			existing.vectorScore = Math.max(existing.vectorScore, vectorScore);
			continue;
		}
		scored.set(hit.noteId, {
			note,
			keywordScore: 0,
			vectorScore,
		});
	}

	const merged = [...scored.values()]
		.map((item) => ({
			note: item.note,
			score: clampFraction(
				item.keywordScore * DEFAULT_AI_HYBRID_KEYWORD_WEIGHT + item.vectorScore * DEFAULT_AI_HYBRID_VECTOR_WEIGHT,
			),
		}))
		.sort((a, b) => b.score - a.score || b.note.updatedAt.localeCompare(a.note.updatedAt))
		.map((item) => ({
			...item.note,
			searchScore: item.note.searchScore ?? Number(item.score.toFixed(6)),
		}))
		.slice(0, input.limit);

	return {
		notes: merged,
		mode: "hybrid",
	};
}

async function queryAiVectorCandidates(
	env: Env,
	input: { query: string; limit: number },
): Promise<Array<{ noteId: string; score: number }>> {
	const vectorIndex = getNotesVectorIndex(env);
	if (!vectorIndex || typeof vectorIndex.query !== "function") {
		return [];
	}
	const query = input.query.trim();
	if (!query) {
		return [];
	}

	try {
		const dimensions = getIndexVectorDimensions(env);
		const embeddings = await buildEmbeddingsForTexts(env, [query], dimensions);
		const vector = embeddings.vectors[0];
		if (!vector) {
			return [];
		}
		const rawMatches = await vectorIndex.query(vector, {
			topK: Math.max(input.limit * 6, 24),
			returnMetadata: "indexed",
		});
		const scoreByNoteId = new Map<string, number>();
		const matches = Array.isArray(rawMatches?.matches) ? rawMatches.matches : [];
		for (const match of matches) {
			const metadata = match?.metadata;
			if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
				continue;
			}
			const noteId = typeof metadata.noteId === "string" ? metadata.noteId : "";
			if (!noteId) {
				continue;
			}
			const rawScore = typeof match.score === "number" && Number.isFinite(match.score) ? match.score : 0;
			const prev = scoreByNoteId.get(noteId);
			if (prev === undefined || rawScore > prev) {
				scoreByNoteId.set(noteId, rawScore);
			}
		}
		return [...scoreByNoteId.entries()]
			.map(([noteId, score]) => ({ noteId, score }))
			.sort((a, b) => b.score - a.score)
			.slice(0, input.limit * 2);
	} catch (error) {
		console.error("AI vector retrieval failed, fallback to keyword retrieval", error);
		return [];
	}
}

async function fetchNotesByIdsForAiContext(
	db: D1Database,
	noteIds: string[],
	status: NoteStatusFilter,
): Promise<NoteRow[]> {
	const uniqueIds = [...new Set(noteIds.filter((item) => typeof item === "string" && item.length > 0))];
	if (uniqueIds.length === 0) {
		return [];
	}
	const marks = placeholders(uniqueIds.length);
	const statusWhere = buildNoteStatusWhere("n", status);
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
		WHERE n.id IN (${marks})
		  AND ${statusWhere}
	`;
	const { results } = await db.prepare(sql).bind(...uniqueIds).all<NoteRow>();
	return results;
}

function normalizeVectorSimilarityScore(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	if (value >= 0 && value <= 1) {
		return value;
	}
	if (value >= -1 && value <= 1) {
		return (value + 1) / 2;
	}
	return clampFraction(value);
}

async function listAiContextChunks(db: D1Database, input: AiContextRequestInput): Promise<AiContextChunkItem[]> {
	const escaped = `%${escapeLikePattern(input.query)}%`;
	const statusWhere = buildNoteStatusWhere("n", input.status);
	const where = [
		statusWhere,
		"nc.chunk_text LIKE ? ESCAPE '\\'",
	];
	const params: Array<string | number> = [escaped];
	if (input.noteId) {
		where.push("n.id = ?");
		params.push(input.noteId);
	}
	const sql = `
		SELECT
			nc.note_id AS noteId,
			n.slug,
			n.title,
			n.updated_at AS updatedAt,
			nc.chunk_index AS chunkIndex,
			nc.chunk_text AS chunkText
		FROM note_chunks nc
		JOIN notes n ON n.id = nc.note_id
		WHERE ${where.join(" AND ")}
		ORDER BY n.updated_at DESC, nc.chunk_index ASC
		LIMIT ?
	`;
	let results: Array<{ noteId: string; slug: string; title: string; updatedAt: string; chunkIndex: number; chunkText: string }> = [];
	try {
		const queryResult = await db.prepare(sql)
			.bind(...params, input.limit)
			.all<{ noteId: string; slug: string; title: string; updatedAt: string; chunkIndex: number; chunkText: string }>();
		results = queryResult.results;
	} catch (error) {
		if (isLikePatternTooComplexError(error)) {
			console.error("AI context chunk LIKE pattern too complex, returning empty chunks", error);
			return [];
		}
		throw error;
	}
	return results.map((item) => ({
		noteId: item.noteId,
		slug: item.slug,
		title: item.title,
		updatedAt: item.updatedAt,
		chunkIndex: item.chunkIndex,
		snippet: item.chunkText.slice(0, 320),
	}));
}

function escapeLikePattern(value: string): string {
	return value.replaceAll(/[%_\\]/g, (char) => `\\${char}`);
}

function normalizeKeywordForLike(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) {
		return "";
	}
	const tokens = trimmed.match(/[\p{L}\p{N}]{1,24}/gu) ?? [];
	const candidate = tokens.length > 0 ? tokens.slice(0, 10).join(" ") : trimmed;
	return candidate.slice(0, DEFAULT_AI_RETRIEVAL_KEYWORD_MAX_CHARS);
}

function isLikePatternTooComplexError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	const message = error.message.toLowerCase();
	return message.includes("like or glob pattern too complex") || message.includes("string or blob too big");
}

function clampFraction(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.max(0, Math.min(1, value));
}
