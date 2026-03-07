import type { Hono } from "hono";
import { registerIndexRoutes as registerIndexRoutesFromService } from "../services/index-service";

export function registerIndexRoutes(app: Hono<{ Bindings: Env }>): void {
	registerIndexRoutesFromService(app);
}
