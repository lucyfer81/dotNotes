export type FolderApiItem = {
	id: string;
	parentId: string | null;
	name: string;
	sortOrder: number;
};

export type TagApiItem = {
	id: string;
	name: string;
	color: string;
	createdAt: string;
};

export type NoteApiItem = {
	id: string;
	slug: string;
	title: string;
	folderId: string;
	storageType: "d1" | "r2";
	bodyText: string | null;
	excerpt: string;
	updatedAt: string;
	tags: TagApiItem[];
};

export type NoteLinkApiItem = {
	noteId: string;
	slug: string;
	title: string;
	updatedAt: string;
	anchorText: string | null;
};

export type NoteLinksApiItem = {
	noteId: string;
	outbound: NoteLinkApiItem[];
	inbound: NoteLinkApiItem[];
};

type ListNotesOptions = {
	limit?: number;
	offset?: number;
	folderId?: string | null;
	tagIds?: string[];
	tagMode?: "any" | "all";
	keyword?: string;
	includeArchived?: boolean;
};

type UpdateNoteInput = {
	title?: string;
	folderId?: string;
	bodyText?: string;
	excerpt?: string;
	tagNames?: string[];
};

type CreateNoteInput = {
	title: string;
	folderId: string;
	bodyText: string;
	tagNames?: string[];
};

type CreateFolderInput = {
	name: string;
	parentId: string;
	sortOrder?: number;
	slug?: string;
};

type UpdateFolderInput = {
	name?: string;
	parentId?: string;
	sortOrder?: number;
	slug?: string;
};

export async function listFolders(): Promise<FolderApiItem[]> {
	const data = await requestApiData<unknown>("/api/folders");
	if (!Array.isArray(data)) {
		throw new Error("Invalid folders response");
	}
	return data
		.map((item) => toFolderApiItem(item))
		.filter((item): item is FolderApiItem => item !== null)
		.sort((a, b) => {
			if (a.parentId === b.parentId) {
				return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-CN");
			}
			if (a.parentId === null) {
				return -1;
			}
			if (b.parentId === null) {
				return 1;
			}
			return a.parentId.localeCompare(b.parentId, "zh-CN");
		});
}

export async function listRootFolders(): Promise<FolderApiItem[]> {
	const folders = await listFolders();
	return folders
		.filter((item) => item.parentId === null)
		.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-CN"));
}

export async function createFolder(input: CreateFolderInput): Promise<FolderApiItem> {
	const data = await requestApiData<unknown>("/api/folders", {
		method: "POST",
		body: JSON.stringify({
			name: input.name,
			parentId: input.parentId,
			sortOrder: input.sortOrder,
			slug: input.slug,
		}),
	});
	const folder = toFolderApiItem(data);
	if (!folder) {
		throw new Error("Invalid create folder response");
	}
	return folder;
}

export async function updateFolder(folderId: string, input: UpdateFolderInput): Promise<FolderApiItem> {
	const data = await requestApiData<unknown>(`/api/folders/${encodeURIComponent(folderId)}`, {
		method: "PATCH",
		body: JSON.stringify(input),
	});
	const folder = toFolderApiItem(data);
	if (!folder) {
		throw new Error("Invalid update folder response");
	}
	return folder;
}

export async function listTags(): Promise<TagApiItem[]> {
	const data = await requestApiData<unknown>("/api/tags");
	if (!Array.isArray(data)) {
		throw new Error("Invalid tags response");
	}
	return data
		.map((item) => toTagApiItem(item))
		.filter((item): item is TagApiItem => item !== null);
}

export async function listNotes(options: ListNotesOptions = {}): Promise<NoteApiItem[]> {
	const query = new URLSearchParams();
	query.set("limit", String(options.limit ?? 100));
	if (typeof options.offset === "number") {
		query.set("offset", String(options.offset));
	}
	if (options.folderId) {
		query.set("folderId", options.folderId);
	}
	if (options.tagIds && options.tagIds.length > 0) {
		query.set("tagIds", options.tagIds.join(","));
	}
	if (options.tagMode) {
		query.set("tagMode", options.tagMode);
	}
	if (options.keyword?.trim()) {
		query.set("q", options.keyword.trim());
	}
	if (typeof options.includeArchived === "boolean") {
		query.set("includeArchived", options.includeArchived ? "1" : "0");
	}

	const data = await requestApiData<unknown>(`/api/notes?${query.toString()}`);
	if (!isRecord(data) || !Array.isArray(data.items)) {
		throw new Error("Invalid notes response");
	}
	return data.items
		.map((item) => toNoteApiItem(item))
		.filter((item): item is NoteApiItem => item !== null);
}

export async function createNote(input: CreateNoteInput): Promise<NoteApiItem> {
	const data = await requestApiData<unknown>("/api/notes", {
		method: "POST",
		body: JSON.stringify({
			title: input.title,
			folderId: input.folderId,
			bodyText: input.bodyText,
			tagNames: input.tagNames ?? [],
			storageType: "d1",
		}),
	});
	const note = toNoteApiItem(data);
	if (!note) {
		throw new Error("Invalid create note response");
	}
	return note;
}

export async function updateNote(noteId: string, input: UpdateNoteInput): Promise<NoteApiItem> {
	const data = await requestApiData<unknown>(`/api/notes/${encodeURIComponent(noteId)}`, {
		method: "PUT",
		body: JSON.stringify(input),
	});
	const note = toNoteApiItem(data);
	if (!note) {
		throw new Error("Invalid update note response");
	}
	return note;
}

export async function deleteNote(noteId: string): Promise<void> {
	await requestApiData<unknown>(`/api/notes/${encodeURIComponent(noteId)}`, {
		method: "DELETE",
	});
}

export async function getNoteLinks(noteId: string): Promise<NoteLinksApiItem> {
	const data = await requestApiData<unknown>(`/api/notes/${encodeURIComponent(noteId)}/links`);
	const parsed = toNoteLinksApiItem(data);
	if (!parsed) {
		throw new Error("Invalid note links response");
	}
	return parsed;
}

async function requestApiData<T>(url: string, init?: RequestInit): Promise<T> {
	const headers = new Headers(init?.headers);
	headers.set("Accept", "application/json");
	if (init?.body && !headers.has("Content-Type")) {
		headers.set("Content-Type", "application/json");
	}

	const response = await fetch(url, { ...init, headers });
	const payload = await response.json().catch(() => null);
	if (!response.ok) {
		throw new Error(readApiError(payload, response.status));
	}
	if (!isRecord(payload) || payload.ok !== true || !("data" in payload)) {
		throw new Error("Invalid API envelope");
	}
	return payload.data as T;
}

function readApiError(payload: unknown, status: number): string {
	if (isRecord(payload) && typeof payload.error === "string") {
		return payload.error;
	}
	return `Request failed: ${status}`;
}

function toFolderApiItem(value: unknown): FolderApiItem | null {
	if (!isRecord(value)) {
		return null;
	}
	if (
		typeof value.id !== "string" ||
		typeof value.name !== "string" ||
		(typeof value.parentId !== "string" && value.parentId !== null) ||
		typeof value.sortOrder !== "number"
	) {
		return null;
	}
	return {
		id: value.id,
		parentId: value.parentId,
		name: value.name,
		sortOrder: value.sortOrder,
	};
}

function toTagApiItem(value: unknown): TagApiItem | null {
	if (!isRecord(value)) {
		return null;
	}
	if (
		typeof value.id !== "string" ||
		typeof value.name !== "string" ||
		typeof value.color !== "string" ||
		typeof value.createdAt !== "string"
	) {
		return null;
	}
	return {
		id: value.id,
		name: value.name,
		color: value.color,
		createdAt: value.createdAt,
	};
}

function toNoteApiItem(value: unknown): NoteApiItem | null {
	if (!isRecord(value)) {
		return null;
	}
	if (
		typeof value.id !== "string" ||
		typeof value.slug !== "string" ||
		typeof value.title !== "string" ||
		typeof value.folderId !== "string" ||
		(value.storageType !== "d1" && value.storageType !== "r2") ||
		(typeof value.bodyText !== "string" && value.bodyText !== null) ||
		typeof value.excerpt !== "string" ||
		typeof value.updatedAt !== "string"
	) {
		return null;
	}

	const tags = Array.isArray(value.tags)
		? value.tags
				.map((item) => toTagApiItem(item))
				.filter((item): item is TagApiItem => item !== null)
		: [];

	return {
		id: value.id,
		slug: value.slug,
		title: value.title,
		folderId: value.folderId,
		storageType: value.storageType,
		bodyText: value.bodyText,
		excerpt: value.excerpt,
		updatedAt: value.updatedAt,
		tags,
	};
}

function toNoteLinksApiItem(value: unknown): NoteLinksApiItem | null {
	if (!isRecord(value) || typeof value.noteId !== "string") {
		return null;
	}
	const outbound = Array.isArray(value.outbound)
		? value.outbound
				.map((item) => toNoteLinkApiItem(item))
				.filter((item): item is NoteLinkApiItem => item !== null)
		: [];
	const inbound = Array.isArray(value.inbound)
		? value.inbound
				.map((item) => toNoteLinkApiItem(item))
				.filter((item): item is NoteLinkApiItem => item !== null)
		: [];
	return {
		noteId: value.noteId,
		outbound,
		inbound,
	};
}

function toNoteLinkApiItem(value: unknown): NoteLinkApiItem | null {
	if (!isRecord(value)) {
		return null;
	}
	if (
		typeof value.noteId !== "string" ||
		typeof value.slug !== "string" ||
		typeof value.title !== "string" ||
		typeof value.updatedAt !== "string"
	) {
		return null;
	}
	if (typeof value.anchorText !== "string" && value.anchorText !== null && value.anchorText !== undefined) {
		return null;
	}
	return {
		noteId: value.noteId,
		slug: value.slug,
		title: value.title,
		updatedAt: value.updatedAt,
		anchorText: typeof value.anchorText === "string" ? value.anchorText : null,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
