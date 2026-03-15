export type FolderApiItem = {
	id: string;
	parentId: string | null;
	name: string;
	sortOrder: number;
};

export type TagApiItem = {
	id: string;
	name: string;
	color: string;
	createdAt: string;
};

export type NoteApiItem = {
	id: string;
	slug: string;
	title: string;
	folderId: string;
	storageType: "d1" | "r2";
	bodyText: string | null;
	excerpt: string;
	searchScore: number | null;
	isArchived: boolean;
	deletedAt: string | null;
	updatedAt: string;
	tags: TagApiItem[];
};

export type NoteStatus = "active" | "archived" | "deleted" | "all";
export type NoteRelationTypeApiItem =
	| "similar"
	| "complements"
	| "contrasts"
	| "same_project"
	| "same_area"
	| "related";
export type NoteRelationStatusApiItem = "suggested" | "accepted" | "rejected" | "all";
export type NoteRelationSourceApiItem = "ai" | "manual" | "all";
export type NoteRelationApiItem = {
	id: string;
	relationType: NoteRelationTypeApiItem;
	status: Exclude<NoteRelationStatusApiItem, "all">;
	source: Exclude<NoteRelationSourceApiItem, "all">;
	score: number;
	reason: string;
	evidenceExcerpt: string | null;
	provider: string | null;
	model: string | null;
	createdAt: string;
	updatedAt: string;
	otherNote: {
		id: string;
		slug: string;
		title: string;
		excerpt: string;
		updatedAt: string;
	};
};
export type NoteRelationListApiItem = {
	noteId: string;
	items: NoteRelationApiItem[];
	paging: { limit: number; offset: number; count: number };
	filters: {
		status: NoteRelationStatusApiItem;
		source: NoteRelationSourceApiItem;
	};
};
export type NoteAssetApiItem = {
	id: string;
	noteId: string;
	fileName: string | null;
	mimeType: string;
	sizeBytes: number;
	sha256: string | null;
	createdAt: string;
	downloadUrl: string;
};
export type AiEnhanceTitleCandidateApiItem = {
	title: string;
	confidence: number;
	reason: string;
};
export type AiEnhanceTagSuggestionApiItem = {
	name: string;
	confidence: number;
	reason: string;
};
export type AiEnhanceRelatedNoteApiItem = {
	noteId: string;
	slug: string;
	title: string;
	snippet: string;
	score: number;
	reason: string;
};
export type AiEnhanceRelationSuggestionApiItem = {
	noteId: string;
	slug: string;
	title: string;
	snippet: string;
	relationType: NoteRelationTypeApiItem;
	score: number;
	reason: string;
	evidenceExcerpt: string | null;
};
export type AiEnhanceSummaryMetaApiItem = {
	mode: "skip" | "mini" | "full";
	skipped: boolean;
	reason: string | null;
};
export type AiEnhanceResultApiItem = {
	noteId: string;
	query: string;
	generatedAt: string;
	provider: "siliconflow" | "local-fallback";
	model: string | null;
	warnings: string[];
	titleCandidates: AiEnhanceTitleCandidateApiItem[];
	tagSuggestions: AiEnhanceTagSuggestionApiItem[];
	semanticSearch: AiEnhanceRelatedNoteApiItem[];
	relationSuggestions: AiEnhanceRelationSuggestionApiItem[];
	summary: string;
	outline: string[];
	summaryMeta: AiEnhanceSummaryMetaApiItem;
	similarNotes: AiEnhanceRelatedNoteApiItem[];
};
export type AiEnhanceTaskApiKey = "title" | "tags" | "semantic" | "relations" | "summary" | "similar";
export type AiEnhanceTaskStreamStage = "prepare" | "generate" | "processing";
export type AiEnhanceTaskStreamProgress = {
	task: AiEnhanceTaskApiKey;
	stage: AiEnhanceTaskStreamStage;
};
export type RssItemStatus = "new" | "saved" | "ignored";
export type RssReadingState = "idle" | "queued" | "processing" | "ready" | "failed";
export type RssFeedApiItem = {
	id: string;
	url: string;
	title: string | null;
	enabled: boolean;
	lastFetchedAt: string | null;
	lastError: string | null;
	createdAt: string;
	updatedAt: string;
};
export type RssItemApiItem = {
	id: string;
	feedId: string;
	feedTitle: string | null;
	sourceId: string | null;
	dedupeKey: string;
	link: string | null;
	title: string | null;
	author: string | null;
	publishedAt: string | null;
	summaryRaw: string;
	summaryZh: string | null;
	status: RssItemStatus;
	noteId: string | null;
	readingState: RssReadingState;
	readingError: string | null;
	readingAttemptCount: number;
	readingRequestedAt: string | null;
	readingStartedAt: string | null;
	readingCompletedAt: string | null;
	fetchedAt: string;
	createdAt: string;
	updatedAt: string;
};
export type RssSyncResultApiItem = {
	processedFeeds: number;
	totalFetchedItems: number;
	totalCreated: number;
	totalUpdated: number;
	totalSkipped: number;
	results: Array<{
		feedId: string;
		url: string;
		feedTitle: string | null;
		fetched: number;
		created: number;
		updated: number;
		skipped: number;
		errors: string[];
	}>;
};
export type RssTranslateResultApiItem = {
	requested: number;
	translated: number;
	failed: number;
	processedItemIds: string[];
};
export type IndexJobActionApiItem = "upsert" | "delete";
export type IndexJobStatusApiItem = "pending" | "processing" | "success" | "failed";
export type IndexJobApiItem = {
	noteId: string;
	action: IndexJobActionApiItem;
	status: IndexJobStatusApiItem;
	attemptCount: number;
	chunkCount: number;
	lastError: string | null;
	nextRetryAt: string | null;
	lastIndexedAt: string | null;
	createdAt: string;
	updatedAt: string;
	noteTitle: string | null;
};
export type IndexProcessResultApiItem = {
	noteId: string;
	action: IndexJobActionApiItem;
	status: "success" | "failed";
	chunkCount: number;
	error: string | null;
	attemptCount: number;
};
export type OpsMetricsAlertApiItem = {
	key: string;
	label: string;
	status: "ok" | "warn" | "no_data";
	threshold: number;
	value: number | null;
	message: string;
};
export type OpsMetricsApiItem = {
	windowMinutes: number;
	generatedAt: string;
	api: {
		totalRequests: number;
		errorRequests: number;
		errorRate: number | null;
	};
	search: {
		requestCount: number;
		p50Ms: number | null;
		p95Ms: number | null;
		avgMs: number | null;
	};
	index: {
		pending: number;
		processing: number;
		failed: number;
		backlog: number;
		recentSuccess: number;
		recentFailed: number;
		successRate: number | null;
	};
	alerts: OpsMetricsAlertApiItem[];
};
export type OpsAiProbeSummaryApiItem = {
	sampleCount: number;
	successCount: number;
	failureCount: number;
	ttfbMs: {
		p50: number | null;
		p95: number | null;
		avg: number | null;
		min: number | null;
		max: number | null;
	};
	totalMs: {
		p50: number | null;
		p95: number | null;
		avg: number | null;
		min: number | null;
		max: number | null;
	};
	recentErrors: string[];
};
export type OpsAiProbeApiItem = {
	sampledAt: string;
	colo: string | null;
	baseUrl: string;
	count: number;
	timeoutMs: number;
	probes: Record<string, OpsAiProbeSummaryApiItem & { model?: string }>;
};
export type NoteStorageMigrateApiItem = {
	dryRun: boolean;
	limit: number;
	minBytes: number;
	scanned: number;
	migrated: number;
	noteIds: string[];
};
export type RssReadingProcessApiItem = {
	processed: number;
	created: number;
	failed: number;
	skipped: number;
	itemIds: string[];
};
export type OpsRssReadingJobsApiItem = {
	items: RssItemApiItem[];
	paging: { limit: number; offset: number; count: number };
	summary: {
		queued: number;
		processing: number;
		failed: number;
	};
};

type ListNotesOptions = {
	limit?: number;
	offset?: number;
	folderId?: string | null;
	tagIds?: string[];
	tagMode?: "any" | "all";
	keyword?: string;
	status?: NoteStatus;
};
type ListTagsOptions = {
	status?: NoteStatus;
};
type CleanupTagsOptions = {
	dryRun?: boolean;
	limit?: number;
};
type UpdateTagInput = {
	name?: string;
	color?: string;
};

type UpdateNoteInput = {
	title?: string;
	folderId?: string;
	bodyText?: string;
	excerpt?: string;
	tagNames?: string[];
};

type CreateNoteInput = {
	title: string;
	folderId: string;
	bodyText: string;
	tagNames?: string[];
};

type CreateFolderInput = {
	name: string;
	parentId: string;
	sortOrder?: number;
	slug?: string;
};

type UpdateFolderInput = {
	name?: string;
	parentId?: string;
	sortOrder?: number;
	slug?: string;
};
type AiEnhanceInput = {
	query?: string;
	topK?: number;
};
type ListNoteRelationsOptions = {
	status?: NoteRelationStatusApiItem;
	source?: NoteRelationSourceApiItem;
	limit?: number;
	offset?: number;
};
type UpsertNoteRelationInput = {
	otherNoteId: string;
	relationType?: NoteRelationTypeApiItem;
	status?: Exclude<NoteRelationStatusApiItem, "all">;
	source?: Exclude<NoteRelationSourceApiItem, "all">;
	score?: number;
	reason?: string;
	evidenceExcerpt?: string | null;
	provider?: string | null;
	model?: string | null;
};
type UpdateNoteRelationInput = {
	relationType?: NoteRelationTypeApiItem;
	status?: Exclude<NoteRelationStatusApiItem, "all">;
	source?: Exclude<NoteRelationSourceApiItem, "all">;
	score?: number;
	reason?: string;
	evidenceExcerpt?: string | null;
	provider?: string | null;
	model?: string | null;
};
type ListRssItemsOptions = {
	feedId?: string | null;
	statuses?: RssItemStatus[];
	limit?: number;
	offset?: number;
};
type ListIndexJobsOptions = {
	statuses?: IndexJobStatusApiItem[];
	limit?: number;
	offset?: number;
};

export async function listFolders(): Promise<FolderApiItem[]> {
	const data = await requestApiData<unknown>("/api/folders");
	if (!Array.isArray(data)) {
		throw new Error("Invalid folders response");
	}
	return data
		.map((item) => toFolderApiItem(item))
		.filter((item): item is FolderApiItem => item !== null)
		.sort((a, b) => {
			if (a.parentId === b.parentId) {
				return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-CN");
			}
			if (a.parentId === null) {
				return -1;
			}
			if (b.parentId === null) {
				return 1;
			}
			return a.parentId.localeCompare(b.parentId, "zh-CN");
		});
}

export async function listRootFolders(): Promise<FolderApiItem[]> {
	const folders = await listFolders();
	return folders
		.filter((item) => item.parentId === null)
		.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-CN"));
}

export async function createFolder(input: CreateFolderInput): Promise<FolderApiItem> {
	const data = await requestApiData<unknown>("/api/folders", {
		method: "POST",
		body: JSON.stringify({
			name: input.name,
			parentId: input.parentId,
			sortOrder: input.sortOrder,
			slug: input.slug,
		}),
	});
	const folder = toFolderApiItem(data);
	if (!folder) {
		throw new Error("Invalid create folder response");
	}
	return folder;
}

export async function updateFolder(folderId: string, input: UpdateFolderInput): Promise<FolderApiItem> {
	const data = await requestApiData<unknown>(`/api/folders/${encodeURIComponent(folderId)}`, {
		method: "PATCH",
		body: JSON.stringify(input),
	});
	const folder = toFolderApiItem(data);
	if (!folder) {
		throw new Error("Invalid update folder response");
	}
	return folder;
}

export async function listTags(options: ListTagsOptions = {}): Promise<TagApiItem[]> {
	const query = new URLSearchParams();
	if (options.status) {
		query.set("status", options.status);
	}
	const suffix = query.toString();
	const data = await requestApiData<unknown>(`/api/tags${suffix ? `?${suffix}` : ""}`);
	if (!Array.isArray(data)) {
		throw new Error("Invalid tags response");
	}
	return data
		.map((item) => toTagApiItem(item))
		.filter((item): item is TagApiItem => item !== null);
}

export async function mergeTags(sourceTagId: string, targetTagId: string): Promise<{
	sourceTagId: string;
	targetTagId: string;
	movedNoteCount: number;
}> {
	return requestApiData<{
		sourceTagId: string;
		targetTagId: string;
		movedNoteCount: number;
	}>("/api/tags/merge", {
		method: "POST",
		body: JSON.stringify({ sourceTagId, targetTagId }),
	});
}

export async function updateTag(tagId: string, input: UpdateTagInput): Promise<TagApiItem> {
	const data = await requestApiData<unknown>(`/api/tags/${encodeURIComponent(tagId)}`, {
		method: "PATCH",
		body: JSON.stringify(input),
	});
	const tag = toTagApiItem(data);
	if (!tag) {
		throw new Error("Invalid update tag response");
	}
	return tag;
}

export async function deleteTag(tagId: string, targetTagId?: string): Promise<void> {
	const suffix = targetTagId
		? `?targetTagId=${encodeURIComponent(targetTagId)}`
		: "";
	await requestApiData<unknown>(`/api/tags/${encodeURIComponent(tagId)}${suffix}`, {
		method: "DELETE",
	});
}

export async function cleanupTags(options: CleanupTagsOptions = {}): Promise<{
	dryRun: boolean;
	orphaned: number;
	deleted: number;
}> {
	const data = await requestApiData<{
		dryRun: boolean;
		orphaned: number;
		deleted: number;
	}>("/api/tags/cleanup", {
		method: "POST",
		body: JSON.stringify({
			dryRun: options.dryRun ?? true,
			limit: options.limit,
		}),
	});
	return data;
}

export async function listNotes(options: ListNotesOptions = {}): Promise<NoteApiItem[]> {
	const query = new URLSearchParams();
	query.set("limit", String(options.limit ?? 100));
	if (typeof options.offset === "number") {
		query.set("offset", String(options.offset));
	}
	if (options.folderId) {
		query.set("folderId", options.folderId);
	}
	if (options.tagIds && options.tagIds.length > 0) {
		query.set("tagIds", options.tagIds.join(","));
	}
	if (options.tagMode) {
		query.set("tagMode", options.tagMode);
	}
	if (options.keyword?.trim()) {
		query.set("q", options.keyword.trim());
	}
	if (options.status) {
		query.set("status", options.status);
	}

	const data = await requestApiData<unknown>(`/api/notes?${query.toString()}`);
	if (!isRecord(data) || !Array.isArray(data.items)) {
		throw new Error("Invalid notes response");
	}
	return data.items
		.map((item) => toNoteApiItem(item))
		.filter((item): item is NoteApiItem => item !== null);
}

export async function createNote(input: CreateNoteInput): Promise<NoteApiItem> {
	const data = await requestApiData<unknown>("/api/notes", {
		method: "POST",
		body: JSON.stringify({
			title: input.title,
			folderId: input.folderId,
			bodyText: input.bodyText,
			tagNames: input.tagNames ?? [],
			storageType: "d1",
		}),
	});
	const note = toNoteApiItem(data);
	if (!note) {
		throw new Error("Invalid create note response");
	}
	return note;
}

export async function updateNote(noteId: string, input: UpdateNoteInput): Promise<NoteApiItem> {
	const data = await requestApiData<unknown>(`/api/notes/${encodeURIComponent(noteId)}`, {
		method: "PUT",
		body: JSON.stringify(input),
	});
	const note = toNoteApiItem(data);
	if (!note) {
		throw new Error("Invalid update note response");
	}
	return note;
}

export async function deleteNote(noteId: string): Promise<void> {
	await requestApiData<unknown>(`/api/notes/${encodeURIComponent(noteId)}`, {
		method: "DELETE",
	});
}

export async function archiveNote(noteId: string, archived?: boolean): Promise<NoteApiItem> {
	const body = typeof archived === "boolean" ? { archived } : {};
	const data = await requestApiData<unknown>(`/api/notes/${encodeURIComponent(noteId)}/archive`, {
		method: "PATCH",
		body: JSON.stringify(body),
	});
	const note = toNoteApiItem(data);
	if (!note) {
		throw new Error("Invalid archive note response");
	}
	return note;
}

export async function restoreNote(noteId: string): Promise<NoteApiItem> {
	const data = await requestApiData<unknown>(`/api/notes/${encodeURIComponent(noteId)}/restore`, {
		method: "PATCH",
	});
	const note = toNoteApiItem(data);
	if (!note) {
		throw new Error("Invalid restore note response");
	}
	return note;
}

export async function hardDeleteNote(noteId: string): Promise<void> {
	await requestApiData<unknown>(`/api/notes/${encodeURIComponent(noteId)}/hard`, {
		method: "DELETE",
	});
}

export async function listNoteRelations(
	noteId: string,
	options: ListNoteRelationsOptions = {},
): Promise<NoteRelationListApiItem> {
	const query = new URLSearchParams();
	if (options.status) {
		query.set("status", options.status);
	}
	if (options.source) {
		query.set("source", options.source);
	}
	if (typeof options.limit === "number") {
		query.set("limit", String(options.limit));
	}
	if (typeof options.offset === "number") {
		query.set("offset", String(options.offset));
	}
	const suffix = query.toString();
	const data = await requestApiData<unknown>(
		`/api/notes/${encodeURIComponent(noteId)}/relations${suffix ? `?${suffix}` : ""}`,
	);
	const parsed = toNoteRelationListApiItem(data);
	if (!parsed) {
		throw new Error("Invalid note relations response");
	}
	return parsed;
}

export async function upsertNoteRelations(
	noteId: string,
	items: UpsertNoteRelationInput[],
): Promise<NoteRelationApiItem[]> {
	const data = await requestApiData<unknown>(`/api/notes/${encodeURIComponent(noteId)}/relations/bulk-upsert`, {
		method: "POST",
		body: JSON.stringify({ items }),
	});
	if (!isRecord(data) || !Array.isArray(data.items)) {
		throw new Error("Invalid upsert note relations response");
	}
	return data.items
		.map((item) => toNoteRelationApiItem(item))
		.filter((item): item is NoteRelationApiItem => item !== null);
}

export async function updateNoteRelation(
	noteId: string,
	relationId: string,
	input: UpdateNoteRelationInput,
): Promise<NoteRelationApiItem> {
	const data = await requestApiData<unknown>(
		`/api/notes/${encodeURIComponent(noteId)}/relations/${encodeURIComponent(relationId)}`,
		{
			method: "PATCH",
			body: JSON.stringify(input),
		},
	);
	const parsed = toNoteRelationApiItem(data);
	if (!parsed) {
		throw new Error("Invalid update note relation response");
	}
	return parsed;
}

export async function deleteNoteRelation(noteId: string, relationId: string): Promise<void> {
	await requestApiData<unknown>(
		`/api/notes/${encodeURIComponent(noteId)}/relations/${encodeURIComponent(relationId)}`,
		{
			method: "DELETE",
		},
	);
}

export async function enhanceNoteWithAi(noteId: string, input: AiEnhanceInput = {}): Promise<AiEnhanceResultApiItem> {
	const data = await requestApiData<unknown>(`/api/ai/notes/${encodeURIComponent(noteId)}/enhance`, {
		method: "POST",
		body: JSON.stringify({
			query: input.query,
			topK: input.topK,
		}),
	});
	const parsed = toAiEnhanceResultApiItem(data);
	if (!parsed) {
		throw new Error("Invalid ai enhance response");
	}
	return parsed;
}

export async function enhanceNoteWithAiTask(
	noteId: string,
	task: AiEnhanceTaskApiKey,
	input: AiEnhanceInput = {},
): Promise<AiEnhanceResultApiItem> {
	const data = await requestApiData<unknown>(`/api/ai/notes/${encodeURIComponent(noteId)}/enhance/${encodeURIComponent(task)}`, {
		method: "POST",
		body: JSON.stringify({
			query: input.query,
			topK: input.topK,
		}),
	});
	const parsed = toAiEnhanceResultApiItem(data);
	if (!parsed) {
		throw new Error("Invalid ai task response");
	}
	return parsed;
}

export async function enhanceNoteWithAiTaskStream(
	noteId: string,
	task: AiEnhanceTaskApiKey,
	input: AiEnhanceInput = {},
	handlers: {
		onStart?: (payload: { task: AiEnhanceTaskApiKey; noteId: string }) => void;
		onProgress?: (payload: AiEnhanceTaskStreamProgress) => void;
		onDone?: (result: AiEnhanceResultApiItem) => void;
	} = {},
): Promise<AiEnhanceResultApiItem> {
	const response = await fetch(`/api/ai/notes/${encodeURIComponent(noteId)}/enhance/${encodeURIComponent(task)}/stream`, {
		method: "POST",
		headers: {
			"Accept": "text/event-stream",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			query: input.query,
			topK: input.topK,
		}),
	});
	if (!response.ok) {
		const payload = await response.json().catch(() => null);
		throw new Error(readApiError(payload, response.status));
	}
	if (!response.body) {
		return enhanceNoteWithAiTask(noteId, task, input);
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let result: AiEnhanceResultApiItem | null = null;

	while (true) {
		const { done, value } = await reader.read();
		buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
		let splitIndex = buffer.indexOf("\n\n");
		while (splitIndex >= 0) {
			const block = buffer.slice(0, splitIndex);
			buffer = buffer.slice(splitIndex + 2);
			const parsed = parseSseBlock(block);
			if (!parsed) {
				splitIndex = buffer.indexOf("\n\n");
				continue;
			}
			if (parsed.event === "start") {
				const payload = parsed.data;
				if (isRecord(payload) && payload.task === task && typeof payload.noteId === "string") {
					handlers.onStart?.({ task, noteId: payload.noteId });
				}
			} else if (parsed.event === "progress") {
				const payload = parsed.data;
				if (
					isRecord(payload) &&
					payload.task === task &&
					(payload.stage === "prepare" || payload.stage === "generate" || payload.stage === "processing")
				) {
					handlers.onProgress?.({
						task,
						stage: payload.stage,
					});
				}
			} else if (parsed.event === "done") {
				const payload = parsed.data;
				if (isRecord(payload) && payload.ok === true && "data" in payload) {
					const parsedResult = toAiEnhanceResultApiItem(payload.data);
					if (parsedResult) {
						result = parsedResult;
						handlers.onDone?.(parsedResult);
					}
				}
			} else if (parsed.event === "error") {
				const payload = parsed.data;
				if (isRecord(payload) && typeof payload.error === "string") {
					throw new Error(payload.error);
				}
				throw new Error("AI stream failed");
			}
			splitIndex = buffer.indexOf("\n\n");
		}
		if (done) {
			break;
		}
	}

	if (!result) {
		throw new Error("AI stream closed without result");
	}
	return result;
}

export async function listNoteAssets(noteId: string): Promise<NoteAssetApiItem[]> {
	const data = await requestApiData<unknown>(`/api/notes/${encodeURIComponent(noteId)}/assets`);
	if (!Array.isArray(data)) {
		throw new Error("Invalid note assets response");
	}
	return data
		.map((item) => toNoteAssetApiItem(item))
		.filter((item): item is NoteAssetApiItem => item !== null);
}

export async function uploadNoteAsset(noteId: string, file: File): Promise<NoteAssetApiItem> {
	const form = new FormData();
	form.set("noteId", noteId);
	form.set("file", file);
	const response = await fetch("/api/assets/upload", {
		method: "POST",
		body: form,
	});
	const payload = await response.json().catch(() => null);
	if (!response.ok) {
		throw new Error(readApiError(payload, response.status));
	}
	if (!isRecord(payload) || payload.ok !== true || !("data" in payload)) {
		throw new Error("Invalid API envelope");
	}
	const parsed = toNoteAssetApiItem(payload.data);
	if (!parsed) {
		throw new Error("Invalid upload note asset response");
	}
	return parsed;
}

export async function deleteNoteAsset(assetId: string): Promise<void> {
	await requestApiData<unknown>(`/api/assets/${encodeURIComponent(assetId)}`, {
		method: "DELETE",
	});
}

export async function listRssFeeds(): Promise<RssFeedApiItem[]> {
	const data = await requestApiData<unknown>("/api/rss/feeds");
	if (!Array.isArray(data)) {
		throw new Error("Invalid rss feeds response");
	}
	return data
		.map((item) => toRssFeedApiItem(item))
		.filter((item): item is RssFeedApiItem => item !== null);
}

export async function createRssFeed(input: {
	url: string;
	title?: string;
	enabled?: boolean;
}): Promise<RssFeedApiItem> {
	const data = await requestApiData<unknown>("/api/rss/feeds", {
		method: "POST",
		body: JSON.stringify({
			url: input.url,
			title: input.title,
			enabled: input.enabled,
		}),
	});
	const parsed = toRssFeedApiItem(data);
	if (!parsed) {
		throw new Error("Invalid create rss feed response");
	}
	return parsed;
}

export async function updateRssFeed(feedId: string, input: {
	url?: string;
	title?: string | null;
	enabled?: boolean;
}): Promise<RssFeedApiItem> {
	const data = await requestApiData<unknown>(`/api/rss/feeds/${encodeURIComponent(feedId)}`, {
		method: "PATCH",
		body: JSON.stringify(input),
	});
	const parsed = toRssFeedApiItem(data);
	if (!parsed) {
		throw new Error("Invalid update rss feed response");
	}
	return parsed;
}

export async function deleteRssFeed(feedId: string): Promise<void> {
	await requestApiData<unknown>(`/api/rss/feeds/${encodeURIComponent(feedId)}`, {
		method: "DELETE",
	});
}

export async function listRssItems(options: ListRssItemsOptions = {}): Promise<RssItemApiItem[]> {
	const query = new URLSearchParams();
	if (options.feedId) {
		query.set("feedId", options.feedId);
	}
	if (options.statuses && options.statuses.length > 0) {
		query.set("status", options.statuses.join(","));
	}
	query.set("limit", String(options.limit ?? 50));
	query.set("offset", String(options.offset ?? 0));
	const data = await requestApiData<unknown>(`/api/rss/items?${query.toString()}`);
	if (!isRecord(data) || !Array.isArray(data.items)) {
		throw new Error("Invalid rss items response");
	}
	return data.items
		.map((item) => toRssItemApiItem(item))
		.filter((item): item is RssItemApiItem => item !== null);
}

export async function updateRssItemStatus(itemId: string, status: RssItemStatus): Promise<void> {
	await requestApiData<unknown>(`/api/rss/items/${encodeURIComponent(itemId)}`, {
		method: "PATCH",
		body: JSON.stringify({ status }),
	});
}

export async function syncRssFeeds(input: {
	feedId?: string;
	feedLimit?: number;
	itemLimit?: number;
	translate?: boolean;
	translateBudget?: number;
} = {}): Promise<RssSyncResultApiItem> {
	const data = await requestApiData<unknown>("/api/rss/sync", {
		method: "POST",
		body: JSON.stringify(input),
	});
	const parsed = toRssSyncResultApiItem(data);
	if (!parsed) {
		throw new Error("Invalid rss sync response");
	}
	return parsed;
}

export async function translateRssItems(input: { feedId?: string; limit?: number } = {}): Promise<RssTranslateResultApiItem> {
	const data = await requestApiData<unknown>("/api/rss/translate", {
		method: "POST",
		body: JSON.stringify(input),
	});
	const parsed = toRssTranslateResultApiItem(data);
	if (!parsed) {
		throw new Error("Invalid rss translate response");
	}
	return parsed;
}

export async function saveRssItemToReading(itemId: string): Promise<{
	noteId: string | null;
	created: boolean;
	queued: boolean;
	item: RssItemApiItem;
}> {
	const data = await requestApiData<unknown>(`/api/rss/items/${encodeURIComponent(itemId)}/save`, {
		method: "POST",
	});
	const item = toRssItemApiItem(isRecord(data) ? data.item : null);
	if (
		!isRecord(data) ||
		(typeof data.noteId !== "string" && data.noteId !== null) ||
		typeof data.created !== "boolean" ||
		typeof data.queued !== "boolean" ||
		!item
	) {
		throw new Error("Invalid rss save response");
	}
	return {
		noteId: data.noteId,
		created: data.created,
		queued: data.queued,
		item,
	};
}

export async function listIndexJobs(options: ListIndexJobsOptions = {}): Promise<{
	items: IndexJobApiItem[];
	paging: { limit: number; offset: number; count: number };
}> {
	const query = new URLSearchParams();
	if (options.statuses && options.statuses.length > 0) {
		query.set("status", options.statuses.join(","));
	}
	query.set("limit", String(options.limit ?? 50));
	query.set("offset", String(options.offset ?? 0));
	const data = await requestApiData<unknown>(`/api/index/jobs?${query.toString()}`);
	if (!isRecord(data) || !Array.isArray(data.items) || !isRecord(data.paging)) {
		throw new Error("Invalid index jobs response");
	}
	const items = data.items
		.map((item) => toIndexJobApiItem(item))
		.filter((item): item is IndexJobApiItem => item !== null);
	const paging = toPagingApiItem(data.paging);
	if (!paging) {
		throw new Error("Invalid index jobs paging");
	}
	return { items, paging };
}

export async function processIndexJobs(limit = 5): Promise<{
	limit: number;
	processed: number;
	results: IndexProcessResultApiItem[];
}> {
	const data = await requestApiData<unknown>("/api/index/process", {
		method: "POST",
		body: JSON.stringify({ limit }),
	});
	if (!isRecord(data) || typeof data.limit !== "number" || typeof data.processed !== "number" || !Array.isArray(data.results)) {
		throw new Error("Invalid index process response");
	}
	return {
		limit: data.limit,
		processed: data.processed,
		results: data.results
			.map((item) => toIndexProcessResultApiItem(item))
			.filter((item): item is IndexProcessResultApiItem => item !== null),
	};
}

export async function rebuildIndex(input: {
	dryRun?: boolean;
	includeDeleted?: boolean;
	includeArchived?: boolean;
	limit?: number;
	noteId?: string;
} = {}): Promise<{
	dryRun: boolean;
	limit: number;
	enqueued: number;
	items: Array<{ noteId: string; action: IndexJobActionApiItem }>;
}> {
	const data = await requestApiData<unknown>("/api/index/rebuild", {
		method: "POST",
		body: JSON.stringify(input),
	});
	if (
		!isRecord(data) ||
		typeof data.dryRun !== "boolean" ||
		typeof data.limit !== "number" ||
		typeof data.enqueued !== "number" ||
		!Array.isArray(data.items)
	) {
		throw new Error("Invalid index rebuild response");
	}
	const items = data.items
		.map((item) => toIndexRebuildItem(item))
		.filter((item): item is { noteId: string; action: IndexJobActionApiItem } => item !== null);
	return {
		dryRun: data.dryRun,
		limit: data.limit,
		enqueued: data.enqueued,
		items,
	};
}

export async function listOpsMetrics(windowMinutes = 60): Promise<OpsMetricsApiItem> {
	const data = await requestApiData<unknown>(`/api/ops/metrics?windowMinutes=${encodeURIComponent(String(windowMinutes))}`);
	const parsed = toOpsMetricsApiItem(data);
	if (!parsed) {
		throw new Error("Invalid ops metrics response");
	}
	return parsed;
}

export async function probeOpsAi(input: {
	count?: number;
	timeoutMs?: number;
	includeModels?: boolean;
	includeEmbedding?: boolean;
	includeChat?: boolean;
	chatModel?: string;
} = {}): Promise<OpsAiProbeApiItem> {
	const data = await requestApiData<unknown>("/api/ops/ai/probe", {
		method: "POST",
		body: JSON.stringify(input),
	});
	const parsed = toOpsAiProbeApiItem(data);
	if (!parsed) {
		throw new Error("Invalid ops ai probe response");
	}
	return parsed;
}

export async function migrateNoteStorage(input: {
	dryRun?: boolean;
	limit?: number;
	minBytes?: number;
} = {}): Promise<NoteStorageMigrateApiItem> {
	const data = await requestApiData<unknown>("/api/notes/storage/migrate", {
		method: "POST",
		body: JSON.stringify(input),
	});
	const parsed = toNoteStorageMigrateApiItem(data);
	if (!parsed) {
		throw new Error("Invalid note storage migrate response");
	}
	return parsed;
}

export async function processRssReadingQueue(input: {
	limit?: number;
	itemId?: string;
} = {}): Promise<RssReadingProcessApiItem> {
	const data = await requestApiData<unknown>("/api/rss/reading/process", {
		method: "POST",
		body: JSON.stringify(input),
	});
	const parsed = toRssReadingProcessApiItem(data);
	if (!parsed) {
		throw new Error("Invalid rss reading process response");
	}
	return parsed;
}

export async function listOpsRssReadingJobs(input: {
	limit?: number;
	offset?: number;
	states?: Array<"queued" | "processing" | "failed">;
} = {}): Promise<OpsRssReadingJobsApiItem> {
	const query = new URLSearchParams();
	query.set("limit", String(input.limit ?? 30));
	query.set("offset", String(input.offset ?? 0));
	if (input.states && input.states.length > 0) {
		query.set("state", input.states.join(","));
	}
	const data = await requestApiData<unknown>(`/api/ops/rss/reading-jobs?${query.toString()}`);
	const parsed = toOpsRssReadingJobsApiItem(data);
	if (!parsed) {
		throw new Error("Invalid ops rss reading jobs response");
	}
	return parsed;
}

async function requestApiData<T>(url: string, init?: RequestInit): Promise<T> {
	const headers = new Headers(init?.headers);
	headers.set("Accept", "application/json");
	if (init?.body && !headers.has("Content-Type")) {
		headers.set("Content-Type", "application/json");
	}

	const response = await fetch(url, { ...init, headers });
	const payload = await response.json().catch(() => null);
	if (!response.ok) {
		throw new Error(readApiError(payload, response.status));
	}
	if (!isRecord(payload) || payload.ok !== true || !("data" in payload)) {
		throw new Error("Invalid API envelope");
	}
	return payload.data as T;
}

function readApiError(payload: unknown, status: number): string {
	if (isRecord(payload) && typeof payload.error === "string") {
		return payload.error;
	}
	return `Request failed: ${status}`;
}

function parseSseBlock(block: string): { event: string; data: unknown } | null {
	const lines = block
		.split(/\r?\n/u)
		.map((line) => line.trimEnd())
		.filter((line) => line.length > 0);
	if (lines.length === 0) {
		return null;
	}
	let event = "";
	const dataLines: string[] = [];
	for (const line of lines) {
		if (line.startsWith("event:")) {
			event = line.slice("event:".length).trim();
			continue;
		}
		if (line.startsWith("data:")) {
			dataLines.push(line.slice("data:".length).trim());
		}
	}
	if (!event) {
		return null;
	}
	const rawData = dataLines.join("\n");
	if (!rawData) {
		return { event, data: null };
	}
	try {
		return {
			event,
			data: JSON.parse(rawData),
		};
	} catch {
		return {
			event,
			data: rawData,
		};
	}
}

function toFolderApiItem(value: unknown): FolderApiItem | null {
	if (!isRecord(value)) {
		return null;
	}
	if (
		typeof value.id !== "string" ||
		typeof value.name !== "string" ||
		(typeof value.parentId !== "string" && value.parentId !== null) ||
		typeof value.sortOrder !== "number"
	) {
		return null;
	}
	return {
		id: value.id,
		parentId: value.parentId,
		name: value.name,
		sortOrder: value.sortOrder,
	};
}

function toTagApiItem(value: unknown): TagApiItem | null {
	if (!isRecord(value)) {
		return null;
	}
	if (
		typeof value.id !== "string" ||
		typeof value.name !== "string" ||
		typeof value.color !== "string" ||
		typeof value.createdAt !== "string"
	) {
		return null;
	}
	return {
		id: value.id,
		name: value.name,
		color: value.color,
		createdAt: value.createdAt,
	};
}

function toNoteApiItem(value: unknown): NoteApiItem | null {
	if (!isRecord(value)) {
		return null;
	}
	if (
		typeof value.id !== "string" ||
		typeof value.slug !== "string" ||
		typeof value.title !== "string" ||
		typeof value.folderId !== "string" ||
		(value.storageType !== "d1" && value.storageType !== "r2") ||
		(typeof value.bodyText !== "string" && value.bodyText !== null) ||
		typeof value.excerpt !== "string" ||
		(typeof value.searchScore !== "number" && value.searchScore !== null) ||
		(typeof value.deletedAt !== "string" && value.deletedAt !== null) ||
		typeof value.updatedAt !== "string"
	) {
		return null;
	}
	const isArchived = toBooleanLike(value.isArchived);
	if (isArchived === null) {
		return null;
	}

	const tags = Array.isArray(value.tags)
		? value.tags
				.map((item) => toTagApiItem(item))
				.filter((item): item is TagApiItem => item !== null)
		: [];

	return {
		id: value.id,
		slug: value.slug,
		title: value.title,
		folderId: value.folderId,
		storageType: value.storageType,
		bodyText: value.bodyText,
		excerpt: value.excerpt,
		searchScore: value.searchScore,
		isArchived,
		deletedAt: value.deletedAt,
		updatedAt: value.updatedAt,
		tags,
	};
}

function toNoteRelationListApiItem(value: unknown): NoteRelationListApiItem | null {
	if (!isRecord(value) || typeof value.noteId !== "string" || !Array.isArray(value.items)) {
		return null;
	}
	if (
		!isRecord(value.paging) ||
		typeof value.paging.limit !== "number" ||
		typeof value.paging.offset !== "number" ||
		typeof value.paging.count !== "number" ||
		!isRecord(value.filters) ||
		!isNoteRelationStatusApiItem(value.filters.status) ||
		!isNoteRelationSourceApiItem(value.filters.source)
	) {
		return null;
	}
	return {
		noteId: value.noteId,
		items: value.items
			.map((item) => toNoteRelationApiItem(item))
			.filter((item): item is NoteRelationApiItem => item !== null),
		paging: {
			limit: value.paging.limit,
			offset: value.paging.offset,
			count: value.paging.count,
		},
		filters: {
			status: value.filters.status,
			source: value.filters.source,
		},
	};
}

function toNoteRelationApiItem(value: unknown): NoteRelationApiItem | null {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		!isNoteRelationTypeApiItem(value.relationType) ||
		!isConcreteNoteRelationStatusApiItem(value.status) ||
		!isConcreteNoteRelationSourceApiItem(value.source) ||
		typeof value.score !== "number" ||
		typeof value.reason !== "string" ||
		(typeof value.evidenceExcerpt !== "string" && value.evidenceExcerpt !== null) ||
		(typeof value.provider !== "string" && value.provider !== null) ||
		(typeof value.model !== "string" && value.model !== null) ||
		typeof value.createdAt !== "string" ||
		typeof value.updatedAt !== "string" ||
		!isRecord(value.otherNote) ||
		typeof value.otherNote.id !== "string" ||
		typeof value.otherNote.slug !== "string" ||
		typeof value.otherNote.title !== "string" ||
		typeof value.otherNote.excerpt !== "string" ||
		typeof value.otherNote.updatedAt !== "string"
	) {
		return null;
	}
	return {
		id: value.id,
		relationType: value.relationType,
		status: value.status,
		source: value.source,
		score: value.score,
		reason: value.reason,
		evidenceExcerpt: value.evidenceExcerpt,
		provider: value.provider,
		model: value.model,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
		otherNote: {
			id: value.otherNote.id,
			slug: value.otherNote.slug,
			title: value.otherNote.title,
			excerpt: value.otherNote.excerpt,
			updatedAt: value.otherNote.updatedAt,
		},
	};
}

function toAiEnhanceResultApiItem(value: unknown): AiEnhanceResultApiItem | null {
	if (
		!isRecord(value) ||
		typeof value.noteId !== "string" ||
		typeof value.query !== "string" ||
		typeof value.generatedAt !== "string" ||
		(value.provider !== "siliconflow" && value.provider !== "local-fallback") ||
		(typeof value.model !== "string" && value.model !== null) ||
		typeof value.summary !== "string"
	) {
		return null;
	}

	const warnings = Array.isArray(value.warnings)
		? value.warnings.filter((item): item is string => typeof item === "string")
		: [];
	const outline = Array.isArray(value.outline)
		? value.outline.filter((item): item is string => typeof item === "string")
		: [];
	const summaryMeta = toAiEnhanceSummaryMetaApiItem(value.summaryMeta) ?? {
		mode: "full",
		skipped: false,
		reason: null,
	};
	const titleCandidates = Array.isArray(value.titleCandidates)
		? value.titleCandidates
				.map((item) => toAiEnhanceTitleCandidateApiItem(item))
				.filter((item): item is AiEnhanceTitleCandidateApiItem => item !== null)
		: [];
	const tagSuggestions = Array.isArray(value.tagSuggestions)
		? value.tagSuggestions
				.map((item) => toAiEnhanceTagSuggestionApiItem(item))
				.filter((item): item is AiEnhanceTagSuggestionApiItem => item !== null)
		: [];
	const semanticSearch = Array.isArray(value.semanticSearch)
		? value.semanticSearch
				.map((item) => toAiEnhanceRelatedNoteApiItem(item))
				.filter((item): item is AiEnhanceRelatedNoteApiItem => item !== null)
		: [];
	const similarNotes = Array.isArray(value.similarNotes)
		? value.similarNotes
				.map((item) => toAiEnhanceRelatedNoteApiItem(item))
				.filter((item): item is AiEnhanceRelatedNoteApiItem => item !== null)
		: [];
	const relationSuggestions = Array.isArray(value.relationSuggestions)
		? value.relationSuggestions
				.map((item) => toAiEnhanceRelationSuggestionApiItem(item))
				.filter((item): item is AiEnhanceRelationSuggestionApiItem => item !== null)
		: [];

	return {
		noteId: value.noteId,
		query: value.query,
		generatedAt: value.generatedAt,
		provider: value.provider,
		model: value.model,
		warnings,
		titleCandidates,
		tagSuggestions,
		semanticSearch,
		relationSuggestions,
		summary: value.summary,
		outline,
		summaryMeta,
		similarNotes,
	};
}

function toAiEnhanceSummaryMetaApiItem(value: unknown): AiEnhanceSummaryMetaApiItem | null {
	if (!isRecord(value)) {
		return null;
	}
	if ((value.mode !== "skip" && value.mode !== "mini" && value.mode !== "full") || typeof value.skipped !== "boolean") {
		return null;
	}
	if (typeof value.reason !== "string" && value.reason !== null) {
		return null;
	}
	return {
		mode: value.mode,
		skipped: value.skipped,
		reason: value.reason,
	};
}

function toAiEnhanceTitleCandidateApiItem(value: unknown): AiEnhanceTitleCandidateApiItem | null {
	if (
		!isRecord(value) ||
		typeof value.title !== "string" ||
		typeof value.confidence !== "number" ||
		typeof value.reason !== "string"
	) {
		return null;
	}
	return {
		title: value.title,
		confidence: value.confidence,
		reason: value.reason,
	};
}

function toAiEnhanceTagSuggestionApiItem(value: unknown): AiEnhanceTagSuggestionApiItem | null {
	if (
		!isRecord(value) ||
		typeof value.name !== "string" ||
		typeof value.confidence !== "number" ||
		typeof value.reason !== "string"
	) {
		return null;
	}
	return {
		name: value.name,
		confidence: value.confidence,
		reason: value.reason,
	};
}

function toAiEnhanceRelatedNoteApiItem(value: unknown): AiEnhanceRelatedNoteApiItem | null {
	if (
		!isRecord(value) ||
		typeof value.noteId !== "string" ||
		typeof value.slug !== "string" ||
		typeof value.title !== "string" ||
		typeof value.snippet !== "string" ||
		typeof value.score !== "number" ||
		typeof value.reason !== "string"
	) {
		return null;
	}
	return {
		noteId: value.noteId,
		slug: value.slug,
		title: value.title,
		snippet: value.snippet,
		score: value.score,
		reason: value.reason,
	};
}

function toAiEnhanceRelationSuggestionApiItem(value: unknown): AiEnhanceRelationSuggestionApiItem | null {
	if (
		!isRecord(value) ||
		typeof value.noteId !== "string" ||
		typeof value.slug !== "string" ||
		typeof value.title !== "string" ||
		typeof value.snippet !== "string" ||
		!isNoteRelationTypeApiItem(value.relationType) ||
		typeof value.score !== "number" ||
		typeof value.reason !== "string" ||
		(typeof value.evidenceExcerpt !== "string" && value.evidenceExcerpt !== null)
	) {
		return null;
	}
	return {
		noteId: value.noteId,
		slug: value.slug,
		title: value.title,
		snippet: value.snippet,
		relationType: value.relationType,
		score: value.score,
		reason: value.reason,
		evidenceExcerpt: value.evidenceExcerpt,
	};
}

function toNoteAssetApiItem(value: unknown): NoteAssetApiItem | null {
	if (!isRecord(value)) {
		return null;
	}
	if (
		typeof value.id !== "string" ||
		typeof value.noteId !== "string" ||
		(typeof value.fileName !== "string" && value.fileName !== null) ||
		typeof value.mimeType !== "string" ||
		typeof value.sizeBytes !== "number" ||
		(typeof value.sha256 !== "string" && value.sha256 !== null) ||
		typeof value.createdAt !== "string" ||
		typeof value.downloadUrl !== "string"
	) {
		return null;
	}
	return {
		id: value.id,
		noteId: value.noteId,
		fileName: value.fileName,
		mimeType: value.mimeType,
		sizeBytes: value.sizeBytes,
		sha256: value.sha256,
		createdAt: value.createdAt,
		downloadUrl: value.downloadUrl,
	};
}

function toRssFeedApiItem(value: unknown): RssFeedApiItem | null {
	if (!isRecord(value)) {
		return null;
	}
	if (
		typeof value.id !== "string" ||
		typeof value.url !== "string" ||
		(typeof value.title !== "string" && value.title !== null) ||
		typeof value.createdAt !== "string" ||
		typeof value.updatedAt !== "string"
	) {
		return null;
	}
	const enabled = toBooleanLike(value.enabled);
	if (enabled === null) {
		return null;
	}
	if ((typeof value.lastFetchedAt !== "string" && value.lastFetchedAt !== null) ||
		(typeof value.lastError !== "string" && value.lastError !== null)) {
		return null;
	}
	return {
		id: value.id,
		url: value.url,
		title: value.title,
		enabled,
		lastFetchedAt: value.lastFetchedAt,
		lastError: value.lastError,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

function toRssItemApiItem(value: unknown): RssItemApiItem | null {
	if (!isRecord(value)) {
		return null;
	}
	const status = value.status;
	if (
		typeof value.id !== "string" ||
		typeof value.feedId !== "string" ||
		(typeof value.feedTitle !== "string" && value.feedTitle !== null) ||
		(typeof value.sourceId !== "string" && value.sourceId !== null) ||
		typeof value.dedupeKey !== "string" ||
		(typeof value.link !== "string" && value.link !== null) ||
		(typeof value.title !== "string" && value.title !== null) ||
		(typeof value.author !== "string" && value.author !== null) ||
		(typeof value.publishedAt !== "string" && value.publishedAt !== null) ||
		typeof value.summaryRaw !== "string" ||
			(typeof value.summaryZh !== "string" && value.summaryZh !== null) ||
			(status !== "new" && status !== "saved" && status !== "ignored") ||
			(typeof value.noteId !== "string" && value.noteId !== null) ||
			(value.readingState !== "idle" &&
				value.readingState !== "queued" &&
				value.readingState !== "processing" &&
				value.readingState !== "ready" &&
				value.readingState !== "failed") ||
			(typeof value.readingError !== "string" && value.readingError !== null) ||
			typeof value.readingAttemptCount !== "number" ||
			(typeof value.readingRequestedAt !== "string" && value.readingRequestedAt !== null) ||
			(typeof value.readingStartedAt !== "string" && value.readingStartedAt !== null) ||
			(typeof value.readingCompletedAt !== "string" && value.readingCompletedAt !== null) ||
			typeof value.fetchedAt !== "string" ||
			typeof value.createdAt !== "string" ||
			typeof value.updatedAt !== "string"
	) {
		return null;
	}
	return {
		id: value.id,
		feedId: value.feedId,
		feedTitle: value.feedTitle,
		sourceId: value.sourceId,
		dedupeKey: value.dedupeKey,
		link: value.link,
		title: value.title,
		author: value.author,
		publishedAt: value.publishedAt,
		summaryRaw: value.summaryRaw,
			summaryZh: value.summaryZh,
			status,
			noteId: value.noteId,
			readingState: value.readingState,
			readingError: value.readingError,
			readingAttemptCount: value.readingAttemptCount,
			readingRequestedAt: value.readingRequestedAt,
			readingStartedAt: value.readingStartedAt,
			readingCompletedAt: value.readingCompletedAt,
			fetchedAt: value.fetchedAt,
			createdAt: value.createdAt,
			updatedAt: value.updatedAt,
	};
}

function toRssSyncResultApiItem(value: unknown): RssSyncResultApiItem | null {
	if (
		!isRecord(value) ||
		typeof value.processedFeeds !== "number" ||
		typeof value.totalFetchedItems !== "number" ||
		typeof value.totalCreated !== "number" ||
		typeof value.totalUpdated !== "number" ||
		typeof value.totalSkipped !== "number" ||
		!Array.isArray(value.results)
	) {
		return null;
	}
	const results = value.results
		.filter((item): item is Record<string, unknown> => isRecord(item))
		.map((item) => {
			if (
				typeof item.feedId !== "string" ||
				typeof item.url !== "string" ||
				(typeof item.feedTitle !== "string" && item.feedTitle !== null) ||
				typeof item.fetched !== "number" ||
				typeof item.created !== "number" ||
				typeof item.updated !== "number" ||
				typeof item.skipped !== "number"
			) {
				return null;
			}
			const errors = Array.isArray(item.errors)
				? item.errors.filter((error): error is string => typeof error === "string")
				: [];
			return {
				feedId: item.feedId,
				url: item.url,
				feedTitle: item.feedTitle,
				fetched: item.fetched,
				created: item.created,
				updated: item.updated,
				skipped: item.skipped,
				errors,
			};
		})
		.filter((item): item is RssSyncResultApiItem["results"][number] => item !== null);

	return {
		processedFeeds: value.processedFeeds,
		totalFetchedItems: value.totalFetchedItems,
		totalCreated: value.totalCreated,
		totalUpdated: value.totalUpdated,
		totalSkipped: value.totalSkipped,
		results,
	};
}

function toRssTranslateResultApiItem(value: unknown): RssTranslateResultApiItem | null {
	if (
		!isRecord(value) ||
		typeof value.requested !== "number" ||
		typeof value.translated !== "number" ||
		typeof value.failed !== "number"
	) {
		return null;
	}
	const processedItemIds = Array.isArray(value.processedItemIds)
		? value.processedItemIds.filter((item): item is string => typeof item === "string")
		: [];
	return {
		requested: value.requested,
		translated: value.translated,
		failed: value.failed,
		processedItemIds,
	};
}

function toIndexJobApiItem(value: unknown): IndexJobApiItem | null {
	if (!isRecord(value)) {
		return null;
	}
	if (
		typeof value.noteId !== "string" ||
		(value.action !== "upsert" && value.action !== "delete") ||
		(value.status !== "pending" && value.status !== "processing" && value.status !== "success" && value.status !== "failed") ||
		typeof value.attemptCount !== "number" ||
		typeof value.chunkCount !== "number" ||
		(typeof value.lastError !== "string" && value.lastError !== null) ||
		(typeof value.nextRetryAt !== "string" && value.nextRetryAt !== null) ||
		(typeof value.lastIndexedAt !== "string" && value.lastIndexedAt !== null) ||
		typeof value.createdAt !== "string" ||
		typeof value.updatedAt !== "string" ||
		(typeof value.noteTitle !== "string" && value.noteTitle !== null)
	) {
		return null;
	}
	return {
		noteId: value.noteId,
		action: value.action,
		status: value.status,
		attemptCount: value.attemptCount,
		chunkCount: value.chunkCount,
		lastError: value.lastError,
		nextRetryAt: value.nextRetryAt,
		lastIndexedAt: value.lastIndexedAt,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
		noteTitle: value.noteTitle,
	};
}

function toIndexProcessResultApiItem(value: unknown): IndexProcessResultApiItem | null {
	if (!isRecord(value)) {
		return null;
	}
	if (
		typeof value.noteId !== "string" ||
		(value.action !== "upsert" && value.action !== "delete") ||
		(value.status !== "success" && value.status !== "failed") ||
		typeof value.chunkCount !== "number" ||
		(typeof value.error !== "string" && value.error !== null) ||
		typeof value.attemptCount !== "number"
	) {
		return null;
	}
	return {
		noteId: value.noteId,
		action: value.action,
		status: value.status,
		chunkCount: value.chunkCount,
		error: value.error,
		attemptCount: value.attemptCount,
	};
}

function toIndexRebuildItem(value: unknown): { noteId: string; action: IndexJobActionApiItem } | null {
	if (!isRecord(value) || typeof value.noteId !== "string" || (value.action !== "upsert" && value.action !== "delete")) {
		return null;
	}
	return {
		noteId: value.noteId,
		action: value.action,
	};
}

function toPagingApiItem(value: unknown): { limit: number; offset: number; count: number } | null {
	if (!isRecord(value) || typeof value.limit !== "number" || typeof value.offset !== "number" || typeof value.count !== "number") {
		return null;
	}
	return {
		limit: value.limit,
		offset: value.offset,
		count: value.count,
	};
}

function toOpsMetricsAlertApiItem(value: unknown): OpsMetricsAlertApiItem | null {
	if (!isRecord(value)) {
		return null;
	}
	if (
		typeof value.key !== "string" ||
		typeof value.label !== "string" ||
		(value.status !== "ok" && value.status !== "warn" && value.status !== "no_data") ||
		typeof value.threshold !== "number" ||
		(typeof value.value !== "number" && value.value !== null) ||
		typeof value.message !== "string"
	) {
		return null;
	}
	return {
		key: value.key,
		label: value.label,
		status: value.status,
		threshold: value.threshold,
		value: value.value,
		message: value.message,
	};
}

function toOpsMetricsApiItem(value: unknown): OpsMetricsApiItem | null {
	if (!isRecord(value) || typeof value.windowMinutes !== "number" || typeof value.generatedAt !== "string") {
		return null;
	}
	if (!isRecord(value.api) || !isRecord(value.search) || !isRecord(value.index)) {
		return null;
	}
	if (
		typeof value.api.totalRequests !== "number" ||
		typeof value.api.errorRequests !== "number" ||
		(typeof value.api.errorRate !== "number" && value.api.errorRate !== null)
	) {
		return null;
	}
	if (
		typeof value.search.requestCount !== "number" ||
		(typeof value.search.p50Ms !== "number" && value.search.p50Ms !== null) ||
		(typeof value.search.p95Ms !== "number" && value.search.p95Ms !== null) ||
		(typeof value.search.avgMs !== "number" && value.search.avgMs !== null)
	) {
		return null;
	}
	if (
		typeof value.index.pending !== "number" ||
		typeof value.index.processing !== "number" ||
		typeof value.index.failed !== "number" ||
		typeof value.index.backlog !== "number" ||
		typeof value.index.recentSuccess !== "number" ||
		typeof value.index.recentFailed !== "number" ||
		(typeof value.index.successRate !== "number" && value.index.successRate !== null)
	) {
		return null;
	}
	const alerts = Array.isArray(value.alerts)
		? value.alerts
				.map((item) => toOpsMetricsAlertApiItem(item))
				.filter((item): item is OpsMetricsAlertApiItem => item !== null)
		: [];
	return {
		windowMinutes: value.windowMinutes,
		generatedAt: value.generatedAt,
		api: {
			totalRequests: value.api.totalRequests,
			errorRequests: value.api.errorRequests,
			errorRate: value.api.errorRate,
		},
		search: {
			requestCount: value.search.requestCount,
			p50Ms: value.search.p50Ms,
			p95Ms: value.search.p95Ms,
			avgMs: value.search.avgMs,
		},
		index: {
			pending: value.index.pending,
			processing: value.index.processing,
			failed: value.index.failed,
			backlog: value.index.backlog,
			recentSuccess: value.index.recentSuccess,
			recentFailed: value.index.recentFailed,
			successRate: value.index.successRate,
		},
		alerts,
	};
}

function toOpsProbeLatencyApiItem(value: unknown): {
	p50: number | null;
	p95: number | null;
	avg: number | null;
	min: number | null;
	max: number | null;
} | null {
	if (
		!isRecord(value) ||
		(typeof value.p50 !== "number" && value.p50 !== null) ||
		(typeof value.p95 !== "number" && value.p95 !== null) ||
		(typeof value.avg !== "number" && value.avg !== null) ||
		(typeof value.min !== "number" && value.min !== null) ||
		(typeof value.max !== "number" && value.max !== null)
	) {
		return null;
	}
	return {
		p50: value.p50,
		p95: value.p95,
		avg: value.avg,
		min: value.min,
		max: value.max,
	};
}

function toOpsAiProbeSummaryApiItem(value: unknown): OpsAiProbeSummaryApiItem | null {
	if (
		!isRecord(value) ||
		typeof value.sampleCount !== "number" ||
		typeof value.successCount !== "number" ||
		typeof value.failureCount !== "number" ||
		!Array.isArray(value.recentErrors)
	) {
		return null;
	}
	const ttfbMs = toOpsProbeLatencyApiItem(value.ttfbMs);
	const totalMs = toOpsProbeLatencyApiItem(value.totalMs);
	if (!ttfbMs || !totalMs) {
		return null;
	}
	return {
		sampleCount: value.sampleCount,
		successCount: value.successCount,
		failureCount: value.failureCount,
		ttfbMs,
		totalMs,
		recentErrors: value.recentErrors.filter((item): item is string => typeof item === "string"),
	};
}

function toOpsAiProbeApiItem(value: unknown): OpsAiProbeApiItem | null {
	if (
		!isRecord(value) ||
		typeof value.sampledAt !== "string" ||
		(typeof value.colo !== "string" && value.colo !== null) ||
		typeof value.baseUrl !== "string" ||
		typeof value.count !== "number" ||
		typeof value.timeoutMs !== "number" ||
		!isRecord(value.probes)
	) {
		return null;
	}
	const probes: Record<string, OpsAiProbeSummaryApiItem & { model?: string }> = {};
	for (const [key, rawProbe] of Object.entries(value.probes)) {
		if (!isRecord(rawProbe)) {
			continue;
		}
		const summary = toOpsAiProbeSummaryApiItem(rawProbe);
		if (!summary) {
			continue;
		}
		probes[key] = {
			...summary,
			...(typeof rawProbe.model === "string" ? { model: rawProbe.model } : {}),
		};
	}
	return {
		sampledAt: value.sampledAt,
		colo: value.colo,
		baseUrl: value.baseUrl,
		count: value.count,
		timeoutMs: value.timeoutMs,
		probes,
	};
}

function toNoteStorageMigrateApiItem(value: unknown): NoteStorageMigrateApiItem | null {
	if (
		!isRecord(value) ||
		typeof value.dryRun !== "boolean" ||
		typeof value.limit !== "number" ||
		typeof value.minBytes !== "number" ||
		typeof value.scanned !== "number" ||
		typeof value.migrated !== "number" ||
		!Array.isArray(value.noteIds)
	) {
		return null;
	}
	return {
		dryRun: value.dryRun,
		limit: value.limit,
		minBytes: value.minBytes,
		scanned: value.scanned,
		migrated: value.migrated,
		noteIds: value.noteIds.filter((item): item is string => typeof item === "string"),
	};
}

function toRssReadingProcessApiItem(value: unknown): RssReadingProcessApiItem | null {
	if (
		!isRecord(value) ||
		typeof value.processed !== "number" ||
		typeof value.created !== "number" ||
		typeof value.failed !== "number" ||
		typeof value.skipped !== "number" ||
		!Array.isArray(value.itemIds)
	) {
		return null;
	}
	return {
		processed: value.processed,
		created: value.created,
		failed: value.failed,
		skipped: value.skipped,
		itemIds: value.itemIds.filter((item): item is string => typeof item === "string"),
	};
}

function toOpsRssReadingJobsApiItem(value: unknown): OpsRssReadingJobsApiItem | null {
	if (!isRecord(value) || !Array.isArray(value.items) || !isRecord(value.paging) || !isRecord(value.summary)) {
		return null;
	}
	const paging = toPagingApiItem(value.paging);
	if (!paging) {
		return null;
	}
	if (
		typeof value.summary.queued !== "number" ||
		typeof value.summary.processing !== "number" ||
		typeof value.summary.failed !== "number"
	) {
		return null;
	}
	return {
		items: value.items
			.map((item) => toRssItemApiItem(item))
			.filter((item): item is RssItemApiItem => item !== null),
		paging,
		summary: {
			queued: value.summary.queued,
			processing: value.summary.processing,
			failed: value.summary.failed,
		},
	};
}

function isNoteRelationTypeApiItem(value: unknown): value is NoteRelationTypeApiItem {
	return (
		value === "similar" ||
		value === "complements" ||
		value === "contrasts" ||
		value === "same_project" ||
		value === "same_area" ||
		value === "related"
	);
}

function isNoteRelationStatusApiItem(value: unknown): value is NoteRelationStatusApiItem {
	return value === "suggested" || value === "accepted" || value === "rejected" || value === "all";
}

function isConcreteNoteRelationStatusApiItem(value: unknown): value is Exclude<NoteRelationStatusApiItem, "all"> {
	return value === "suggested" || value === "accepted" || value === "rejected";
}

function isNoteRelationSourceApiItem(value: unknown): value is NoteRelationSourceApiItem {
	return value === "ai" || value === "manual" || value === "all";
}

function isConcreteNoteRelationSourceApiItem(value: unknown): value is Exclude<NoteRelationSourceApiItem, "all"> {
	return value === "ai" || value === "manual";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toBooleanLike(value: unknown): boolean | null {
	if (typeof value === "boolean") {
		return value;
	}
	if (typeof value === "number") {
		return value === 1;
	}
	if (typeof value === "string") {
		if (value === "1" || value.toLowerCase() === "true") {
			return true;
		}
		if (value === "0" || value.toLowerCase() === "false") {
			return false;
		}
	}
	return null;
}
