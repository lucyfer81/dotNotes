import {
	buildTitle,
} from "./note-query-service";
import { requestRssImportedNote } from "./note-import-service";
import { sha256Hex } from "./note-storage-service";
import {
	bindRssItemToNote,
	claimRssItemReadingJob,
	ensureRssSchema,
	findRssItemByDedupeKey,
	getRssItemById,
	listFeedsForSync,
	listRssItemsQueuedForReading,
	listRssItemsPendingTranslation,
	markRssItemReadingFailed,
	markRssItemReadingReady,
	markRssFeedSyncFailure,
	markRssFeedSyncSuccess,
	queueRssItemForReading,
	requeueStaleRssReadingJobs,
	updateRssItemSummaryZh,
	upsertRssFeedTitle,
	upsertRssItem,
} from "./rss-feed-service";
import { fetchAndParseRssFeed } from "./rss-fetch-service";
import { fetchRssArticleMarkdown } from "./rss-reading-fetch-service";
import {
	getRssTranslateEnabled,
	translateSummaryToChinese,
} from "./rss-translate-service";
import type {
	RssItemRow,
	RssReadingQueueResult,
	RssSyncFeedResult,
	RssSyncResult,
	RssTranslateResult,
} from "./rss-types";

const DEFAULT_RSS_SYNC_FEED_LIMIT = 3;
const DEFAULT_RSS_SYNC_ITEM_LIMIT = 10;
const DEFAULT_RSS_SYNC_TRANSLATE_BUDGET = 3;
const DEFAULT_RSS_TRANSLATE_PASS_LIMIT = 30;
const DEFAULT_RSS_READING_PROCESS_LIMIT = 3;
const DEFAULT_RSS_READING_STALE_MINUTES = 10;

export function getRssSyncFeedLimit(env: Env): number {
	const ext = env as Env & { RSS_SYNC_FEED_LIMIT?: string };
	const parsed = Number(ext.RSS_SYNC_FEED_LIMIT);
	if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 200) {
		return Math.trunc(parsed);
	}
	return DEFAULT_RSS_SYNC_FEED_LIMIT;
}

export function getRssSyncItemLimit(env: Env): number {
	const ext = env as Env & { RSS_SYNC_ITEM_LIMIT?: string };
	const parsed = Number(ext.RSS_SYNC_ITEM_LIMIT);
	if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 200) {
		return Math.trunc(parsed);
	}
	return DEFAULT_RSS_SYNC_ITEM_LIMIT;
}

export function getRssSyncTranslateBudget(env: Env): number {
	const ext = env as Env & { RSS_SYNC_TRANSLATE_BUDGET?: string };
	const parsed = Number(ext.RSS_SYNC_TRANSLATE_BUDGET);
	if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) {
		return Math.trunc(parsed);
	}
	return DEFAULT_RSS_SYNC_TRANSLATE_BUDGET;
}

export function getRssTranslatePassLimit(env: Env): number {
	const ext = env as Env & { RSS_TRANSLATE_BATCH_LIMIT?: string };
	const parsed = Number(ext.RSS_TRANSLATE_BATCH_LIMIT);
	if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 200) {
		return Math.trunc(parsed);
	}
	return DEFAULT_RSS_TRANSLATE_PASS_LIMIT;
}

export function getRssReadingProcessLimit(env: Env): number {
	const ext = env as Env & { RSS_READING_PROCESS_LIMIT?: string };
	const parsed = Number(ext.RSS_READING_PROCESS_LIMIT);
	if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 100) {
		return Math.trunc(parsed);
	}
	return DEFAULT_RSS_READING_PROCESS_LIMIT;
}

export function getRssReadingStaleMinutes(env: Env): number {
	const ext = env as Env & { RSS_READING_STALE_MINUTES?: string };
	const parsed = Number(ext.RSS_READING_STALE_MINUTES);
	if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 24 * 60) {
		return Math.trunc(parsed);
	}
	return DEFAULT_RSS_READING_STALE_MINUTES;
}

export async function syncRssFeeds(
	env: Env,
	input: {
		feedId?: string | null;
		feedLimit?: number;
		itemLimit?: number;
		translate?: boolean;
		translateBudget?: number;
	},
): Promise<RssSyncResult> {
	await ensureRssSchema(env.DB);
	const feedLimit = input.feedLimit ?? getRssSyncFeedLimit(env);
	const itemLimit = input.itemLimit ?? getRssSyncItemLimit(env);
	const translateEnabled = input.translate ?? getRssTranslateEnabled(env);
	const translateBudget = input.translateBudget ?? getRssSyncTranslateBudget(env);
	const feeds = await listFeedsForSync(env.DB, {
		feedId: input.feedId ?? null,
		limit: feedLimit,
	});

	const results: RssSyncFeedResult[] = [];
	const translationQueue = new Map<string, string>();
	for (const feed of feeds) {
		const perFeed: RssSyncFeedResult = {
			feedId: feed.id,
			url: feed.url,
			feedTitle: feed.title,
			fetched: 0,
			created: 0,
			updated: 0,
			skipped: 0,
			errors: [],
		};
		try {
			const parsed = await fetchAndParseRssFeed(env, feed.url);
			perFeed.feedTitle = parsed.title ?? feed.title;
			await upsertRssFeedTitle(env.DB, feed.id, parsed.title ?? null);
			const items = parsed.items.slice(0, itemLimit);
			for (const item of items) {
				perFeed.fetched += 1;
				const dedupeKey = await buildRssItemDedupeKey(feed.id, item);
				const existing = await findRssItemByDedupeKey(env.DB, feed.id, dedupeKey);
				const summaryRaw = (item.summary || "").trim();
				const upserted = await upsertRssItem(env.DB, {
					feedId: feed.id,
					sourceId: item.sourceId ?? null,
					dedupeKey,
					link: item.link ?? null,
					title: item.title ?? null,
					author: item.author ?? null,
					publishedAt: item.publishedAt ?? null,
					summaryRaw,
					summaryZh: existing?.summaryZh ?? null,
				});
				if (
					translateEnabled &&
					summaryRaw.length > 0 &&
					(!existing || existing.summaryRaw !== summaryRaw || !existing.summaryZh)
				) {
					translationQueue.set(upserted.id, summaryRaw);
				}
				if (upserted.created) {
					perFeed.created += 1;
				} else if (upserted.updated) {
					perFeed.updated += 1;
				} else {
					perFeed.skipped += 1;
				}
			}
			await markRssFeedSyncSuccess(env.DB, feed.id, {
				fetchedAt: new Date().toISOString(),
				title: parsed.title ?? null,
			});
		} catch (error) {
			const message = String(error);
			perFeed.errors.push(message);
			await markRssFeedSyncFailure(env.DB, feed.id, message);
		}
		results.push(perFeed);
	}

	if (translateEnabled && translateBudget > 0 && translationQueue.size > 0) {
		await translateRssItems(env, [...translationQueue.entries()].map(([id, summaryRaw]) => ({ id, summaryRaw })), translateBudget);
	}

	return {
		processedFeeds: results.length,
		totalFetchedItems: results.reduce((acc, item) => acc + item.fetched, 0),
		totalCreated: results.reduce((acc, item) => acc + item.created, 0),
		totalUpdated: results.reduce((acc, item) => acc + item.updated, 0),
		totalSkipped: results.reduce((acc, item) => acc + item.skipped, 0),
		results,
	};
}

export async function translatePendingRssItems(
	env: Env,
	input: { feedId?: string | null; limit?: number } = {},
): Promise<RssTranslateResult> {
	await ensureRssSchema(env.DB);
	const limit = input.limit ?? getRssTranslatePassLimit(env);
	const candidates = await listRssItemsPendingTranslation(env.DB, {
		feedId: input.feedId ?? null,
		limit,
	});
	return translateRssItems(env, candidates, limit);
}

export async function saveRssItemToReading(env: Env, itemId: string): Promise<RssReadingQueueResult> {
	await ensureRssSchema(env.DB);
	const queued = await queueRssItemForReading(env.DB, itemId);
	if (queued.noteId || queued.item.readingState !== "queued") {
		return queued;
	}
	const outcome = await processSingleQueuedRssReadingItem(env, itemId).catch(async (error) => {
		const current = await getRssItemById(env.DB, itemId);
		if (current) {
			return {
				item: current,
				queued: false,
				noteId: current.noteId,
				created: false,
			} satisfies RssReadingQueueResult;
		}
		throw error;
	});
	if (typeof outcome === "object") {
		return outcome;
	}
	const current = await getRssItemById(env.DB, itemId);
	if (!current) {
		throw new Error("RSS item not found after save");
	}
	return {
		item: current,
		queued: false,
		noteId: current.noteId,
		created: outcome === "created" && !!current.noteId,
	};
}

export async function processQueuedRssReadingItems(
	env: Env,
	input: { limit?: number; itemId?: string | null } = {},
): Promise<{ processed: number; created: number; failed: number; skipped: number; itemIds: string[] }> {
	await ensureRssSchema(env.DB);
	const limit = input.limit ?? getRssReadingProcessLimit(env);
	const recovered = await requeueStaleRssReadingJobs(env.DB, {
		staleMinutes: getRssReadingStaleMinutes(env),
	});
	if (recovered > 0) {
		console.warn("Recovered stale rss reading jobs", { recovered });
	}
	const candidates = await listRssItemsQueuedForReading(env.DB, {
		limit,
		itemId: input.itemId ?? null,
	});
	let created = 0;
	let failed = 0;
	let skipped = 0;
	const itemIds: string[] = [];
	for (const candidate of candidates) {
		itemIds.push(candidate.id);
		try {
			const outcome = await processSingleQueuedRssReadingItem(env, candidate.id);
			if (outcome === "created") {
				created += 1;
			} else {
				skipped += 1;
			}
		} catch (error) {
			console.error("Process RSS reading queue item failed", { itemId: candidate.id, error });
			failed += 1;
		}
	}
	return {
		processed: candidates.length,
		created,
		failed,
		skipped,
		itemIds,
	};
}

async function processSingleQueuedRssReadingItem(env: Env, itemId: string): Promise<"created" | "skipped"> {
	const claimed = await claimRssItemReadingJob(env.DB, itemId);
	if (!claimed) {
		return "skipped";
	}
	const item = await getRssItemById(env.DB, itemId);
	if (!item) {
		await markRssItemReadingFailed(env.DB, itemId, "RSS item not found");
		return "skipped";
	}
	if (item.noteId) {
		await markRssItemReadingReady(env.DB, item.id);
		return "skipped";
	}
	if (!item.link || item.link.trim().length === 0) {
		const fallbackBody = buildReadingNoteBodyFromFallback(item, "RSS item link is empty");
		const fallbackTitle = (item.title ?? "").trim() || buildTitle(item.summaryZh ?? item.summaryRaw) || "RSS Reading";
		const imported = await requestRssImportedNote(env, {
			title: fallbackTitle,
			bodyText: fallbackBody,
		});
		await bindRssItemToNote(env.DB, item.id, { noteId: imported.noteId, status: "saved" });
		return "created";
	}
	let bodyText: string;
	let noteTitle: string;
	try {
		const article = await fetchRssArticleMarkdown(env, item.link);
		bodyText = buildReadingNoteBodyFromArticle(item, article.markdown, article.source);
		noteTitle = (item.title ?? "").trim() || buildTitle(article.markdown) || "RSS Reading";
	} catch (error) {
		console.warn("RSS article fetch failed, fallback to summary import", {
			itemId: item.id,
			error: String(error),
		});
		bodyText = buildReadingNoteBodyFromFallback(item, String(error));
		noteTitle = (item.title ?? "").trim() || buildTitle(item.summaryZh ?? item.summaryRaw) || "RSS Reading";
	}
	try {
		const imported = await requestRssImportedNote(env, {
			title: noteTitle,
			bodyText,
		});
		await bindRssItemToNote(env.DB, item.id, { noteId: imported.noteId, status: "saved" });
		return "created";
	} catch (error) {
		await markRssItemReadingFailed(env.DB, item.id, String(error));
		throw error;
	}
}

async function buildRssItemDedupeKey(feedId: string, item: {
	sourceId: string | null;
	link: string | null;
	title: string | null;
	summary: string;
}): Promise<string> {
	const base = [
		feedId,
		item.sourceId ?? "",
		item.link ?? "",
		item.title ?? "",
		item.summary.slice(0, 256),
	].join("|");
	return sha256Hex(new TextEncoder().encode(base).buffer as ArrayBuffer);
}

async function translateRssItems(
	env: Env,
	items: Array<{ id: string; summaryRaw: string }>,
	limit: number,
): Promise<RssTranslateResult> {
	const queue = items
		.filter((item) => item.summaryRaw.trim().length > 0)
		.slice(0, Math.max(0, limit));
	let translated = 0;
	let failed = 0;
	const processedItemIds: string[] = [];
	for (const item of queue) {
		try {
			const summaryZh = await translateSummaryToChinese(env, item.summaryRaw);
			const updated = await updateRssItemSummaryZh(env.DB, item.id, summaryZh);
			if (updated) {
				translated += 1;
			} else {
				failed += 1;
			}
		} catch (error) {
			console.error("RSS translate item failed", { itemId: item.id, error });
			failed += 1;
		}
		processedItemIds.push(item.id);
	}
	return {
		requested: queue.length,
		translated,
		failed,
		processedItemIds,
	};
}

function buildReadingNoteBodyFromArticle(
	item: RssItemRow,
	originalBody: string,
	contentSource: "browser-rendering" | "direct-fetch",
): string {
	const lines: string[] = [];
	lines.push("## 全文（原文）");
	lines.push(originalBody.trim());
	lines.push("");
	if (item.link) {
		lines.push(`Source: ${item.link}`);
	}
	if (item.feedTitle) {
		lines.push(`Feed: ${item.feedTitle}`);
	}
	if (item.publishedAt) {
		lines.push(`Published: ${item.publishedAt}`);
	}
	if (item.author) {
		lines.push(`Author: ${item.author}`);
	}
	if (lines.length > 0) {
		lines.push("");
	}
	lines.push(`Extractor: ${contentSource}`);
	lines.push("#rss");
	return lines.join("\n").trim();
}

function buildReadingNoteBodyFromFallback(item: RssItemRow, reason: string): string {
	const lines: string[] = [];
	lines.push("## 摘要");
	lines.push((item.summaryZh ?? item.summaryRaw).trim() || "No summary available.");
	lines.push("");
	if (item.link) {
		lines.push(`Source: ${item.link}`);
	}
	if (item.feedTitle) {
		lines.push(`Feed: ${item.feedTitle}`);
	}
	if (item.publishedAt) {
		lines.push(`Published: ${item.publishedAt}`);
	}
	if (item.author) {
		lines.push(`Author: ${item.author}`);
	}
	lines.push("");
	lines.push(`Fallback: ${reason}`);
	lines.push("#rss");
	return lines.join("\n").trim();
}
