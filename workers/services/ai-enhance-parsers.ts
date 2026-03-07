import { buildExcerpt } from "./note-query-service";
import { normalizeTagName } from "./note-relations-service";
import { buildOutlineFallback } from "./ai-enhance-fallback";
import type {
	AiContextNoteItem,
	AiEnhanceLinkSuggestion,
	AiEnhanceRelatedNoteItem,
	AiEnhanceSummaryMode,
	AiEnhanceTagSuggestion,
	AiEnhanceTitleCandidate,
} from "./ai-types";

export function parseTitleCandidates(value: unknown, limit: number): AiEnhanceTitleCandidate[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const output: AiEnhanceTitleCandidate[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (output.length >= limit) {
			break;
		}
		if (typeof item === "string") {
			const title = item.trim();
			if (!title || seen.has(title)) {
				continue;
			}
			seen.add(title);
			output.push({
				title,
				confidence: 0.6,
				reason: "模型建议",
			});
			continue;
		}
		if (!isRecord(item)) {
			continue;
		}
		const title = typeof item.title === "string" ? item.title.trim() : "";
		if (!title || seen.has(title)) {
			continue;
		}
		seen.add(title);
		output.push({
			title,
			confidence: clampFraction(readFloatValue(item, "confidence") ?? 0.6),
			reason: typeof item.reason === "string" && item.reason.trim() ? item.reason.trim() : "模型建议",
		});
	}
	return output;
}

export function parseTagSuggestions(value: unknown, limit: number, maxTagLength: number): AiEnhanceTagSuggestion[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const output: AiEnhanceTagSuggestion[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (output.length >= limit) {
			break;
		}
		const rawName = typeof item === "string"
			? item
			: (isRecord(item) && typeof item.name === "string" ? item.name : "");
		const normalizedName = normalizeTagName(rawName, maxTagLength);
		if (!normalizedName || seen.has(normalizedName.toLowerCase())) {
			continue;
		}
		seen.add(normalizedName.toLowerCase());
		output.push({
			name: normalizedName,
			confidence: clampFraction(isRecord(item) ? (readFloatValue(item, "confidence") ?? 0.6) : 0.6),
			reason: isRecord(item) && typeof item.reason === "string" && item.reason.trim()
				? item.reason.trim()
				: "语义相关",
		});
	}
	return output;
}

export function parseRelatedNoteItems(
	value: unknown,
	limit: number,
	candidatesById: Map<string, AiContextNoteItem>,
): AiEnhanceRelatedNoteItem[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const output: AiEnhanceRelatedNoteItem[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (output.length >= limit || !isRecord(item)) {
			continue;
		}
		const noteId = typeof item.noteId === "string" ? item.noteId.trim() : "";
		const candidate = noteId ? candidatesById.get(noteId) : null;
		if (!candidate || seen.has(candidate.noteId)) {
			continue;
		}
		seen.add(candidate.noteId);
		output.push({
			noteId: candidate.noteId,
			slug: candidate.slug,
			title: candidate.title,
			snippet: candidate.snippet,
			score: clampFraction(readFloatValue(item, "score") ?? readFloatValue(item, "confidence") ?? 0.6),
			reason: typeof item.reason === "string" && item.reason.trim() ? item.reason.trim() : "语义相关",
		});
	}
	return output;
}

export function parseLinkSuggestions(
	value: unknown,
	limit: number,
	candidatesById: Map<string, AiContextNoteItem>,
	linkedSlugs: Set<string>,
): AiEnhanceLinkSuggestion[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const output: AiEnhanceLinkSuggestion[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (output.length >= limit || !isRecord(item)) {
			continue;
		}
		const noteId = typeof item.noteId === "string" ? item.noteId.trim() : "";
		const candidate = noteId ? candidatesById.get(noteId) : null;
		if (!candidate || linkedSlugs.has(candidate.slug) || seen.has(candidate.noteId)) {
			continue;
		}
		seen.add(candidate.noteId);
		const anchorText = typeof item.anchorText === "string" && item.anchorText.trim()
			? item.anchorText.trim()
			: candidate.slug;
		output.push({
			targetNoteId: candidate.noteId,
			slug: candidate.slug,
			title: candidate.title,
			anchorText,
			score: clampFraction(readFloatValue(item, "score") ?? readFloatValue(item, "confidence") ?? 0.6),
			reason: typeof item.reason === "string" && item.reason.trim() ? item.reason.trim() : "建议建立双链",
		});
	}
	return output;
}

export function normalizeSummaryTaskResult(
	payload: unknown,
	bodyText: string,
	mode: AiEnhanceSummaryMode,
): { summary: string; outline: string[] } {
	const source = isRecord(payload) ? payload : {};
	const summary = typeof source.summary === "string" && source.summary.trim()
		? source.summary.trim()
		: buildExcerpt(bodyText);
	const outline = parseOutlineItems(
		source.outline ?? source.key_points ?? source.keyPoints,
		bodyText,
	);
	if (outline.length > 0) {
		return { summary, outline };
	}
	return {
		summary,
		outline: mode === "mini"
			? ["核心结论", "后续动作"]
			: buildOutlineFallback(bodyText),
	};
}

function parseOutlineItems(value: unknown, bodyText: string): string[] {
	if (Array.isArray(value)) {
		const lines = value.flatMap((item) => {
			if (typeof item === "string") {
				return [item.trim()];
			}
			if (isRecord(item) && typeof item.heading === "string") {
				const output = [item.heading.trim()];
				if (Array.isArray(item.children)) {
					for (const child of item.children) {
						if (typeof child === "string" && child.trim()) {
							output.push(child.trim());
						}
					}
				}
				return output;
			}
			return [];
		})
			.filter((item) => item.length > 0)
			.slice(0, 8);
		if (lines.length > 0) {
			return lines;
		}
	}
	return buildOutlineFallback(bodyText);
}

export function readFloatValue(obj: Record<string, unknown>, key: string): number | null {
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

export function clampFraction(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.max(0, Math.min(1, value));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
