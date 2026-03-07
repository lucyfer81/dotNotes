import type { Hono } from "hono";
import { registerRssRoutes as registerRssRoutesFromService } from "../services/rss-service";

export function registerRssRoutes(app: Hono<{ Bindings: Env }>): void {
	registerRssRoutesFromService(app);
}
