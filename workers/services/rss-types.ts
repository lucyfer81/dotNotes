export type RssItemStatus = "new" | "saved" | "ignored";

export type RssFeedRow = {
	id: string;
	url: string;
	title: string | null;
	enabled: number;
	lastFetchedAt: string | null;
	lastError: string | null;
	createdAt: string;
	updatedAt: string;
};

export type RssItemRow = {
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
	fetchedAt: string;
	createdAt: string;
	updatedAt: string;
};

export type ParsedRssItem = {
	sourceId: string | null;
	link: string | null;
	title: string | null;
	author: string | null;
	publishedAt: string | null;
	summary: string;
};

export type ParsedRssFeed = {
	title: string | null;
	items: ParsedRssItem[];
};

export type RssSyncFeedResult = {
	feedId: string;
	url: string;
	feedTitle: string | null;
	fetched: number;
	created: number;
	updated: number;
	skipped: number;
	errors: string[];
};

export type RssSyncResult = {
	processedFeeds: number;
	totalFetchedItems: number;
	totalCreated: number;
	totalUpdated: number;
	totalSkipped: number;
	results: RssSyncFeedResult[];
};

export type RssTranslateResult = {
	requested: number;
	translated: number;
	failed: number;
	processedItemIds: string[];
};
