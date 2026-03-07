import {
	getIndexVectorDimensions,
	getNotesVectorIndex,
} from "./note-query-service";
import { sha256Hex } from "./note-storage-service";
import { buildEmbeddingsForTexts, buildHashEmbedding } from "./index-embed-service";
import type { NoteChunkRow, NoteRow } from "./index-types";

export async function buildVectorId(noteId: string, chunkIndex: number, chunkText: string): Promise<string> {
	const digest = await sha256Hex(new TextEncoder().encode(chunkText).buffer as ArrayBuffer);
	return `${noteId}:${chunkIndex}:${digest.slice(0, 16)}`;
}

export async function upsertNoteChunksToVectorIndex(
	env: Env,
	note: NoteRow,
	chunks: Array<{ chunkIndex: number; chunkText: string; tokenCount: number }>,
): Promise<void> {
	const vectorIndex = getNotesVectorIndex(env);
	if (!vectorIndex) {
		throw new Error("Vectorize binding `NOTES_VECTOR_INDEX` is missing");
	}

	const { results: existing } = await env.DB.prepare(
		`SELECT
			id,
			note_id AS noteId,
			chunk_index AS chunkIndex,
			chunk_text AS chunkText,
			token_count AS tokenCount,
			embedding_model AS embeddingModel,
			vector_id AS vectorId,
			created_at AS createdAt
		 FROM note_chunks
		 WHERE note_id = ?`,
	)
		.bind(note.id)
		.all<NoteChunkRow>();

	const dimensions = getIndexVectorDimensions(env);
	const embeddings = await buildEmbeddingsForTexts(
		env,
		chunks.map((item) => item.chunkText),
		dimensions,
	);
	const model = embeddings.model;
	const vectorRecords: VectorizeVector[] = [];
	const chunkRows: Array<{ id: string; vectorId: string; chunkIndex: number; chunkText: string; tokenCount: number }> = [];
	for (let index = 0; index < chunks.length; index += 1) {
		const chunk = chunks[index];
		if (!chunk) {
			continue;
		}
		const vectorId = await buildVectorId(note.id, chunk.chunkIndex, chunk.chunkText);
		vectorRecords.push({
			id: vectorId,
			values: embeddings.vectors[index] ?? buildHashEmbedding(chunk.chunkText, dimensions),
			metadata: {
				noteId: note.id,
				slug: note.slug,
				title: note.title,
				chunkIndex: chunk.chunkIndex,
			},
		});
		chunkRows.push({
			id: crypto.randomUUID(),
			vectorId,
			chunkIndex: chunk.chunkIndex,
			chunkText: chunk.chunkText,
			tokenCount: chunk.tokenCount,
		});
	}

	if (vectorRecords.length > 0) {
		await vectorIndex.upsert(vectorRecords);
	}
	const nextVectorIds = new Set(vectorRecords.map((item) => item.id));
	const staleVectorIds = existing
		.map((item) => item.vectorId)
		.filter((vectorId): vectorId is string =>
			typeof vectorId === "string" && vectorId.length > 0 && !nextVectorIds.has(vectorId),
		);
	if (staleVectorIds.length > 0) {
		await vectorIndex.deleteByIds(staleVectorIds);
	}

	await env.DB.prepare("DELETE FROM note_chunks WHERE note_id = ?")
		.bind(note.id)
		.run();
	if (chunkRows.length > 0) {
		const statements = chunkRows.map((item) =>
			env.DB.prepare(
				`INSERT INTO note_chunks (
					id, note_id, chunk_index, chunk_text, token_count, embedding_model, vector_id
				) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
				.bind(item.id, note.id, item.chunkIndex, item.chunkText, item.tokenCount, model, item.vectorId),
		);
		await env.DB.batch(statements);
	}
}

export async function clearNoteChunksAndVectors(env: Env, noteId: string): Promise<void> {
	const { results } = await env.DB.prepare(
		`SELECT vector_id AS vectorId
		 FROM note_chunks
		 WHERE note_id = ?`,
	)
		.bind(noteId)
		.all<{ vectorId: string | null }>();
	const vectorIds = results
		.map((item) => item.vectorId)
		.filter((item): item is string => Boolean(item));
	if (vectorIds.length > 0) {
		const vectorIndex = getNotesVectorIndex(env);
		if (!vectorIndex) {
			throw new Error("Vectorize binding `NOTES_VECTOR_INDEX` is missing");
		}
		await vectorIndex.deleteByIds(vectorIds);
	}
	await env.DB.prepare("DELETE FROM note_chunks WHERE note_id = ?")
		.bind(noteId)
		.run();
}
