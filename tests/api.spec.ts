import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../workers/app";
import { FakeD1Database } from "./helpers/fake-d1";
import { FakeR2Bucket } from "./helpers/fake-r2";
import { FakeVectorIndex } from "./helpers/fake-vectorize";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schemaSql = readFileSync(path.resolve(__dirname, "../db/schema.sql"), "utf8");

let db: FakeD1Database;
let bucket: FakeR2Bucket;
let vectorIndex: FakeVectorIndex;

beforeEach(async () => {
	db = new FakeD1Database();
	bucket = new FakeR2Bucket();
	vectorIndex = new FakeVectorIndex();
	await db.exec(schemaSql);
});

describe("notes lifecycle api", () => {
	it("supports archive, delete, restore, and hard delete flow", async () => {
		const created = await createNote({
			title: "生命周期测试",
			folderId: "folder-10-projects",
			bodyText: "first content #life",
			tagNames: ["life"],
		});

		const noteId = created.id;

		const archived = await readEnvelope<NotePayload>(await api(`/api/notes/${noteId}/archive`, {
			method: "PATCH",
			body: JSON.stringify({ archived: true }),
		}));
		expect(archived.data.isArchived).toBe(1);

		const softDeleted = await readEnvelope<{ id: string; deleted: boolean }>(
			await api(`/api/notes/${noteId}`, { method: "DELETE" }),
		);
		expect(softDeleted.data.deleted).toBe(true);

		const deletedList = await readEnvelope<NotesListPayload>(
			await api("/api/notes?status=deleted"),
		);
		expect(deletedList.data.items.some((item) => item.id === noteId)).toBe(true);

		const restored = await readEnvelope<NotePayload>(await api(`/api/notes/${noteId}/restore`, {
			method: "PATCH",
		}));
		expect(restored.data.deletedAt).toBeNull();
		expect(restored.data.isArchived).toBe(0);

		await readEnvelope(await api(`/api/notes/${noteId}`, { method: "DELETE" }));
		await readEnvelope(await api(`/api/notes/${noteId}/hard`, { method: "DELETE" }));

		const gone = await api(`/api/notes/${noteId}`);
		expect(gone.status).toBe(404);
	});
});

describe("search api", () => {
	it("supports keyword + status/tag filters and prioritizes title matches", async () => {
		const exact = await createNote({
			title: "Alpha Query",
			folderId: "folder-10-projects",
			bodyText: "body without keywords",
			tagNames: ["searchscope"],
		});

		const bodyHit = await createNote({
			title: "Unrelated Title",
			folderId: "folder-10-projects",
			bodyText: "this body mentions alpha query inside text",
		});

		const archived = await createNote({
			title: "Alpha Query Archived",
			folderId: "folder-10-projects",
			bodyText: "alpha query also appears here",
		});
		await readEnvelope(await api(`/api/notes/${archived.id}/archive`, {
			method: "PATCH",
			body: JSON.stringify({ archived: true }),
		}));

		const activeSearch = await readEnvelope<NotesListPayload>(
			await api("/api/notes?q=alpha%20query&status=active"),
		);
		expect(activeSearch.data.items.map((item) => item.id)).toEqual([exact.id, bodyHit.id]);
		expect(activeSearch.data.search?.mode).toBe("fts");
		expect(typeof activeSearch.data.items[0]?.searchScore).toBe("number");

		const tags = await readEnvelope<TagPayload[]>(await api("/api/tags?status=all"));
		const searchTag = tags.data.find((item) => item.name.toLowerCase() === "searchscope");
		expect(searchTag?.id).toBeDefined();

		const tagFiltered = await readEnvelope<NotesListPayload>(
			await api(`/api/notes?q=alpha%20query&status=active&tagIds=${encodeURIComponent(searchTag!.id)}`),
		);
		expect(tagFiltered.data.items.map((item) => item.id)).toEqual([exact.id]);

		const archivedSearch = await readEnvelope<NotesListPayload>(
			await api("/api/notes?q=alpha%20query&status=archived"),
		);
		expect(archivedSearch.data.items.map((item) => item.id)).toEqual([archived.id]);
	});
});

describe("storage strategy api", () => {
	it("auto switches oversized body to r2 while keeping body text readable", async () => {
		const uniqueToken = "r2-body-search-token-991";
		const largeBody = `# Big note\n${"large-content ".repeat(50).trimEnd()}\n\n${uniqueToken}`;
		const created = await createNote({
			title: "Large Body Note",
			folderId: "folder-10-projects",
			bodyText: largeBody,
		});
		expect(created.storageType).toBe("r2");
		expect(created.bodyText).toBe(largeBody);

		const listed = await readEnvelope<NotesListPayload>(
			await api(`/api/notes?q=${encodeURIComponent("Large Body Note")}&status=active`),
		);
		expect(listed.data.items[0]?.storageType).toBe("r2");
		expect(listed.data.items[0]?.bodyText).toBe(largeBody);

		const bodySearch = await readEnvelope<NotesListPayload>(
			await api(`/api/notes?q=${encodeURIComponent(uniqueToken)}&status=active`),
		);
		expect(bodySearch.data.items.map((item) => item.id)).toContain(created.id);
		expect(bodySearch.data.search?.mode).toBe("fts");
	});
});

describe("assets api", () => {
	it("supports upload, list, download and delete", async () => {
		const created = await createNote({
			title: "Asset Host Note",
			folderId: "folder-10-projects",
			bodyText: "assets body",
		});
		const noteId = created.id;

		const form = new FormData();
		form.set("noteId", noteId);
		form.set("file", new File(["hello-asset"], "hello.txt", { type: "text/plain" }));

		const uploaded = await readEnvelope<AssetPayload>(await api("/api/assets/upload", {
			method: "POST",
			body: form,
		}));
		expect(uploaded.data.noteId).toBe(noteId);
		expect(uploaded.data.fileName).toBe("hello.txt");

		const list = await readEnvelope<AssetPayload[]>(await api(`/api/notes/${noteId}/assets`));
		expect(list.data.length).toBe(1);
		expect(list.data[0]?.id).toBe(uploaded.data.id);

		const content = await api(`/api/assets/${uploaded.data.id}/content`);
		expect(content.status).toBe(200);
		expect(await content.text()).toBe("hello-asset");

		await readEnvelope(await api(`/api/assets/${uploaded.data.id}`, { method: "DELETE" }));
		const afterDelete = await readEnvelope<AssetPayload[]>(await api(`/api/notes/${noteId}/assets`));
		expect(afterDelete.data.length).toBe(0);
	});
});

describe("tag governance api", () => {
	it("supports merge and cleanup flow", async () => {
		await createNote({
			title: "Tag A Note",
			folderId: "folder-10-projects",
			bodyText: "alpha",
			tagNames: ["topic-a"],
		});
		await createNote({
			title: "Tag B Note",
			folderId: "folder-10-projects",
			bodyText: "beta",
			tagNames: ["topic-b"],
		});

		const tags = await readEnvelope<TagPayload[]>(await api("/api/tags?status=all"));
		const topicA = tags.data.find((item) => item.name === "topic-a");
		const topicB = tags.data.find((item) => item.name === "topic-b");
		expect(topicA?.id).toBeDefined();
		expect(topicB?.id).toBeDefined();

		await readEnvelope(await api("/api/tags/merge", {
			method: "POST",
			body: JSON.stringify({
				sourceTagId: topicB!.id,
				targetTagId: topicA!.id,
			}),
		}));

		const mergedSearch = await readEnvelope<NotesListPayload>(
			await api(`/api/notes?status=active&tagIds=${encodeURIComponent(topicA!.id)}`),
		);
		expect(mergedSearch.data.items.length).toBe(2);

		await readEnvelope(await api("/api/tags", {
			method: "POST",
			body: JSON.stringify({ name: "orphan-cleanup" }),
		}));
		const dryCleanup = await readEnvelope<{ orphaned: number; deleted: number }>(
			await api("/api/tags/cleanup", {
				method: "POST",
				body: JSON.stringify({ dryRun: true }),
			}),
		);
		expect(dryCleanup.data.orphaned).toBeGreaterThanOrEqual(1);
		expect(dryCleanup.data.deleted).toBe(0);

		const cleanup = await readEnvelope<{ orphaned: number; deleted: number }>(
			await api("/api/tags/cleanup", {
				method: "POST",
				body: JSON.stringify({ dryRun: false }),
			}),
		);
		expect(cleanup.data.deleted).toBeGreaterThanOrEqual(1);
	});
});

describe("index pipeline api", () => {
	it("supports retry and processing with vectorize-backed chunks", async () => {
		const created = await createNote({
			title: "Index Note",
			folderId: "folder-10-projects",
			bodyText: "## section\nthis is an index body ".repeat(80),
		});

		const retryUpsert = await readEnvelope<{ processed: { status: string; chunkCount: number } }>(
			await api(`/api/notes/${created.id}/index/retry`, { method: "POST" }),
		);
		expect(retryUpsert.data.processed.status).toBe("success");
		expect(retryUpsert.data.processed.chunkCount).toBeGreaterThan(0);
		expect(vectorIndex.size()).toBeGreaterThan(0);

		await readEnvelope(await api(`/api/notes/${created.id}/archive`, {
			method: "PATCH",
			body: JSON.stringify({ archived: true }),
		}));
		const retryDelete = await readEnvelope<{ processed: { status: string; chunkCount: number } }>(
			await api(`/api/notes/${created.id}/index/retry`, { method: "POST" }),
		);
		expect(retryDelete.data.processed.status).toBe("success");
		expect(retryDelete.data.processed.chunkCount).toBe(0);
		expect(vectorIndex.size()).toBe(0);
	});
});

describe("ops metrics api", () => {
	it("exposes api error/search/index metrics and alert summaries", async () => {
		const created = await createNote({
			title: "Ops Metrics Note",
			folderId: "folder-10-projects",
			bodyText: "metrics content token",
		});

		await readEnvelope(await api(`/api/notes?q=${encodeURIComponent("metrics content token")}&status=active`));
		await api("/api/notes/not-exists");
		await readEnvelope(await api(`/api/notes/${created.id}/index/retry`, { method: "POST" }));

		const metrics = await readEnvelope<{
			api: { totalRequests: number; errorRate: number | null };
			search: { p95Ms: number | null };
			index: { backlog: number; successRate: number | null };
			alerts: Array<{ key: string; status: string }>;
		}>(await api("/api/ops/metrics?windowMinutes=120"));

		expect(metrics.data.api.totalRequests).toBeGreaterThan(0);
		expect(metrics.data.api.errorRate).not.toBeNull();
		expect(metrics.data.search.p95Ms).not.toBeNull();
		expect(metrics.data.index.backlog).toBeGreaterThanOrEqual(0);
		expect(metrics.data.alerts.some((item) => item.key === "api_error_rate")).toBe(true);
	});

	it("provides ai probe latency summaries", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn(async (input) => {
			const url = typeof input === "string" ? input : input instanceof Request ? input.url : "";
			if (url.includes("/models")) {
				return new Response(JSON.stringify({ data: [{ id: "m1" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
			}
			if (url.includes("/embeddings")) {
				return new Response(
					JSON.stringify({ data: [{ index: 0, embedding: [1, 0, 0, 0] }] }),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			if (url.includes("/chat/completions")) {
				return new Response(
					JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			return new Response("not found", { status: 404 });
		}) as typeof fetch;
		try {
			const probed = await readEnvelope<{
				count: number;
				probes: {
					models?: { sampleCount: number; successCount: number };
					embedding?: { sampleCount: number; successCount: number };
					chat?: { model: string; sampleCount: number; successCount: number };
				};
			}>(await api("/api/ops/ai/probe", {
				method: "POST",
				body: JSON.stringify({ count: 3, chatModel: "Qwen/Qwen3-30B-A3B-Instruct-2507" }),
			}, {
				AI_BASE_URL: "https://api.siliconflow.cn/v1",
				AI_CHAT_MODEL: "Qwen/Qwen2.5-7B-Instruct",
				SILICONFLOW_API_KEY: "test-key",
				AI_EMBEDDING_MODEL: "test-embedding-model",
			}));
			expect(probed.data.count).toBe(3);
			expect(probed.data.probes.models?.sampleCount).toBe(3);
			expect(probed.data.probes.models?.successCount).toBe(3);
			expect(probed.data.probes.embedding?.sampleCount).toBe(3);
			expect(probed.data.probes.embedding?.successCount).toBe(3);
			expect(probed.data.probes.chat?.sampleCount).toBe(3);
			expect(probed.data.probes.chat?.successCount).toBe(3);
			expect(probed.data.probes.chat?.model).toBe("Qwen/Qwen3-30B-A3B-Instruct-2507");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

describe("ai pre-integration api", () => {
	it("returns retrieval context while generation remains disabled", async () => {
		const created = await createNote({
			title: "AI Context Note",
			folderId: "folder-10-projects",
			bodyText: "This paragraph prepares ai retrieval context.",
		});
		await readEnvelope(await api(`/api/notes/${created.id}/index/retry`, { method: "POST" }));

		const context = await readEnvelope<{
			enabled: boolean;
			notes: Array<{ noteId: string }>;
			chunks: Array<{ noteId: string }>;
		}>(await api("/api/ai/context", {
			method: "POST",
			body: JSON.stringify({ query: "retrieval context" }),
		}));
		expect(context.data.enabled).toBe(false);
		expect(context.data.notes.map((item) => item.noteId)).toContain(created.id);

		const execute = await readEnvelope<{
			enabled: boolean;
			answer: string | null;
		}>(await api("/api/ai/execute", {
			method: "POST",
			body: JSON.stringify({ query: "retrieval context", noteId: created.id }),
		}));
		expect(execute.data.enabled).toBe(false);
		expect(execute.data.answer).toBeNull();
	});

	it("supports hybrid retrieval with vector candidates when keyword misses", async () => {
		const target = await createNote({
			title: "Hybrid Target",
			folderId: "folder-10-projects",
			bodyText: "latent concept alpha and retrieval strategy",
		});
		const noise = await createNote({
			title: "Hybrid Noise",
			folderId: "folder-10-projects",
			bodyText: "totally different beta topic",
		});

		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn(async (input, init) => {
			const url = typeof input === "string" ? input : input instanceof Request ? input.url : "";
			if (!url.includes("/embeddings")) {
				return new Response("not found", { status: 404 });
			}
			const body = typeof init?.body === "string" ? JSON.parse(init.body) as { input?: string[] } : {};
			const values = Array.isArray(body.input) ? body.input : [];
			const vectors = values.map((text) => {
				if (text.includes("alpha") || text.includes("目标主题")) {
					return [1, 0, 0, 0];
				}
				return [0, 1, 0, 0];
			});
			return new Response(
				JSON.stringify({
					data: vectors.map((embedding, index) => ({ index, embedding })),
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		}) as typeof fetch;

		try {
			const envOverrides = {
				AI_BASE_URL: "https://api.siliconflow.cn/v1",
				AI_EMBEDDING_MODEL: "test-embed-model",
				SILICONFLOW_API_KEY: "test-key",
			};
			await readEnvelope(await api(`/api/notes/${target.id}/index/retry`, { method: "POST" }, envOverrides));
			await readEnvelope(await api(`/api/notes/${noise.id}/index/retry`, { method: "POST" }, envOverrides));

			const context = await readEnvelope<{
				searchMode: string;
				notes: Array<{ noteId: string }>;
			}>(await api("/api/ai/context", {
				method: "POST",
				body: JSON.stringify({ query: "目标主题", limit: 3 }),
			}, envOverrides));
			expect(context.data.searchMode).toBe("hybrid");
			expect(context.data.notes.map((item) => item.noteId)).toContain(target.id);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

describe("ai enhance api", () => {
	it("returns structured enhancement suggestions from siliconflow-compatible payload", async () => {
		const created = await createNote({
			title: "AI Enhance Note",
			folderId: "folder-10-projects",
			bodyText:
				"RAG 检索与总结流程设计，包含 tags 与关系候选。为了验证摘要逻辑，这里补充更多上下文：先定义查询意图，再构建候选池，之后由模型给出标题、标签、关系建议。最后通过摘要提炼关键结论、风险和后续动作，确保输出不是原文复述。并且记录失败回退策略、重试机制与可观测指标，用于后续迭代。",
		});

		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn(async () =>
			new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: JSON.stringify({
									titleCandidates: [{ title: "RAG 流程设计", confidence: 0.88, reason: "主题聚焦" }],
									tagSuggestions: [{ name: "ai/rag", confidence: 0.83, reason: "语义命中" }],
									semanticSearch: [],
									relationSuggestions: [],
									summary: "这是一条关于 RAG 流程设计的笔记。",
									outline: ["问题定义", "检索链路", "输出策略"],
									similarNotes: [],
								}),
							},
						},
					],
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			),
		) as typeof fetch;

		try {
			const enhanced = await readEnvelope<{
				provider: string;
				titleCandidates: Array<{ title: string }>;
				tagSuggestions: Array<{ name: string }>;
				summary: string;
			}>(await api(`/api/ai/notes/${created.id}/enhance`, {
				method: "POST",
				body: JSON.stringify({ query: "RAG" }),
			}, {
				AI_BASE_URL: "https://api.siliconflow.cn/v1",
				AI_CHAT_MODEL: "Qwen/Qwen2.5-7B-Instruct",
				SILICONFLOW_API_KEY: "test-key",
			}));

			expect(enhanced.data.provider).toBe("siliconflow");
			expect(enhanced.data.titleCandidates[0]?.title).toBe("RAG 流程设计");
			expect(enhanced.data.tagSuggestions[0]?.name).toBe("ai-rag");
			expect(enhanced.data.summary).toContain("RAG");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("reuses existing tags when ai suggestions only differ by hierarchy or token order", async () => {
		await createNote({
			title: "Existing Tag Seed",
			folderId: "folder-10-projects",
			bodyText: "用于建立 ai-rag 既有标签。",
			tagNames: ["ai-rag"],
		});
		const created = await createNote({
			title: "AI Enhance Existing Tag Note",
			folderId: "folder-10-projects",
			bodyText: "这条笔记讨论 RAG、检索链路与 AI 标签归一化。",
		});

		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn(async () =>
			new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: JSON.stringify({
									tagSuggestions: [{ name: "rag/ai", confidence: 0.79, reason: "与既有标签语义一致" }],
								}),
							},
						},
					],
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			),
		) as typeof fetch;

		try {
			const enhanced = await readEnvelope<{
				tagSuggestions: Array<{ name: string }>;
			}>(await api(`/api/ai/notes/${created.id}/enhance`, {
				method: "POST",
				body: JSON.stringify({ query: "RAG" }),
			}, {
				AI_BASE_URL: "https://api.siliconflow.cn/v1",
				AI_CHAT_MODEL: "Qwen/Qwen2.5-7B-Instruct",
				SILICONFLOW_API_KEY: "test-key",
			}));

			expect(enhanced.data.tagSuggestions[0]?.name).toBe("ai-rag");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("uses same-folder notes as relation candidates when retrieval results are sparse", async () => {
		const source = await createNote({
			title: "双链功能必要性探讨",
			folderId: "folder-10-projects",
			bodyText: "我不会主动在一篇 note 里提及另一篇 note，更依赖 AI 判断关系。",
		});
		const sibling = await createNote({
			title: "dotNotes：停用全译 + 格式强化改进提案",
			folderId: "folder-10-projects",
			bodyText: "讨论 dotNotes 的产品设计、编辑体验和后续演进。",
		});
		await createNote({
			title: "Area Note",
			folderId: "folder-20-areas",
			bodyText: "不同 folder 的笔记，不应该作为这条回归测试的唯一候选来源。",
		});

		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn(async (input, init) => {
			const url = typeof input === "string" ? input : input instanceof Request ? input.url : "";
			if (url.includes("/embeddings")) {
				return new Response(
					JSON.stringify({
						data: [{ index: 0, embedding: [1, 0, 0, 0] }],
					}),
					{
						status: 200,
						headers: { "Content-Type": "application/json" },
					},
				);
			}
			const payload = typeof init?.body === "string"
				? JSON.parse(init.body) as { messages?: Array<{ role?: string; content?: string }> }
				: {};
			const userPrompt = payload.messages?.find((item) => item.role === "user")?.content ?? "";
			const inputMarker = "input: ";
			const schemaMarker = "\nschema:";
			const inputStart = userPrompt.indexOf(inputMarker);
			const schemaStart = userPrompt.indexOf(schemaMarker, inputStart);
			expect(inputStart).toBeGreaterThanOrEqual(0);
			expect(schemaStart).toBeGreaterThan(inputStart);
			const promptInput = JSON.parse(
				userPrompt.slice(inputStart + inputMarker.length, schemaStart),
			) as { candidates?: Array<{ noteId: string }> };
			expect(promptInput.candidates?.map((item) => item.noteId)).toContain(sibling.id);

			return new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: JSON.stringify({
									relationSuggestions: [
										{
											noteId: sibling.id,
											relationType: "same_project",
											score: 0.87,
											reason: "同一目录下都在讨论 dotNotes 的产品设计。",
											evidenceExcerpt: "都围绕 dotFamily / dotNotes 的功能设计展开。",
										},
									],
								}),
							},
						},
					],
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		}) as typeof fetch;

		try {
			const enhanced = await readEnvelope<{
				relationSuggestions: Array<{ noteId: string; relationType: string }>;
			}>(await api(`/api/ai/notes/${source.id}/enhance/relations`, {
				method: "POST",
				body: JSON.stringify({}),
			}, {
				AI_BASE_URL: "https://api.siliconflow.cn/v1",
				AI_CHAT_MODEL: "Qwen/Qwen2.5-7B-Instruct",
				SILICONFLOW_API_KEY: "test-key",
			}));

			expect(enhanced.data.relationSuggestions[0]?.noteId).toBe(sibling.id);
			expect(enhanced.data.relationSuggestions[0]?.relationType).toBe("same_project");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("does not call embeddings when running summary task only", async () => {
		const created = await createNote({
			title: "Short Note",
			folderId: "folder-10-projects",
			bodyText: "短笔记，不需要检索上下文。",
		});
		const calledUrls: string[] = [];
		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn(async (input) => {
			const url = typeof input === "string" ? input : input instanceof Request ? input.url : "";
			calledUrls.push(url);
			return new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: JSON.stringify({
									summary: "should-not-be-used",
									outline: ["x"],
								}),
							},
						},
					],
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		}) as typeof fetch;
		try {
			const enhanced = await readEnvelope<{
				summaryMeta: { skipped: boolean; reason: string | null };
			}>(await api(`/api/ai/notes/${created.id}/enhance/summary`, {
				method: "POST",
				body: JSON.stringify({ query: "短笔记" }),
			}, {
				AI_BASE_URL: "https://api.siliconflow.cn/v1",
				AI_CHAT_MODEL: "Qwen/Qwen2.5-7B-Instruct",
				SILICONFLOW_API_KEY: "test-key",
				AI_EMBEDDING_MODEL: "test-embedding-model",
			}));
			expect(enhanced.data.summaryMeta.skipped).toBe(true);
			expect(calledUrls.some((url) => url.includes("/embeddings"))).toBe(false);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("streams task progress and final result for title task", async () => {
		const created = await createNote({
			title: "Stream Title",
			folderId: "folder-10-projects",
			bodyText: "A note for streaming task response.",
		});
		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn(async () =>
			new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: JSON.stringify({
									titleCandidates: [{ title: "Streaming Title Candidate", confidence: 0.9, reason: "stream test" }],
								}),
							},
						},
					],
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			),
		) as typeof fetch;
		try {
			const response = await api(`/api/ai/notes/${created.id}/enhance/title/stream`, {
				method: "POST",
				body: JSON.stringify({ query: "stream title" }),
			}, {
				AI_BASE_URL: "https://api.siliconflow.cn/v1",
				AI_CHAT_MODEL: "Qwen/Qwen2.5-7B-Instruct",
				SILICONFLOW_API_KEY: "test-key",
			});
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type") ?? "").toContain("text/event-stream");
			const text = await response.text();
			expect(text).toContain("event: start");
			expect(text).toContain("event: done");
			expect(text).toContain("Streaming Title Candidate");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

async function createNote(input: {
	title: string;
	folderId: string;
	bodyText: string;
	tagNames?: string[];
}) {
	const created = await readEnvelope<NotePayload>(await api("/api/notes", {
		method: "POST",
		body: JSON.stringify({
			title: input.title,
			folderId: input.folderId,
			bodyText: input.bodyText,
			tagNames: input.tagNames ?? [],
			storageType: "d1",
		}),
	}));
	return created.data;
}

async function api(pathname: string, init?: RequestInit, envOverrides: Record<string, unknown> = {}) {
	const headers = new Headers(init?.headers);
	if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
		headers.set("Content-Type", "application/json");
	}
	headers.set("Accept", "application/json");
	return app.request(`https://dotnotes.test${pathname}`, { ...init, headers }, {
		DB: db as unknown as D1Database,
		NOTES_BUCKET: bucket as unknown as R2Bucket,
		NOTES_VECTOR_INDEX: vectorIndex as unknown as VectorizeIndex,
		BODY_R2_THRESHOLD_BYTES: "64",
		INDEX_CHUNK_MAX_CHARS: "120",
		INDEX_CHUNK_OVERLAP_CHARS: "16",
		INDEX_VECTOR_DIMENSIONS: "32",
		...envOverrides,
	} as Env, createExecutionContext());
}

async function readEnvelope<T = unknown>(response: Response): Promise<{ ok: true; data: T }> {
	const payload = await response.json() as { ok: boolean; data?: T; error?: string };
	expect(response.ok).toBe(true);
	expect(payload.ok).toBe(true);
	if (!("data" in payload)) {
		throw new Error(`missing data in response: ${JSON.stringify(payload)}`);
	}
	return payload as { ok: true; data: T };
}

function createExecutionContext(): ExecutionContext {
	return {
		waitUntil() {
			return Promise.resolve();
		},
		passThroughOnException() {
			return;
		},
	};
}

type NotePayload = {
	id: string;
	title: string;
	slug: string;
	folderId: string;
	storageType: "d1" | "r2";
	bodyText: string | null;
	isArchived: number;
	deletedAt: string | null;
};

type TagPayload = {
	id: string;
	name: string;
};

type NotesListPayload = {
	items: Array<{ id: string; storageType: "d1" | "r2"; bodyText: string | null; searchScore: number | null }>;
	search?: { mode: "fts" | "like-fallback" | "none"; keyword: string };
};

type AssetPayload = {
	id: string;
	noteId: string;
	fileName: string | null;
	downloadUrl: string;
};
