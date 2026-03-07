import type { Hono } from "hono";
import { registerAiRoutes as registerAiRoutesFromService } from "../services/ai-service";

export function registerAiRoutes(app: Hono<{ Bindings: Env }>): void {
	registerAiRoutesFromService(app);
}
