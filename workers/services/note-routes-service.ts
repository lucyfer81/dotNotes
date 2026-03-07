import type { Hono } from "hono";
import { registerNoteReadRoutes } from "./note-read-routes-service";
import { registerNoteWriteRoutes } from "./note-write-routes-service";
import { registerNoteMaintenanceRoutes } from "./note-maintenance-routes-service";

export function registerNoteRoutes(app: Hono<{ Bindings: Env }>): void {
	registerNoteReadRoutes(app);
	registerNoteWriteRoutes(app);
	registerNoteMaintenanceRoutes(app);
}
