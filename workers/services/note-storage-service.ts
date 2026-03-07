import { countWords } from "./note-query-service";

type NoteRow = {
	id: string;
	slug: string;
	title: string;
	folderId: string;
	storageType: "d1" | "r2";
	bodyText: string | null;
	bodyR2Key: string | null;
	excerpt: string;
	sizeBytes: number;
	wordCount: number;
	isPinned: number;
	isArchived: number;
	deletedAt: string | null;
	createdAt: string;
	updatedAt: string;
	searchScore: number | null;
};

type NoteBodyStorageResult = {
	storageType: "d1" | "r2";
	bodyText: string | null;
	bodyR2Key: string | null;
	plainBodyText: string;
	sizeBytes: number;
	wordCount: number;
};

const DEFAULT_BODY_R2_THRESHOLD_BYTES = 64 * 1024;
const NOTE_BODY_R2_PREFIX = "note-bodies";

export function getBodyR2ThresholdBytes(env: Env): number {
	const value = "BODY_R2_THRESHOLD_BYTES" in env ? Number(env.BODY_R2_THRESHOLD_BYTES) : Number.NaN;
	if (Number.isFinite(value) && value > 0) {
		return Math.trunc(value);
	}
	return DEFAULT_BODY_R2_THRESHOLD_BYTES;
}

export function getNotesBucket(env: Env): R2Bucket | null {
	return "NOTES_BUCKET" in env && env.NOTES_BUCKET ? env.NOTES_BUCKET : null;
}

export async function resolveBodyStorageForCreate(
	env: Env,
	input: {
		noteId: string;
		requestedStorageType: "d1" | "r2";
		bodyText: string;
		bodyR2Key: string | null;
	},
): Promise<NoteBodyStorageResult> {
	const plainBodyText = input.bodyText;
	const sizeBytes = byteLength(plainBodyText);
	const wordCount = countWords(plainBodyText);
	const threshold = getBodyR2ThresholdBytes(env);
	const bucket = getNotesBucket(env);

	if (input.requestedStorageType === "r2") {
		const key = input.bodyR2Key || `${NOTE_BODY_R2_PREFIX}/${input.noteId}.md`;
		if (!input.bodyR2Key) {
			if (!bucket) {
				throw new Error("R2 bucket binding `NOTES_BUCKET` is missing");
			}
			await bucket.put(key, plainBodyText, {
				httpMetadata: { contentType: "text/markdown; charset=utf-8" },
			});
		}
		return {
			storageType: "r2",
			bodyText: null,
			bodyR2Key: key,
			plainBodyText,
			sizeBytes,
			wordCount,
		};
	}

	if (sizeBytes > threshold) {
		if (!bucket) {
			throw new Error("R2 bucket binding `NOTES_BUCKET` is missing");
		}
		const key = `${NOTE_BODY_R2_PREFIX}/${input.noteId}.md`;
		await bucket.put(key, plainBodyText, {
			httpMetadata: { contentType: "text/markdown; charset=utf-8" },
		});
		return {
			storageType: "r2",
			bodyText: null,
			bodyR2Key: key,
			plainBodyText,
			sizeBytes,
			wordCount,
		};
	}

	return {
		storageType: "d1",
		bodyText: plainBodyText,
		bodyR2Key: null,
		plainBodyText,
		sizeBytes,
		wordCount,
	};
}

export async function resolveBodyStorageForUpdate(
	env: Env,
	input: {
		noteId: string;
		requestedStorageType: "d1" | "r2";
		bodyTextInput: string | null | undefined;
		bodyR2KeyInput: string | null | undefined;
		existing: NoteRow;
	},
): Promise<NoteBodyStorageResult> {
	const bodyChanged = input.bodyTextInput !== undefined;
	const storageChanged = input.requestedStorageType !== input.existing.storageType;
	const bodyR2KeyChanged = input.bodyR2KeyInput !== undefined;
	const noStorageMutation = !bodyChanged && !storageChanged && !bodyR2KeyChanged;

	if (noStorageMutation) {
		const plain = input.existing.storageType === "d1"
			? (input.existing.bodyText ?? "")
			: await readNoteBodyFromR2(env, input.existing.bodyR2Key);
		return {
			storageType: input.existing.storageType,
			bodyText: input.existing.bodyText,
			bodyR2Key: input.existing.bodyR2Key,
			plainBodyText: plain,
			sizeBytes: byteLength(plain),
			wordCount: countWords(plain),
		};
	}

	let plainBodyText = "";
	if (bodyChanged) {
		plainBodyText = input.bodyTextInput ?? "";
	} else if (input.existing.storageType === "d1") {
		plainBodyText = input.existing.bodyText ?? "";
	} else {
		plainBodyText = await readNoteBodyFromR2(env, input.existing.bodyR2Key);
	}

	const sizeBytes = byteLength(plainBodyText);
	const wordCount = countWords(plainBodyText);
	const threshold = getBodyR2ThresholdBytes(env);
	const bucket = getNotesBucket(env);

	if (input.requestedStorageType === "r2") {
		const key = input.bodyR2KeyInput ?? input.existing.bodyR2Key ?? `${NOTE_BODY_R2_PREFIX}/${input.noteId}.md`;
		const shouldWriteBody =
			bodyChanged ||
			!input.existing.bodyR2Key ||
			(input.bodyR2KeyInput !== undefined && input.bodyR2KeyInput !== input.existing.bodyR2Key);
		if (shouldWriteBody) {
			if (!bucket) {
				throw new Error("R2 bucket binding `NOTES_BUCKET` is missing");
			}
			await bucket.put(key, plainBodyText, {
				httpMetadata: { contentType: "text/markdown; charset=utf-8" },
			});
		}
		if (input.existing.bodyR2Key && input.existing.bodyR2Key !== key) {
			await deleteObjectsFromR2(env, [input.existing.bodyR2Key]);
		}
		return {
			storageType: "r2",
			bodyText: null,
			bodyR2Key: key,
			plainBodyText,
			sizeBytes,
			wordCount,
		};
	}

	if (sizeBytes > threshold) {
		if (!bucket) {
			throw new Error("R2 bucket binding `NOTES_BUCKET` is missing");
		}
		const key = input.existing.bodyR2Key ?? `${NOTE_BODY_R2_PREFIX}/${input.noteId}.md`;
		await bucket.put(key, plainBodyText, {
			httpMetadata: { contentType: "text/markdown; charset=utf-8" },
		});
		return {
			storageType: "r2",
			bodyText: null,
			bodyR2Key: key,
			plainBodyText,
			sizeBytes,
			wordCount,
		};
	}

	if (input.existing.bodyR2Key) {
		await deleteObjectsFromR2(env, [input.existing.bodyR2Key]);
	}
	return {
		storageType: "d1",
		bodyText: plainBodyText,
		bodyR2Key: null,
		plainBodyText,
		sizeBytes,
		wordCount,
	};
}

export async function hydrateNoteBodiesFromR2(env: Env, notes: NoteRow[]): Promise<NoteRow[]> {
	return Promise.all(notes.map((note) => hydrateNoteBodyFromR2(env, note)));
}

export async function hydrateNoteBodyFromR2(env: Env, note: NoteRow): Promise<NoteRow> {
	if (note.storageType !== "r2") {
		return note;
	}
	const text = await readNoteBodyFromR2(env, note.bodyR2Key);
	return {
		...note,
		bodyText: text,
	};
}

async function readNoteBodyFromR2(env: Env, bodyR2Key: string | null): Promise<string> {
	if (!bodyR2Key) {
		return "";
	}
	const bucket = getNotesBucket(env);
	if (!bucket) {
		return "";
	}
	const object = await bucket.get(bodyR2Key);
	if (!object) {
		return "";
	}
	return object.text();
}

export async function deleteObjectsFromR2(env: Env, keys: Array<string | null | undefined>): Promise<void> {
	const bucket = getNotesBucket(env);
	if (!bucket) {
		return;
	}
	const filtered = [...new Set(keys.filter((key): key is string => Boolean(key)))];
	for (const key of filtered) {
		await bucket.delete(key);
	}
}

export function buildAssetDownloadUrl(assetId: string): string {
	return `/api/assets/${encodeURIComponent(assetId)}/content`;
}

export function sanitizeFileName(input: string): string {
	const trimmed = input.trim();
	const sanitized = trimmed
		.replace(/[^\p{L}\p{N}._-]+/gu, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 120);
	return sanitized || "attachment";
}

export async function sha256Hex(value: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", value);
	const bytes = new Uint8Array(digest);
	return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function listAssetKeysByNoteId(db: D1Database, noteId: string): Promise<string[]> {
	const { results } = await db.prepare(
		`SELECT r2_key AS r2Key
		 FROM assets
		 WHERE note_id = ?`,
	)
		.bind(noteId)
		.all<{ r2Key: string }>();
	return results.map((item) => item.r2Key);
}

function byteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}
