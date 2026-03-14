import type { Hono } from "hono";
import { registerNoteImportRoutes } from "./note-import-routes-service";
import { registerNoteRelationRoutes } from "./note-relation-routes-service";
import { registerNoteReadRoutes } from "./note-read-routes-service";
import { registerNoteWriteRoutes } from "./note-write-routes-service";
import { registerNoteMaintenanceRoutes } from "./note-maintenance-routes-service";

export function registerNoteRoutes(app: Hono<{ Bindings: Env }>): void {
	registerNoteImportRoutes(app);
	registerNoteReadRoutes(app);
	registerNoteRelationRoutes(app);
	registerNoteWriteRoutes(app);
	registerNoteMaintenanceRoutes(app);
}
