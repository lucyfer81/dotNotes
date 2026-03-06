import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
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

describe("wiki link behavior with renamed titles", () => {
	it("stores links in database only and keeps slug-stable links after title rename", async () => {
		const target = await createNote({
			title: "dotBlog",
			folderId: "folder-10-projects",
			bodyText: "target note body",
		});
		const source = await createNote({
			title: "dotFamily",
			folderId: "folder-10-projects",
			bodyText: "ref [[dotBlog]]",
		});

		const beforeRename = await readEnvelope<NoteLinksPayload>(
			await api(`/api/notes/${source.id}/links?status=all`),
		);
		expect(beforeRename.data.outbound).toEqual([]);

		await readEnvelope<NotePayload>(await api(`/api/notes/${source.id}`, {
			method: "PUT",
			body: JSON.stringify({
				linkSlugs: ["dotblog"],
			}),
		}));

		const linked = await readEnvelope<NoteLinksPayload>(
			await api(`/api/notes/${source.id}/links?status=all`),
		);
		expect(linked.data.outbound.map((item) => item.noteId)).toEqual([target.id]);
		expect(linked.data.outbound[0]?.slug).toBe("dotblog");
		expect(linked.data.outbound[0]?.title).toBe("dotBlog");

		await readEnvelope<NotePayload>(await api(`/api/notes/${target.id}`, {
			method: "PUT",
			body: JSON.stringify({
				title: "dotWatcher",
				bodyText: "target note body",
			}),
		}));

		const sourceAfterRename = await readEnvelope<NotePayload>(await api(`/api/notes/${source.id}`));
		expect(sourceAfterRename.data.bodyText).toContain("[[dotBlog]]");

		const linksAfterRename = await readEnvelope<NoteLinksPayload>(
			await api(`/api/notes/${source.id}/links?status=all`),
		);
		expect(linksAfterRename.data.outbound.map((item) => item.noteId)).toEqual([target.id]);
		expect(linksAfterRename.data.outbound[0]?.slug).toBe("dotblog");
		expect(linksAfterRename.data.outbound[0]?.title).toBe("dotWatcher");

		await readEnvelope<NotePayload>(await api(`/api/notes/${source.id}`, {
			method: "PUT",
			body: JSON.stringify({
				bodyText: "ref [[dotWatcher|dotblog]]",
			}),
		}));

		const linksAfterBodyUpdate = await readEnvelope<NoteLinksPayload>(
			await api(`/api/notes/${source.id}/links?status=all`),
		);
		expect(linksAfterBodyUpdate.data.outbound.map((item) => item.noteId)).toEqual([target.id]);
		expect(linksAfterBodyUpdate.data.outbound[0]?.slug).toBe("dotblog");
		expect(linksAfterBodyUpdate.data.outbound[0]?.title).toBe("dotWatcher");

		await readEnvelope<NotePayload>(await api(`/api/notes/${source.id}`, {
			method: "PUT",
			body: JSON.stringify({
				linkSlugs: [],
			}),
		}));
		const linksAfterClear = await readEnvelope<NoteLinksPayload>(
			await api(`/api/notes/${source.id}/links?status=all`),
		);
		expect(linksAfterClear.data.outbound).toEqual([]);
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

async function api(pathname: string, init?: RequestInit) {
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
	storageType: "d1" | "r2";
	bodyText: string | null;
	isArchived: number;
	deletedAt: string | null;
};

type NoteLinksPayload = {
	noteId: string;
	outbound: Array<{ noteId: string; slug: string; title: string }>;
	inbound: Array<{ noteId: string; slug: string; title: string }>;
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
