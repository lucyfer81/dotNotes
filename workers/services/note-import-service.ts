import { isRecord } from "./common-service";
import { enqueueNoteIndexJob } from "./index-core-service";
import { fetchTagsForSingleNote, replaceNoteTags, resolveTagIds } from "./note-relations-service";
import {
	buildExcerpt,
	buildTitle,
	ensurePresetFolders,
	ensureUniqueSlug,
	getTagPerNoteLimit,
	slugify,
	syncNoteFtsContent,
} from "./note-query-service";
import { resolveBodyStorageForCreate } from "./note-storage-service";

const INBOX_FOLDER_ID = "folder-00-inbox";
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

export type AppImportedNoteInput = {
	title: string;
	bodyText: string;
	tags?: string[];
	folder?: string | null;
	folderId?: string | null;
};

export type AppImportedNoteCreateResult = ImportedNoteCreateResult & {
	tags: Array<{ id: string; name: string }>;
};

type FolderLookupRow = {
	id: string;
	parentId: string | null;
	name: string;
	slug: string;
};

export class ImportedNoteInputError extends Error {
	readonly details?: string;

	constructor(message: string, details?: string) {
		super(message);
		this.name = "ImportedNoteInputError";
		this.details = details;
	}
}

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

export async function createAppImportedNote(
	env: Env,
	input: AppImportedNoteInput,
): Promise<AppImportedNoteCreateResult> {
	const folderId = await resolveImportedFolderId(env.DB, input.folderId ?? input.folder ?? null);
	const { tagIds, ignoredTagNames } = await resolveTagIds(env, env.DB, [], input.tags ?? []);
	if (ignoredTagNames.length > 0) {
		throw new ImportedNoteInputError(
			`Too many tag names, max ${getTagPerNoteLimit(env)}`,
			ignoredTagNames.join(","),
		);
	}

	const created = await createImportedNote(env, {
		title: input.title,
		bodyText: input.bodyText,
		folderId,
		requestedStorageType: "d1",
		indexAction: "upsert",
	});
	await replaceNoteTags(env.DB, created.noteId, tagIds);
	const tags = (await fetchTagsForSingleNote(env.DB, created.noteId)).map((tag) => ({
		id: tag.id,
		name: tag.name,
	}));

	return {
		...created,
		tags,
	};
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

export function getNotesAppImportPath(): string {
	return "/api/internal/notes/imports";
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

async function resolveImportedFolderId(db: D1Database, folderRef: string | null): Promise<string> {
	await ensurePresetFolders(db);
	const normalizedRef = folderRef?.trim() ?? "";
	if (!normalizedRef) {
		return INBOX_FOLDER_ID;
	}

	const byId = await db.prepare("SELECT id FROM folders WHERE id = ? LIMIT 1")
		.bind(normalizedRef)
		.first<{ id: string }>();
	if (byId?.id) {
		return byId.id;
	}

	const pathSegments = normalizedRef
		.split("/")
		.map((segment) => segment.trim())
		.filter((segment) => segment.length > 0);
	if (pathSegments.length > 1) {
		return resolveFolderPath(db, pathSegments);
	}

	const slug = slugify(normalizedRef);
	const { results } = await db.prepare(
		`SELECT
			id,
			parent_id AS parentId,
			name,
			slug
		 FROM folders
		 WHERE slug = ?
		    OR LOWER(name) = LOWER(?)
		 ORDER BY COALESCE(parent_id, ''), name ASC`,
	)
		.bind(slug, normalizedRef)
		.all<FolderLookupRow>();

	if (results.length === 1) {
		return results[0]!.id;
	}
	if (results.length > 1) {
		throw new ImportedNoteInputError(
			"Folder is ambiguous, please use folderId or full folder path",
			results.map((folder) => buildFolderLabel(folder)).join(", "),
		);
	}

	throw new ImportedNoteInputError("Folder does not exist", normalizedRef);
}

async function resolveFolderPath(db: D1Database, segments: string[]): Promise<string> {
	let parentId: string | null = null;
	let current: FolderLookupRow | null = null;

	for (const segment of segments) {
		const slug = slugify(segment);
		const queryResult = await db.prepare(
			`SELECT
				id,
				parent_id AS parentId,
				name,
				slug
			 FROM folders
			 WHERE COALESCE(parent_id, '__root__') = COALESCE(?, '__root__')
			   AND (slug = ? OR LOWER(name) = LOWER(?))
			 ORDER BY name ASC`,
		)
			.bind(parentId, slug, segment)
			.all<FolderLookupRow>();
		const results: FolderLookupRow[] = queryResult.results;

		if (results.length === 0) {
			throw new ImportedNoteInputError("Folder path does not exist", segments.join("/"));
		}
		if (results.length > 1) {
			throw new ImportedNoteInputError(
				"Folder path is ambiguous, please use folderId",
				segments.join("/"),
			);
		}

		const matchedFolder = results[0]!;
		current = matchedFolder;
		parentId = matchedFolder.id;
	}

	if (!current) {
		throw new ImportedNoteInputError("Folder path does not exist", segments.join("/"));
	}
	return current.id;
}

function buildFolderLabel(folder: FolderLookupRow): string {
	return folder.parentId ? `${folder.name} (${folder.slug})` : `${folder.name}`;
}
