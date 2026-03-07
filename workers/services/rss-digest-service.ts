import {
	buildExcerpt,
	buildTitle,
	ensurePresetFolders,
	ensureUniqueSlug,
	slugify,
	syncNoteFtsContent,
} from "./note-query-service";
import { resolveBodyStorageForCreate, sha256Hex } from "./note-storage-service";
import { enqueueNoteIndexJob } from "./index-core-service";
import {
	bindRssItemToNote,
	ensureRssSchema,
	findRssItemByDedupeKey,
	getRssItemById,
	listFeedsForSync,
	markRssFeedSyncFailure,
	markRssFeedSyncSuccess,
	upsertRssItem,
} from "./rss-feed-service";
import { fetchAndParseRssFeed } from "./rss-fetch-service";
import { getRssTranslateEnabled, translateSummaryToChinese } from "./rss-translate-service";
import type {
	RssItemRow,
	RssSyncFeedResult,
	RssSyncResult,
} from "./rss-types";

const DEFAULT_RSS_SYNC_FEED_LIMIT = 20;
const DEFAULT_RSS_SYNC_ITEM_LIMIT = 30;
const READING_PARENT_FOLDER_ID = "folder-20-areas";
const READING_FOLDER_SLUG = "reading";
const READING_FOLDER_NAME = "Reading";
const READING_FOLDER_ID = "folder-20-areas-reading";

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

export async function syncRssFeeds(
	env: Env,
	input: {
		feedId?: string | null;
		feedLimit?: number;
		itemLimit?: number;
		translate?: boolean;
	},
): Promise<RssSyncResult> {
	await ensureRssSchema(env.DB);
	const feedLimit = input.feedLimit ?? getRssSyncFeedLimit(env);
	const itemLimit = input.itemLimit ?? getRssSyncItemLimit(env);
	const translateEnabled = input.translate ?? getRssTranslateEnabled(env);
	const feeds = await listFeedsForSync(env.DB, {
		feedId: input.feedId ?? null,
		limit: feedLimit,
	});

	const results: RssSyncFeedResult[] = [];
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
			const items = parsed.items.slice(0, itemLimit);
			for (const item of items) {
				perFeed.fetched += 1;
				const dedupeKey = await buildRssItemDedupeKey(feed.id, item);
				const existing = await findRssItemByDedupeKey(env.DB, feed.id, dedupeKey);
				const summaryRaw = (item.summary || "").trim();
				const shouldTranslate =
					translateEnabled &&
					summaryRaw.length > 0 &&
					(!existing || existing.summaryRaw !== summaryRaw || !existing.summaryZh);
				const summaryZh = shouldTranslate
					? await translateSummaryToChinese(env, summaryRaw)
					: (existing?.summaryZh ?? null);
				const upserted = await upsertRssItem(env.DB, {
					feedId: feed.id,
					sourceId: item.sourceId ?? null,
					dedupeKey,
					link: item.link ?? null,
					title: item.title ?? null,
					author: item.author ?? null,
					publishedAt: item.publishedAt ?? null,
					summaryRaw,
					summaryZh,
				});
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

	return {
		processedFeeds: results.length,
		totalFetchedItems: results.reduce((acc, item) => acc + item.fetched, 0),
		totalCreated: results.reduce((acc, item) => acc + item.created, 0),
		totalUpdated: results.reduce((acc, item) => acc + item.updated, 0),
		totalSkipped: results.reduce((acc, item) => acc + item.skipped, 0),
		results,
	};
}

export async function saveRssItemToReading(env: Env, itemId: string): Promise<{ item: RssItemRow; noteId: string; created: boolean }> {
	await ensureRssSchema(env.DB);
	const item = await getRssItemById(env.DB, itemId);
	if (!item) {
		throw new Error("RSS item not found");
	}
	if (item.noteId) {
		return {
			item,
			noteId: item.noteId,
			created: false,
		};
	}

	const folderId = await ensureReadingFolder(env.DB);
	const bodyText = buildReadingNoteBody(item);
	const noteId = crypto.randomUUID();
	const slug = await ensureUniqueSlug(env.DB, slugify(item.title || buildTitle(bodyText)));
	const resolvedBody = await resolveBodyStorageForCreate(env, {
		noteId,
		requestedStorageType: "d1",
		bodyText,
		bodyR2Key: null,
	});
	const title = item.title || buildTitle(bodyText) || "RSS Reading";
	await env.DB.prepare(
		`INSERT INTO notes (
			id, slug, title, folder_id, storage_type, body_text, body_r2_key, excerpt, size_bytes, word_count, is_pinned, is_archived
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
	)
		.bind(
			noteId,
			slug,
			title,
			folderId,
			resolvedBody.storageType,
			resolvedBody.bodyText,
			resolvedBody.bodyR2Key,
			buildExcerpt(resolvedBody.plainBodyText),
			resolvedBody.sizeBytes,
			resolvedBody.wordCount,
		)
		.run();
	await syncNoteFtsContent(env.DB, noteId, title, buildExcerpt(resolvedBody.plainBodyText), resolvedBody.plainBodyText);
	await bindRssItemToNote(env.DB, item.id, { noteId, status: "saved" });
	await enqueueNoteIndexJob(env.DB, noteId, "upsert");
	return {
		item: {
			...item,
			noteId,
			status: "saved",
		},
		noteId,
		created: true,
	};
}

async function ensureReadingFolder(db: D1Database): Promise<string> {
	await ensurePresetFolders(db);
	const existing = await db.prepare(
		`SELECT id
		 FROM folders
		 WHERE parent_id = ?
		   AND slug = ?
		 LIMIT 1`,
	)
		.bind(READING_PARENT_FOLDER_ID, READING_FOLDER_SLUG)
		.first<{ id: string }>();
	if (existing?.id) {
		return existing.id;
	}
	await db.prepare(
		`INSERT OR IGNORE INTO folders (id, parent_id, name, slug, sort_order)
		 VALUES (?, ?, ?, ?, ?)`,
	)
		.bind(READING_FOLDER_ID, READING_PARENT_FOLDER_ID, READING_FOLDER_NAME, READING_FOLDER_SLUG, 20)
		.run();
	return READING_FOLDER_ID;
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

function buildReadingNoteBody(item: RssItemRow): string {
	const lines: string[] = [];
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
	const zh = (item.summaryZh ?? "").trim();
	if (zh) {
		lines.push("## Summary (ZH)");
		lines.push(zh);
		lines.push("");
	}
	const raw = item.summaryRaw.trim();
	if (raw) {
		lines.push("## Summary (Raw)");
		lines.push(raw);
		lines.push("");
	}
	lines.push("#rss");
	return lines.join("\n").trim();
}
