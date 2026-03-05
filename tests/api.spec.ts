import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../workers/app";
import { FakeD1Database } from "./helpers/fake-d1";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schemaSql = readFileSync(path.resolve(__dirname, "../db/schema.sql"), "utf8");

let db: FakeD1Database;

beforeEach(async () => {
	db = new FakeD1Database();
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
	if (init?.body && !headers.has("Content-Type")) {
		headers.set("Content-Type", "application/json");
	}
	headers.set("Accept", "application/json");
	return app.request(`https://dotnotes.test${pathname}`, { ...init, headers }, {
		DB: db as unknown as D1Database,
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
	isArchived: number;
	deletedAt: string | null;
};

type TagPayload = {
	id: string;
	name: string;
};

type NotesListPayload = {
	items: Array<{ id: string }>;
	search?: { mode: "fts" | "like-fallback" | "none"; keyword: string };
};
