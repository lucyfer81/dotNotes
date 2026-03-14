export type {
	AiContextChunkItem,
	AiContextNoteItem,
	AiContextRequestInput,
	AiEnhancePreparedInput,
	AiEnhanceRelationSuggestion,
	AiEnhanceRelatedNoteItem,
	AiEnhanceRequestInput,
	AiEnhanceResult,
	AiEnhanceSummaryMeta,
	AiEnhanceSummaryMode,
	AiEnhanceTagSuggestion,
	AiEnhanceTaskKey,
	AiEnhanceTitleCandidate,
	NoteRow,
	NoteSearchMode,
	NoteStatusFilter,
} from "./ai-types";

export {
	getAiBaseUrl,
	getAiChatModel,
	getSiliconflowApiKey,
	getAiTimeoutMs,
	getAiTaskTimeoutMs,
	getAiMaxInputChars,
	getAiEmbeddingModel,
	getAiEmbeddingBatchSize,
	getAiEmbedTimeoutMs,
	buildAiChatRuntime,
	callSiliconflowJson,
	buildEmbeddingsForTexts,
} from "./ai-provider-service";

export {
	parseAiContextInput,
	buildAiContext,
} from "./ai-retrieval-service";

export {
	AI_ENHANCE_TASK_KEYS,
	parseAiEnhanceInput,
	parseAiEnhanceTaskKey,
	handleAiEnhanceRequest,
	streamAiEnhanceTask,
} from "./ai-enhance-service";

export function getNotesBucket(env: Env): R2Bucket | null {
	return "NOTES_BUCKET" in env && env.NOTES_BUCKET ? env.NOTES_BUCKET : null;
}
