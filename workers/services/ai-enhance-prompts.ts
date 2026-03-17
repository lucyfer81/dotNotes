import type {
	AiEnhancePreparedInput,
	AiEnhanceSummaryMode,
} from "./ai-types";

const DEFAULT_AI_PROMPT_NOTE_MAX_CHARS = 4000;
const DEFAULT_AI_PROMPT_CANDIDATE_SNIPPET_MAX_CHARS = 160;

export function buildAiEnhanceDefaultQuery(title: string, bodyText: string): string {
	const condensedTitle = title.trim();
	const bodySnippet = clipTextForAi(bodyText, 120);
	const joined = `${condensedTitle} ${bodySnippet}`.trim();
	return joined || "笔记增强";
}

export function buildAiEnhanceRelationQuery(title: string, bodyText: string): string {
	const condensedTitle = title.trim();
	if (condensedTitle) {
		return condensedTitle;
	}
	const bodySnippet = clipTextForAi(bodyText, 48);
	return bodySnippet || "笔记关系";
}

export function buildSharedPromptContext(
	input: AiEnhancePreparedInput,
	maxInputChars: number,
): {
	sourceBody: string;
	sharedContext: {
		query: string;
		current_note: {
			noteId: string;
			slug: string;
			title: string;
			excerpt: string;
			bodyText: string;
		};
		candidates: Array<{ noteId: string; slug: string; title: string; snippet: string; updatedAt: string }>;
	};
} {
	const sourceBody = clipTextForAi(input.note.bodyText ?? "", Math.min(maxInputChars, DEFAULT_AI_PROMPT_NOTE_MAX_CHARS));
	const candidateContext = input.candidates.slice(0, Math.max(input.topK * 2, 8)).map((item) => ({
		noteId: item.noteId,
		slug: item.slug,
		title: item.title,
		snippet: clipTextForAi(item.snippet, DEFAULT_AI_PROMPT_CANDIDATE_SNIPPET_MAX_CHARS),
		updatedAt: item.updatedAt,
	}));
	return {
		sourceBody,
		sharedContext: {
			query: input.query,
			current_note: {
				noteId: input.note.id,
				slug: input.note.slug,
				title: input.note.title,
				excerpt: clipTextForAi(input.note.excerpt || "", 240),
				bodyText: sourceBody,
			},
			candidates: candidateContext,
		},
	};
}

export function buildTitleTaskPrompt(input: { title: string; sourceBody: string; query: string }) {
	return {
		systemPrompt: "你是笔记命名助手。目标是给出可区分、可检索的标题候选。返回严格 JSON，不要 markdown。",
		userPrompt: [
			"规则：",
			"- 输出 3-5 个标题候选，长度建议 12-32 字符。",
			"- 风格至少覆盖：概念型、行动型、问题型。",
			"- 避免与 original_title 仅做同义替换。",
			"- confidence 范围 0~1。",
			"",
			`input: ${JSON.stringify({
				original_title: input.title,
				note_content: input.sourceBody,
				query: input.query,
			})}`,
			"schema:",
			JSON.stringify({
				titleCandidates: [{ title: "string", confidence: 0.8, reason: "string" }],
			}),
		].join("\n"),
	};
}

export function buildTagsTaskPrompt(input: {
	sharedContext: { current_note: unknown; query: string };
	existingTagNames: string[];
}) {
	return {
		systemPrompt: "你是笔记标签助手。目标是生成可复用、低冗余、便于检索的层级标签。返回严格 JSON。",
		userPrompt: [
			"规则：",
			"- 优先复用 existing_tags，仅在必要时创建新标签。",
			"- 如果候选标签与 existing_tags 仅是分隔符、层级写法或词序不同，必须直接返回 existing_tags 里的原标签名。",
			"- 层级标签最多 3 层，使用 '/' 作为分隔。",
			"- 输出 5-12 个标签，不要泛化标签。",
			"- confidence 范围 0~1。",
			"",
			`input: ${JSON.stringify({
				current_note: input.sharedContext.current_note,
				existing_tags: input.existingTagNames,
				query: input.sharedContext.query,
			})}`,
			"schema:",
			JSON.stringify({
				tagSuggestions: [{ name: "topic/subtopic", confidence: 0.8, reason: "string" }],
			}),
		].join("\n"),
	};
}

export function buildSemanticTaskPrompt(sharedContext: unknown) {
	return {
		systemPrompt: "你是笔记语义检索助手。只允许从 candidates 中选择相关笔记，返回严格 JSON。",
		userPrompt: [
			"规则：",
			"- 仅输出 candidates 中的 noteId。",
			"- 关注同义词、缩写、错别字容错后的主题相似性。",
			"- 每项给出 reason 和 score(0~1)。",
			"",
			`input: ${JSON.stringify(sharedContext)}`,
			"schema:",
			JSON.stringify({
				semanticSearch: [{ noteId: "string", score: 0.8, reason: "string" }],
			}),
		].join("\n"),
	};
}

export function buildRelationsTaskPrompt(sharedContext: unknown, relatedNoteIds: Set<string>) {
	return {
		systemPrompt: "你是知识库关系发现助手。只允许从 candidates 选择目标，并判断笔记间关系。返回严格 JSON。",
		userPrompt: [
			"规则：",
			"- 仅输出 candidates 中的 noteId。",
			"- 过滤 already_related_note_ids。",
			"- relationType 仅允许: similar, complements, contrasts, same_project, same_area, related。",
			"- 每条建议包含 reason、score(0~1)、evidenceExcerpt。",
			"",
			`input: ${JSON.stringify({
				...(sharedContext as Record<string, unknown>),
				already_related_note_ids: [...relatedNoteIds],
			})}`,
			"schema:",
			JSON.stringify({
				relationSuggestions: [
					{
						noteId: "string",
						relationType: "related",
						score: 0.8,
						reason: "string",
						evidenceExcerpt: "string",
					},
				],
			}),
		].join("\n"),
	};
}

export function buildSummaryTaskPrompt(input: { mode: AiEnhanceSummaryMode; title: string; sourceBody: string; query: string }) {
	return {
		systemPrompt: "你是笔记提炼助手。输出有信息增量的摘要和大纲，避免复述原文。返回严格 JSON。",
		userPrompt: [
			`mode: ${input.mode}`,
			"规则：",
			"- mini 模式：输出 1 句摘要 + 2 条关键点。",
			"- full 模式：输出摘要、关键点、大纲、待确认问题与下一步。",
			"- 所有输出必须可执行或可验证。",
			"",
			`input: ${JSON.stringify({
				title: input.title,
				bodyText: input.sourceBody,
				query: input.query,
			})}`,
			"schema:",
			JSON.stringify({
				summary: "string",
				key_points: ["string"],
				outline: ["string"],
				open_questions: ["string"],
				action_items: ["string"],
			}),
		].join("\n"),
	};
}

export function buildSimilarTaskPrompt(sharedContext: unknown) {
	return {
		systemPrompt: "你是相似笔记发现助手。只允许从 candidates 中选择，返回严格 JSON。",
		userPrompt: [
			"规则：",
			"- 仅输出 candidates 中的 noteId。",
			"- 给出 similarity_type、reason、score(0~1)。",
			"",
			`input: ${JSON.stringify(sharedContext)}`,
			"schema:",
			JSON.stringify({
				similarNotes: [{ noteId: "string", score: 0.8, reason: "string", similarity_type: "same_topic" }],
			}),
		].join("\n"),
	};
}

export function clipTextForAi(text: string, maxChars: number): string {
	const normalized = text.replace(/\s+/gu, " ").trim();
	if (normalized.length <= maxChars) {
		return normalized;
	}
	return `${normalized.slice(0, maxChars)}...`;
}
