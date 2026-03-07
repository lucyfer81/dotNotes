import type { Hono } from "hono";
import { registerOpsRoutes as registerOpsRoutesFromService } from "../services/ops-service";

export function registerOpsRoutes(app: Hono<{ Bindings: Env }>): void {
	registerOpsRoutesFromService(app);
}
