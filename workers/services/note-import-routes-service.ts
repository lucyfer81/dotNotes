import type { Hono } from "hono";
import { jsonError, jsonOk, parseObjectBody, readOptionalString, readRequiredString } from "./common-service";
import {
	createRssImportedNote,
	getNotesImportSharedTokenHeaderName,
} from "./note-import-service";

export function registerNoteImportRoutes(app: Hono<{ Bindings: Env }>): void {
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
	const ext = env as Env & { NOTES_API_SHARED_TOKEN?: string };
	const requiredToken = (ext.NOTES_API_SHARED_TOKEN ?? "").trim();
	if (!requiredToken) {
		return true;
	}
	return providedToken === requiredToken;
}
