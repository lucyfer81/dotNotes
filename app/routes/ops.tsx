import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
	listIndexJobs,
	listOpsMetrics,
	migrateNoteStorage,
	processIndexJobs,
	probeOpsAi,
	rebuildIndex,
	type IndexJobApiItem,
	type IndexJobStatusApiItem,
	type OpsAiProbeApiItem,
	type OpsMetricsApiItem,
} from "../lib/api";
import { formatMonthDayTime } from "../lib/datetime";
import type { Route } from "./+types/ops";

const INDEX_STATUSES: IndexJobStatusApiItem[] = ["failed", "pending", "processing", "success"];

export function meta({}: Route.MetaArgs) {
	return [
		{ title: "运维控制台 | dotNotes" },
		{ name: "description", content: "dotNotes 运维控制台" },
	];
}

export default function OpsPage() {
	const [metrics, setMetrics] = useState<OpsMetricsApiItem | null>(null);
	const [jobs, setJobs] = useState<IndexJobApiItem[]>([]);
	const [jobsCount, setJobsCount] = useState(0);
	const [aiProbe, setAiProbe] = useState<OpsAiProbeApiItem | null>(null);

	const [windowMinutesInput, setWindowMinutesInput] = useState("60");
	const [jobLimitInput, setJobLimitInput] = useState("50");
	const [jobStatusFilter, setJobStatusFilter] = useState<IndexJobStatusApiItem[]>(["failed", "pending", "processing"]);
	const [processLimitInput, setProcessLimitInput] = useState("5");
	const [rebuildLimitInput, setRebuildLimitInput] = useState("200");
	const [rebuildDryRun, setRebuildDryRun] = useState(true);
	const [rebuildIncludeArchived, setRebuildIncludeArchived] = useState(false);
	const [rebuildIncludeDeleted, setRebuildIncludeDeleted] = useState(false);

	const [migrateDryRun, setMigrateDryRun] = useState(true);
	const [migrateLimitInput, setMigrateLimitInput] = useState("50");
	const [migrateMinBytesInput, setMigrateMinBytesInput] = useState("65536");

	const [probeCountInput, setProbeCountInput] = useState("3");
	const [probeTimeoutInput, setProbeTimeoutInput] = useState("15000");
	const [probeIncludeModels, setProbeIncludeModels] = useState(true);
	const [probeIncludeEmbedding, setProbeIncludeEmbedding] = useState(true);
	const [probeIncludeChat, setProbeIncludeChat] = useState(true);
	const [probeChatModel, setProbeChatModel] = useState("");

	const [isLoadingMetrics, setIsLoadingMetrics] = useState(false);
	const [isLoadingJobs, setIsLoadingJobs] = useState(false);
	const [pendingAction, setPendingAction] = useState("");
	const [errorMessage, setErrorMessage] = useState("");
	const [successMessage, setSuccessMessage] = useState("");

	const [lastIndexProcess, setLastIndexProcess] = useState<{ processed: number; success: number; failed: number } | null>(null);
	const [lastRebuild, setLastRebuild] = useState<{ dryRun: boolean; enqueued: number } | null>(null);
	const [lastMigrate, setLastMigrate] = useState<{ dryRun: boolean; scanned: number; migrated: number } | null>(null);

	const activeAlerts = useMemo(
		() => (metrics?.alerts ?? []).filter((item) => item.status === "warn"),
		[metrics],
	);

	useEffect(() => {
		void (async () => {
			await Promise.all([refreshMetrics(), refreshJobs()]);
		})();
	}, []);

	const refreshMetrics = async () => {
		const windowMinutes = parseIntInRange(windowMinutesInput, 60, 5, 24 * 60);
		setIsLoadingMetrics(true);
		try {
			const next = await listOpsMetrics(windowMinutes);
			setMetrics(next);
		} catch (error) {
			setErrorMessage(readErrorMessage(error));
		} finally {
			setIsLoadingMetrics(false);
		}
	};

	const refreshJobs = async () => {
		const limit = parseIntInRange(jobLimitInput, 50, 1, 200);
		setIsLoadingJobs(true);
		try {
			const next = await listIndexJobs({
				statuses: jobStatusFilter.length > 0 ? jobStatusFilter : undefined,
				limit,
				offset: 0,
			});
			setJobs(next.items);
			setJobsCount(next.paging.count);
		} catch (error) {
			setErrorMessage(readErrorMessage(error));
		} finally {
			setIsLoadingJobs(false);
		}
	};

	const runProcessIndex = async () => {
		const limit = parseIntInRange(processLimitInput, 5, 1, 50);
		setPendingAction("index-process");
		setErrorMessage("");
		setSuccessMessage("");
		try {
			const result = await processIndexJobs(limit);
			const failed = result.results.filter((item) => item.status === "failed").length;
			setLastIndexProcess({
				processed: result.processed,
				success: result.results.length - failed,
				failed,
			});
			setSuccessMessage(`索引处理完成：处理 ${result.processed}，失败 ${failed}`);
			await Promise.all([refreshMetrics(), refreshJobs()]);
		} catch (error) {
			setErrorMessage(readErrorMessage(error));
		} finally {
			setPendingAction("");
		}
	};

	const runRebuildIndex = async () => {
		const limit = parseIntInRange(rebuildLimitInput, 200, 1, 2000);
		setPendingAction("index-rebuild");
		setErrorMessage("");
		setSuccessMessage("");
		try {
			const result = await rebuildIndex({
				dryRun: rebuildDryRun,
				includeArchived: rebuildIncludeArchived,
				includeDeleted: rebuildIncludeDeleted,
				limit,
			});
			setLastRebuild({ dryRun: result.dryRun, enqueued: result.enqueued });
			setSuccessMessage(result.dryRun ? `重建预览完成：命中 ${result.enqueued}` : `重建入队完成：${result.enqueued}`);
			await Promise.all([refreshMetrics(), refreshJobs()]);
		} catch (error) {
			setErrorMessage(readErrorMessage(error));
		} finally {
			setPendingAction("");
		}
	};

	const runStorageMigrate = async () => {
		const limit = parseIntInRange(migrateLimitInput, 50, 1, 200);
		const minBytes = parseIntInRange(migrateMinBytesInput, 65536, 1, 5_000_000);
		setPendingAction("storage-migrate");
		setErrorMessage("");
		setSuccessMessage("");
		try {
			const result = await migrateNoteStorage({
				dryRun: migrateDryRun,
				limit,
				minBytes,
			});
			setLastMigrate({
				dryRun: result.dryRun,
				scanned: result.scanned,
				migrated: result.migrated,
			});
			setSuccessMessage(result.dryRun ? `迁移预览完成：命中 ${result.migrated}` : `迁移完成：${result.migrated}/${result.scanned}`);
		} catch (error) {
			setErrorMessage(readErrorMessage(error));
		} finally {
			setPendingAction("");
		}
	};

	const runAiProbe = async () => {
		const count = parseIntInRange(probeCountInput, 3, 1, 20);
		const timeoutMs = parseIntInRange(probeTimeoutInput, 15000, 1000, 120000);
		setPendingAction("ai-probe");
		setErrorMessage("");
		setSuccessMessage("");
		try {
			const result = await probeOpsAi({
				count,
				timeoutMs,
				includeModels: probeIncludeModels,
				includeEmbedding: probeIncludeEmbedding,
				includeChat: probeIncludeChat,
				chatModel: probeChatModel.trim() || undefined,
			});
			setAiProbe(result);
			setSuccessMessage("AI 探针完成");
		} catch (error) {
			setErrorMessage(readErrorMessage(error));
		} finally {
			setPendingAction("");
		}
	};

	const toggleStatusFilter = (status: IndexJobStatusApiItem) => {
		setJobStatusFilter((prev) =>
			prev.includes(status)
				? prev.filter((item) => item !== status)
				: [...prev, status],
		);
	};

	return (
		<main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 md:py-8">
			<div className="mb-5 flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight text-slate-900">运维控制台</h1>
					<p className="mt-1 text-sm text-slate-500">用于监控与手动处置索引、存储维护和 AI 连通性。</p>
				</div>
				<div className="flex items-center gap-2">
					<Link to="/" className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">返回工作台</Link>
					<Link to="/tags" className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">标签治理</Link>
				</div>
			</div>

			{errorMessage ? <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{errorMessage}</p> : null}
			{successMessage ? <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

			<section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
				<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
					<h2 className="text-lg font-semibold text-slate-900">系统指标与告警</h2>
					<div className="flex items-center gap-2">
						<input
							value={windowMinutesInput}
							onChange={(event) => setWindowMinutesInput(event.target.value)}
							className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
						/>
						<button
							type="button"
							disabled={isLoadingMetrics}
							onClick={() => void refreshMetrics()}
							className="rounded-lg border border-sky-200 px-3 py-1.5 text-sm text-sky-700 hover:bg-sky-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
						>
							{isLoadingMetrics ? "刷新中..." : "刷新指标"}
						</button>
					</div>
				</div>
				{metrics ? (
					<div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
						<MetricCard label="API 请求" value={String(metrics.api.totalRequests)} />
						<MetricCard label="API 错误率" value={formatPercent(metrics.api.errorRate)} />
						<MetricCard label="搜索 P95" value={formatMs(metrics.search.p95Ms)} />
						<MetricCard label="索引积压" value={String(metrics.index.backlog)} />
					</div>
				) : (
					<p className="text-sm text-slate-500">暂无指标数据。</p>
				)}
				{metrics ? (
					<div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
						<p className="text-sm font-medium text-slate-800">告警（{activeAlerts.length}）</p>
						<div className="mt-2 space-y-1 text-sm">
							{metrics.alerts.map((alert) => (
								<p key={alert.key} className={alert.status === "warn" ? "text-amber-700" : "text-slate-600"}>
									[{alert.status}] {alert.label} - {alert.message}
								</p>
							))}
						</div>
					</div>
				) : null}
			</section>

			<section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
				<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
					<h2 className="text-lg font-semibold text-slate-900">索引队列</h2>
					<div className="flex items-center gap-2">
						<input
							value={jobLimitInput}
							onChange={(event) => setJobLimitInput(event.target.value)}
							className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
						/>
						<button
							type="button"
							disabled={isLoadingJobs}
							onClick={() => void refreshJobs()}
							className="rounded-lg border border-sky-200 px-3 py-1.5 text-sm text-sky-700 hover:bg-sky-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
						>
							{isLoadingJobs ? "刷新中..." : "刷新队列"}
						</button>
					</div>
				</div>
				<div className="mb-3 flex flex-wrap gap-2">
					{INDEX_STATUSES.map((status) => (
						<button
							key={status}
							type="button"
							onClick={() => toggleStatusFilter(status)}
							className={`rounded-lg border px-2.5 py-1 text-xs ${
								jobStatusFilter.includes(status)
									? "border-slate-900 bg-slate-900 text-white"
									: "border-slate-200 text-slate-600 hover:bg-slate-100"
							}`}
						>
							{status}
						</button>
					))}
				</div>
				<div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
					<input
						value={processLimitInput}
						onChange={(event) => setProcessLimitInput(event.target.value)}
						className="w-24 rounded-lg border border-slate-200 px-2 py-1.5"
					/>
					<button
						type="button"
						disabled={pendingAction !== ""}
						onClick={() => void runProcessIndex()}
						className="rounded-lg border border-emerald-200 px-3 py-1.5 text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
					>
						处理 pending
					</button>
					<input
						value={rebuildLimitInput}
						onChange={(event) => setRebuildLimitInput(event.target.value)}
						className="w-24 rounded-lg border border-slate-200 px-2 py-1.5"
					/>
					<label className="inline-flex items-center gap-1 text-xs text-slate-600">
						<input type="checkbox" checked={rebuildDryRun} onChange={(event) => setRebuildDryRun(event.target.checked)} />
						dryRun
					</label>
					<label className="inline-flex items-center gap-1 text-xs text-slate-600">
						<input type="checkbox" checked={rebuildIncludeArchived} onChange={(event) => setRebuildIncludeArchived(event.target.checked)} />
						includeArchived
					</label>
					<label className="inline-flex items-center gap-1 text-xs text-slate-600">
						<input type="checkbox" checked={rebuildIncludeDeleted} onChange={(event) => setRebuildIncludeDeleted(event.target.checked)} />
						includeDeleted
					</label>
					<button
						type="button"
						disabled={pendingAction !== ""}
						onClick={() => void runRebuildIndex()}
						className="rounded-lg border border-amber-200 px-3 py-1.5 text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
					>
						重建索引
					</button>
				</div>
				{lastIndexProcess ? <p className="mb-2 text-xs text-slate-600">最近处理：{lastIndexProcess.processed} 条，成功 {lastIndexProcess.success}，失败 {lastIndexProcess.failed}</p> : null}
				{lastRebuild ? <p className="mb-2 text-xs text-slate-600">最近重建：{lastRebuild.dryRun ? "预览" : "执行"}，入队 {lastRebuild.enqueued}</p> : null}
				<p className="mb-2 text-xs text-slate-500">当前列表数量：{jobsCount}</p>
				<div className="max-h-80 overflow-auto rounded-xl border border-slate-200">
					<table className="min-w-full text-left text-xs">
						<thead className="sticky top-0 bg-slate-100 text-slate-600">
							<tr>
								<th className="px-2 py-2">状态</th>
								<th className="px-2 py-2">动作</th>
								<th className="px-2 py-2">标题</th>
								<th className="px-2 py-2">错误</th>
								<th className="px-2 py-2">更新时间</th>
							</tr>
						</thead>
						<tbody>
							{jobs.map((item) => (
								<tr key={item.noteId} className="border-t border-slate-200">
									<td className="px-2 py-2">{item.status}</td>
									<td className="px-2 py-2">{item.action}</td>
									<td className="max-w-[360px] truncate px-2 py-2">{item.noteTitle || item.noteId}</td>
									<td className="max-w-[280px] truncate px-2 py-2 text-rose-600">{item.lastError || "-"}</td>
									<td className="px-2 py-2 text-slate-500">{formatDateTime(item.updatedAt)}</td>
								</tr>
							))}
							{jobs.length === 0 ? (
								<tr>
									<td className="px-2 py-3 text-slate-500" colSpan={5}>暂无队列项</td>
								</tr>
							) : null}
						</tbody>
					</table>
				</div>
			</section>

			<section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
				<h2 className="mb-3 text-lg font-semibold text-slate-900">存储维护（D1 到 R2）</h2>
				<div className="flex flex-wrap items-center gap-2 text-sm">
					<input value={migrateLimitInput} onChange={(event) => setMigrateLimitInput(event.target.value)} className="w-24 rounded-lg border border-slate-200 px-2 py-1.5" />
					<input value={migrateMinBytesInput} onChange={(event) => setMigrateMinBytesInput(event.target.value)} className="w-28 rounded-lg border border-slate-200 px-2 py-1.5" />
					<label className="inline-flex items-center gap-1 text-xs text-slate-600">
						<input type="checkbox" checked={migrateDryRun} onChange={(event) => setMigrateDryRun(event.target.checked)} />
						dryRun
					</label>
					<button
						type="button"
						disabled={pendingAction !== ""}
						onClick={() => void runStorageMigrate()}
						className="rounded-lg border border-sky-200 px-3 py-1.5 text-sky-700 hover:bg-sky-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
					>
						执行迁移
					</button>
				</div>
				{lastMigrate ? <p className="mt-2 text-xs text-slate-600">最近迁移：{lastMigrate.dryRun ? "预览" : "执行"}，扫描 {lastMigrate.scanned}，迁移 {lastMigrate.migrated}</p> : null}
			</section>

			<section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
				<h2 className="mb-3 text-lg font-semibold text-slate-900">AI 连通性探针</h2>
				<div className="mb-2 grid gap-2 md:grid-cols-3">
					<input value={probeCountInput} onChange={(event) => setProbeCountInput(event.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
					<input value={probeTimeoutInput} onChange={(event) => setProbeTimeoutInput(event.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
					<input value={probeChatModel} onChange={(event) => setProbeChatModel(event.target.value)} placeholder="可选 chatModel 覆盖" className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
				</div>
				<div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
					<label className="inline-flex items-center gap-1"><input type="checkbox" checked={probeIncludeModels} onChange={(event) => setProbeIncludeModels(event.target.checked)} />models</label>
					<label className="inline-flex items-center gap-1"><input type="checkbox" checked={probeIncludeEmbedding} onChange={(event) => setProbeIncludeEmbedding(event.target.checked)} />embedding</label>
					<label className="inline-flex items-center gap-1"><input type="checkbox" checked={probeIncludeChat} onChange={(event) => setProbeIncludeChat(event.target.checked)} />chat</label>
					<button
						type="button"
						disabled={pendingAction !== ""}
						onClick={() => void runAiProbe()}
						className="rounded-lg border border-violet-200 px-3 py-1.5 text-violet-700 hover:bg-violet-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
					>
						运行探针
					</button>
				</div>
				{aiProbe ? (
					<div className="grid gap-2 md:grid-cols-3">
						{Object.entries(aiProbe.probes).map(([key, probe]) => (
							<div key={key} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
								<p className="font-semibold text-slate-800">{key}</p>
								<p className="mt-1 text-slate-600">成功 {probe.successCount}/{probe.sampleCount}</p>
								<p className="text-slate-600">TTFB p95: {formatMs(probe.ttfbMs.p95)}</p>
								<p className="text-slate-600">Total p95: {formatMs(probe.totalMs.p95)}</p>
								{probe.model ? <p className="mt-1 truncate text-slate-500">model: {probe.model}</p> : null}
								{probe.recentErrors.length > 0 ? <p className="mt-1 text-rose-600">错误: {probe.recentErrors.join(", ")}</p> : null}
							</div>
						))}
					</div>
				) : (
					<p className="text-sm text-slate-500">暂无探针结果。</p>
				)}
			</section>
		</main>
	);
}

function MetricCard(props: { label: string; value: string }) {
	const { label, value } = props;
	return (
		<div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
			<p className="text-xs text-slate-500">{label}</p>
			<p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
		</div>
	);
}

function parseIntInRange(value: string, fallback: number, min: number, max: number): number {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed)) {
		return fallback;
	}
	return Math.min(max, Math.max(min, parsed));
}

function formatPercent(value: number | null): string {
	if (value === null) {
		return "-";
	}
	return `${(value * 100).toFixed(2)}%`;
}

function formatMs(value: number | null): string {
	if (value === null) {
		return "-";
	}
	return `${Math.round(value)}ms`;
}

function formatDateTime(value: string): string {
	return formatMonthDayTime(value);
}

function readErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	return "操作失败，请稍后重试";
}
