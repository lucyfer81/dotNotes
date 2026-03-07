import type { Hono } from "hono";
import { registerNoteRoutes as registerNoteRoutesFromService } from "../services/note-routes-service";

export function registerNoteRoutes(app: Hono<{ Bindings: Env }>): void {
	registerNoteRoutesFromService(app);
}
