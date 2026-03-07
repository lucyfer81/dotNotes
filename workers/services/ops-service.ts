import type { Hono } from "hono";
import {
	clampInt,
	hasOwn,
	jsonError,
	jsonOk,
	parseBooleanLike,
	parseObjectBody,
	readOptionalNumber,
	readOptionalString,
} from "./common-service";
import {
	buildOpsMetrics,
	readRequestColo,
	runHttpTimingProbe,
	sampleHttpProbe,
	summarizeProbeSamples,
} from "./ops-core-service";
import {
	getAiBaseUrl,
	getAiChatModel,
	getAiEmbeddingModel,
	getSiliconflowApiKey,
} from "./ai-core-service";

const DEFAULT_OPS_WINDOW_MINUTES = 60;

export function registerOpsRoutes(app: Hono<{ Bindings: Env }>): void {
	app.get("/api/ops/metrics", async (c) => {
		const windowMinutes = clampInt(c.req.query("windowMinutes"), DEFAULT_OPS_WINDOW_MINUTES, 5, 24 * 60);
		const metrics = await buildOpsMetrics(c.env.DB, windowMinutes);
		return jsonOk(c, metrics);
	});

	app.get("/api/ops/alerts", async (c) => {
		const windowMinutes = clampInt(c.req.query("windowMinutes"), DEFAULT_OPS_WINDOW_MINUTES, 5, 24 * 60);
		const metrics = await buildOpsMetrics(c.env.DB, windowMinutes);
		return jsonOk(c, {
			windowMinutes,
			generatedAt: metrics.generatedAt,
			alerts: metrics.alerts,
		});
	});

	app.post("/api/ops/ai/probe", async (c) => {
		const payload = (await parseObjectBody(c)) ?? {};
		const count = clampInt(
			typeof payload.count === "string" ? payload.count : String(readOptionalNumber(payload, "count") ?? "5"),
			5,
			1,
			20,
		);
		const timeoutMs = clampInt(
			typeof payload.timeoutMs === "string" ? payload.timeoutMs : String(readOptionalNumber(payload, "timeoutMs") ?? "15000"),
			15_000,
			1000,
			120_000,
		);
		const includeModels = hasOwn(payload, "includeModels") ? parseBooleanLike(payload.includeModels) : true;
		const includeEmbedding = hasOwn(payload, "includeEmbedding") ? parseBooleanLike(payload.includeEmbedding) : true;
		const includeChat = hasOwn(payload, "includeChat") ? parseBooleanLike(payload.includeChat) : true;
		const baseUrl = getAiBaseUrl(c.env);
		const apiKey = getSiliconflowApiKey(c.env);
		const chatModel = getAiChatModel(c.env);
		const chatModelOverride = readOptionalString(payload, "chatModel");
		const chatModelToUse = chatModelOverride ?? chatModel;
		const embeddingModel = getAiEmbeddingModel(c.env);
		if (!baseUrl || !apiKey || !chatModelToUse) {
			return jsonError(c, 500, "AI probe configuration missing");
		}
		const colo = readRequestColo(c.req.raw);
		const sampledAt = new Date().toISOString();
		const probes: Record<string, unknown> = {};
		if (includeModels) {
			const samples = await sampleHttpProbe(count, () =>
				runHttpTimingProbe({
					url: `${baseUrl.replace(/\/+$/u, "")}/models`,
					method: "GET",
					headers: {
						"Authorization": `Bearer ${apiKey}`,
					},
					timeoutMs,
				}),
			);
			probes.models = summarizeProbeSamples(samples);
		}
		if (includeEmbedding) {
			const samples = await sampleHttpProbe(count, () =>
				runHttpTimingProbe({
					url: `${baseUrl.replace(/\/+$/u, "")}/embeddings`,
					method: "POST",
					headers: {
						"Authorization": `Bearer ${apiKey}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						model: embeddingModel,
						input: ["latency probe"],
					}),
					timeoutMs,
				}),
			);
			probes.embedding = {
				model: embeddingModel,
				...summarizeProbeSamples(samples),
			};
		}
		if (includeChat) {
			const samples = await sampleHttpProbe(count, () =>
				runHttpTimingProbe({
					url: `${baseUrl.replace(/\/+$/u, "")}/chat/completions`,
					method: "POST",
					headers: {
						"Authorization": `Bearer ${apiKey}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						model: chatModelToUse,
						temperature: 0,
						max_tokens: 16,
						messages: [
							{ role: "system", content: "Return short answer." },
							{ role: "user", content: "ping" },
						],
					}),
					timeoutMs,
				}),
			);
			probes.chat = {
				model: chatModelToUse,
				...summarizeProbeSamples(samples),
			};
		}
		return jsonOk(c, {
			sampledAt,
			colo,
			baseUrl,
			count,
			timeoutMs,
			probes,
		});
	});
}
