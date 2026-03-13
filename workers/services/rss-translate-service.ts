import { buildAiChatRuntime, callSiliconflowJson, getAiTaskTimeoutMs } from "./ai-provider-service";
import { isRecord } from "./common-service";

const DEFAULT_RSS_TRANSLATE_MAX_CHARS = 1600;
const DEFAULT_RSS_READING_TRANSLATE_CHUNK_CHARS = 3200;
const DEFAULT_RSS_READING_TRANSLATE_MAX_CHUNKS = 8;
const DEFAULT_RSS_READING_TRANSLATE_TIMEOUT_MS = 180_000;
const DEFAULT_RSS_READING_TRANSLATE_CHUNK_TIMEOUT_MS = 30_000;
const DEFAULT_RSS_TENCENT_TRANSLATE_TIMEOUT_MS = 10_000;
const DEFAULT_RSS_TENCENT_TRANSLATE_REGION = "ap-beijing";
const DEFAULT_RSS_TENCENT_TRANSLATE_SOURCE = "auto";
const DEFAULT_RSS_TENCENT_TRANSLATE_TARGET = "zh";
const TENCENT_TRANSLATE_ENDPOINT = "https://tmt.tencentcloudapi.com";
const TENCENT_TRANSLATE_HOST = "tmt.tencentcloudapi.com";
const TENCENT_TRANSLATE_ACTION = "TextTranslate";
const TENCENT_TRANSLATE_VERSION = "2018-03-21";
const TENCENT_TRANSLATE_SERVICE = "tmt";
const TENCENT_SIGNATURE_ALGORITHM = "TC3-HMAC-SHA256";

export function getRssTranslateMaxChars(env: Env): number {
	const ext = env as Env & { RSS_TRANSLATE_MAX_CHARS?: string };
	const parsed = Number(ext.RSS_TRANSLATE_MAX_CHARS);
	if (Number.isFinite(parsed) && parsed >= 200 && parsed <= 5000) {
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
	try {
		const translatedSummary = await translateSummaryWithTencent(env, normalized);
		return translatedSummary || normalized;
	} catch (error) {
		console.error("RSS summary translation failed, fallback to original summary", error);
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

function getRssTencentTranslateTimeoutMs(env: Env): number {
	const ext = env as Env & { RSS_TENCENT_TRANSLATE_TIMEOUT_MS?: string };
	const parsed = Number(ext.RSS_TENCENT_TRANSLATE_TIMEOUT_MS);
	if (Number.isFinite(parsed) && parsed >= 1000 && parsed <= 120_000) {
		return Math.trunc(parsed);
	}
	return DEFAULT_RSS_TENCENT_TRANSLATE_TIMEOUT_MS;
}

function readTencentTranslateRuntime(env: Env): {
	secretId: string;
	secretKey: string;
	region: string;
	sourceLang: string;
	targetLang: string;
	projectId: number;
} | null {
	const ext = env as Env & {
		TENCENT_SECRET_ID?: string;
		TENCENT_SECRET_KEY?: string;
		RSS_TENCENT_TRANSLATE_REGION?: string;
		RSS_TENCENT_TRANSLATE_SOURCE?: string;
		RSS_TENCENT_TRANSLATE_TARGET?: string;
		RSS_TENCENT_TRANSLATE_PROJECT_ID?: string;
	};
	const secretId = (ext.TENCENT_SECRET_ID ?? "").trim();
	const secretKey = (ext.TENCENT_SECRET_KEY ?? "").trim();
	if (!secretId || !secretKey) {
		return null;
	}
	const region = (ext.RSS_TENCENT_TRANSLATE_REGION ?? DEFAULT_RSS_TENCENT_TRANSLATE_REGION).trim();
	const sourceLang = (ext.RSS_TENCENT_TRANSLATE_SOURCE ?? DEFAULT_RSS_TENCENT_TRANSLATE_SOURCE).trim();
	const targetLang = (ext.RSS_TENCENT_TRANSLATE_TARGET ?? DEFAULT_RSS_TENCENT_TRANSLATE_TARGET).trim();
	const projectIdParsed = Number(ext.RSS_TENCENT_TRANSLATE_PROJECT_ID);
	return {
		secretId,
		secretKey,
		region: region || DEFAULT_RSS_TENCENT_TRANSLATE_REGION,
		sourceLang: sourceLang || DEFAULT_RSS_TENCENT_TRANSLATE_SOURCE,
		targetLang: targetLang || DEFAULT_RSS_TENCENT_TRANSLATE_TARGET,
		projectId: Number.isFinite(projectIdParsed) ? Math.max(0, Math.trunc(projectIdParsed)) : 0,
	};
}

async function translateSummaryWithTencent(env: Env, summary: string): Promise<string> {
	const runtime = readTencentTranslateRuntime(env);
	if (!runtime) {
		return summary;
	}
	const sourceText = summary.slice(0, getRssTranslateMaxChars(env));
	const requestBody = JSON.stringify({
		SourceText: sourceText,
		Source: runtime.sourceLang,
		Target: runtime.targetLang,
		ProjectId: runtime.projectId,
	});
	const timestamp = Math.floor(Date.now() / 1000);
	const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
	const authorization = await buildTencentAuthorization({
		secretId: runtime.secretId,
		secretKey: runtime.secretKey,
		timestamp,
		date,
		service: TENCENT_TRANSLATE_SERVICE,
		host: TENCENT_TRANSLATE_HOST,
		action: TENCENT_TRANSLATE_ACTION,
		payload: requestBody,
	});
	const controller = new AbortController();
	const timeoutMs = getRssTencentTranslateTimeoutMs(env);
	const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
	const startedAt = Date.now();
	let response: Response;
	try {
		response = await fetch(TENCENT_TRANSLATE_ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/json; charset=utf-8",
				"Host": TENCENT_TRANSLATE_HOST,
				"X-TC-Action": TENCENT_TRANSLATE_ACTION,
				"X-TC-Version": TENCENT_TRANSLATE_VERSION,
				"X-TC-Region": runtime.region,
				"X-TC-Timestamp": String(timestamp),
				"Authorization": authorization,
			},
			body: requestBody,
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timer);
	}
	if (!response.ok) {
		const errorText = (await response.text().catch(() => "")).slice(0, 500);
		throw new Error(`Tencent translate request failed: ${response.status} ${errorText}`);
	}
	const payload = await response.json<unknown>();
	if (!isRecord(payload) || !isRecord(payload.Response)) {
		throw new Error("Tencent translate response payload is invalid");
	}
	const responseBody = payload.Response;
	if (isRecord(responseBody.Error)) {
		const code = readStringField(responseBody.Error, "Code");
		const message = readStringField(responseBody.Error, "Message");
		throw new Error(`Tencent translate API error: ${code || "unknown_code"} ${message || "unknown_message"}`.trim());
	}
	const targetText = readStringField(responseBody, "TargetText");
	if (!targetText) {
		throw new Error("Tencent translate response missing TargetText");
	}
	console.info("RSS summary translated via tencent", {
		charCount: sourceText.length,
		region: runtime.region,
		totalMs: Date.now() - startedAt,
	});
	return targetText;
}

async function buildTencentAuthorization(input: {
	secretId: string;
	secretKey: string;
	timestamp: number;
	date: string;
	service: string;
	host: string;
	action: string;
	payload: string;
}): Promise<string> {
	const actionLower = input.action.toLowerCase();
	const hashedPayload = await sha256Hex(input.payload);
	const canonicalRequest = [
		"POST",
		"/",
		"",
		`content-type:application/json; charset=utf-8\nhost:${input.host}\nx-tc-action:${actionLower}\n`,
		"content-type;host;x-tc-action",
		hashedPayload,
	].join("\n");
	const credentialScope = `${input.date}/${input.service}/tc3_request`;
	const hashedCanonicalRequest = await sha256Hex(canonicalRequest);
	const stringToSign = [
		TENCENT_SIGNATURE_ALGORITHM,
		String(input.timestamp),
		credentialScope,
		hashedCanonicalRequest,
	].join("\n");
	const secretDate = await hmacSha256(`TC3${input.secretKey}`, input.date);
	const secretService = await hmacSha256(secretDate, input.service);
	const secretSigning = await hmacSha256(secretService, "tc3_request");
	const signature = toHex(new Uint8Array(await hmacSha256(secretSigning, stringToSign)));
	return `${TENCENT_SIGNATURE_ALGORITHM} Credential=${input.secretId}/${credentialScope}, SignedHeaders=content-type;host;x-tc-action, Signature=${signature}`;
}

async function sha256Hex(content: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
	return toHex(new Uint8Array(digest));
}

async function hmacSha256(key: string | BufferSource, message: string): Promise<ArrayBuffer> {
	const keyData = typeof key === "string" ? new TextEncoder().encode(key) : key;
	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		keyData,
		{
			name: "HMAC",
			hash: "SHA-256",
		},
		false,
		["sign"],
	);
	return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
}

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
