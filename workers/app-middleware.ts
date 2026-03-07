import type { Hono } from "hono";
import { registerApiMiddleware } from "./services/ops-core-service";

export function registerAppMiddleware(app: Hono<{ Bindings: Env }>): void {
	registerApiMiddleware(app);
}
