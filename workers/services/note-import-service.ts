import { isRecord } from "./common-service";
import { enqueueNoteIndexJob } from "./index-core-service";
import {
	buildExcerpt,
	buildTitle,
	ensurePresetFolders,
	ensureUniqueSlug,
	slugify,
	syncNoteFtsContent,
} from "./note-query-service";
import { resolveBodyStorageForCreate } from "./note-storage-service";

const READING_PARENT_FOLDER_ID = "folder-20-areas";
const READING_FOLDER_SLUG = "reading";
const READING_FOLDER_NAME = "Reading";
const READING_FOLDER_ID = "folder-20-areas-reading";
const NOTES_IMPORT_RSS_PATH = "/api/internal/notes/imports/rss";
const NOTES_IMPORT_SHARED_TOKEN_HEADER = "x-dotfamily-internal-token";

export type ImportedNoteCreateInput = {
	title?: string | null;
	bodyText: string;
	folderId: string;
	noteId?: string;
	slug?: string | null;
	excerpt?: string | null;
	requestedStorageType?: "d1" | "r2";
	indexAction?: "upsert" | "delete";
};

export type ImportedNoteCreateResult = {
	noteId: string;
	title: string;
	slug: string;
	folderId: string;
	created: true;
};

export type RssImportedNoteInput = {
	title?: string | null;
	bodyText: string;
};

export async function createImportedNote(
	env: Env,
	input: ImportedNoteCreateInput,
): Promise<ImportedNoteCreateResult> {
	await ensurePresetFolders(env.DB);
	const noteId = input.noteId ?? crypto.randomUUID();
	const normalizedTitle = (input.title ?? "").trim() || buildTitle(input.bodyText) || "Imported Note";
	const slug = await ensureUniqueSlug(env.DB, slugify(input.slug ?? normalizedTitle));
	const requestedStorageType = input.requestedStorageType ?? "d1";
	const resolvedBody = await resolveBodyStorageForCreate(env, {
		noteId,
		requestedStorageType,
		bodyText: input.bodyText,
		bodyR2Key: null,
	});
	const excerpt = input.excerpt?.trim() || buildExcerpt(resolvedBody.plainBodyText);

	await env.DB.prepare(
		`INSERT INTO notes (
			id, slug, title, folder_id, storage_type, body_text, body_r2_key, excerpt, size_bytes, word_count, is_pinned, is_archived
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
	)
		.bind(
			noteId,
			slug,
			normalizedTitle,
			input.folderId,
			resolvedBody.storageType,
			resolvedBody.bodyText,
			resolvedBody.bodyR2Key,
			excerpt,
			resolvedBody.sizeBytes,
			resolvedBody.wordCount,
		)
		.run();

	await syncNoteFtsContent(env.DB, noteId, normalizedTitle, excerpt, resolvedBody.plainBodyText);
	await enqueueNoteIndexJob(env.DB, noteId, input.indexAction ?? "upsert");

	return {
		noteId,
		title: normalizedTitle,
		slug,
		folderId: input.folderId,
		created: true,
	};
}

export async function createRssImportedNote(
	env: Env,
	input: RssImportedNoteInput,
): Promise<ImportedNoteCreateResult> {
	return createImportedNote(env, {
		title: input.title,
		bodyText: input.bodyText,
		folderId: await ensureReadingFolder(env.DB),
		requestedStorageType: "d1",
		indexAction: "upsert",
	});
}

export async function requestRssImportedNote(
	env: Env,
	input: RssImportedNoteInput,
): Promise<ImportedNoteCreateResult> {
	const ext = env as Env & {
		NOTES_API_BASE_URL?: string;
		NOTES_API_SHARED_TOKEN?: string;
	};
	const baseUrl = (ext.NOTES_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
	if (!baseUrl) {
		return createRssImportedNote(env, input);
	}

	const headers = new Headers({
		"Accept": "application/json",
		"Content-Type": "application/json",
	});
	const sharedToken = (ext.NOTES_API_SHARED_TOKEN ?? "").trim();
	if (sharedToken) {
		headers.set(NOTES_IMPORT_SHARED_TOKEN_HEADER, sharedToken);
	}

	const response = await fetch(`${baseUrl}${NOTES_IMPORT_RSS_PATH}`, {
		method: "POST",
		headers,
		body: JSON.stringify(input),
	});
	if (!response.ok) {
		const errorText = (await response.text().catch(() => "")).slice(0, 500);
		throw new Error(`Notes RSS import request failed: ${response.status} ${errorText}`.trim());
	}

	const payload = await response.json<unknown>();
	const parsed = parseImportedNoteEnvelope(payload);
	if (!parsed) {
		throw new Error("Notes RSS import response is invalid");
	}
	return parsed;
}

export function getNotesImportSharedTokenHeaderName(): string {
	return NOTES_IMPORT_SHARED_TOKEN_HEADER;
}

function parseImportedNoteEnvelope(value: unknown): ImportedNoteCreateResult | null {
	if (!isRecord(value) || value.ok !== true || !isRecord(value.data)) {
		return null;
	}
	const data = value.data;
	if (
		typeof data.noteId !== "string" ||
		typeof data.title !== "string" ||
		typeof data.slug !== "string" ||
		typeof data.folderId !== "string" ||
		typeof data.created !== "boolean"
	) {
		return null;
	}
	if (!data.created) {
		return null;
	}
	return {
		noteId: data.noteId,
		title: data.title,
		slug: data.slug,
		folderId: data.folderId,
		created: true,
	};
}

async function ensureReadingFolder(db: D1Database): Promise<string> {
	await ensurePresetFolders(db);
	const existing = await db.prepare(
		`SELECT id
		 FROM folders
		 WHERE parent_id = ?
		   AND slug = ?
		 LIMIT 1`,
	)
		.bind(READING_PARENT_FOLDER_ID, READING_FOLDER_SLUG)
		.first<{ id: string }>();
	if (existing?.id) {
		return existing.id;
	}
	await db.prepare(
		`INSERT OR IGNORE INTO folders (id, parent_id, name, slug, sort_order)
		 VALUES (?, ?, ?, ?, ?)`,
	)
		.bind(READING_FOLDER_ID, READING_PARENT_FOLDER_ID, READING_FOLDER_NAME, READING_FOLDER_SLUG, 20)
		.run();
	return READING_FOLDER_ID;
}
