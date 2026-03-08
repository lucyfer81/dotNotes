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

export type NoteLinkApiItem = {
	noteId: string;
	slug: string;
	title: string;
	updatedAt: string;
	anchorText: string | null;
};

export type NoteLinksApiItem = {
	noteId: string;
	outbound: NoteLinkApiItem[];
	inbound: NoteLinkApiItem[];
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
export type AiEnhanceLinkSuggestionApiItem = {
	targetNoteId: string;
	slug: string;
	title: string;
	anchorText: string;
	score: number;
	reason: string;
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
	linkSuggestions: AiEnhanceLinkSuggestionApiItem[];
	summary: string;
	outline: string[];
	summaryMeta: AiEnhanceSummaryMetaApiItem;
	similarNotes: AiEnhanceRelatedNoteApiItem[];
};
export type AiEnhanceTaskApiKey = "title" | "tags" | "semantic" | "links" | "summary" | "similar";
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
	linkSlugs?: string[];
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
type ListRssItemsOptions = {
	feedId?: string | null;
	statuses?: RssItemStatus[];
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

export async function getNoteLinks(noteId: string, status?: NoteStatus): Promise<NoteLinksApiItem> {
	const query = new URLSearchParams();
	if (status) {
		query.set("status", status);
	}
	const suffix = query.toString();
	const data = await requestApiData<unknown>(
		`/api/notes/${encodeURIComponent(noteId)}/links${suffix ? `?${suffix}` : ""}`,
	);
	const parsed = toNoteLinksApiItem(data);
	if (!parsed) {
		throw new Error("Invalid note links response");
	}
	return parsed;
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

function toNoteLinksApiItem(value: unknown): NoteLinksApiItem | null {
	if (!isRecord(value) || typeof value.noteId !== "string") {
		return null;
	}
	const outbound = Array.isArray(value.outbound)
		? value.outbound
				.map((item) => toNoteLinkApiItem(item))
				.filter((item): item is NoteLinkApiItem => item !== null)
		: [];
	const inbound = Array.isArray(value.inbound)
		? value.inbound
				.map((item) => toNoteLinkApiItem(item))
				.filter((item): item is NoteLinkApiItem => item !== null)
		: [];
	return {
		noteId: value.noteId,
		outbound,
		inbound,
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
	const linkSuggestions = Array.isArray(value.linkSuggestions)
		? value.linkSuggestions
				.map((item) => toAiEnhanceLinkSuggestionApiItem(item))
				.filter((item): item is AiEnhanceLinkSuggestionApiItem => item !== null)
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
		linkSuggestions,
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

function toAiEnhanceLinkSuggestionApiItem(value: unknown): AiEnhanceLinkSuggestionApiItem | null {
	if (
		!isRecord(value) ||
		typeof value.targetNoteId !== "string" ||
		typeof value.slug !== "string" ||
		typeof value.title !== "string" ||
		typeof value.anchorText !== "string" ||
		typeof value.score !== "number" ||
		typeof value.reason !== "string"
	) {
		return null;
	}
	return {
		targetNoteId: value.targetNoteId,
		slug: value.slug,
		title: value.title,
		anchorText: value.anchorText,
		score: value.score,
		reason: value.reason,
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

function toNoteLinkApiItem(value: unknown): NoteLinkApiItem | null {
	if (!isRecord(value)) {
		return null;
	}
	if (
		typeof value.noteId !== "string" ||
		typeof value.slug !== "string" ||
		typeof value.title !== "string" ||
		typeof value.updatedAt !== "string"
	) {
		return null;
	}
	if (typeof value.anchorText !== "string" && value.anchorText !== null && value.anchorText !== undefined) {
		return null;
	}
	return {
		noteId: value.noteId,
		slug: value.slug,
		title: value.title,
		updatedAt: value.updatedAt,
		anchorText: typeof value.anchorText === "string" ? value.anchorText : null,
	};
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
