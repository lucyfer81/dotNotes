import { getIndexEmbeddingModel } from "./note-query-service";
import { isRecord } from "./common-service";
import {
	getAiBaseUrl,
	getAiEmbedTimeoutMs,
	getAiEmbeddingBatchSize,
	getAiEmbeddingModel,
	getSiliconflowApiKey,
} from "./ai-core-service";

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

export function buildHashEmbedding(text: string, dimensions: number): number[] {
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
