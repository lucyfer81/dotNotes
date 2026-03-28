import type { Hono } from "hono";
import {
	extractTagNames,
	jsonError,
	jsonOk,
	parseCsv,
	parseObjectBody,
	readOptionalString,
	readRequiredString,
	toStringArray,
} from "./common-service";
import { scheduleIndexProcessing } from "./index-core-service";
import {
	createAppImportedNote,
	createRssImportedNote,
	getNotesAppImportPath,
	getNotesImportSharedTokenHeaderName,
	ImportedNoteInputError,
} from "./note-import-service";

export function registerNoteImportRoutes(app: Hono<{ Bindings: Env }>): void {
	app.post(getNotesAppImportPath(), async (c) => {
		const requiredToken = getConfiguredSharedToken(c.env);
		if (!requiredToken) {
			return jsonError(c, 500, "NOTES_API_SHARED_TOKEN is not configured");
		}
		if (c.req.header(getNotesImportSharedTokenHeaderName()) !== requiredToken) {
			return jsonError(c, 401, "Unauthorized internal import request");
		}

		const payload = await parseObjectBody(c);
		if (!payload) {
			return jsonError(c, 400, "Invalid JSON body");
		}

		const title = readRequiredString(payload, "title");
		if (!title) {
			return jsonError(c, 400, "`title` is required");
		}

		const bodyText = readRequiredContent(payload);
		if (!bodyText) {
			return jsonError(c, 400, "`content` is required");
		}

		try {
			const created = await createAppImportedNote(c.env, {
				title,
				bodyText,
				tags: readImportedTags(payload),
				folderId: readOptionalString(payload, "folderId"),
				folder: readOptionalString(payload, "folder"),
			});
			scheduleIndexProcessing(c, 1);
			return jsonOk(c, created, 201);
		} catch (error) {
			if (error instanceof ImportedNoteInputError) {
				return jsonError(c, 400, error.message, error.details);
			}
			throw error;
		}
	});

	app.post("/api/internal/notes/imports/rss", async (c) => {
		if (!isAuthorizedInternalRequest(c.env, c.req.header(getNotesImportSharedTokenHeaderName()))) {
			return jsonError(c, 401, "Unauthorized internal import request");
		}
		const payload = await parseObjectBody(c);
		if (!payload) {
			return jsonError(c, 400, "Invalid JSON body");
		}
		const bodyText = readRequiredString(payload, "bodyText");
		if (!bodyText) {
			return jsonError(c, 400, "`bodyText` is required");
		}
		const created = await createRssImportedNote(c.env, {
			title: readOptionalString(payload, "title"),
			bodyText,
		});
		return jsonOk(c, created, 201);
	});
}

function isAuthorizedInternalRequest(env: Env, providedToken: string | undefined): boolean {
	const requiredToken = getConfiguredSharedToken(env);
	if (!requiredToken) {
		return true;
	}
	return providedToken === requiredToken;
}

function getConfiguredSharedToken(env: Env): string {
	const ext = env as Env & { NOTES_API_SHARED_TOKEN?: string };
	return (ext.NOTES_API_SHARED_TOKEN ?? "").trim();
}

function readRequiredContent(payload: Record<string, unknown>): string | null {
	return readRequiredString(payload, "content") ?? readRequiredString(payload, "bodyText");
}

function readImportedTags(payload: Record<string, unknown>): string[] {
	const fromTags =
		typeof payload.tags === "string"
			? parseCsv(payload.tags)
			: [...toStringArray(payload.tags), ...extractTagNames(payload.tags)];
	const merged = [
		...toStringArray(payload.tagNames),
		...fromTags,
	];
	return [...new Set(merged)];
}
