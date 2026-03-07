import type { Hono } from "hono";
import { registerAssetRoutes as registerAssetRoutesFromService } from "../services/asset-service";

export function registerAssetRoutes(app: Hono<{ Bindings: Env }>): void {
	registerAssetRoutesFromService(app);
}
