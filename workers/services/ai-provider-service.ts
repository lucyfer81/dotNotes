import { getIndexEmbeddingModel } from "./note-query-service";
import type { AiEnhanceTaskKey } from "./ai-types";

const DEFAULT_AI_TIMEOUT_MS = 30_000;
const DEFAULT_AI_TIMEOUT_TITLE_MS = 60_000;
const DEFAULT_AI_TIMEOUT_TAGS_MS = 45_000;
const DEFAULT_AI_TIMEOUT_SUMMARY_MS = 60_000;
const DEFAULT_AI_MAX_INPUT_CHARS = 12_000;
const DEFAULT_AI_EMBED_TIMEOUT_MS = 12_000;
const DEFAULT_AI_EMBED_BATCH_SIZE = 8;
const DEFAULT_AI_EMBEDDING_MODEL = "Qwen/Qwen3-Embedding-0.6B";

export type AiChatRuntime = {
	baseUrl: string;
	model: string;
	apiKey: string;
	timeoutMs: number;
};

export function getAiBaseUrl(env: Env): string | null {
	const ext = env as Env & { AI_BASE_URL?: string };
	const value = typeof ext.AI_BASE_URL === "string" ? ext.AI_BASE_URL.trim() : "";
	return value || null;
}

export function getAiChatModel(env: Env): string | null {
	const ext = env as Env & { AI_CHAT_MODEL?: string };
	const value = typeof ext.AI_CHAT_MODEL === "string" ? ext.AI_CHAT_MODEL.trim() : "";
	return value || null;
}

export function getSiliconflowApiKey(env: Env): string | null {
	const ext = env as Env & { SILICONFLOW_API_KEY?: string };
	const value = typeof ext.SILICONFLOW_API_KEY === "string" ? ext.SILICONFLOW_API_KEY.trim() : "";
	return value || null;
}

export function getAiTimeoutMs(env: Env): number {
	const ext = env as Env & { AI_TIMEOUT_MS?: string };
	const parsed = Number(ext.AI_TIMEOUT_MS);
	if (Number.isFinite(parsed) && parsed >= 1000 && parsed <= 120_000) {
		return Math.trunc(parsed);
	}
	return DEFAULT_AI_TIMEOUT_MS;
}

export function getAiTaskTimeoutMs(env: Env, task: AiEnhanceTaskKey): number {
	const base = getAiTimeoutMs(env);
	const ext = env as Env & {
		AI_TIMEOUT_MS_TITLE?: string;
		AI_TIMEOUT_MS_TAGS?: string;
		AI_TIMEOUT_MS_SUMMARY?: string;
	};
	const read = (value: string | undefined, fallback: number): number => {
		const parsed = Number(value);
		if (Number.isFinite(parsed) && parsed >= 1000 && parsed <= 180_000) {
			return Math.trunc(parsed);
		}
		return fallback;
	};
	if (task === "title") {
		return read(ext.AI_TIMEOUT_MS_TITLE, Math.max(base, DEFAULT_AI_TIMEOUT_TITLE_MS));
	}
	if (task === "tags") {
		return read(ext.AI_TIMEOUT_MS_TAGS, Math.max(base, DEFAULT_AI_TIMEOUT_TAGS_MS));
	}
	if (task === "summary") {
		return read(ext.AI_TIMEOUT_MS_SUMMARY, Math.max(base, DEFAULT_AI_TIMEOUT_SUMMARY_MS));
	}
	return base;
}

export function getAiMaxInputChars(env: Env): number {
	const ext = env as Env & { AI_MAX_INPUT_CHARS?: string };
	const parsed = Number(ext.AI_MAX_INPUT_CHARS);
	if (Number.isFinite(parsed) && parsed >= 500 && parsed <= 80_000) {
		return Math.trunc(parsed);
	}
	return DEFAULT_AI_MAX_INPUT_CHARS;
}

export function getAiEmbeddingModel(env: Env): string {
	const ext = env as Env & { AI_EMBEDDING_MODEL?: string };
	const value = typeof ext.AI_EMBEDDING_MODEL === "string" ? ext.AI_EMBEDDING_MODEL.trim() : "";
	return value || DEFAULT_AI_EMBEDDING_MODEL;
}

export function getAiEmbeddingBatchSize(env: Env): number {
	const ext = env as Env & { AI_EMBED_BATCH_SIZE?: string };
	const parsed = Number(ext.AI_EMBED_BATCH_SIZE);
	if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 64) {
		return Math.trunc(parsed);
	}
	return DEFAULT_AI_EMBED_BATCH_SIZE;
}

export function getAiEmbedTimeoutMs(env: Env): number {
	const ext = env as Env & { AI_EMBED_TIMEOUT_MS?: string };
	const parsed = Number(ext.AI_EMBED_TIMEOUT_MS);
	if (Number.isFinite(parsed) && parsed >= 1000 && parsed <= 120_000) {
		return Math.trunc(parsed);
	}
	return DEFAULT_AI_EMBED_TIMEOUT_MS;
}

export function buildAiChatRuntime(env: Env): AiChatRuntime {
	const baseUrl = getAiBaseUrl(env);
	const model = getAiChatModel(env);
	const apiKey = getSiliconflowApiKey(env);
	if (!baseUrl || !model || !apiKey) {
		throw new Error("AI configuration missing: AI_BASE_URL / AI_CHAT_MODEL / SILICONFLOW_API_KEY");
	}
	return {
		baseUrl,
		model,
		apiKey,
		timeoutMs: getAiTimeoutMs(env),
	};
}

export async function callSiliconflowJson(
	runtime: AiChatRuntime,
	input: {
		systemPrompt: string;
		userPrompt: string;
	},
	options?: {
		timeoutMs?: number;
		label?: string;
	},
): Promise<unknown> {
	const timeoutMs = options?.timeoutMs ?? runtime.timeoutMs;
	const startedAt = Date.now();
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
	let content = "";
	let statusCode: number | null = null;
	let ttfbMs: number | null = null;
	try {
		const response = await fetch(`${runtime.baseUrl.replace(/\/+$/u, "")}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Authorization": `Bearer ${runtime.apiKey}`,
			},
			body: JSON.stringify({
				model: runtime.model,
				temperature: 0.2,
				enable_thinking: false,
				response_format: { type: "json_object" },
				messages: [
					{
						role: "system",
						content: input.systemPrompt,
					},
					{
						role: "user",
						content: input.userPrompt,
					},
				],
			}),
			signal: controller.signal,
		});
		statusCode = response.status;
		ttfbMs = Date.now() - startedAt;
		if (!response.ok) {
			const errorText = (await response.text()).slice(0, 500);
			throw new Error(`Siliconflow request failed: ${response.status} ${errorText}`);
		}
		const payload = await response.json<unknown>();
		content = readChatCompletionText(payload);
		if (!content) {
			throw new Error("Siliconflow response missing choices[0].message.content");
		}
		console.info("AI chat timing", {
			label: options?.label ?? null,
			model: runtime.model,
			statusCode,
			ttfbMs,
			totalMs: Date.now() - startedAt,
		});
	} finally {
		clearTimeout(timer);
	}
	return parseJsonFromModelContent(content);
}

export async function buildEmbeddingsForTexts(
	env: Env,
	texts: string[],
	targetDimensions: number,
): Promise<{ vectors: number[][]; model: string }> {
	if (texts.length === 0) {
		return {
			vectors: [],
			model: getIndexEmbeddingModel(env),
		};
	}
	const baseUrl = getAiBaseUrl(env);
	const apiKey = getSiliconflowApiKey(env);
	const embeddingModel = getAiEmbeddingModel(env);
	if (baseUrl && apiKey && embeddingModel) {
		try {
			const rawVectors = await fetchSiliconflowEmbeddings(env, {
				baseUrl,
				apiKey,
				model: embeddingModel,
				texts,
			});
			return {
				vectors: rawVectors.map((vector) => projectVectorToDimensions(vector, targetDimensions)),
				model: `siliconflow:${embeddingModel}`,
			};
		} catch (error) {
			console.error("Siliconflow embeddings failed, fallback to hash embedding", error);
		}
	}
	return {
		vectors: texts.map((text) => buildHashEmbedding(text, targetDimensions)),
		model: getIndexEmbeddingModel(env),
	};
}

function buildHashEmbedding(text: string, dimensions: number): number[] {
	const vector = Array.from({ length: dimensions }, () => 0);
	for (let i = 0; i < text.length; i += 1) {
		const code = text.charCodeAt(i);
		const index = ((code * 31) + i * 17) % dimensions;
		vector[index] += ((code % 29) + 1) / 29;
	}
	let norm = 0;
	for (const value of vector) {
		norm += value * value;
	}
	const denominator = Math.sqrt(norm) || 1;
	return vector.map((value) => value / denominator);
}

function normalizeVectorL2(values: number[]): number[] {
	let norm = 0;
	for (const value of values) {
		norm += value * value;
	}
	const denominator = Math.sqrt(norm) || 1;
	return values.map((value) => value / denominator);
}

function projectVectorToDimensions(source: number[], targetDimensions: number): number[] {
	if (targetDimensions <= 0) {
		return [];
	}
	if (source.length === 0) {
		return Array.from({ length: targetDimensions }, () => 0);
	}
	if (source.length === targetDimensions) {
		return normalizeVectorL2(source.slice());
	}
	const projected = Array.from({ length: targetDimensions }, () => 0);
	for (let index = 0; index < source.length; index += 1) {
		const value = source[index];
		if (!Number.isFinite(value)) {
			continue;
		}
		projected[index % targetDimensions] += value;
	}
	return normalizeVectorL2(projected);
}

async function fetchSiliconflowEmbeddings(
	env: Env,
	input: {
		baseUrl: string;
		apiKey: string;
		model: string;
		texts: string[];
	},
): Promise<number[][]> {
	const batchSize = getAiEmbeddingBatchSize(env);
	const timeoutMs = getAiEmbedTimeoutMs(env);
	const output: number[][] = [];
	for (let start = 0; start < input.texts.length; start += batchSize) {
		const batch = input.texts.slice(start, start + batchSize);
		const startedAt = Date.now();
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
		const response = await fetch(`${input.baseUrl.replace(/\/+$/u, "")}/embeddings`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Authorization": `Bearer ${input.apiKey}`,
			},
			body: JSON.stringify({
				model: input.model,
				input: batch,
			}),
			signal: controller.signal,
		}).finally(() => {
			clearTimeout(timer);
		});
		const ttfbMs = Date.now() - startedAt;
		if (!response.ok) {
			const errorText = (await response.text()).slice(0, 300);
			throw new Error(`Siliconflow embeddings failed: ${response.status} ${errorText}`);
		}
		const payload = await response.json<unknown>();
		if (!isRecord(payload) || !Array.isArray(payload.data)) {
			throw new Error("Siliconflow embeddings payload is invalid");
		}
		const vectors = payload.data
			.filter((item): item is Record<string, unknown> => isRecord(item))
			.sort((a, b) => {
				const indexA = typeof a.index === "number" ? a.index : 0;
				const indexB = typeof b.index === "number" ? b.index : 0;
				return indexA - indexB;
			})
			.map((item) => {
				const embedding = item.embedding;
				if (!Array.isArray(embedding)) {
					return [];
				}
				return embedding
					.map((value) => (typeof value === "number" && Number.isFinite(value) ? value : 0))
					.filter((value, index, self) => Number.isFinite(value) && index < self.length);
			});
		if (vectors.length !== batch.length) {
			throw new Error("Siliconflow embeddings length mismatch");
		}
		for (const vector of vectors) {
			if (vector.length === 0) {
				throw new Error("Siliconflow embeddings contains empty vector");
			}
			output.push(vector);
		}
		console.info("AI embedding timing", {
			model: input.model,
			batchSize: batch.length,
			statusCode: response.status,
			ttfbMs,
			totalMs: Date.now() - startedAt,
		});
	}
	return output;
}

function readChatCompletionText(payload: unknown): string {
	if (!isRecord(payload) || !Array.isArray(payload.choices)) {
		return "";
	}
	const first = payload.choices[0];
	if (!isRecord(first) || !isRecord(first.message) || typeof first.message.content !== "string") {
		return "";
	}
	return first.message.content.trim();
}

function parseJsonFromModelContent(content: string): unknown {
	const trimmed = content.trim();
	if (!trimmed) {
		throw new Error("Model response is empty");
	}
	const withoutFence = trimmed
		.replace(/^```json\s*/iu, "")
		.replace(/^```\s*/u, "")
		.replace(/\s*```$/u, "")
		.trim();
	try {
		return JSON.parse(withoutFence);
	} catch {
		const first = withoutFence.indexOf("{");
		const last = withoutFence.lastIndexOf("}");
		if (first < 0 || last <= first) {
			throw new Error("Model response is not valid JSON");
		}
		return JSON.parse(withoutFence.slice(first, last + 1));
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
