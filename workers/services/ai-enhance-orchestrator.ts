import type { Context } from "hono";
import { getNoteById, getTagNameMaxLength, listNotesWithSearchMode } from "./note-query-service";
import { hydrateNoteBodyFromR2 } from "./note-storage-service";
import {
	clampInt,
	jsonError,
	jsonOk,
	parseObjectBody,
	readOptionalNumber,
	readOptionalString,
} from "./common-service";
import { buildAiContext } from "./ai-retrieval-service";
import {
	buildAiChatRuntime,
	callSiliconflowJson,
	getAiMaxInputChars,
	getAiTaskTimeoutMs,
} from "./ai-provider-service";
import {
	buildAiEnhanceDefaultQuery,
	buildAiEnhanceRelationQuery,
	buildRelationsTaskPrompt,
	buildSemanticTaskPrompt,
	buildSharedPromptContext,
	buildSimilarTaskPrompt,
	buildSummaryTaskPrompt,
	buildTagsTaskPrompt,
	buildTitleTaskPrompt,
} from "./ai-enhance-prompts";
import {
	buildAiEnhanceFallback,
	buildFallbackRelationSuggestions,
	buildFallbackSemanticSearch,
	buildFallbackTagSuggestions,
	buildFallbackTitleCandidates,
	buildOutlineFallback,
	createEmptyAiEnhanceResult,
	decideSummaryMode,
} from "./ai-enhance-fallback";
import {
	isRecord,
	normalizeSummaryTaskResult,
	parseRelationSuggestions,
	parseRelatedNoteItems,
	parseTagSuggestions,
	parseTitleCandidates,
} from "./ai-enhance-parsers";
import type {
	AiContextNoteItem,
	AiEnhancePreparedInput,
	AiEnhanceRequestInput,
	AiEnhanceResult,
	AiEnhanceTaskKey,
	NoteRow,
} from "./ai-types";

type AppContext = Context<{ Bindings: Env }>;

const DEFAULT_AI_ENHANCE_TOP_K = 6;
const DEFAULT_AI_EXISTING_TAG_LIMIT = 200;
const DEFAULT_AI_RELATION_CANDIDATE_LIMIT = 12;

export const AI_ENHANCE_TASK_KEYS: AiEnhanceTaskKey[] = ["title", "tags", "semantic", "relations", "summary", "similar"];

export function parseAiEnhanceInput(payload: Record<string, unknown>): AiEnhanceRequestInput {
	const query = readOptionalString(payload, "query");
	const topK = clampInt(
		typeof payload.topK === "string" ? payload.topK : String(readOptionalNumber(payload, "topK") ?? DEFAULT_AI_ENHANCE_TOP_K),
		DEFAULT_AI_ENHANCE_TOP_K,
		1,
		10,
	);
	return {
		query,
		topK,
	};
}

export function parseAiEnhanceTaskKey(value: string): AiEnhanceTaskKey | null {
	if (value === "title" || value === "tags" || value === "semantic" || value === "relations" || value === "summary" || value === "similar") {
		return value;
	}
	return null;
}

export async function handleAiEnhanceRequest(c: AppContext, tasks: AiEnhanceTaskKey[]): Promise<Response> {
	const noteId = c.req.param("id");
	const note = await getNoteById(c.env.DB, noteId);
	if (!note || note.deletedAt) {
		return jsonError(c, 404, "Note not found");
	}
	const payload = (await parseObjectBody(c)) ?? {};
	const input = parseAiEnhanceInput(payload);
	const { prepared, warnings } = await prepareAiEnhanceInput(c.env, note, input, tasks);

	let result: AiEnhanceResult;
	try {
		result = await generateAiEnhanceWithSiliconflow(c.env, prepared, tasks);
	} catch (error) {
		console.error("AI enhance fallback", error);
		result = buildAiEnhanceFallback(prepared, tasks, String(error));
	}
	if (warnings.length > 0) {
		result = {
			...result,
			warnings: [...warnings, ...result.warnings],
		};
	}
	return jsonOk(c, result);
}

export function streamAiEnhanceTask(
	env: Env,
	note: NoteRow,
	input: AiEnhanceRequestInput,
	task: AiEnhanceTaskKey,
): Response {
	const encoder = new TextEncoder();
	let closed = false;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const sendEvent = (event: "start" | "progress" | "done" | "error", data: unknown) => {
				if (closed) {
					return;
				}
				controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
			};

			const heartbeat = setInterval(() => {
				sendEvent("progress", {
					task,
					stage: "processing",
				});
			}, 4000);

			const finish = () => {
				if (closed) {
					return;
				}
				closed = true;
				clearInterval(heartbeat);
				controller.close();
			};

			(async () => {
				sendEvent("start", {
					task,
					noteId: note.id,
				});
				try {
					sendEvent("progress", {
						task,
						stage: "prepare",
					});
					const { prepared, warnings } = await prepareAiEnhanceInput(env, note, input, [task]);
					sendEvent("progress", {
						task,
						stage: "generate",
					});
					let result: AiEnhanceResult;
					try {
						result = await generateAiEnhanceWithSiliconflow(env, prepared, [task]);
					} catch (error) {
						console.error("AI enhance stream fallback", error);
						result = buildAiEnhanceFallback(prepared, [task], String(error));
					}
					if (warnings.length > 0) {
						result = {
							...result,
							warnings: [...warnings, ...result.warnings],
						};
					}
					sendEvent("done", {
						ok: true,
						data: result,
					});
				} catch (error) {
					sendEvent("error", {
						ok: false,
						error: String(error),
					});
				} finally {
					finish();
				}
			})().catch((error) => {
				sendEvent("error", {
					ok: false,
					error: String(error),
				});
				finish();
			});
		},
		cancel() {
			closed = true;
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			"Connection": "keep-alive",
			"X-Accel-Buffering": "no",
		},
	});
}

async function prepareAiEnhanceInput(
	env: Env,
	note: NoteRow,
	input: AiEnhanceRequestInput,
	tasks: AiEnhanceTaskKey[],
): Promise<{ prepared: AiEnhancePreparedInput; warnings: string[] }> {
	const warnings: string[] = [];
	const taskSet = new Set(tasks);
	const requiresContext = taskSet.has("semantic") || taskSet.has("relations") || taskSet.has("similar");
	const requiresRelatedNoteIds = taskSet.has("relations");
	const requiresExistingTags = taskSet.has("tags");
	let hydrated = note;
	try {
		hydrated = await hydrateNoteBodyFromR2(env, note);
	} catch (error) {
		console.error("AI enhance hydrate failed, fallback to note row body", error);
		warnings.push(`hydrate_failed: ${String(error)}`);
	}

	const sourceBody = hydrated.bodyText ?? note.bodyText ?? "";
	const query = input.query
		?? (taskSet.has("relations")
			? buildAiEnhanceRelationQuery(hydrated.title, sourceBody)
			: buildAiEnhanceDefaultQuery(hydrated.title, sourceBody));
	let candidatePool: AiContextNoteItem[] = [];
	if (requiresContext) {
		try {
			const context = await buildAiContext(env, {
				query,
				noteId: null,
				limit: Math.min(20, Math.max(input.topK * 2, 8)),
				status: "active",
			});
			candidatePool = context.notes.filter((item) => item.noteId !== note.id);
		} catch (error) {
			console.error("AI enhance context build failed, continue with empty candidates", error);
			warnings.push(`context_failed: ${String(error)}`);
		}
	}
	if (taskSet.has("relations")) {
		try {
			candidatePool = await supplementRelationCandidatesFromFolder(env.DB, note, candidatePool, input.topK);
		} catch (error) {
			console.error("AI enhance same-folder candidate lookup failed, continue with existing candidates", error);
			warnings.push(`relation_folder_candidates_failed: ${String(error)}`);
		}
	}

	let relatedNoteIds = new Set<string>();
	if (requiresRelatedNoteIds) {
		try {
			relatedNoteIds = await listExistingRelationNoteIds(env.DB, note.id, 128);
		} catch (error) {
			console.error("AI enhance relation lookup failed, continue with empty relations", error);
			warnings.push(`relation_lookup_failed: ${String(error)}`);
		}
	}

	let existingTagNames: string[] = [];
	if (requiresExistingTags) {
		try {
			existingTagNames = await listExistingTagNames(env.DB, DEFAULT_AI_EXISTING_TAG_LIMIT);
		} catch (error) {
			console.error("AI enhance existing tags lookup failed, continue with empty tags", error);
			warnings.push(`tags_context_failed: ${String(error)}`);
		}
	}

	return {
		prepared: {
			note: hydrated,
			query,
			topK: input.topK,
			candidates: candidatePool,
			relatedNoteIds,
			existingTagNames,
		},
		warnings,
	};
}

async function supplementRelationCandidatesFromFolder(
	db: D1Database,
	note: NoteRow,
	candidates: AiContextNoteItem[],
	topK: number,
): Promise<AiContextNoteItem[]> {
	const targetCount = Math.max(topK * 2, DEFAULT_AI_ENHANCE_TOP_K, 4);
	if (!note.folderId || candidates.length >= targetCount) {
		return candidates;
	}
	const { notes } = await listNotesWithSearchMode(db, {
		folderId: note.folderId,
		tagIds: [],
		tagMode: "any",
		keyword: "",
		status: "active",
		limit: Math.max(DEFAULT_AI_RELATION_CANDIDATE_LIMIT, targetCount * 2),
		offset: 0,
	});
	if (notes.length === 0) {
		return candidates;
	}
	const merged = new Map(candidates.map((item) => [item.noteId, item] as const));
	for (const item of notes) {
		if (item.id === note.id || merged.has(item.id)) {
			continue;
		}
		merged.set(item.id, {
			noteId: item.id,
			slug: item.slug,
			title: item.title,
			snippet: (item.excerpt || "").slice(0, 240),
			updatedAt: item.updatedAt,
			searchScore: item.searchScore,
		});
		if (merged.size >= DEFAULT_AI_RELATION_CANDIDATE_LIMIT) {
			break;
		}
	}
	return [...merged.values()].slice(0, DEFAULT_AI_RELATION_CANDIDATE_LIMIT);
}

async function listExistingRelationNoteIds(db: D1Database, noteId: string, limit: number): Promise<Set<string>> {
	const { results } = await db.prepare(
		`SELECT
			CASE
				WHEN nr.note_id_low = ? THEN nr.note_id_high
				ELSE nr.note_id_low
			END AS otherNoteId
		 FROM note_relations nr
		 WHERE (nr.note_id_low = ? OR nr.note_id_high = ?)
		   AND nr.status IN ('suggested', 'accepted')
		 ORDER BY nr.updated_at DESC
		 LIMIT ?`,
	)
		.bind(noteId, noteId, noteId, limit)
		.all<{ otherNoteId: string }>();
	return new Set(
		results
			.map((item) => item.otherNoteId)
			.filter((item): item is string => typeof item === "string" && item.length > 0),
	);
}

async function listExistingTagNames(db: D1Database, limit: number): Promise<string[]> {
	const { results } = await db.prepare(
		`SELECT name
		 FROM tags
		 ORDER BY name COLLATE NOCASE ASC
		 LIMIT ?`,
	)
		.bind(limit)
		.all<{ name: string }>();
	return results
		.map((item) => item.name.trim())
		.filter((item) => item.length > 0);
}

async function generateAiEnhanceWithSiliconflow(
	env: Env,
	input: AiEnhancePreparedInput,
	tasks: AiEnhanceTaskKey[],
): Promise<AiEnhanceResult> {
	const runtime = buildAiChatRuntime(env);
	const result = createEmptyAiEnhanceResult(input, {
		provider: "siliconflow",
		model: runtime.model,
		warnings: [],
	});
	const candidatesById = new Map(input.candidates.map((item) => [item.noteId, item] as const));
	const { sourceBody, sharedContext } = buildSharedPromptContext(input, getAiMaxInputChars(env));
	const taskSet = new Set(tasks);
	const taskPromises: Array<Promise<void>> = [];

	if (taskSet.has("title")) {
		taskPromises.push((async () => {
			const payload = await callSiliconflowJson(runtime, buildTitleTaskPrompt({
				title: input.note.title,
				sourceBody,
				query: input.query,
			}), {
				timeoutMs: getAiTaskTimeoutMs(env, "title"),
				label: "task:title",
			});
			const source = isRecord(payload) ? payload : {};
			const candidates = parseTitleCandidates(source.titleCandidates ?? source.candidates, input.topK);
			result.titleCandidates = candidates.length > 0 ? candidates : buildFallbackTitleCandidates(input.note, input.topK);
		})().catch((error) => {
			result.warnings.push(`task_failed:title:${String(error)}`);
			result.titleCandidates = buildFallbackTitleCandidates(input.note, input.topK);
		}));
	}

	if (taskSet.has("tags")) {
		taskPromises.push((async () => {
			const payload = await callSiliconflowJson(runtime, buildTagsTaskPrompt({
				sharedContext,
				existingTagNames: input.existingTagNames,
			}), {
				timeoutMs: getAiTaskTimeoutMs(env, "tags"),
				label: "task:tags",
			});
			const source = isRecord(payload) ? payload : {};
			result.tagSuggestions = parseTagSuggestions(
				source.tagSuggestions ?? source.tags,
				input.topK,
				getTagNameMaxLength(env),
			);
		})().catch((error) => {
			result.warnings.push(`task_failed:tags:${String(error)}`);
			result.tagSuggestions = buildFallbackTagSuggestions(input.note.bodyText ?? "", input.topK);
		}));
	}

	if (taskSet.has("semantic")) {
		taskPromises.push((async () => {
			const payload = await callSiliconflowJson(runtime, buildSemanticTaskPrompt(sharedContext), {
				timeoutMs: getAiTaskTimeoutMs(env, "semantic"),
				label: "task:semantic",
			});
			const source = isRecord(payload) ? payload : {};
			result.semanticSearch = parseRelatedNoteItems(
				source.semanticSearch ?? source.recommendations,
				input.topK,
				candidatesById,
			);
		})().catch((error) => {
			result.warnings.push(`task_failed:semantic:${String(error)}`);
			result.semanticSearch = buildFallbackSemanticSearch(input.candidates, input.topK);
		}));
	}

	if (taskSet.has("relations")) {
		taskPromises.push((async () => {
			const payload = await callSiliconflowJson(runtime, buildRelationsTaskPrompt(sharedContext, input.relatedNoteIds), {
				timeoutMs: getAiTaskTimeoutMs(env, "relations"),
				label: "task:relations",
			});
			const source = isRecord(payload) ? payload : {};
			result.relationSuggestions = parseRelationSuggestions(
				source.relationSuggestions ?? source.relations,
				input.topK,
				candidatesById,
				input.relatedNoteIds,
			);
		})().catch((error) => {
			result.warnings.push(`task_failed:relations:${String(error)}`);
			result.relationSuggestions = buildFallbackRelationSuggestions(
				buildFallbackSemanticSearch(input.candidates, input.topK),
				input.relatedNoteIds,
				input.topK,
			);
		}));
	}

	if (taskSet.has("summary")) {
		taskPromises.push((async () => {
			const summaryMode = decideSummaryMode(input.note.bodyText ?? "");
			result.summaryMeta = summaryMode;
			if (summaryMode.skipped) {
				result.summary = "";
				result.outline = [];
				return;
			}
			const payload = await callSiliconflowJson(runtime, buildSummaryTaskPrompt({
				mode: summaryMode.mode,
				title: input.note.title,
				sourceBody,
				query: input.query,
			}), {
				timeoutMs: getAiTaskTimeoutMs(env, "summary"),
				label: "task:summary",
			});
			const normalized = normalizeSummaryTaskResult(payload, input.note.bodyText ?? "", summaryMode.mode);
			result.summary = normalized.summary;
			result.outline = normalized.outline;
		})().catch((error) => {
			result.warnings.push(`task_failed:summary:${String(error)}`);
			result.summary = buildAiEnhanceFallback(input, ["summary"], String(error)).summary;
			result.outline = buildOutlineFallback(input.note.bodyText ?? "");
			result.summaryMeta = {
				mode: "full",
				skipped: false,
				reason: "fallback",
			};
		}));
	}

	if (taskSet.has("similar")) {
		taskPromises.push((async () => {
			const payload = await callSiliconflowJson(runtime, buildSimilarTaskPrompt(sharedContext), {
				timeoutMs: getAiTaskTimeoutMs(env, "similar"),
				label: "task:similar",
			});
			const source = isRecord(payload) ? payload : {};
			result.similarNotes = parseRelatedNoteItems(
				source.similarNotes ?? source.recommendations,
				input.topK,
				candidatesById,
			);
		})().catch((error) => {
			result.warnings.push(`task_failed:similar:${String(error)}`);
			result.similarNotes = buildFallbackSemanticSearch(input.candidates, input.topK);
		}));
	}

	await Promise.all(taskPromises);

	if (result.titleCandidates.length === 0 && taskSet.has("title")) {
		result.titleCandidates = buildFallbackTitleCandidates(input.note, input.topK);
	}
	if (result.tagSuggestions.length === 0 && taskSet.has("tags")) {
		result.tagSuggestions = buildFallbackTagSuggestions(input.note.bodyText ?? "", input.topK);
	}
	if (result.semanticSearch.length === 0 && taskSet.has("semantic")) {
		result.semanticSearch = buildFallbackSemanticSearch(input.candidates, input.topK);
	}
	if (result.relationSuggestions.length === 0 && taskSet.has("relations")) {
		result.relationSuggestions = buildFallbackRelationSuggestions(result.semanticSearch, input.relatedNoteIds, input.topK);
	}
	if (taskSet.has("summary") && result.summaryMeta.mode !== "skip" && !result.summary.trim()) {
		result.summary = buildAiEnhanceFallback(input, ["summary"], "summary-empty").summary;
		result.outline = buildOutlineFallback(input.note.bodyText ?? "");
	}
	if (result.similarNotes.length === 0 && taskSet.has("similar")) {
		result.similarNotes = taskSet.has("semantic") && result.semanticSearch.length > 0
			? result.semanticSearch
			: buildFallbackSemanticSearch(input.candidates, input.topK);
	}

	return result;
}
