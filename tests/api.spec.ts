import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../workers/app";
import { FakeD1Database } from "./helpers/fake-d1";
import { FakeR2Bucket } from "./helpers/fake-r2";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schemaSql = readFileSync(path.resolve(__dirname, "../db/schema.sql"), "utf8");

let db: FakeD1Database;
let bucket: FakeR2Bucket;

beforeEach(async () => {
	db = new FakeD1Database();
	bucket = new FakeR2Bucket();
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
		const largeBody = `# Big note\n${"large-content ".repeat(40).trimEnd()}`;
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
		BODY_R2_THRESHOLD_BYTES: "64",
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
	items: Array<{ id: string; storageType: "d1" | "r2"; bodyText: string | null }>;
	search?: { mode: "fts" | "like-fallback" | "none"; keyword: string };
};

type AssetPayload = {
	id: string;
	noteId: string;
	fileName: string | null;
	downloadUrl: string;
};
