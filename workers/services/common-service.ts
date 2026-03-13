import type { Context } from "hono";

type AppContext = Context<{ Bindings: Env }>;

export function jsonOk<T>(c: AppContext, data: T, status: 200 | 201 = 200) {
	return c.json({ ok: true, data }, status);
}

export function jsonError(c: AppContext, status: 400 | 401 | 404 | 409 | 500, error: string, details?: string) {
	return c.json({ ok: false, error, details }, status);
}

export async function parseObjectBody(c: AppContext): Promise<Record<string, unknown> | null> {
	const body = await c.req.json<unknown>().catch(() => null);
	if (!isRecord(body)) {
		return null;
	}
	return body;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasOwn(obj: Record<string, unknown>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(obj, key);
}

export function readRequiredString(obj: Record<string, unknown>, key: string): string | null {
	const value = obj[key];
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export function readOptionalString(obj: Record<string, unknown>, key: string): string | null {
	const value = obj[key];
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export function readNullableString(obj: Record<string, unknown>, key: string): string | null {
	if (!hasOwn(obj, key) || obj[key] === null) {
		return null;
	}
	if (typeof obj[key] !== "string") {
		return null;
	}
	return obj[key].trim();
}

export function readOptionalNumber(obj: Record<string, unknown>, key: string): number | null {
	const value = obj[key];
	if (typeof value === "number" && Number.isFinite(value)) {
		return Math.trunc(value);
	}
	if (typeof value === "string" && value.trim().length > 0) {
		const parsed = Number.parseInt(value, 10);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return null;
}

export function parseBooleanLike(value: unknown): boolean {
	if (typeof value === "boolean") {
		return value;
	}
	if (typeof value === "number") {
		return value === 1;
	}
	if (typeof value === "string") {
		return value.toLowerCase() === "true" || value === "1";
	}
	return false;
}

export function parseCsv(value: string | undefined): string[] {
	if (!value) {
		return [];
	}
	const seen = new Set<string>();
	for (const item of value.split(",")) {
		const trimmed = item.trim();
		if (trimmed) {
			seen.add(trimmed);
		}
	}
	return [...seen];
}

export function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const unique = new Set<string>();
	for (const item of value) {
		if (typeof item !== "string") {
			continue;
		}
		const trimmed = item.trim();
		if (trimmed.length > 0) {
			unique.add(trimmed);
		}
	}
	return [...unique];
}

export function extractTagNames(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const unique = new Set<string>();
	for (const item of value) {
		if (typeof item === "string") {
			const trimmed = item.trim();
			if (trimmed) {
				unique.add(trimmed);
			}
			continue;
		}
		if (isRecord(item) && typeof item.name === "string") {
			const trimmed = item.name.trim();
			if (trimmed) {
				unique.add(trimmed);
			}
		}
	}
	return [...unique];
}

export function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
	if (!value) {
		return fallback;
	}
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed)) {
		return fallback;
	}
	return Math.min(max, Math.max(min, parsed));
}

export function placeholders(count: number): string {
	return Array.from({ length: count }, () => "?").join(", ");
}
