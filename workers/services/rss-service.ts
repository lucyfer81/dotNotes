import type { Hono } from "hono";
import {
	clampInt,
	jsonError,
	jsonOk,
	parseBooleanLike,
	parseObjectBody,
	readOptionalNumber,
	readOptionalString,
	readRequiredString,
} from "./common-service";
import {
	createRssFeed,
	deleteRssFeed,
	ensureRssSchema,
	getRssFeedById,
	listRssFeeds,
	listRssItems,
	updateRssFeed,
	updateRssItemStatus,
} from "./rss-feed-service";
import {
	getRssSyncFeedLimit,
	getRssSyncItemLimit,
	getRssSyncTranslateBudget,
	processQueuedRssReadingItems,
	getRssTranslatePassLimit,
	saveRssItemToReading,
	syncRssFeeds,
	translatePendingRssItems,
} from "./rss-digest-service";
import type { RssItemStatus } from "./rss-types";

function parseRssItemStatus(value: string | null): RssItemStatus | null {
	if (value === "new" || value === "saved" || value === "ignored") {
		return value;
	}
	return null;
}

export function registerRssRoutes(app: Hono<{ Bindings: Env }>): void {
	app.get("/api/rss/feeds", async (c) => {
		await ensureRssSchema(c.env.DB);
		const feeds = await listRssFeeds(c.env.DB);
		return jsonOk(c, feeds);
	});

	app.post("/api/rss/feeds", async (c) => {
		const payload = await parseObjectBody(c);
		if (!payload) {
			return jsonError(c, 400, "Invalid JSON body");
		}
		await ensureRssSchema(c.env.DB);
		const url = readRequiredString(payload, "url");
		if (!url) {
			return jsonError(c, 400, "`url` is required");
		}
		const title = readOptionalString(payload, "title");
		const enabled = payload.enabled === undefined ? true : parseBooleanLike(payload.enabled);
		const created = await createRssFeed(c.env.DB, {
			id: readOptionalString(payload, "id") ?? crypto.randomUUID(),
			url,
			title,
			enabled,
		}).catch((error) => {
			console.error("Create rss feed failed", error);
			return null;
		});
		if (!created) {
			return jsonError(c, 409, "Failed to create rss feed, maybe duplicated url");
		}
		return jsonOk(c, created, 201);
	});

	app.patch("/api/rss/feeds/:id", async (c) => {
		const feedId = c.req.param("id");
		const payload = await parseObjectBody(c);
		if (!payload) {
			return jsonError(c, 400, "Invalid JSON body");
		}
		await ensureRssSchema(c.env.DB);
		const existing = await getRssFeedById(c.env.DB, feedId);
		if (!existing) {
			return jsonError(c, 404, "RSS feed not found");
		}
		const updated = await updateRssFeed(c.env.DB, feedId, {
			url: readOptionalString(payload, "url") ?? undefined,
			title: payload.title === null ? null : (readOptionalString(payload, "title") ?? undefined),
			enabled: payload.enabled === undefined ? undefined : parseBooleanLike(payload.enabled),
		}).catch((error) => {
			console.error("Update rss feed failed", error);
			return null;
		});
		if (!updated) {
			return jsonError(c, 409, "Failed to update rss feed");
		}
		return jsonOk(c, updated);
	});

	app.delete("/api/rss/feeds/:id", async (c) => {
		const feedId = c.req.param("id");
		await ensureRssSchema(c.env.DB);
		const deleted = await deleteRssFeed(c.env.DB, feedId);
		if (!deleted) {
			return jsonError(c, 404, "RSS feed not found");
		}
		return jsonOk(c, { id: feedId, deleted: true });
	});

	app.get("/api/rss/items", async (c) => {
		await ensureRssSchema(c.env.DB);
		const feedId = c.req.query("feedId") ?? null;
		const status = c.req.query("status") ?? null;
		const limit = clampInt(c.req.query("limit"), 50, 1, 200);
		const offset = clampInt(c.req.query("offset"), 0, 0, 5000);
		const items = await listRssItems(c.env.DB, {
			feedId,
			statusCsv: status,
			limit,
			offset,
		});
		return jsonOk(c, {
			items,
			paging: {
				limit,
				offset,
				count: items.length,
			},
		});
	});

	app.patch("/api/rss/items/:id", async (c) => {
		const itemId = c.req.param("id");
		const payload = await parseObjectBody(c);
		if (!payload) {
			return jsonError(c, 400, "Invalid JSON body");
		}
		await ensureRssSchema(c.env.DB);
		const status = parseRssItemStatus(readOptionalString(payload, "status"));
		if (!status) {
			return jsonError(c, 400, "`status` must be one of: new, saved, ignored");
		}
		const updated = await updateRssItemStatus(c.env.DB, itemId, status);
		if (!updated) {
			return jsonError(c, 404, "RSS item not found");
		}
		return jsonOk(c, { id: itemId, status });
	});

	app.post("/api/rss/sync", async (c) => {
		const payload = (await parseObjectBody(c)) ?? {};
		await ensureRssSchema(c.env.DB);
		const inputFeedLimit = readOptionalNumber(payload, "feedLimit");
		const feedLimit = clampInt(
			inputFeedLimit === null ? undefined : String(inputFeedLimit),
			getRssSyncFeedLimit(c.env),
			1,
			200,
		);
		const inputItemLimit = readOptionalNumber(payload, "itemLimit");
		const itemLimit = clampInt(
			inputItemLimit === null ? undefined : String(inputItemLimit),
			getRssSyncItemLimit(c.env),
			1,
			200,
		);
		const inputTranslateBudget = readOptionalNumber(payload, "translateBudget");
		const translateBudget = clampInt(
			inputTranslateBudget === null ? undefined : String(inputTranslateBudget),
			getRssSyncTranslateBudget(c.env),
			0,
			100,
		);
		const feedId = readOptionalString(payload, "feedId");
		const translate = payload.translate === undefined ? undefined : parseBooleanLike(payload.translate);
		const synced = await syncRssFeeds(c.env, {
			feedId,
			feedLimit,
			itemLimit,
			translate,
			translateBudget,
		});
		return jsonOk(c, synced);
	});

	app.post("/api/rss/translate", async (c) => {
		const payload = (await parseObjectBody(c)) ?? {};
		await ensureRssSchema(c.env.DB);
		const inputLimit = readOptionalNumber(payload, "limit");
		const limit = clampInt(
			inputLimit === null ? undefined : String(inputLimit),
			getRssTranslatePassLimit(c.env),
			1,
			200,
		);
		const translated = await translatePendingRssItems(c.env, {
			feedId: readOptionalString(payload, "feedId"),
			limit,
		});
		return jsonOk(c, translated);
	});

	app.post("/api/rss/items/:id/save", async (c) => {
		const itemId = c.req.param("id");
		await ensureRssSchema(c.env.DB);
		try {
			const saved = await saveRssItemToReading(c.env, itemId);
			return jsonOk(c, saved);
		} catch (error) {
			const message = String(error);
			if (message.includes("not found")) {
				return jsonError(c, 404, "RSS item not found");
			}
			console.error("Save rss item failed", error);
			return jsonError(c, 500, "Failed to save rss item");
		}
	});

	app.post("/api/rss/reading/process", async (c) => {
		await ensureRssSchema(c.env.DB);
		const payload = (await parseObjectBody(c)) ?? {};
		const limitInput = readOptionalNumber(payload, "limit");
		const limit = clampInt(
			limitInput === null ? undefined : String(limitInput),
			3,
			1,
			100,
		);
		const itemId = readOptionalString(payload, "itemId");
		const result = await processQueuedRssReadingItems(c.env, {
			limit,
			itemId,
		});
		return jsonOk(c, result);
	});
}
