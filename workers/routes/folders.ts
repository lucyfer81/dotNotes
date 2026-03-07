import type { Hono } from "hono";
import { registerFolderRoutes as registerFolderRoutesFromService } from "../services/folder-service";

export function registerFolderRoutes(app: Hono<{ Bindings: Env }>): void {
	registerFolderRoutesFromService(app);
}
