import type { Context, Hono } from "hono";
import { ensureNoteIndexSchema } from "./index-core-service";
import { jsonError } from "./common-service";

type AppContext = Context<{ Bindings: Env }>;
type ApiMetricsAlertStatus = "ok" | "warn" | "no_data";
type ApiMetricsAlert = {
	key: string;
	label: string;
	status: ApiMetricsAlertStatus;
	threshold: number;
	value: number | null;
	message: string;
};

type HttpTimingProbeSample = {
	ok: boolean;
	status: number | null;
	ttfbMs: number | null;
	totalMs: number;
	error: string | null;
};

type HttpTimingProbeInput = {
	url: string;
	method: "GET" | "POST";
	headers?: Record<string, string>;
	body?: string;
	timeoutMs: number;
};

const DEFAULT_API_ERROR_RATE_ALERT_THRESHOLD = 0.05;
const DEFAULT_SEARCH_P95_ALERT_THRESHOLD_MS = 800;
const DEFAULT_INDEX_SUCCESS_RATE_ALERT_THRESHOLD = 0.95;
const DEFAULT_INDEX_BACKLOG_ALERT_THRESHOLD = 20;

let apiMetricsSchemaReady = false;

export function registerApiMiddleware(app: Hono<{ Bindings: Env }>): void {
	app.onError((error, c) => {
		console.error("Unhandled API error", error);
		return jsonError(c, 500, "Internal server error", String(error));
	});

	app.use("/api/*", async (c, next) => {
		const startedAt = Date.now();
		try {
			await next();
		} finally {
			const routePath = c.req.path;
			if (routePath.startsWith("/api/ops/")) {
				return;
			}
			try {
				await recordApiRequestEvent(c.env.DB, {
					path: routePath,
					method: c.req.method,
					statusCode: c.res.status,
					durationMs: Date.now() - startedAt,
					isSearchRequest: isSearchNotesRequest(c),
				});
			} catch (error) {
				console.error("Failed to record API metrics event", error);
			}
		}
	});
}

function isSearchNotesRequest(c: AppContext): boolean {
	if (c.req.method !== "GET" || c.req.path !== "/api/notes") {
		return false;
	}
	const keyword = c.req.query("q");
	return typeof keyword === "string" && keyword.trim().length > 0;
}

function normalizeMetricsPath(pathname: string): string {
	return pathname.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id");
}

async function ensureApiMetricsSchema(db: D1Database): Promise<void> {
	if (apiMetricsSchemaReady) {
		return;
	}
	await db.prepare(
		`CREATE TABLE IF NOT EXISTS api_request_events (
			id TEXT PRIMARY KEY,
			path TEXT NOT NULL,
			method TEXT NOT NULL,
			status_code INTEGER NOT NULL,
			duration_ms INTEGER NOT NULL,
			is_error INTEGER NOT NULL DEFAULT 0 CHECK (is_error IN (0, 1)),
			is_search INTEGER NOT NULL DEFAULT 0 CHECK (is_search IN (0, 1)),
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
	).run();
	await db.prepare(
		"CREATE INDEX IF NOT EXISTS idx_api_request_events_created_at ON api_request_events(created_at)",
	).run();
	await db.prepare(
		"CREATE INDEX IF NOT EXISTS idx_api_request_events_search_time ON api_request_events(is_search, created_at)",
	).run();
	apiMetricsSchemaReady = true;
}

async function recordApiRequestEvent(
	db: D1Database,
	input: {
		path: string;
		method: string;
		statusCode: number;
		durationMs: number;
		isSearchRequest: boolean;
	},
): Promise<void> {
	await ensureApiMetricsSchema(db);
	await db.prepare(
		`INSERT INTO api_request_events (
			id, path, method, status_code, duration_ms, is_error, is_search
		) VALUES (?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			crypto.randomUUID(),
			normalizeMetricsPath(input.path),
			input.method,
			input.statusCode,
			Math.max(0, Math.trunc(input.durationMs)),
			input.statusCode >= 400 ? 1 : 0,
			input.isSearchRequest ? 1 : 0,
		)
		.run();
}

export async function buildOpsMetrics(db: D1Database, windowMinutes: number): Promise<{
	windowMinutes: number;
	generatedAt: string;
	api: {
		totalRequests: number;
		errorRequests: number;
		errorRate: number | null;
	};
	search: {
		requestCount: number;
		p50Ms: number | null;
		p95Ms: number | null;
		avgMs: number | null;
	};
	index: {
		pending: number;
		processing: number;
		failed: number;
		backlog: number;
		recentSuccess: number;
		recentFailed: number;
		successRate: number | null;
	};
	alerts: ApiMetricsAlert[];
}> {
	await ensureApiMetricsSchema(db);
	await ensureNoteIndexSchema(db);
	const windowExpr = `-${windowMinutes} minutes`;

	const apiTotals = await db.prepare(
		`SELECT
			COUNT(*) AS totalRequests,
			COALESCE(SUM(is_error), 0) AS errorRequests
		 FROM api_request_events
		 WHERE created_at >= datetime('now', ?)`,
	)
		.bind(windowExpr)
		.first<{ totalRequests: number; errorRequests: number }>();
	const totalRequests = apiTotals?.totalRequests ?? 0;
	const errorRequests = apiTotals?.errorRequests ?? 0;
	const errorRate = totalRequests > 0 ? errorRequests / totalRequests : null;

	const { results: searchRows } = await db.prepare(
		`SELECT duration_ms AS durationMs
		 FROM api_request_events
		 WHERE is_search = 1
		   AND created_at >= datetime('now', ?)
		 ORDER BY duration_ms ASC`,
	)
		.bind(windowExpr)
		.all<{ durationMs: number }>();
	const searchDurations = searchRows.map((row) => row.durationMs).filter((value) => Number.isFinite(value));
	const searchCount = searchDurations.length;
	const searchAvgMs = searchCount > 0
		? Math.round(searchDurations.reduce((sum, value) => sum + value, 0) / searchCount)
		: null;
	const searchP50Ms = percentileFromSorted(searchDurations, 0.5);
	const searchP95Ms = percentileFromSorted(searchDurations, 0.95);

	const indexStats = await db.prepare(
		`SELECT
			COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
			COALESCE(SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END), 0) AS processing,
			COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
			COALESCE(SUM(CASE WHEN status = 'success' AND last_indexed_at >= datetime('now', ?) THEN 1 ELSE 0 END), 0) AS recentSuccess,
			COALESCE(SUM(CASE WHEN status = 'failed' AND updated_at >= datetime('now', ?) THEN 1 ELSE 0 END), 0) AS recentFailed
		 FROM note_index_jobs`,
	)
		.bind(windowExpr, windowExpr)
		.first<{
			pending: number;
			processing: number;
			failed: number;
			recentSuccess: number;
			recentFailed: number;
		}>();
	const pending = indexStats?.pending ?? 0;
	const processing = indexStats?.processing ?? 0;
	const failed = indexStats?.failed ?? 0;
	const recentSuccess = indexStats?.recentSuccess ?? 0;
	const recentFailed = indexStats?.recentFailed ?? 0;
	const backlog = pending + processing + failed;
	const successRate = recentSuccess + recentFailed > 0
		? recentSuccess / (recentSuccess + recentFailed)
		: null;

	const alerts: ApiMetricsAlert[] = [
		buildMetricsAlert(
			"api_error_rate",
			"API 错误率",
			errorRate,
			DEFAULT_API_ERROR_RATE_ALERT_THRESHOLD,
			(value, threshold) => `当前 ${formatRate(value)}，阈值 ${formatRate(threshold)}`,
		),
		buildMetricsAlert(
			"search_p95_ms",
			"搜索 P95(ms)",
			searchP95Ms,
			DEFAULT_SEARCH_P95_ALERT_THRESHOLD_MS,
			(value, threshold) => `当前 ${Math.round(value)}ms，阈值 ${Math.round(threshold)}ms`,
		),
		buildMetricsAlert(
			"index_success_rate",
			"索引成功率",
			successRate,
			DEFAULT_INDEX_SUCCESS_RATE_ALERT_THRESHOLD,
			(value, threshold) => `当前 ${formatRate(value)}，阈值 ${formatRate(threshold)}`,
			"lt",
		),
		buildMetricsAlert(
			"index_backlog",
			"索引积压数",
			backlog,
			DEFAULT_INDEX_BACKLOG_ALERT_THRESHOLD,
			(value, threshold) => `当前 ${Math.round(value)}，阈值 ${Math.round(threshold)}`,
		),
	];

	return {
		windowMinutes,
		generatedAt: new Date().toISOString(),
		api: {
			totalRequests,
			errorRequests,
			errorRate,
		},
		search: {
			requestCount: searchCount,
			p50Ms: searchP50Ms,
			p95Ms: searchP95Ms,
			avgMs: searchAvgMs,
		},
		index: {
			pending,
			processing,
			failed,
			backlog,
			recentSuccess,
			recentFailed,
			successRate,
		},
		alerts,
	};
}

function percentileFromSorted(sortedValues: number[], percentile: number): number | null {
	if (sortedValues.length === 0) {
		return null;
	}
	const rank = Math.max(0, Math.ceil(sortedValues.length * percentile) - 1);
	return sortedValues[Math.min(sortedValues.length - 1, rank)] ?? null;
}

function formatRate(value: number): string {
	return `${(value * 100).toFixed(2)}%`;
}

function buildMetricsAlert(
	key: string,
	label: string,
	value: number | null,
	threshold: number,
	messageBuilder: (value: number, threshold: number) => string,
	comparator: "gt" | "lt" = "gt",
): ApiMetricsAlert {
	if (value === null) {
		return {
			key,
			label,
			status: "no_data",
			threshold,
			value: null,
			message: "窗口内暂无数据",
		};
	}
	const shouldWarn = comparator === "lt" ? value < threshold : value > threshold;
	return {
		key,
		label,
		status: shouldWarn ? "warn" : "ok",
		threshold,
		value,
		message: messageBuilder(value, threshold),
	};
}

export function readRequestColo(request: Request): string | null {
	const withCf = request as Request & { cf?: { colo?: string } };
	const value = withCf.cf?.colo;
	return typeof value === "string" && value.length > 0 ? value : null;
}

export async function sampleHttpProbe(
	count: number,
	run: () => Promise<HttpTimingProbeSample>,
): Promise<HttpTimingProbeSample[]> {
	const output: HttpTimingProbeSample[] = [];
	for (let index = 0; index < count; index += 1) {
		output.push(await run());
	}
	return output;
}

export async function runHttpTimingProbe(input: HttpTimingProbeInput): Promise<HttpTimingProbeSample> {
	const startedAt = Date.now();
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort("timeout"), input.timeoutMs);
	try {
		const response = await fetch(input.url, {
			method: input.method,
			headers: input.headers,
			body: input.body,
			signal: controller.signal,
		});
		const ttfbMs = Date.now() - startedAt;
		await response.text().catch(() => "");
		const totalMs = Date.now() - startedAt;
		return {
			ok: response.ok,
			status: response.status,
			ttfbMs,
			totalMs,
			error: response.ok ? null : `status_${response.status}`,
		};
	} catch (error) {
		const totalMs = Date.now() - startedAt;
		return {
			ok: false,
			status: null,
			ttfbMs: null,
			totalMs,
			error: String(error),
		};
	} finally {
		clearTimeout(timer);
	}
}

export function summarizeProbeSamples(samples: HttpTimingProbeSample[]): {
	sampleCount: number;
	successCount: number;
	failureCount: number;
	ttfbMs: { p50: number | null; p95: number | null; avg: number | null; min: number | null; max: number | null };
	totalMs: { p50: number | null; p95: number | null; avg: number | null; min: number | null; max: number | null };
	recentErrors: string[];
} {
	const success = samples.filter((item) => item.ok);
	const failure = samples.filter((item) => !item.ok);
	const ttfbValues = success
		.map((item) => item.ttfbMs)
		.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
		.sort((a, b) => a - b);
	const totalValues = success
		.map((item) => item.totalMs)
		.filter((item) => Number.isFinite(item))
		.sort((a, b) => a - b);
	const average = (values: number[]): number | null =>
		values.length > 0
			? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1))
			: null;

	return {
		sampleCount: samples.length,
		successCount: success.length,
		failureCount: failure.length,
		ttfbMs: {
			p50: percentileFromSorted(ttfbValues, 0.5),
			p95: percentileFromSorted(ttfbValues, 0.95),
			avg: average(ttfbValues),
			min: ttfbValues[0] ?? null,
			max: ttfbValues.at(-1) ?? null,
		},
		totalMs: {
			p50: percentileFromSorted(totalValues, 0.5),
			p95: percentileFromSorted(totalValues, 0.95),
			avg: average(totalValues),
			min: totalValues[0] ?? null,
			max: totalValues.at(-1) ?? null,
		},
		recentErrors: failure
			.map((item) => item.error ?? "unknown_error")
			.filter((item) => item.length > 0)
			.slice(0, 5),
	};
}
