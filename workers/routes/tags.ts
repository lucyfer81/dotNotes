import type { Hono } from "hono";
import { registerTagRoutes as registerTagRoutesFromService } from "../services/tag-service";

export function registerTagRoutes(app: Hono<{ Bindings: Env }>): void {
	registerTagRoutesFromService(app);
}
