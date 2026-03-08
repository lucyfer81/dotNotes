import { NodeHtmlMarkdown } from "node-html-markdown";
import type { ParsedRssFeed, ParsedRssItem } from "./rss-types";

const DEFAULT_RSS_FETCH_TIMEOUT_MS = 20_000;
const summaryMarkdownConverter = new NodeHtmlMarkdown({
	bulletMarker: "-",
	emDelimiter: "*",
	strongDelimiter: "**",
	codeBlockStyle: "fenced",
	maxConsecutiveNewlines: 2,
	preferNativeParser: false,
});

export function getRssFetchTimeoutMs(env: Env): number {
	const ext = env as Env & { RSS_FETCH_TIMEOUT_MS?: string };
	const parsed = Number(ext.RSS_FETCH_TIMEOUT_MS);
	if (Number.isFinite(parsed) && parsed >= 1000 && parsed <= 120_000) {
		return Math.trunc(parsed);
	}
	return DEFAULT_RSS_FETCH_TIMEOUT_MS;
}

export async function fetchAndParseRssFeed(env: Env, feedUrl: string): Promise<ParsedRssFeed> {
	const timeoutMs = getRssFetchTimeoutMs(env);
	const startedAt = Date.now();
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
	const response = await fetch(feedUrl, {
		method: "GET",
		headers: {
			"Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
			"User-Agent": "dotnotes-rss-worker/1.0",
		},
		signal: controller.signal,
	}).finally(() => {
		clearTimeout(timer);
	});
	if (!response.ok) {
		const errorText = (await response.text()).slice(0, 500);
		throw new Error(`RSS fetch failed: ${response.status} ${errorText}`);
	}
	const xml = await response.text();
	const parsed = parseRssOrAtom(xml);
	console.info("RSS fetch timing", {
		url: feedUrl,
		statusCode: response.status,
		itemCount: parsed.items.length,
		totalMs: Date.now() - startedAt,
	});
	return parsed;
}

export function parseRssOrAtom(xml: string): ParsedRssFeed {
	const text = xml.trim();
	if (!text) {
		return { title: null, items: [] };
	}
	if (/<feed[\s>]/i.test(text)) {
		return parseAtom(text);
	}
	return parseRss(text);
}

function parseRss(xml: string): ParsedRssFeed {
	const channelBlock = matchFirstBlock(xml, "channel");
	const feedTitle = normalizeText(extractTagValue(channelBlock ?? xml, "title"));
	const itemBlocks = collectBlocks(channelBlock ?? xml, "item");
	const items = itemBlocks.map((block) => parseRssItemBlock(block))
		.filter((item) => hasRssItemIdentity(item));
	return {
		title: feedTitle || null,
		items,
	};
}

function parseRssItemBlock(block: string): ParsedRssItem {
	const sourceId = normalizeText(extractTagValue(block, "guid")) || null;
	const link = normalizeUrl(extractTagValue(block, "link"));
	const title = normalizeText(extractTagValue(block, "title")) || null;
	const author = normalizeText(
		extractTagValue(block, "author") ||
		extractTagValue(block, "dc:creator"),
	) || null;
	const publishedAt = parseDateToIso(
		extractTagValue(block, "pubDate") ||
		extractTagValue(block, "published") ||
		extractTagValue(block, "updated"),
	);
	const summary = normalizeSummaryMarkdown(
		extractTagValueRaw(block, "description") ||
		extractTagValueRaw(block, "content:encoded") ||
		extractTagValueRaw(block, "summary"),
	);
	return {
		sourceId,
		link,
		title,
		author,
		publishedAt,
		summary,
	};
}

function parseAtom(xml: string): ParsedRssFeed {
	const feedBlock = matchFirstBlock(xml, "feed") ?? xml;
	const feedTitle = normalizeText(extractTagValue(feedBlock, "title"));
	const entryBlocks = collectBlocks(feedBlock, "entry");
	const items = entryBlocks.map((block) => parseAtomEntryBlock(block))
		.filter((item) => hasRssItemIdentity(item));
	return {
		title: feedTitle || null,
		items,
	};
}

function parseAtomEntryBlock(block: string): ParsedRssItem {
	const sourceId = normalizeText(extractTagValue(block, "id")) || null;
	const link = extractAtomLink(block);
	const title = normalizeText(extractTagValue(block, "title")) || null;
	const author = normalizeText(extractTagValue(matchFirstBlock(block, "author") ?? "", "name")) || null;
	const publishedAt = parseDateToIso(
		extractTagValue(block, "published") ||
		extractTagValue(block, "updated"),
	);
	const summary = normalizeSummaryMarkdown(
		extractTagValueRaw(block, "summary") ||
		extractTagValueRaw(block, "content"),
	);
	return {
		sourceId,
		link,
		title,
		author,
		publishedAt,
		summary,
	};
}

function hasRssItemIdentity(item: ParsedRssItem): boolean {
	return Boolean(item.sourceId || item.link || item.title || item.summary);
}

function matchFirstBlock(xml: string, tag: string): string | null {
	const escaped = escapeRegex(tag);
	const regex = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i");
	const matched = regex.exec(xml);
	return matched?.[1] ?? null;
}

function collectBlocks(xml: string, tag: string): string[] {
	const escaped = escapeRegex(tag);
	const regex = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "gi");
	const output: string[] = [];
	let matched: RegExpExecArray | null = regex.exec(xml);
	while (matched) {
		output.push(matched[1] ?? "");
		matched = regex.exec(xml);
	}
	return output;
}

function extractTagValue(xml: string, tag: string): string {
	return stripHtmlTags(extractTagValueRaw(xml, tag));
}

function extractTagValueRaw(xml: string, tag: string): string {
	const escaped = escapeRegex(tag);
	const regex = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i");
	const matched = regex.exec(xml);
	if (!matched || !matched[1]) {
		return "";
	}
	return decodeXmlEntities(unwrapCdata(matched[1]));
}

function extractAtomLink(entryXml: string): string | null {
	const linkRegex = /<link\b([^>]*)\/?>/gi;
	let alternateHref: string | null = null;
	let fallbackHref: string | null = null;
	let matched: RegExpExecArray | null = linkRegex.exec(entryXml);
	while (matched) {
		const attrs = matched[1] ?? "";
		const href = readAttribute(attrs, "href");
		if (!href) {
			matched = linkRegex.exec(entryXml);
			continue;
		}
		const rel = (readAttribute(attrs, "rel") ?? "").toLowerCase();
		if (!fallbackHref) {
			fallbackHref = href;
		}
		if (!rel || rel === "alternate") {
			alternateHref = href;
			break;
		}
		matched = linkRegex.exec(entryXml);
	}
	return normalizeUrl(alternateHref ?? fallbackHref);
}

function readAttribute(attrs: string, key: string): string | null {
	const escaped = escapeRegex(key);
	const regex = new RegExp(`${escaped}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
	const matched = regex.exec(attrs);
	if (!matched) {
		return null;
	}
	return normalizeText(decodeXmlEntities(matched[2] ?? matched[3] ?? "")) || null;
}

function normalizeUrl(value: string | null | undefined): string | null {
	const cleaned = normalizeText(value);
	if (!cleaned) {
		return null;
	}
	return cleaned;
}

function parseDateToIso(value: string): string | null {
	const cleaned = normalizeText(value);
	if (!cleaned) {
		return null;
	}
	const timestamp = Date.parse(cleaned);
	if (!Number.isFinite(timestamp)) {
		return null;
	}
	return new Date(timestamp).toISOString();
}

function normalizeText(value: string | null | undefined): string {
	return (value ?? "").replace(/\s+/gu, " ").trim();
}

function stripHtmlTags(value: string): string {
	return value
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<[^>]+>/g, " ");
}

function unwrapCdata(value: string): string {
	return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1");
}

function normalizeSummaryMarkdown(value: string): string {
	const source = value.trim();
	if (!source) {
		return "";
	}
	const markdown = summaryMarkdownConverter.translate(source.replace(/\r\n?/g, "\n"));
	const text = markdown
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n[ \t]+/g, "\n")
		.replace(/\n{3,}/g, "\n\n");

	const lines = text
		.split("\n")
		.map((line) => line.trimEnd());
	return lines.join("\n").trim();
}

function decodeXmlEntities(value: string): string {
	return value
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, "\"")
		.replace(/&#39;/g, "'")
		.replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
		.replace(/&#([0-9]+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)));
}

function escapeRegex(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
