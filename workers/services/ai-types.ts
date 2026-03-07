export type NoteStatusFilter = "active" | "archived" | "deleted" | "all";
export type NoteSearchMode = "none" | "fts" | "like-fallback" | "hybrid";

export type NoteRow = {
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

export type AiContextRequestInput = {
	query: string;
	noteId: string | null;
	limit: number;
	status: NoteStatusFilter;
};

export type AiContextNoteItem = {
	noteId: string;
	slug: string;
	title: string;
	snippet: string;
	updatedAt: string;
	searchScore: number | null;
};

export type AiContextChunkItem = {
	noteId: string;
	slug: string;
	title: string;
	chunkIndex: number;
	snippet: string;
	updatedAt: string;
};

export type AiEnhanceRequestInput = {
	query: string | null;
	topK: number;
};

export type AiEnhanceTaskKey = "title" | "tags" | "semantic" | "links" | "summary" | "similar";

export type AiEnhanceTitleCandidate = {
	title: string;
	confidence: number;
	reason: string;
};

export type AiEnhanceTagSuggestion = {
	name: string;
	confidence: number;
	reason: string;
};

export type AiEnhanceRelatedNoteItem = {
	noteId: string;
	slug: string;
	title: string;
	snippet: string;
	score: number;
	reason: string;
};

export type AiEnhanceLinkSuggestion = {
	targetNoteId: string;
	slug: string;
	title: string;
	anchorText: string;
	score: number;
	reason: string;
};

export type AiEnhanceSummaryMode = "skip" | "mini" | "full";

export type AiEnhanceSummaryMeta = {
	mode: AiEnhanceSummaryMode;
	skipped: boolean;
	reason: string | null;
};

export type AiEnhanceResult = {
	noteId: string;
	query: string;
	generatedAt: string;
	provider: "siliconflow" | "local-fallback";
	model: string | null;
	warnings: string[];
	titleCandidates: AiEnhanceTitleCandidate[];
	tagSuggestions: AiEnhanceTagSuggestion[];
	semanticSearch: AiEnhanceRelatedNoteItem[];
	linkSuggestions: AiEnhanceLinkSuggestion[];
	summary: string;
	outline: string[];
	summaryMeta: AiEnhanceSummaryMeta;
	similarNotes: AiEnhanceRelatedNoteItem[];
};

export type AiEnhancePreparedInput = {
	note: NoteRow;
	query: string;
	topK: number;
	candidates: AiContextNoteItem[];
	linkedSlugs: Set<string>;
	existingTagNames: string[];
};
