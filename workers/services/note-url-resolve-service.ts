import type { Hono } from "hono";
import { fetchTagsForSingleNote } from "./note-relations-service";
import {
	buildExcerpt,
	buildTitle,
	getNoteById,
	syncNoteFtsContent,
} from "./note-query-service";
import {
	hydrateNoteBodyFromR2,
	resolveBodyStorageForUpdate,
} from "./note-storage-service";
import { jsonError, jsonOk } from "./common-service";
import { enqueueNoteIndexJob, scheduleIndexProcessing } from "./index-core-service";

const DEFAULT_JINA_READER_BASE_URL = "https://r.jina.ai";
const DEFAULT_JINA_READER_TIMEOUT_MS = 30_000;

type JinaReaderResponse = {
	title: string | null;
	markdown: string;
};

export function registerNoteUrlResolveRoutes(app: Hono<{ Bindings: Env }>): void {
	app.post("/api/notes/:id/resolve-url", async (c) => {
		const noteId = c.req.param("id");
		const existing = await getNoteById(c.env.DB, noteId);
		if (!existing || existing.deletedAt) {
			return jsonError(c, 404, "Note not found");
		}

		const hydrated = await hydrateNoteBodyFromR2(c.env, existing);
		const sourceUrl = extractSingleUrl(hydrated.bodyText ?? "");
		if (!sourceUrl) {
			return jsonError(c, 400, "Note body must contain exactly one http(s) URL");
		}

		let resolved: JinaReaderResponse | null = null;
		let fallbackReason: string | null = null;
		try {
			resolved = await fetchUrlMarkdownWithJina(c.env, sourceUrl);
		} catch (error) {
			fallbackReason = toErrorMessage(error);
		}

		if (!resolved) {
			const tags = await fetchTagsForSingleNote(c.env.DB, noteId);
			return jsonOk(c, {
				note: { ...hydrated, tags },
				resolved: false,
				sourceUrl,
				fallbackReason,
			});
		}

		let resolvedBody;
		try {
			resolvedBody = await resolveBodyStorageForUpdate(c.env, {
				noteId,
				requestedStorageType: hydrated.storageType,
				bodyTextInput: buildResolvedNoteBody(resolved.markdown, sourceUrl),
				bodyR2KeyInput: undefined,
				existing,
			});
		} catch (error) {
			return jsonError(c, 500, "Failed to resolve note body storage", String(error));
		}

		const nextTitle = resolved.title?.trim() || buildTitle(resolved.markdown) || hydrated.title;
		const nextExcerpt = buildExcerpt(resolvedBody.plainBodyText);

		await c.env.DB.prepare(
			`UPDATE notes
			 SET title = ?,
				 storage_type = ?,
				 body_text = ?,
				 body_r2_key = ?,
				 excerpt = ?,
				 size_bytes = ?,
				 word_count = ?
			 WHERE id = ?`,
		)
			.bind(
				nextTitle,
				resolvedBody.storageType,
				resolvedBody.bodyText,
				resolvedBody.bodyR2Key,
				nextExcerpt,
				resolvedBody.sizeBytes,
				resolvedBody.wordCount,
				noteId,
			)
			.run();

		await syncNoteFtsContent(c.env.DB, noteId, nextTitle, nextExcerpt, resolvedBody.plainBodyText);
		await enqueueNoteIndexJob(c.env.DB, noteId, existing.isArchived ? "delete" : "upsert");
		scheduleIndexProcessing(c, 1);

		const updated = await getNoteById(c.env.DB, noteId);
		const tags = await fetchTagsForSingleNote(c.env.DB, noteId);
		const updatedHydrated = updated ? await hydrateNoteBodyFromR2(c.env, updated) : null;
		if (!updatedHydrated) {
			return jsonError(c, 500, "Resolved note could not be reloaded");
		}

		return jsonOk(c, {
			note: { ...updatedHydrated, tags },
			resolved: true,
			sourceUrl,
			fallbackReason: null,
		});
	});
}

async function fetchUrlMarkdownWithJina(env: Env, sourceUrl: string): Promise<JinaReaderResponse> {
	const headers = new Headers({
		"Accept": "text/plain, text/markdown;q=0.9, application/json;q=0.5",
	});
	const apiKey = getJinaReaderApiKey(env);
	if (apiKey) {
		headers.set("Authorization", `Bearer ${apiKey}`);
	}

	const postResponse = await fetchTextWithTimeout(
		getJinaReaderBaseUrl(env),
		{
			method: "POST",
			headers: new Headers({
				...Object.fromEntries(headers.entries()),
				"Content-Type": "application/json",
			}),
			body: JSON.stringify({ url: sourceUrl }),
		},
		getJinaReaderTimeoutMs(env),
	).catch(() => "");
	const parsedFromPost = parseJinaReaderText(postResponse);
	if (parsedFromPost) {
		return parsedFromPost;
	}

	const candidates = buildJinaReaderGetUrls(getJinaReaderBaseUrl(env), sourceUrl);
	let lastError: Error | null = null;
	for (const candidate of candidates) {
		try {
			const getResponse = await fetchTextWithTimeout(
				candidate,
				{
					method: "GET",
					headers,
				},
				getJinaReaderTimeoutMs(env),
			);
			const parsed = parseJinaReaderText(getResponse);
			if (parsed) {
				return parsed;
			}
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
		}
	}
	throw lastError ?? new Error("Jina reader returned empty content");
}

function getJinaReaderBaseUrl(env: Env): string {
	const ext = env as Env & { JINA_READER_BASE_URL?: string };
	const configured = (ext.JINA_READER_BASE_URL ?? "").trim().replace(/\/+$/u, "");
	return configured || DEFAULT_JINA_READER_BASE_URL;
}

function getJinaReaderApiKey(env: Env): string {
	const ext = env as Env & { JINA_READER_API_KEY?: string };
	return (ext.JINA_READER_API_KEY ?? "").trim();
}

function getJinaReaderTimeoutMs(env: Env): number {
	const ext = env as Env & { JINA_READER_TIMEOUT_MS?: string };
	const parsed = Number(ext.JINA_READER_TIMEOUT_MS);
	if (Number.isFinite(parsed) && parsed >= 2000 && parsed <= 180_000) {
		return Math.trunc(parsed);
	}
	return DEFAULT_JINA_READER_TIMEOUT_MS;
}

function buildJinaReaderGetUrls(baseUrl: string, sourceUrl: string): string[] {
	const normalizedBase = baseUrl.replace(/\/+$/u, "");
	const protocolStripped = sourceUrl.replace(/^https?:\/\//iu, "");
	return [...new Set([
		`${normalizedBase}/${sourceUrl}`,
		`${normalizedBase}/http://${protocolStripped}`,
		`${normalizedBase}/https://${protocolStripped}`,
	])];
}

function parseJinaReaderText(raw: string): JinaReaderResponse | null {
	const normalized = raw.replace(/\r\n?/gu, "\n").trim();
	if (!normalized) {
		return null;
	}

	const lines = normalized.split("\n");
	let title: string | null = null;
	const filtered: string[] = [];
	let inMarkdownSection = false;

	for (const line of lines) {
		const trimmed = line.trim();
		const titleMatch = /^Title:\s*(.+)$/iu.exec(trimmed);
		if (titleMatch) {
			title = titleMatch[1]?.trim() || null;
			continue;
		}
		if (/^Markdown Content:\s*$/iu.test(trimmed)) {
			inMarkdownSection = true;
			continue;
		}
		if (!inMarkdownSection && isJinaMetadataLine(trimmed)) {
			continue;
		}
		filtered.push(line);
	}

	const markdown = filtered.join("\n").trim() || normalized;
	if (!markdown) {
		return null;
	}

	return {
		title,
		markdown,
	};
}

function isJinaMetadataLine(line: string): boolean {
	return /^(URL Source|Published Time|Description):/iu.test(line);
}

function buildResolvedNoteBody(markdown: string, sourceUrl: string): string {
	const normalizedMarkdown = markdown.trim();
	const lines = [normalizedMarkdown];
	if (!/^(Source|URL Source):\s+/imu.test(normalizedMarkdown)) {
		lines.push("", `Source: ${sourceUrl}`);
	}
	lines.push("Extractor: jina-reader");
	return lines.join("\n").trim();
}

function extractSingleUrl(input: string): string | null {
	const trimmed = input.trim();
	if (!trimmed || /\s/u.test(trimmed)) {
		return null;
	}
	try {
		const url = new URL(trimmed);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return null;
		}
		return url.toString();
	} catch {
		return null;
	}
}

async function fetchTextWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<string> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
	try {
		const response = await fetch(url, { ...init, signal: controller.signal });
		if (!response.ok) {
			const errorText = (await response.text().catch(() => "")).slice(0, 300);
			throw new Error(`Jina reader request failed: ${response.status} ${errorText}`.trim());
		}
		return response.text();
	} finally {
		clearTimeout(timer);
	}
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	return String(error);
}
