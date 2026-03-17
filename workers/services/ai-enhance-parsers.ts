import { buildExcerpt } from "./note-query-service";
import { normalizeNoteRelationType, normalizeTagName } from "./note-relations-service";
import { buildOutlineFallback } from "./ai-enhance-fallback";
import type {
	AiContextNoteItem,
	AiEnhanceRelationSuggestion,
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

export function parseTagSuggestions(
	value: unknown,
	limit: number,
	maxTagLength: number,
	existingTagNames: string[] = [],
): AiEnhanceTagSuggestion[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const output: AiEnhanceTagSuggestion[] = [];
	const seen = new Set<string>();
	const existingTags = buildExistingTagCandidates(existingTagNames, maxTagLength);
	for (const item of value) {
		if (output.length >= limit) {
			break;
		}
		const rawName = typeof item === "string"
			? item
			: (isRecord(item) && typeof item.name === "string" ? item.name : "");
		const normalizedName = normalizeTagName(rawName, maxTagLength);
		const resolvedName = findExistingTagName(normalizedName, existingTags) ?? normalizedName;
		if (!resolvedName || seen.has(resolvedName.toLowerCase())) {
			continue;
		}
		seen.add(resolvedName.toLowerCase());
		output.push({
			name: resolvedName,
			confidence: clampFraction(isRecord(item) ? (readFloatValue(item, "confidence") ?? 0.6) : 0.6),
			reason: isRecord(item) && typeof item.reason === "string" && item.reason.trim()
				? item.reason.trim()
				: "语义相关",
		});
	}
	return output;
}

type ExistingTagCandidate = {
	name: string;
	normalizedName: string;
	collapsedKey: string;
	tokenSignature: string;
};

function buildExistingTagCandidates(existingTagNames: string[], maxTagLength: number): ExistingTagCandidate[] {
	const seen = new Set<string>();
	const output: ExistingTagCandidate[] = [];
	for (const value of existingTagNames) {
		const normalizedName = normalizeTagName(value, maxTagLength);
		if (!normalizedName || seen.has(normalizedName)) {
			continue;
		}
		seen.add(normalizedName);
		output.push({
			name: normalizedName,
			normalizedName,
			collapsedKey: toCollapsedTagKey(normalizedName),
			tokenSignature: toTagTokenSignature(normalizedName),
		});
	}
	return output;
}

function findExistingTagName(normalizedName: string, existingTags: ExistingTagCandidate[]): string | null {
	if (!normalizedName) {
		return null;
	}
	const exactMatch = existingTags.find((item) => item.normalizedName === normalizedName);
	if (exactMatch) {
		return exactMatch.name;
	}
	const collapsedKey = toCollapsedTagKey(normalizedName);
	if (collapsedKey) {
		const collapsedMatch = existingTags.find((item) => item.collapsedKey === collapsedKey);
		if (collapsedMatch) {
			return collapsedMatch.name;
		}
	}
	const tokenSignature = toTagTokenSignature(normalizedName);
	if (!tokenSignature) {
		return null;
	}
	const tokenMatch = existingTags.find((item) => item.tokenSignature === tokenSignature);
	return tokenMatch?.name ?? null;
}

function toCollapsedTagKey(value: string): string {
	return value.replace(/[-_/]+/gu, "");
}

function toTagTokenSignature(value: string): string {
	return value
		.split(/[-_/]+/gu)
		.map((item) => item.trim())
		.filter((item) => item.length > 0)
		.sort((left, right) => left.localeCompare(right, "zh-CN"))
		.join("|");
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

export function parseRelationSuggestions(
	value: unknown,
	limit: number,
	candidatesById: Map<string, AiContextNoteItem>,
	relatedNoteIds: Set<string>,
): AiEnhanceRelationSuggestion[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const output: AiEnhanceRelationSuggestion[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (output.length >= limit || !isRecord(item)) {
			continue;
		}
		const noteId = typeof item.noteId === "string" ? item.noteId.trim() : "";
		const candidate = noteId ? candidatesById.get(noteId) : null;
		if (!candidate || relatedNoteIds.has(candidate.noteId) || seen.has(candidate.noteId)) {
			continue;
		}
		const relationType = normalizeNoteRelationType(
			typeof item.relationType === "string" ? item.relationType.trim() : null,
		) ?? "related";
		seen.add(candidate.noteId);
		output.push({
			noteId: candidate.noteId,
			slug: candidate.slug,
			title: candidate.title,
			snippet: candidate.snippet,
			relationType,
			score: clampFraction(readFloatValue(item, "score") ?? readFloatValue(item, "confidence") ?? 0.6),
			reason: typeof item.reason === "string" && item.reason.trim() ? item.reason.trim() : "建议建立关系",
			evidenceExcerpt: typeof item.evidenceExcerpt === "string" && item.evidenceExcerpt.trim()
				? item.evidenceExcerpt.trim()
				: candidate.snippet,
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
