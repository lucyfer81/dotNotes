import type { Hono } from "hono";
import {
	AI_ENHANCE_TASK_KEYS,
	buildAiContext,
	handleAiEnhanceRequest,
	parseAiContextInput,
	parseAiEnhanceInput,
	parseAiEnhanceTaskKey,
	streamAiEnhanceTask,
} from "./ai-core-service";
import { getNoteById } from "./note-query-service";
import { jsonError, jsonOk, parseObjectBody } from "./common-service";

export function registerAiRoutes(app: Hono<{ Bindings: Env }>): void {
	app.post("/api/ai/notes/:id/enhance", async (c) => handleAiEnhanceRequest(c, [...AI_ENHANCE_TASK_KEYS]));

	app.post("/api/ai/notes/:id/enhance/:task", async (c) => {
		const task = parseAiEnhanceTaskKey(c.req.param("task"));
		if (!task) {
			return jsonError(c, 404, "AI task not found");
		}
		return handleAiEnhanceRequest(c, [task]);
	});

	app.post("/api/ai/notes/:id/enhance/:task/stream", async (c) => {
		const task = parseAiEnhanceTaskKey(c.req.param("task"));
		if (!task) {
			return jsonError(c, 404, "AI task not found");
		}
		const noteId = c.req.param("id");
		const note = await getNoteById(c.env.DB, noteId);
		if (!note || note.deletedAt) {
			return jsonError(c, 404, "Note not found");
		}
		const payload = (await parseObjectBody(c)) ?? {};
		const input = parseAiEnhanceInput(payload);
		return streamAiEnhanceTask(c.env, note, input, task);
	});

	app.post("/api/ai/context", async (c) => {
		const payload = await parseObjectBody(c);
		if (!payload) {
			return jsonError(c, 400, "Invalid JSON body");
		}
		const input = parseAiContextInput(payload);
		if (!input) {
			return jsonError(c, 400, "`query` is required");
		}
		const context = await buildAiContext(c.env, input);
		return jsonOk(c, {
			enabled: false,
			phase: "before-ai",
			message: "AI generation is disabled in BeforeAI phase. Retrieval context is ready.",
			...context,
		});
	});

	app.post("/api/ai/execute", async (c) => {
		const payload = await parseObjectBody(c);
		if (!payload) {
			return jsonError(c, 400, "Invalid JSON body");
		}
		const input = parseAiContextInput(payload);
		if (!input) {
			return jsonError(c, 400, "`query` is required");
		}
		const context = await buildAiContext(c.env, input);
		return jsonOk(c, {
			enabled: false,
			phase: "before-ai",
			answer: null,
			message: "AI generation endpoint is reserved. Retrieval/context pipeline is available.",
			...context,
		});
	});
}
