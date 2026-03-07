import type { Hono } from "hono";
import { registerAiRoutes } from "./routes/ai";
import { registerAssetRoutes } from "./routes/assets";
import { registerFolderRoutes } from "./routes/folders";
import { registerIndexRoutes } from "./routes/index";
import { registerNoteRoutes } from "./routes/notes";
import { registerOpsRoutes } from "./routes/ops";
import { registerRssRoutes } from "./routes/rss";
import { registerTagRoutes } from "./routes/tags";
import { registerApiFallbackRoutes } from "./services/note-query-service";

export function registerApiRoutes(app: Hono<{ Bindings: Env }>): void {
	registerFolderRoutes(app);
	registerTagRoutes(app);
	registerNoteRoutes(app);
	registerAssetRoutes(app);
	registerIndexRoutes(app);
	registerOpsRoutes(app);
	registerRssRoutes(app);
	registerAiRoutes(app);
	registerApiFallbackRoutes(app);
}
