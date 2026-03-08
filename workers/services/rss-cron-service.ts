import { clampInt } from "./common-service";
import { processQueuedRssReadingItems, syncRssFeeds, translatePendingRssItems } from "./rss-digest-service";

const DEFAULT_RSS_CRON_ENABLED = true;
const DEFAULT_RSS_CRON_AUTO_TRANSLATE = true;
const DEFAULT_RSS_CRON_SYNC_FEED_LIMIT = 20;
const DEFAULT_RSS_CRON_SYNC_ITEM_LIMIT = 10;
const DEFAULT_RSS_CRON_TRANSLATE_LIMIT = 20;
const DEFAULT_RSS_CRON_TRANSLATE_ROUNDS = 2;

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
	if (typeof value !== "string" || value.trim().length === 0) {
		return fallback;
	}
	const normalized = value.trim().toLowerCase();
	if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
		return true;
	}
	if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
		return false;
	}
	return fallback;
}

function readIntEnv(value: string | undefined, fallback: number, min: number, max: number): number {
	return clampInt(value, fallback, min, max);
}

export function getRssCronEnabled(env: Env): boolean {
	const ext = env as Env & { RSS_CRON_ENABLED?: string };
	return parseBooleanEnv(ext.RSS_CRON_ENABLED, DEFAULT_RSS_CRON_ENABLED);
}

export function getRssCronAutoTranslate(env: Env): boolean {
	const ext = env as Env & { RSS_CRON_AUTO_TRANSLATE?: string };
	return parseBooleanEnv(ext.RSS_CRON_AUTO_TRANSLATE, DEFAULT_RSS_CRON_AUTO_TRANSLATE);
}

export function getRssCronSyncFeedLimit(env: Env): number {
	const ext = env as Env & { RSS_CRON_SYNC_FEED_LIMIT?: string };
	return readIntEnv(ext.RSS_CRON_SYNC_FEED_LIMIT, DEFAULT_RSS_CRON_SYNC_FEED_LIMIT, 1, 200);
}

export function getRssCronSyncItemLimit(env: Env): number {
	const ext = env as Env & { RSS_CRON_SYNC_ITEM_LIMIT?: string };
	return readIntEnv(ext.RSS_CRON_SYNC_ITEM_LIMIT, DEFAULT_RSS_CRON_SYNC_ITEM_LIMIT, 1, 200);
}

export function getRssCronTranslateLimit(env: Env): number {
	const ext = env as Env & { RSS_CRON_TRANSLATE_LIMIT?: string };
	return readIntEnv(ext.RSS_CRON_TRANSLATE_LIMIT, DEFAULT_RSS_CRON_TRANSLATE_LIMIT, 1, 200);
}

export function getRssCronTranslateRounds(env: Env): number {
	const ext = env as Env & { RSS_CRON_TRANSLATE_ROUNDS?: string };
	return readIntEnv(ext.RSS_CRON_TRANSLATE_ROUNDS, DEFAULT_RSS_CRON_TRANSLATE_ROUNDS, 1, 20);
}

export async function runRssCronJob(event: ScheduledController, env: Env): Promise<void> {
	if (!getRssCronEnabled(env)) {
		console.info("RSS cron skipped: disabled", { cron: event.cron });
		return;
	}
	const startedAt = Date.now();
	const syncFeedLimit = getRssCronSyncFeedLimit(env);
	const syncItemLimit = getRssCronSyncItemLimit(env);
	const autoTranslate = getRssCronAutoTranslate(env);
	const translateLimit = getRssCronTranslateLimit(env);
	const translateRounds = getRssCronTranslateRounds(env);

	try {
		const readingResult = await processQueuedRssReadingItems(env, {
			limit: Math.max(2, Math.min(syncFeedLimit, 20)),
		});
		const syncResult = await syncRssFeeds(env, {
			feedLimit: syncFeedLimit,
			itemLimit: syncItemLimit,
			translate: false,
			translateBudget: 0,
		});
		let translateRequested = 0;
		let translateSuccess = 0;
		let translateFailed = 0;
		let completedRounds = 0;

		if (autoTranslate) {
			for (let round = 0; round < translateRounds; round += 1) {
				const batch = await translatePendingRssItems(env, {
					limit: translateLimit,
				});
				completedRounds += 1;
				translateRequested += batch.requested;
				translateSuccess += batch.translated;
				translateFailed += batch.failed;
				if (batch.requested === 0) {
					break;
				}
				if (batch.translated === 0 && batch.failed > 0) {
					break;
				}
			}
		}

		console.info("RSS cron completed", {
			cron: event.cron,
			syncFeedLimit,
			syncItemLimit,
			autoTranslate,
			translateLimit,
			translateRounds,
			processedFeeds: syncResult.processedFeeds,
			totalFetchedItems: syncResult.totalFetchedItems,
			totalCreated: syncResult.totalCreated,
			totalUpdated: syncResult.totalUpdated,
			totalSkipped: syncResult.totalSkipped,
				translateRequested,
				translateSuccess,
				translateFailed,
				completedRounds,
				readingProcessed: readingResult.processed,
				readingCreated: readingResult.created,
				readingFailed: readingResult.failed,
				readingSkipped: readingResult.skipped,
				totalMs: Date.now() - startedAt,
			});
	} catch (error) {
		console.error("RSS cron failed", {
			cron: event.cron,
			error: String(error),
			totalMs: Date.now() - startedAt,
		});
		throw error;
	}
}
