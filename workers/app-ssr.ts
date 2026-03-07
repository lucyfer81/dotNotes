import type { Hono } from "hono";
import { createRequestHandler } from "react-router";

export function registerSsrRoute(app: Hono<{ Bindings: Env }>): void {
	app.get("*", (c) => {
		const requestHandler = createRequestHandler(
			() => import("virtual:react-router/server-build"),
			import.meta.env.MODE,
		);
		return requestHandler(c.req.raw);
	});
}
