import { clampInt, parseCsv } from "./common-service";
import type {
	RssFeedRow,
	RssItemRow,
	RssReadingQueueResult,
	RssItemStatus,
} from "./rss-types";

const DEFAULT_RSS_FEED_LIMIT = 20;
const DEFAULT_RSS_ITEM_LIMIT = 50;
const DEFAULT_RSS_READING_QUEUE_LIMIT = 20;

export async function ensureRssSchema(db: D1Database): Promise<void> {
	await db.prepare(
		`CREATE TABLE IF NOT EXISTS rss_feeds (
			id TEXT PRIMARY KEY,
			url TEXT NOT NULL UNIQUE,
			title TEXT,
			enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
			last_fetched_at TEXT,
			last_error TEXT,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
	).run();
	await db.prepare(
		`CREATE TABLE IF NOT EXISTS rss_items (
			id TEXT PRIMARY KEY,
			feed_id TEXT NOT NULL REFERENCES rss_feeds(id) ON DELETE CASCADE,
			source_id TEXT,
			dedupe_key TEXT NOT NULL,
			link TEXT,
			title TEXT,
			author TEXT,
			published_at TEXT,
			summary_raw TEXT NOT NULL DEFAULT '',
				summary_zh TEXT,
				status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'saved', 'ignored')),
				note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,
				reading_state TEXT NOT NULL DEFAULT 'idle' CHECK (reading_state IN ('idle', 'queued', 'processing', 'ready', 'failed')),
				reading_error TEXT,
				reading_attempt_count INTEGER NOT NULL DEFAULT 0,
				reading_requested_at TEXT,
				reading_started_at TEXT,
				reading_completed_at TEXT,
				fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				UNIQUE(feed_id, dedupe_key)
			)`,
	).run();
	await addColumnIfMissing(
		db,
		"ALTER TABLE rss_items ADD COLUMN reading_state TEXT NOT NULL DEFAULT 'idle' CHECK (reading_state IN ('idle', 'queued', 'processing', 'ready', 'failed'))",
	);
	await addColumnIfMissing(db, "ALTER TABLE rss_items ADD COLUMN reading_error TEXT");
	await addColumnIfMissing(db, "ALTER TABLE rss_items ADD COLUMN reading_attempt_count INTEGER NOT NULL DEFAULT 0");
	await addColumnIfMissing(db, "ALTER TABLE rss_items ADD COLUMN reading_requested_at TEXT");
	await addColumnIfMissing(db, "ALTER TABLE rss_items ADD COLUMN reading_started_at TEXT");
	await addColumnIfMissing(db, "ALTER TABLE rss_items ADD COLUMN reading_completed_at TEXT");
	await db.prepare(
		"CREATE INDEX IF NOT EXISTS idx_rss_feeds_enabled_updated ON rss_feeds(enabled, updated_at DESC)",
	).run();
	await db.prepare(
		"CREATE INDEX IF NOT EXISTS idx_rss_items_feed_published ON rss_items(feed_id, published_at DESC, created_at DESC)",
	).run();
	await db.prepare(
		"CREATE INDEX IF NOT EXISTS idx_rss_items_status_updated ON rss_items(status, updated_at DESC)",
	).run();
	await db.prepare(
		"CREATE INDEX IF NOT EXISTS idx_rss_items_reading_queue ON rss_items(reading_state, reading_requested_at, updated_at)",
	).run();
	await db.prepare(
		`CREATE TRIGGER IF NOT EXISTS trg_rss_feeds_updated_at
		AFTER UPDATE ON rss_feeds
		FOR EACH ROW
		WHEN NEW.updated_at = OLD.updated_at
		BEGIN
			UPDATE rss_feeds SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
		END`,
	).run();
	await db.prepare(
		`CREATE TRIGGER IF NOT EXISTS trg_rss_items_updated_at
		AFTER UPDATE ON rss_items
		FOR EACH ROW
		WHEN NEW.updated_at = OLD.updated_at
		BEGIN
			UPDATE rss_items SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
		END`,
		).run();
}

async function addColumnIfMissing(db: D1Database, sql: string): Promise<void> {
	try {
		await db.prepare(sql).run();
	} catch (error) {
		const message = String(error).toLowerCase();
		if (message.includes("duplicate column name") || message.includes("already exists")) {
			return;
		}
		throw error;
	}
}

export async function listRssFeeds(db: D1Database): Promise<RssFeedRow[]> {
	const { results } = await db.prepare(
		`SELECT
			id,
			url,
			title,
			enabled,
			last_fetched_at AS lastFetchedAt,
			last_error AS lastError,
			created_at AS createdAt,
			updated_at AS updatedAt
		 FROM rss_feeds
		 ORDER BY enabled DESC, updated_at DESC`,
	).all<RssFeedRow>();
	return results;
}

export async function getRssFeedById(db: D1Database, feedId: string): Promise<RssFeedRow | null> {
	const row = await db.prepare(
		`SELECT
			id,
			url,
			title,
			enabled,
			last_fetched_at AS lastFetchedAt,
			last_error AS lastError,
			created_at AS createdAt,
			updated_at AS updatedAt
		 FROM rss_feeds
		 WHERE id = ?
		 LIMIT 1`,
	)
		.bind(feedId)
		.first<RssFeedRow>();
	return row ?? null;
}

export async function createRssFeed(
	db: D1Database,
	input: { id: string; url: string; title: string | null; enabled: boolean },
): Promise<RssFeedRow> {
	await db.prepare(
		`INSERT INTO rss_feeds (id, url, title, enabled)
		 VALUES (?, ?, ?, ?)`,
	)
		.bind(input.id, input.url, input.title, input.enabled ? 1 : 0)
		.run();
	const row = await getRssFeedById(db, input.id);
	if (!row) {
		throw new Error("Failed to create rss feed");
	}
	return row;
}

export async function updateRssFeed(
	db: D1Database,
	feedId: string,
	input: { url?: string; title?: string | null; enabled?: boolean },
): Promise<RssFeedRow | null> {
	const existing = await getRssFeedById(db, feedId);
	if (!existing) {
		return null;
	}
	const nextUrl = input.url ?? existing.url;
	const nextTitle = input.title === undefined ? existing.title : input.title;
	const nextEnabled = input.enabled === undefined ? existing.enabled : (input.enabled ? 1 : 0);
	await db.prepare(
		`UPDATE rss_feeds
		 SET url = ?, title = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
		 WHERE id = ?`,
	)
		.bind(nextUrl, nextTitle, nextEnabled, feedId)
		.run();
	return getRssFeedById(db, feedId);
}

export async function deleteRssFeed(db: D1Database, feedId: string): Promise<boolean> {
	const result = await db.prepare("DELETE FROM rss_feeds WHERE id = ?")
		.bind(feedId)
		.run();
	return Number(result.meta.changes ?? 0) > 0;
}

export async function listFeedsForSync(
	db: D1Database,
	input: { feedId?: string | null; limit?: number },
): Promise<RssFeedRow[]> {
	const where: string[] = ["enabled = 1"];
	const params: Array<string | number> = [];
	if (input.feedId) {
		where.push("id = ?");
		params.push(input.feedId);
	}
	const limit = clampInt(
		typeof input.limit === "number" ? String(input.limit) : undefined,
		DEFAULT_RSS_FEED_LIMIT,
		1,
		100,
	);
	const { results } = await db.prepare(
		`SELECT
			id,
			url,
			title,
			enabled,
			last_fetched_at AS lastFetchedAt,
			last_error AS lastError,
			created_at AS createdAt,
			updated_at AS updatedAt
		 FROM rss_feeds
		 WHERE ${where.join(" AND ")}
		 ORDER BY
			CASE WHEN last_fetched_at IS NULL THEN 0 ELSE 1 END ASC,
			COALESCE(last_fetched_at, '1970-01-01T00:00:00.000Z') ASC,
			updated_at ASC
		 LIMIT ?`,
	)
		.bind(...params, limit)
		.all<RssFeedRow>();
	return results;
}

export async function upsertRssFeedTitle(db: D1Database, feedId: string, title: string | null): Promise<void> {
	const normalized = title?.trim() ?? "";
	if (!normalized) {
		return;
	}
	await db.prepare(
		`UPDATE rss_feeds
		 SET title = ?,
			 updated_at = CURRENT_TIMESTAMP
		 WHERE id = ?
		   AND COALESCE(title, '') <> ?`,
	)
		.bind(normalized, feedId, normalized)
		.run();
}

export async function markRssFeedSyncSuccess(
	db: D1Database,
	feedId: string,
	input: { fetchedAt: string; title?: string | null },
): Promise<void> {
	await db.prepare(
		`UPDATE rss_feeds
		 SET title = COALESCE(?, title),
			 last_fetched_at = ?,
			 last_error = NULL,
			 updated_at = CURRENT_TIMESTAMP
		 WHERE id = ?`,
	)
		.bind(input.title ?? null, input.fetchedAt, feedId)
		.run();
}

export async function markRssFeedSyncFailure(db: D1Database, feedId: string, error: string): Promise<void> {
	await db.prepare(
		`UPDATE rss_feeds
		 SET last_error = ?,
			 updated_at = CURRENT_TIMESTAMP
		 WHERE id = ?`,
	)
		.bind(error.slice(0, 800), feedId)
		.run();
}

export async function findRssItemByDedupeKey(
	db: D1Database,
	feedId: string,
	dedupeKey: string,
): Promise<RssItemRow | null> {
	const row = await db.prepare(
		`SELECT
			ri.id,
			ri.feed_id AS feedId,
			rf.title AS feedTitle,
			ri.source_id AS sourceId,
			ri.dedupe_key AS dedupeKey,
			ri.link,
			ri.title,
			ri.author,
			ri.published_at AS publishedAt,
			ri.summary_raw AS summaryRaw,
				ri.summary_zh AS summaryZh,
				ri.status,
				ri.note_id AS noteId,
				ri.reading_state AS readingState,
				ri.reading_error AS readingError,
				ri.reading_attempt_count AS readingAttemptCount,
				ri.reading_requested_at AS readingRequestedAt,
				ri.reading_started_at AS readingStartedAt,
				ri.reading_completed_at AS readingCompletedAt,
				ri.fetched_at AS fetchedAt,
				ri.created_at AS createdAt,
				ri.updated_at AS updatedAt
		 FROM rss_items ri
		 LEFT JOIN rss_feeds rf ON rf.id = ri.feed_id
		 WHERE ri.feed_id = ? AND ri.dedupe_key = ?
		 LIMIT 1`,
	)
		.bind(feedId, dedupeKey)
		.first<RssItemRow>();
	return row ?? null;
}

export async function upsertRssItem(
	db: D1Database,
	input: {
		feedId: string;
		sourceId: string | null;
		dedupeKey: string;
		link: string | null;
		title: string | null;
		author: string | null;
		publishedAt: string | null;
		summaryRaw: string;
		summaryZh: string | null;
	},
): Promise<{ id: string; created: boolean; updated: boolean }> {
	const existing = await findRssItemByDedupeKey(db, input.feedId, input.dedupeKey);
	if (existing) {
		const changed =
			(existing.sourceId ?? null) !== (input.sourceId ?? null) ||
			(existing.link ?? null) !== (input.link ?? null) ||
			(existing.title ?? null) !== (input.title ?? null) ||
			(existing.author ?? null) !== (input.author ?? null) ||
			(existing.publishedAt ?? null) !== (input.publishedAt ?? null) ||
			existing.summaryRaw !== input.summaryRaw ||
			(existing.summaryZh ?? null) !== (input.summaryZh ?? null);
		if (changed) {
			await db.prepare(
				`UPDATE rss_items
				 SET source_id = ?,
					 link = ?,
					 title = ?,
					 author = ?,
					 published_at = ?,
					 summary_raw = ?,
					 summary_zh = ?,
					 fetched_at = CURRENT_TIMESTAMP,
					 updated_at = CURRENT_TIMESTAMP
				 WHERE id = ?`,
			)
				.bind(
					input.sourceId,
					input.link,
					input.title,
					input.author,
					input.publishedAt,
					input.summaryRaw,
					input.summaryZh,
					existing.id,
				)
				.run();
		} else {
			await db.prepare(
				`UPDATE rss_items
				 SET fetched_at = CURRENT_TIMESTAMP,
					 updated_at = CURRENT_TIMESTAMP
				 WHERE id = ?`,
			)
				.bind(existing.id)
				.run();
		}
		return {
			id: existing.id,
			created: false,
			updated: changed,
		};
	}

	const itemId = crypto.randomUUID();
	await db.prepare(
		`INSERT INTO rss_items (
			id, feed_id, source_id, dedupe_key, link, title, author, published_at, summary_raw, summary_zh
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			itemId,
			input.feedId,
			input.sourceId,
			input.dedupeKey,
			input.link,
			input.title,
			input.author,
			input.publishedAt,
			input.summaryRaw,
			input.summaryZh,
		)
		.run();
	return {
		id: itemId,
		created: true,
		updated: false,
	};
}

export async function listRssItems(
	db: D1Database,
	input: { feedId?: string | null; statusCsv?: string | null; limit?: number; offset?: number },
): Promise<RssItemRow[]> {
	const statuses = parseCsv(input.statusCsv ?? undefined).filter(
		(item): item is RssItemStatus => item === "new" || item === "saved" || item === "ignored",
	);
	const where: string[] = [];
	const params: Array<string | number> = [];
	if (input.feedId) {
		where.push("ri.feed_id = ?");
		params.push(input.feedId);
	}
	if (statuses.length > 0) {
		where.push(`ri.status IN (${statuses.map(() => "?").join(", ")})`);
		params.push(...statuses);
	}
	const limit = clampInt(
		typeof input.limit === "number" ? String(input.limit) : undefined,
		DEFAULT_RSS_ITEM_LIMIT,
		1,
		200,
	);
	const offset = clampInt(
		typeof input.offset === "number" ? String(input.offset) : undefined,
		0,
		0,
		5000,
	);
	const { results } = await db.prepare(
		`SELECT
			ri.id,
			ri.feed_id AS feedId,
			rf.title AS feedTitle,
			ri.source_id AS sourceId,
			ri.dedupe_key AS dedupeKey,
			ri.link,
			ri.title,
			ri.author,
			ri.published_at AS publishedAt,
			ri.summary_raw AS summaryRaw,
				ri.summary_zh AS summaryZh,
				ri.status,
				ri.note_id AS noteId,
				ri.reading_state AS readingState,
				ri.reading_error AS readingError,
				ri.reading_attempt_count AS readingAttemptCount,
				ri.reading_requested_at AS readingRequestedAt,
				ri.reading_started_at AS readingStartedAt,
				ri.reading_completed_at AS readingCompletedAt,
				ri.fetched_at AS fetchedAt,
				ri.created_at AS createdAt,
				ri.updated_at AS updatedAt
		 FROM rss_items ri
		 LEFT JOIN rss_feeds rf ON rf.id = ri.feed_id
		 ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
		 ORDER BY COALESCE(ri.published_at, ri.created_at) DESC, ri.created_at DESC
		 LIMIT ? OFFSET ?`,
	)
		.bind(...params, limit, offset)
		.all<RssItemRow>();
	return results;
}

export async function listRssReadingJobs(
	db: D1Database,
	input: { readingStateCsv?: string | null; limit?: number; offset?: number } = {},
): Promise<{
	items: RssItemRow[];
	count: number;
	summary: { queued: number; processing: number; failed: number };
}> {
	const states = parseCsv(input.readingStateCsv ?? undefined).filter(
		(item): item is "queued" | "processing" | "failed" =>
			item === "queued" || item === "processing" || item === "failed",
	);
	const effectiveStates = states.length > 0 ? states : ["queued", "processing", "failed"];
	const where: string[] = [
		"ri.note_id IS NULL",
		`ri.reading_state IN (${effectiveStates.map(() => "?").join(", ")})`,
	];
	const params: Array<string | number> = [...effectiveStates];
	const limit = clampInt(
		typeof input.limit === "number" ? String(input.limit) : undefined,
		DEFAULT_RSS_READING_QUEUE_LIMIT,
		1,
		200,
	);
	const offset = clampInt(
		typeof input.offset === "number" ? String(input.offset) : undefined,
		0,
		0,
		5000,
	);
	const { results: items } = await db.prepare(
		`SELECT
			ri.id,
			ri.feed_id AS feedId,
			rf.title AS feedTitle,
			ri.source_id AS sourceId,
			ri.dedupe_key AS dedupeKey,
			ri.link,
			ri.title,
			ri.author,
			ri.published_at AS publishedAt,
			ri.summary_raw AS summaryRaw,
			ri.summary_zh AS summaryZh,
			ri.status,
			ri.note_id AS noteId,
			ri.reading_state AS readingState,
			ri.reading_error AS readingError,
			ri.reading_attempt_count AS readingAttemptCount,
			ri.reading_requested_at AS readingRequestedAt,
			ri.reading_started_at AS readingStartedAt,
			ri.reading_completed_at AS readingCompletedAt,
			ri.fetched_at AS fetchedAt,
			ri.created_at AS createdAt,
			ri.updated_at AS updatedAt
		 FROM rss_items ri
		 LEFT JOIN rss_feeds rf ON rf.id = ri.feed_id
		 WHERE ${where.join(" AND ")}
		 ORDER BY
			CASE
				WHEN ri.reading_state = 'processing' THEN 0
				WHEN ri.reading_state = 'queued' THEN 1
				WHEN ri.reading_state = 'failed' THEN 2
				ELSE 3
			END ASC,
			COALESCE(ri.reading_started_at, ri.reading_requested_at, ri.updated_at) DESC,
			ri.updated_at DESC
		 LIMIT ? OFFSET ?`,
	)
		.bind(...params, limit, offset)
		.all<RssItemRow>();
	const countRow = await db.prepare(
		`SELECT COUNT(*) AS count
		 FROM rss_items ri
		 WHERE ${where.join(" AND ")}`,
	)
		.bind(...params)
		.first<{ count: number }>();
	const { results: summaryRows } = await db.prepare(
		`SELECT
			ri.reading_state AS readingState,
			COUNT(*) AS count
		 FROM rss_items ri
		 WHERE ri.note_id IS NULL
		   AND ri.reading_state IN ('queued', 'processing', 'failed')
		 GROUP BY ri.reading_state`,
	).all<{ readingState: string; count: number }>();
	let queued = 0;
	let processing = 0;
	let failed = 0;
	for (const row of summaryRows) {
		if (row.readingState === "queued") {
			queued = row.count;
		} else if (row.readingState === "processing") {
			processing = row.count;
		} else if (row.readingState === "failed") {
			failed = row.count;
		}
	}
	return {
		items,
		count: countRow?.count ?? 0,
		summary: {
			queued,
			processing,
			failed,
		},
	};
}

export async function getRssItemById(db: D1Database, itemId: string): Promise<RssItemRow | null> {
	const row = await db.prepare(
		`SELECT
			ri.id,
			ri.feed_id AS feedId,
			rf.title AS feedTitle,
			ri.source_id AS sourceId,
			ri.dedupe_key AS dedupeKey,
			ri.link,
			ri.title,
			ri.author,
			ri.published_at AS publishedAt,
			ri.summary_raw AS summaryRaw,
				ri.summary_zh AS summaryZh,
				ri.status,
				ri.note_id AS noteId,
				ri.reading_state AS readingState,
				ri.reading_error AS readingError,
				ri.reading_attempt_count AS readingAttemptCount,
				ri.reading_requested_at AS readingRequestedAt,
				ri.reading_started_at AS readingStartedAt,
				ri.reading_completed_at AS readingCompletedAt,
				ri.fetched_at AS fetchedAt,
				ri.created_at AS createdAt,
				ri.updated_at AS updatedAt
		 FROM rss_items ri
		 LEFT JOIN rss_feeds rf ON rf.id = ri.feed_id
		 WHERE ri.id = ?
		 LIMIT 1`,
	)
		.bind(itemId)
		.first<RssItemRow>();
	return row ?? null;
}

export async function updateRssItemStatus(db: D1Database, itemId: string, status: RssItemStatus): Promise<boolean> {
	const result = await db.prepare(
		`UPDATE rss_items
		 SET status = ?, updated_at = CURRENT_TIMESTAMP
		 WHERE id = ?`,
	)
		.bind(status, itemId)
		.run();
	return Number(result.meta.changes ?? 0) > 0;
}

export async function bindRssItemToNote(
	db: D1Database,
	itemId: string,
	input: { noteId: string; status: RssItemStatus },
): Promise<boolean> {
	const result = await db.prepare(
		`UPDATE rss_items
		 SET note_id = ?,
			 status = ?,
			 reading_state = 'ready',
			 reading_error = NULL,
			 reading_completed_at = CURRENT_TIMESTAMP,
			 updated_at = CURRENT_TIMESTAMP
		 WHERE id = ?`,
	)
		.bind(input.noteId, input.status, itemId)
		.run();
	return Number(result.meta.changes ?? 0) > 0;
}

export async function queueRssItemForReading(db: D1Database, itemId: string): Promise<RssReadingQueueResult> {
	const existing = await getRssItemById(db, itemId);
	if (!existing) {
		throw new Error("RSS item not found");
	}
	if (existing.noteId) {
		return {
			item: existing,
			queued: false,
			noteId: existing.noteId,
			created: false,
		};
	}
	if (existing.readingState === "queued" || existing.readingState === "processing") {
		return {
			item: existing,
			queued: false,
			noteId: null,
			created: false,
		};
	}
	await db.prepare(
		`UPDATE rss_items
		 SET reading_state = 'queued',
			 reading_error = NULL,
			 reading_requested_at = CURRENT_TIMESTAMP,
			 updated_at = CURRENT_TIMESTAMP
		 WHERE id = ?
		   AND note_id IS NULL`,
	)
		.bind(itemId)
		.run();
	const queuedItem = await getRssItemById(db, itemId);
	if (!queuedItem) {
		throw new Error("RSS item not found");
	}
	return {
		item: queuedItem,
		queued: queuedItem.readingState === "queued",
		noteId: null,
		created: false,
	};
}

export async function listRssItemsQueuedForReading(
	db: D1Database,
	input: { limit?: number; itemId?: string | null } = {},
): Promise<RssItemRow[]> {
	const where: string[] = [
		"ri.note_id IS NULL",
		"ri.reading_state = 'queued'",
	];
	const params: Array<string | number> = [];
	if (input.itemId) {
		where.push("ri.id = ?");
		params.push(input.itemId);
	}
	const limit = clampInt(
		typeof input.limit === "number" ? String(input.limit) : undefined,
		DEFAULT_RSS_READING_QUEUE_LIMIT,
		1,
		200,
	);
	const { results } = await db.prepare(
		`SELECT
			ri.id,
			ri.feed_id AS feedId,
			rf.title AS feedTitle,
			ri.source_id AS sourceId,
			ri.dedupe_key AS dedupeKey,
			ri.link,
			ri.title,
			ri.author,
			ri.published_at AS publishedAt,
			ri.summary_raw AS summaryRaw,
			ri.summary_zh AS summaryZh,
			ri.status,
			ri.note_id AS noteId,
			ri.reading_state AS readingState,
			ri.reading_error AS readingError,
			ri.reading_attempt_count AS readingAttemptCount,
			ri.reading_requested_at AS readingRequestedAt,
			ri.reading_started_at AS readingStartedAt,
			ri.reading_completed_at AS readingCompletedAt,
			ri.fetched_at AS fetchedAt,
			ri.created_at AS createdAt,
			ri.updated_at AS updatedAt
		 FROM rss_items ri
		 LEFT JOIN rss_feeds rf ON rf.id = ri.feed_id
		 WHERE ${where.join(" AND ")}
		 ORDER BY
			COALESCE(ri.reading_requested_at, ri.updated_at) ASC,
			ri.updated_at ASC
		 LIMIT ?`,
	)
		.bind(...params, limit)
		.all<RssItemRow>();
	return results;
}

export async function claimRssItemReadingJob(db: D1Database, itemId: string): Promise<boolean> {
	const result = await db.prepare(
		`UPDATE rss_items
		 SET reading_state = 'processing',
			 reading_error = NULL,
			 reading_attempt_count = COALESCE(reading_attempt_count, 0) + 1,
			 reading_started_at = CURRENT_TIMESTAMP,
			 updated_at = CURRENT_TIMESTAMP
		 WHERE id = ?
		   AND note_id IS NULL
		   AND reading_state = 'queued'`,
	)
		.bind(itemId)
		.run();
	return Number(result.meta.changes ?? 0) > 0;
}

export async function requeueStaleRssReadingJobs(
	db: D1Database,
	input: { staleMinutes: number },
): Promise<number> {
	const staleMinutes = clampInt(String(input.staleMinutes), 10, 1, 24 * 60);
	const staleBeforeExpr = `-${staleMinutes} minutes`;
	const result = await db.prepare(
		`UPDATE rss_items
		 SET reading_state = 'queued',
			 reading_error = 'Recovered stale processing job',
			 reading_requested_at = CURRENT_TIMESTAMP,
			 updated_at = CURRENT_TIMESTAMP
		 WHERE note_id IS NULL
		   AND reading_state = 'processing'
		   AND reading_started_at IS NOT NULL
		   AND reading_started_at <= datetime('now', ?)`,
	)
		.bind(staleBeforeExpr)
		.run();
	return Number(result.meta.changes ?? 0);
}

export async function markRssItemReadingFailed(db: D1Database, itemId: string, errorMessage: string): Promise<void> {
	await db.prepare(
		`UPDATE rss_items
		 SET reading_state = 'failed',
			 reading_error = ?,
			 reading_completed_at = CURRENT_TIMESTAMP,
			 updated_at = CURRENT_TIMESTAMP
		 WHERE id = ?`,
	)
		.bind(errorMessage.slice(0, 1000), itemId)
		.run();
}

export async function markRssItemReadingReady(db: D1Database, itemId: string): Promise<void> {
	await db.prepare(
		`UPDATE rss_items
		 SET reading_state = 'ready',
			 reading_error = NULL,
			 reading_completed_at = CURRENT_TIMESTAMP,
			 updated_at = CURRENT_TIMESTAMP
		 WHERE id = ?`,
	)
		.bind(itemId)
		.run();
}

export async function listRssItemsPendingTranslation(
	db: D1Database,
	input: { feedId?: string | null; limit?: number },
): Promise<Array<{ id: string; summaryRaw: string }>> {
	const where: string[] = [
		"rf.enabled = 1",
		"TRIM(COALESCE(ri.summary_raw, '')) <> ''",
		"(ri.summary_zh IS NULL OR TRIM(ri.summary_zh) = '')",
	];
	const params: Array<string | number> = [];
	if (input.feedId) {
		where.push("ri.feed_id = ?");
		params.push(input.feedId);
	}
	const limit = clampInt(
		typeof input.limit === "number" ? String(input.limit) : undefined,
		30,
		1,
		200,
	);
	const { results } = await db.prepare(
		`SELECT
			ri.id,
			ri.summary_raw AS summaryRaw
		 FROM rss_items ri
		 INNER JOIN rss_feeds rf ON rf.id = ri.feed_id
		 WHERE ${where.join(" AND ")}
		 ORDER BY COALESCE(ri.published_at, ri.created_at) DESC, ri.created_at DESC
		 LIMIT ?`,
	)
		.bind(...params, limit)
		.all<{ id: string; summaryRaw: string }>();
	return results;
}

export async function updateRssItemSummaryZh(db: D1Database, itemId: string, summaryZh: string): Promise<boolean> {
	const normalized = summaryZh.trim();
	if (!normalized) {
		return false;
	}
	const result = await db.prepare(
		`UPDATE rss_items
		 SET summary_zh = ?,
			 updated_at = CURRENT_TIMESTAMP
		 WHERE id = ?`,
	)
		.bind(normalized, itemId)
		.run();
	return Number(result.meta.changes ?? 0) > 0;
}
