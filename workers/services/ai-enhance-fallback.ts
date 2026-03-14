import {
	buildExcerpt,
	buildTitle,
	countWords,
	extractHashTags,
} from "./note-query-service";
import { normalizeTagName } from "./note-relations-service";
import type {
	AiContextNoteItem,
	AiEnhancePreparedInput,
	AiEnhanceRelationSuggestion,
	AiEnhanceRelatedNoteItem,
	AiEnhanceResult,
	AiEnhanceSummaryMeta,
	AiEnhanceTagSuggestion,
	AiEnhanceTaskKey,
	AiEnhanceTitleCandidate,
	NoteRow,
} from "./ai-types";

const DEFAULT_TAG_NAME_MAX_LENGTH = 48;
const DEFAULT_AI_SUMMARY_SKIP_CHAR_THRESHOLD = 120;
const DEFAULT_AI_SUMMARY_SKIP_WORD_THRESHOLD = 40;
const DEFAULT_AI_SUMMARY_MINI_CHAR_THRESHOLD = 300;
const DEFAULT_AI_SUMMARY_MINI_WORD_THRESHOLD = 80;

export function createEmptyAiEnhanceResult(
	input: AiEnhancePreparedInput,
	meta: { provider: "siliconflow" | "local-fallback"; model: string | null; warnings: string[] },
): AiEnhanceResult {
	return {
		noteId: input.note.id,
		query: input.query,
		generatedAt: new Date().toISOString(),
		provider: meta.provider,
		model: meta.model,
		warnings: [...meta.warnings],
		titleCandidates: [],
		tagSuggestions: [],
		semanticSearch: [],
		relationSuggestions: [],
		summary: "",
		outline: [],
		summaryMeta: {
			mode: "full",
			skipped: false,
			reason: null,
		},
		similarNotes: [],
	};
}

export function decideSummaryMode(bodyText: string): AiEnhanceSummaryMeta {
	const normalized = bodyText.replace(/\s+/gu, " ").trim();
	const charCount = normalized.length;
	const wordCount = countWords(normalized);
	if (charCount < DEFAULT_AI_SUMMARY_SKIP_CHAR_THRESHOLD && wordCount < DEFAULT_AI_SUMMARY_SKIP_WORD_THRESHOLD) {
		return {
			mode: "skip",
			skipped: true,
			reason: "too_short",
		};
	}
	if (charCount < DEFAULT_AI_SUMMARY_MINI_CHAR_THRESHOLD && wordCount < DEFAULT_AI_SUMMARY_MINI_WORD_THRESHOLD) {
		return {
			mode: "mini",
			skipped: false,
			reason: null,
		};
	}
	return {
		mode: "full",
		skipped: false,
		reason: null,
	};
}

export function buildFallbackTitleCandidates(note: NoteRow, topK: number): AiEnhanceTitleCandidate[] {
	const output: AiEnhanceTitleCandidate[] = [
		{
			title: note.title,
			confidence: 0.5,
			reason: "保留原标题",
		},
	];
	const fallbackTitle = buildTitle(note.bodyText ?? "");
	if (fallbackTitle && fallbackTitle !== note.title) {
		output.push({
			title: fallbackTitle,
			confidence: 0.45,
			reason: "基于正文首行生成",
		});
	}
	return output.slice(0, topK);
}

export function buildFallbackTagSuggestions(bodyText: string, topK: number): AiEnhanceTagSuggestion[] {
	return extractHashTags(bodyText)
		.slice(0, topK)
		.map((item) => ({
			name: normalizeTagName(item, DEFAULT_TAG_NAME_MAX_LENGTH) || item,
			confidence: 0.45,
			reason: "来自正文 hashtag",
		}));
}

export function buildFallbackSemanticSearch(candidates: AiContextNoteItem[], topK: number): AiEnhanceRelatedNoteItem[] {
	return candidates.slice(0, topK).map((item, index) => ({
		noteId: item.noteId,
		slug: item.slug,
		title: item.title,
		snippet: item.snippet,
		score: clampFraction(0.6 - index * 0.05),
		reason: "关键词召回",
	}));
}

export function buildFallbackRelationSuggestions(
	semanticSearch: AiEnhanceRelatedNoteItem[],
	relatedNoteIds: Set<string>,
	topK: number,
): AiEnhanceRelationSuggestion[] {
	return semanticSearch
		.filter((item) => !relatedNoteIds.has(item.noteId))
		.slice(0, topK)
		.map((item) => ({
			noteId: item.noteId,
			slug: item.slug,
			title: item.title,
			snippet: item.snippet,
			relationType: "related",
			score: item.score,
			reason: "基于关键词建议建立关系",
			evidenceExcerpt: item.snippet,
		}));
}

export function buildOutlineFallback(bodyText: string): string[] {
	const headings = bodyText
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => /^#{1,6}\s+/u.test(line))
		.map((line) => line.replace(/^#{1,6}\s+/u, ""))
		.slice(0, 8);
	if (headings.length > 0) {
		return headings;
	}
	const sentences = bodyText
		.replace(/\s+/gu, " ")
		.split(/[。！？.!?]/u)
		.map((item) => item.trim())
		.filter((item) => item.length > 0)
		.slice(0, 6);
	if (sentences.length > 0) {
		return sentences;
	}
	return ["核心观点", "关键细节", "下一步"];
}

export function buildAiEnhanceFallback(
	input: AiEnhancePreparedInput,
	tasks: AiEnhanceTaskKey[],
	warning: string,
): AiEnhanceResult {
	const result = createEmptyAiEnhanceResult(input, {
		provider: "local-fallback",
		model: null,
		warnings: [warning],
	});
	const taskSet = new Set(tasks);
	if (taskSet.has("title")) {
		result.titleCandidates = buildFallbackTitleCandidates(input.note, input.topK);
	}
	if (taskSet.has("tags")) {
		result.tagSuggestions = buildFallbackTagSuggestions(input.note.bodyText ?? "", input.topK);
	}
	if (taskSet.has("semantic")) {
		result.semanticSearch = buildFallbackSemanticSearch(input.candidates, input.topK);
	}
	if (taskSet.has("relations")) {
		const base = result.semanticSearch.length > 0
			? result.semanticSearch
			: buildFallbackSemanticSearch(input.candidates, input.topK);
		result.relationSuggestions = buildFallbackRelationSuggestions(base, input.relatedNoteIds, input.topK);
	}
	if (taskSet.has("summary")) {
		const summaryMeta = decideSummaryMode(input.note.bodyText ?? "");
		result.summaryMeta = summaryMeta;
		if (summaryMeta.mode === "skip") {
			result.summary = "";
			result.outline = [];
		} else {
			result.summary = buildExcerpt(input.note.bodyText ?? "");
			result.outline = buildOutlineFallback(input.note.bodyText ?? "");
		}
	}
	if (taskSet.has("similar")) {
		result.similarNotes = result.semanticSearch.length > 0
			? result.semanticSearch
			: buildFallbackSemanticSearch(input.candidates, input.topK);
	}
	return result;
}

function clampFraction(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.max(0, Math.min(1, value));
}
