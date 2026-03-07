import {
	countWords,
	getIndexMaxChars,
	getIndexOverlapChars,
	getNoteById,
} from "./note-query-service";
import { hydrateNoteBodyFromR2 } from "./note-storage-service";
import { clearNoteChunksAndVectors, upsertNoteChunksToVectorIndex } from "./index-vector-service";
import type { IndexAction, NoteRow } from "./index-types";

export async function processSingleNoteIndexJob(env: Env, noteId: string, action: IndexAction): Promise<number> {
	if (action === "delete") {
		await clearNoteChunksAndVectors(env, noteId);
		return 0;
	}

	const note = await getNoteById(env.DB, noteId);
	if (!note || note.deletedAt || note.isArchived) {
		await clearNoteChunksAndVectors(env, noteId);
		return 0;
	}

	const hydrated = await hydrateNoteBodyFromR2(env, note);
	const bodyText = hydrated.bodyText ?? "";
	const chunks = buildNoteChunks(bodyText, getIndexMaxChars(env), getIndexOverlapChars(env));
	await upsertNoteChunksToVectorIndex(env, hydrated as NoteRow, chunks);
	return chunks.length;
}

export function buildNoteChunks(
	bodyText: string,
	maxChars: number,
	overlapChars: number,
): Array<{ chunkIndex: number; chunkText: string; tokenCount: number }> {
	const normalized = bodyText.replace(/\r\n/g, "\n").trim();
	if (!normalized) {
		return [];
	}

	const paragraphs = normalized
		.split(/\n{2,}/u)
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
	const rawChunks: string[] = [];
	let current = "";
	for (const paragraph of paragraphs) {
		const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
		if (candidate.length <= maxChars) {
			current = candidate;
			continue;
		}
		if (current) {
			rawChunks.push(current);
		}
		if (paragraph.length <= maxChars) {
			current = paragraph;
			continue;
		}
		const longParagraphChunks = splitLongText(paragraph, maxChars, overlapChars);
		rawChunks.push(...longParagraphChunks.slice(0, -1));
		current = longParagraphChunks.at(-1) ?? "";
	}
	if (current) {
		rawChunks.push(current);
	}

	const finalChunks: string[] = [];
	for (let index = 0; index < rawChunks.length; index += 1) {
		const base = rawChunks[index] ?? "";
		const prev = finalChunks[index - 1];
		if (!prev || overlapChars <= 0) {
			finalChunks.push(base);
			continue;
		}
		const tail = prev.slice(Math.max(0, prev.length - overlapChars)).trim();
		const merged = `${tail}\n${base}`.trim();
		finalChunks.push(merged.length <= maxChars ? merged : merged.slice(merged.length - maxChars));
	}

	return finalChunks.map((chunkText, chunkIndex) => ({
		chunkIndex,
		chunkText,
		tokenCount: countWords(chunkText),
	}));
}

export function splitLongText(text: string, maxChars: number, overlapChars: number): string[] {
	const stride = Math.max(1, maxChars - Math.max(0, overlapChars));
	const chunks: string[] = [];
	for (let start = 0; start < text.length; start += stride) {
		const slice = text.slice(start, start + maxChars).trim();
		if (slice) {
			chunks.push(slice);
		}
		if (start + maxChars >= text.length) {
			break;
		}
	}
	return chunks;
}
