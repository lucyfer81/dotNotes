import { buildAiChatRuntime, callSiliconflowJson, getAiTaskTimeoutMs } from "./ai-provider-service";
import { isRecord } from "./common-service";

const DEFAULT_RSS_TRANSLATE_MAX_CHARS = 1600;
const DEFAULT_RSS_READING_TRANSLATE_CHUNK_CHARS = 3200;
const DEFAULT_RSS_READING_TRANSLATE_MAX_CHUNKS = 8;
const DEFAULT_RSS_READING_TRANSLATE_TIMEOUT_MS = 180_000;
const DEFAULT_RSS_READING_TRANSLATE_CHUNK_TIMEOUT_MS = 30_000;

export function getRssTranslateMaxChars(env: Env): number {
	const ext = env as Env & { RSS_TRANSLATE_MAX_CHARS?: string };
	const parsed = Number(ext.RSS_TRANSLATE_MAX_CHARS);
	if (Number.isFinite(parsed) && parsed >= 200 && parsed <= 6000) {
		return Math.trunc(parsed);
	}
	return DEFAULT_RSS_TRANSLATE_MAX_CHARS;
}

export function getRssTranslateEnabled(env: Env): boolean {
	const ext = env as Env & { RSS_TRANSLATE_ENABLED?: string };
	const value = typeof ext.RSS_TRANSLATE_ENABLED === "string" ? ext.RSS_TRANSLATE_ENABLED.trim().toLowerCase() : "";
	if (!value) {
		return false;
	}
	return value === "1" || value === "true" || value === "yes";
}

export function getRssReadingTranslateChunkChars(env: Env): number {
	const ext = env as Env & { RSS_READING_TRANSLATE_CHUNK_CHARS?: string };
	const parsed = Number(ext.RSS_READING_TRANSLATE_CHUNK_CHARS);
	if (Number.isFinite(parsed) && parsed >= 500 && parsed <= 10_000) {
		return Math.trunc(parsed);
	}
	return DEFAULT_RSS_READING_TRANSLATE_CHUNK_CHARS;
}

export function getRssReadingTranslateMaxChunks(env: Env): number {
	const ext = env as Env & { RSS_READING_TRANSLATE_MAX_CHUNKS?: string };
	const parsed = Number(ext.RSS_READING_TRANSLATE_MAX_CHUNKS);
	if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 200) {
		return Math.trunc(parsed);
	}
	return DEFAULT_RSS_READING_TRANSLATE_MAX_CHUNKS;
}

export function getRssReadingTranslateTimeoutMs(env: Env): number {
	const ext = env as Env & { RSS_READING_TRANSLATE_TIMEOUT_MS?: string };
	const parsed = Number(ext.RSS_READING_TRANSLATE_TIMEOUT_MS);
	if (Number.isFinite(parsed) && parsed >= 10_000 && parsed <= 600_000) {
		return Math.trunc(parsed);
	}
	return DEFAULT_RSS_READING_TRANSLATE_TIMEOUT_MS;
}

export function getRssReadingTranslateChunkTimeoutMs(env: Env): number {
	const ext = env as Env & { RSS_READING_TRANSLATE_CHUNK_TIMEOUT_MS?: string };
	const parsed = Number(ext.RSS_READING_TRANSLATE_CHUNK_TIMEOUT_MS);
	if (Number.isFinite(parsed) && parsed >= 3000 && parsed <= 120_000) {
		return Math.trunc(parsed);
	}
	return DEFAULT_RSS_READING_TRANSLATE_CHUNK_TIMEOUT_MS;
}

export async function translateSummaryToChinese(env: Env, rawText: string): Promise<string> {
	const normalized = rawText.replace(/\s+/gu, " ").trim();
	if (!normalized) {
		return "";
	}
	if (hasStrongChineseSignal(normalized)) {
		return normalized;
	}

	let runtime;
	try {
		runtime = buildAiChatRuntime(env);
	} catch {
		return normalized;
	}
	try {
		const maxChars = getRssTranslateMaxChars(env);
		const payload = await callSiliconflowJson(
			runtime,
			{
				systemPrompt: "You translate technical/news text into concise Simplified Chinese. Return strict JSON only.",
				userPrompt: [
					"Translate the text to Simplified Chinese.",
					"Keep names, numbers, and links accurate.",
					`Input text: ${JSON.stringify(normalized.slice(0, maxChars))}`,
					`Output schema: ${JSON.stringify({ translatedSummary: "string" })}`,
				].join("\n"),
			},
			{
				timeoutMs: getAiTaskTimeoutMs(env, "summary"),
				label: "rss:translate",
			},
		);
		if (!isRecord(payload)) {
			return normalized;
		}
		const translatedSummary = readStringField(payload, "translatedSummary")
			|| readStringField(payload, "translation")
			|| readStringField(payload, "translated")
			|| readStringField(payload, "summaryZh");
		return translatedSummary || normalized;
	} catch (error) {
		console.error("RSS translation failed, fallback to original summary", error);
		return normalized;
	}
}

export async function translateTextToChineseStrict(
	env: Env,
	rawText: string,
	options: {
		maxChars?: number;
		label?: string;
		preserveMarkdown?: boolean;
		timeoutMs?: number;
	} = {},
): Promise<string> {
	const normalized = rawText.replace(/\s+/gu, " ").trim();
	if (!normalized) {
		throw new Error("Text is empty");
	}
	if (hasStrongChineseSignal(normalized)) {
		return normalized;
	}
	const runtime = buildAiChatRuntime(env);
	const maxChars = options.maxChars ?? getRssTranslateMaxChars(env);
	const payload = await callSiliconflowJson(
		runtime,
		{
			systemPrompt: options.preserveMarkdown === false
				? "You translate text into concise Simplified Chinese. Return strict JSON only."
				: "You translate Markdown into natural Simplified Chinese. Keep Markdown structure, links, and code blocks unchanged. Return strict JSON only.",
			userPrompt: [
				"Translate the text to Simplified Chinese.",
				"Keep names, numbers, and links accurate.",
				`Input text: ${JSON.stringify(normalized.slice(0, maxChars))}`,
				`Output schema: ${JSON.stringify({ translatedText: "string" })}`,
			].join("\n"),
		},
		{
			timeoutMs: options.timeoutMs ?? getAiTaskTimeoutMs(env, "summary"),
			label: options.label ?? "rss:translate-strict",
		},
	);
	if (!isRecord(payload)) {
		throw new Error("Invalid translator response payload");
	}
	const translated = readStringField(payload, "translatedText")
		|| readStringField(payload, "translatedSummary")
		|| readStringField(payload, "translation")
		|| readStringField(payload, "translated")
		|| readStringField(payload, "summaryZh");
	if (!translated) {
		throw new Error("Translator output is empty");
	}
	return translated;
}

export async function translateLongTextToChineseStrict(
	env: Env,
	rawText: string,
	options: {
		chunkChars?: number;
		maxChunks?: number;
		label?: string;
		timeoutMs?: number;
		chunkTimeoutMs?: number;
	} = {},
): Promise<string> {
	const normalized = rawText
		.replace(/\r\n?/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	if (!normalized) {
		throw new Error("Text is empty");
	}
	if (hasStrongChineseSignal(normalized)) {
		return normalized;
	}
	const chunkChars = options.chunkChars ?? getRssReadingTranslateChunkChars(env);
	const maxChunks = options.maxChunks ?? getRssReadingTranslateMaxChunks(env);
	const timeoutMs = options.timeoutMs ?? getRssReadingTranslateTimeoutMs(env);
	const chunkTimeoutMs = options.chunkTimeoutMs ?? getRssReadingTranslateChunkTimeoutMs(env);
	const chunks = buildChunksByParagraph(normalized, chunkChars, maxChunks);
	const translatedChunks: string[] = [];
	const startedAt = Date.now();
	for (let index = 0; index < chunks.length; index += 1) {
		if (Date.now() - startedAt > timeoutMs) {
			throw new Error(`RSS reading translation timed out (${timeoutMs}ms)`);
		}
		const chunk = chunks[index];
		const translated = await translateTextToChineseStrict(env, chunk, {
			maxChars: chunkChars + 200,
			label: `${options.label ?? "rss:translate-reading"}#${index + 1}`,
			preserveMarkdown: true,
			timeoutMs: chunkTimeoutMs,
		});
		translatedChunks.push(translated);
	}
	return translatedChunks.join("\n\n").trim();
}

function buildChunksByParagraph(text: string, chunkChars: number, maxChunks: number): string[] {
	const paragraphs = text
		.split(/\n{2,}/u)
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
	const chunks: string[] = [];
	let current = "";
	for (const paragraph of paragraphs) {
		const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
		if (candidate.length <= chunkChars) {
			current = candidate;
			continue;
		}
		if (current) {
			chunks.push(current);
			current = "";
		}
		if (paragraph.length <= chunkChars) {
			current = paragraph;
			continue;
		}
		for (let start = 0; start < paragraph.length; start += chunkChars) {
			chunks.push(paragraph.slice(start, start + chunkChars).trim());
			if (chunks.length >= maxChunks) {
				return chunks;
			}
		}
	}
	if (current) {
		chunks.push(current);
	}
	if (chunks.length > maxChunks) {
		return chunks.slice(0, maxChunks);
	}
	return chunks;
}

function readStringField(payload: Record<string, unknown>, key: string): string {
	const value = payload[key];
	if (typeof value !== "string") {
		return "";
	}
	return value.trim();
}

function hasStrongChineseSignal(text: string): boolean {
	let cjkCount = 0;
	for (const ch of text) {
		const code = ch.codePointAt(0) ?? 0;
		if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)) {
			cjkCount += 1;
		}
	}
	return cjkCount >= Math.max(12, Math.floor(text.length * 0.2));
}
