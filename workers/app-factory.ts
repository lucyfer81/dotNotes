import { Hono } from "hono";
import { registerAppMiddleware } from "./app-middleware";
import { registerApiRoutes } from "./app-routes";
import { registerSsrRoute } from "./app-ssr";

export function createApp(): Hono<{ Bindings: Env }> {
	const app = new Hono<{ Bindings: Env }>();
	registerAppMiddleware(app);
	registerApiRoutes(app);
	registerSsrRoute(app);
	return app;
}
