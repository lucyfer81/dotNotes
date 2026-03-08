import { NodeHtmlMarkdown } from "node-html-markdown";
import { isRecord } from "./common-service";

const DEFAULT_RSS_READING_FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_RSS_READING_MAX_CHARS = 40_000;
const markdownConverter = new NodeHtmlMarkdown({
	bulletMarker: "-",
	emDelimiter: "*",
	strongDelimiter: "**",
	codeBlockStyle: "fenced",
	maxConsecutiveNewlines: 2,
	preferNativeParser: false,
});

export function getRssReadingFetchTimeoutMs(env: Env): number {
	const ext = env as Env & { RSS_READING_FETCH_TIMEOUT_MS?: string };
	const parsed = Number(ext.RSS_READING_FETCH_TIMEOUT_MS);
	if (Number.isFinite(parsed) && parsed >= 2000 && parsed <= 180_000) {
		return Math.trunc(parsed);
	}
	return DEFAULT_RSS_READING_FETCH_TIMEOUT_MS;
}

export function getRssReadingMaxChars(env: Env): number {
	const ext = env as Env & { RSS_READING_MAX_CHARS?: string };
	const parsed = Number(ext.RSS_READING_MAX_CHARS);
	if (Number.isFinite(parsed) && parsed >= 2000 && parsed <= 200_000) {
		return Math.trunc(parsed);
	}
	return DEFAULT_RSS_READING_MAX_CHARS;
}

export function getRssReadingUseBrowserRendering(env: Env): boolean {
	const ext = env as Env & { RSS_READING_USE_BROWSER_RENDERING?: string };
	const normalized = (ext.RSS_READING_USE_BROWSER_RENDERING ?? "").trim().toLowerCase();
	if (!normalized) {
		return true;
	}
	return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

type BrowserAuth = {
	accountId: string;
	token: string;
};

function readBrowserRenderingAuth(env: Env): BrowserAuth | null {
	const ext = env as Env & {
		BROWSER_RENDER_ACCOUNT_ID?: string;
		CLOUDFLARE_ACCOUNT_ID?: string;
		CF_ACCOUNT_ID?: string;
		BROWSER_RENDER_API_TOKEN?: string;
		CLOUDFLARE_API_TOKEN?: string;
	};
	const accountId = (
		ext.BROWSER_RENDER_ACCOUNT_ID
		|| ext.CLOUDFLARE_ACCOUNT_ID
		|| ext.CF_ACCOUNT_ID
		|| ""
	).trim();
	const token = (
		ext.BROWSER_RENDER_API_TOKEN
		|| ext.CLOUDFLARE_API_TOKEN
		|| ""
	).trim();
	if (!accountId || !token) {
		return null;
	}
	return { accountId, token };
}

export async function fetchRssArticleMarkdown(
	env: Env,
	url: string,
): Promise<{ markdown: string; source: "browser-rendering" | "direct-fetch" }> {
	const normalizedUrl = url.trim();
	if (!normalizedUrl) {
		throw new Error("Article URL is empty");
	}
	if (getRssReadingUseBrowserRendering(env)) {
		const auth = readBrowserRenderingAuth(env);
		if (auth) {
			try {
				const markdown = await fetchMarkdownWithBrowserRendering(env, auth, normalizedUrl);
				if (markdown.trim().length > 0) {
					return {
						markdown,
						source: "browser-rendering",
					};
				}
			} catch (error) {
				console.error("Browser rendering markdown fetch failed", { url: normalizedUrl, error: String(error) });
			}
		}
	}
	const markdown = await fetchMarkdownWithDirectRequest(env, normalizedUrl);
	return {
		markdown,
		source: "direct-fetch",
	};
}

async function fetchMarkdownWithBrowserRendering(env: Env, auth: BrowserAuth, url: string): Promise<string> {
	const endpoint = `https://api.cloudflare.com/client/v4/accounts/${auth.accountId}/browser-rendering/markdown?cacheTTL=0`;
	const payload = await fetchJsonWithTimeout(
		endpoint,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Authorization": `Bearer ${auth.token}`,
			},
			body: JSON.stringify({ url }),
		},
		getRssReadingFetchTimeoutMs(env),
	);
	if (!isRecord(payload)) {
		throw new Error("Invalid browser rendering response");
	}
	if ("success" in payload && payload.success !== true) {
		const errorText = readApiErrorText(payload);
		throw new Error(`Browser rendering request failed: ${errorText || "unknown_error"}`);
	}
	const markdown = extractBrowserRenderingMarkdown(payload).trim();
	if (!markdown) {
		throw new Error("Browser rendering returned empty markdown");
	}
	return limitText(markdown, getRssReadingMaxChars(env));
}

async function fetchMarkdownWithDirectRequest(env: Env, url: string): Promise<string> {
	const response = await fetchWithTimeout(
		url,
		{
			method: "GET",
			headers: {
				"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				"User-Agent": "dotnotes-rss-reading-worker/1.0",
			},
		},
		getRssReadingFetchTimeoutMs(env),
	);
	if (!response.ok) {
		const errorText = (await response.text().catch(() => "")).slice(0, 500);
		throw new Error(`Direct article fetch failed: ${response.status} ${errorText}`);
	}
	const html = await response.text();
	const content = extractMainHtmlBlock(html);
	const markdown = markdownConverter.translate(content.replace(/\r\n?/g, "\n"));
	const normalized = markdown
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n[ \t]+/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	if (!normalized) {
		throw new Error("Direct article extraction returned empty markdown");
	}
	return limitText(normalized, getRssReadingMaxChars(env));
}

function extractBrowserRenderingMarkdown(payload: Record<string, unknown>): string {
	if (typeof payload.result === "string") {
		return payload.result;
	}
	if (isRecord(payload.result) && typeof payload.result.markdown === "string") {
		return payload.result.markdown;
	}
	if (typeof payload.markdown === "string") {
		return payload.markdown;
	}
	if (isRecord(payload.data) && typeof payload.data.markdown === "string") {
		return payload.data.markdown;
	}
	return "";
}

function readApiErrorText(payload: Record<string, unknown>): string {
	const errors = payload.errors;
	if (Array.isArray(errors) && errors.length > 0) {
		const first = errors[0];
		if (isRecord(first) && typeof first.message === "string") {
			return first.message;
		}
		return String(first);
	}
	if (typeof payload.error === "string") {
		return payload.error;
	}
	return "";
}

function extractMainHtmlBlock(html: string): string {
	const sanitized = html
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
	const article = matchTagContent(sanitized, "article");
	if (article) {
		return article;
	}
	const main = matchTagContent(sanitized, "main");
	if (main) {
		return main;
	}
	const body = matchTagContent(sanitized, "body");
	if (body) {
		return body;
	}
	return sanitized;
}

function matchTagContent(html: string, tagName: string): string | null {
	const escaped = escapeRegex(tagName);
	const pattern = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i");
	const matched = pattern.exec(html);
	return matched?.[1] ?? null;
}

function escapeRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function limitText(text: string, maxChars: number): string {
	if (text.length <= maxChars) {
		return text;
	}
	return `${text.slice(0, maxChars).trim()}\n\n[Truncated]`;
}

async function fetchJsonWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
	const response = await fetchWithTimeout(url, init, timeoutMs);
	const payload = await response.json().catch(() => null);
	if (!response.ok) {
		throw new Error(`Request failed: ${response.status}`);
	}
	return payload;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}
