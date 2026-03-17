import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
	cleanupTags,
	deleteTag,
	listTags,
	mergeTags,
	updateTag,
	type TagApiItem,
} from "../lib/api";
import type { Route } from "./+types/tags";

export function meta({}: Route.MetaArgs) {
	return [
		{ title: "标签治理 | dotNotes" },
		{ name: "description", content: "dotNotes 标签治理页面" },
	];
}

type PendingAction =
	| ""
	| "rename"
	| "merge"
	| "delete"
	| "cleanup-dry"
	| "cleanup-run";

export default function TagsGovernancePage() {
	const [tags, setTags] = useState<TagApiItem[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [pendingAction, setPendingAction] = useState<PendingAction>("");
	const [message, setMessage] = useState("");
	const [errorMessage, setErrorMessage] = useState("");

	const [renameTagId, setRenameTagId] = useState("");
	const [renameValue, setRenameValue] = useState("");

	const [mergeSourceTagId, setMergeSourceTagId] = useState("");
	const [mergeTargetTagId, setMergeTargetTagId] = useState("");

	const [deleteTagId, setDeleteTagId] = useState("");
	const [deleteMode, setDeleteMode] = useState<"detach" | "migrate">("detach");
	const [deleteTargetTagId, setDeleteTargetTagId] = useState("");

	const [cleanupLimit, setCleanupLimit] = useState("100");
	const [cleanupPreview, setCleanupPreview] = useState<{ orphaned: number; deleted: number; dryRun: boolean } | null>(null);

	const isPending = pendingAction !== "";

	const tagById = useMemo(() => {
		const map = new Map<string, TagApiItem>();
		for (const tag of tags) {
			map.set(tag.id, tag);
		}
		return map;
	}, [tags]);

	useEffect(() => {
		void refreshTags();
	}, []);

	useEffect(() => {
		if (tags.length === 0) {
			setRenameTagId("");
			setMergeSourceTagId("");
			setMergeTargetTagId("");
			setDeleteTagId("");
			setDeleteTargetTagId("");
			setRenameValue("");
			return;
		}
		const firstTag = tags[0];
		if (!firstTag) {
			return;
		}
		if (!renameTagId || !tagById.has(renameTagId)) {
			setRenameTagId(firstTag.id);
			setRenameValue(firstTag.name);
		}
		if (!mergeSourceTagId || !tagById.has(mergeSourceTagId)) {
			setMergeSourceTagId(firstTag.id);
		}
		if (!deleteTagId || !tagById.has(deleteTagId)) {
			setDeleteTagId(firstTag.id);
		}
	}, [deleteTagId, mergeSourceTagId, renameTagId, tagById, tags]);

	useEffect(() => {
		const current = tagById.get(renameTagId);
		if (current) {
			setRenameValue(current.name);
		}
	}, [renameTagId, tagById]);

	useEffect(() => {
		if (!mergeSourceTagId || !tagById.has(mergeSourceTagId)) {
			setMergeTargetTagId("");
			return;
		}
		if (mergeTargetTagId === mergeSourceTagId || (mergeTargetTagId && !tagById.has(mergeTargetTagId))) {
			const fallback = tags.find((item) => item.id !== mergeSourceTagId);
			setMergeTargetTagId(fallback?.id ?? "");
		}
	}, [mergeSourceTagId, mergeTargetTagId, tagById, tags]);

	useEffect(() => {
		if (deleteMode !== "migrate") {
			return;
		}
		if (!deleteTagId || !tagById.has(deleteTagId)) {
			setDeleteTargetTagId("");
			return;
		}
		if (deleteTargetTagId === deleteTagId || (deleteTargetTagId && !tagById.has(deleteTargetTagId))) {
			const fallback = tags.find((item) => item.id !== deleteTagId);
			setDeleteTargetTagId(fallback?.id ?? "");
		}
	}, [deleteMode, deleteTagId, deleteTargetTagId, tagById, tags]);

	const handleRefresh = async () => {
		await refreshTags();
	};

	const handleRename = async () => {
		if (isPending || !renameTagId) {
			return;
		}
		const rawInput = renameValue.trim();
		if (!rawInput) {
			setErrorMessage("标签名不能为空。");
			return;
		}
		const current = tagById.get(renameTagId);
		if (!current) {
			setErrorMessage("请选择有效标签。");
			return;
		}
		const nextName = normalizeGovernanceTagName(rawInput);
		if (!nextName) {
			setErrorMessage("标签名无效，请输入标签正文，不要只输入 #。");
			return;
		}
		if (current.name.toLowerCase() === nextName.toLowerCase()) {
			setErrorMessage(
				hasLeadingTagMarker(rawInput)
					? "前导 # 只是 Markdown 标签语法，保存时不会保留；规范化后标签名未变化。"
					: "规范化后标签名未变化。",
			);
			return;
		}
		const confirmed = window.confirm(`确认将标签「${current.name}」重命名为「${nextName}」吗？`);
		if (!confirmed) {
			return;
		}

		setPendingAction("rename");
		setErrorMessage("");
		setMessage("");
		try {
			const updated = await updateTag(renameTagId, { name: nextName });
			setMessage(`已重命名为「${updated.name}」。`);
			await refreshTags();
		} catch (error) {
			setErrorMessage(readErrorMessage(error));
		} finally {
			setPendingAction("");
		}
	};

	const handleMerge = async () => {
		if (isPending) {
			return;
		}
		if (!mergeSourceTagId || !mergeTargetTagId) {
			setErrorMessage("请选择要合并的来源标签和目标标签。");
			return;
		}
		if (mergeSourceTagId === mergeTargetTagId) {
			setErrorMessage("来源标签和目标标签不能相同。");
			return;
		}
		const source = tagById.get(mergeSourceTagId);
		const target = tagById.get(mergeTargetTagId);
		if (!source || !target) {
			setErrorMessage("标签不存在，请刷新后重试。");
			return;
		}

		const confirmed = window.confirm(
			`确认合并标签「${source.name}」到「${target.name}」吗？\n合并后来源标签会被删除。`,
		);
		if (!confirmed) {
			return;
		}

		setPendingAction("merge");
		setErrorMessage("");
		setMessage("");
		try {
			const result = await mergeTags(source.id, target.id);
			setMessage(`合并完成，迁移关联笔记 ${result.movedNoteCount} 条。`);
			await refreshTags();
		} catch (error) {
			setErrorMessage(readErrorMessage(error));
		} finally {
			setPendingAction("");
		}
	};

	const handleDelete = async () => {
		if (isPending || !deleteTagId) {
			return;
		}
		const source = tagById.get(deleteTagId);
		if (!source) {
			setErrorMessage("请选择有效标签。");
			return;
		}

		let targetTagId: string | undefined;
		let confirmText = `确认删除标签「${source.name}」吗？`;
		if (deleteMode === "migrate") {
			if (!deleteTargetTagId || deleteTargetTagId === deleteTagId) {
				setErrorMessage("请选择不同的迁移目标标签。");
				return;
			}
			const target = tagById.get(deleteTargetTagId);
			if (!target) {
				setErrorMessage("迁移目标标签不存在，请刷新后重试。");
				return;
			}
			targetTagId = target.id;
			confirmText = `确认删除标签「${source.name}」并迁移到「${target.name}」吗？`;
		} else {
			confirmText = `确认删除标签「${source.name}」吗？\n将直接移除其全部关联。`;
		}

		const confirmed = window.confirm(confirmText);
		if (!confirmed) {
			return;
		}

		setPendingAction("delete");
		setErrorMessage("");
		setMessage("");
		try {
			await deleteTag(source.id, targetTagId);
			setMessage(deleteMode === "migrate" ? "标签已删除并完成迁移。" : "标签已删除并移除关联。");
			await refreshTags();
		} catch (error) {
			setErrorMessage(readErrorMessage(error));
		} finally {
			setPendingAction("");
		}
	};

	const handleCleanupPreview = async () => {
		if (isPending) {
			return;
		}
		const limit = normalizeLimit(cleanupLimit);
		setPendingAction("cleanup-dry");
		setErrorMessage("");
		setMessage("");
		try {
			const result = await cleanupTags({ dryRun: true, limit });
			setCleanupPreview(result);
			setMessage(`预览完成：检测到孤儿标签 ${result.orphaned} 个。`);
		} catch (error) {
			setErrorMessage(readErrorMessage(error));
		} finally {
			setPendingAction("");
		}
	};

	const handleCleanupRun = async () => {
		if (isPending) {
			return;
		}
		const limit = normalizeLimit(cleanupLimit);
		const confirmed = window.confirm(`确认执行孤儿标签清理吗？本次最多处理 ${limit} 个标签。`);
		if (!confirmed) {
			return;
		}
		setPendingAction("cleanup-run");
		setErrorMessage("");
		setMessage("");
		try {
			const result = await cleanupTags({ dryRun: false, limit });
			setCleanupPreview(result);
			setMessage(`清理完成：删除 ${result.deleted} 个孤儿标签。`);
			await refreshTags();
		} catch (error) {
			setErrorMessage(readErrorMessage(error));
		} finally {
			setPendingAction("");
		}
	};

	return (
		<div className="min-h-screen bg-[#f4f6f8] text-slate-900">
			<div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-8">
				<header className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div>
							<p className="text-sm font-semibold tracking-tight">标签治理</p>
							<p className="mt-1 text-xs text-slate-500">重命名、合并、删除与孤儿标签清理</p>
						</div>
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={() => void handleRefresh()}
								disabled={isPending || isLoading}
								className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
									isPending || isLoading
										? "cursor-not-allowed border-slate-200 text-slate-300"
										: "border-slate-300 text-slate-700 hover:bg-slate-100"
								}`}
							>
								刷新
							</button>
							<Link
								to="/"
								className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
							>
								返回首页
							</Link>
						</div>
					</div>
					<div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
						<span>当前标签数：{tags.length}</span>
						{isLoading ? <span>加载中...</span> : null}
					</div>
					{message ? <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{message}</p> : null}
					{errorMessage ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{errorMessage}</p> : null}
				</header>

				<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
					<section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
						<h2 className="text-sm font-semibold">1. 重命名标签</h2>
						<p className="mt-1 text-xs text-slate-500">保护：重命名前二次确认，避免误操作。</p>
						<div className="mt-3 space-y-3">
							<select
								value={renameTagId}
								onChange={(event) => setRenameTagId(event.target.value)}
								disabled={isPending || tags.length === 0}
								className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500"
							>
								{tags.map((tag) => (
									<option key={tag.id} value={tag.id}>{`#${tag.name}`}</option>
								))}
							</select>
							<input
								value={renameValue}
								onChange={(event) => setRenameValue(stripLeadingTagMarker(event.target.value))}
								disabled={isPending || tags.length === 0}
								placeholder="输入标签名，可带 #，保存时会自动忽略"
								className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500"
							/>
							<p className="text-xs text-slate-500">
								展示时会写成 <code>#tag</code>，但标签名本身不包含 <code>#</code>。输入 <code>#agent</code> 会按 <code>agent</code> 处理。
							</p>
							<button
								type="button"
								onClick={() => void handleRename()}
								disabled={isPending || tags.length === 0}
								className={`rounded-lg px-3 py-2 text-sm font-medium text-white ${
									isPending || tags.length === 0 ? "cursor-not-allowed bg-slate-300" : "bg-slate-900 hover:bg-slate-700"
								}`}
							>
								{pendingAction === "rename" ? "处理中..." : "确认重命名"}
							</button>
						</div>
					</section>

					<section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
						<h2 className="text-sm font-semibold">2. 合并标签（A -&gt; B）</h2>
						<p className="mt-1 text-xs text-slate-500">保护：禁止同标签合并，提交前二次确认。</p>
						<div className="mt-3 space-y-3">
							<select
								value={mergeSourceTagId}
								onChange={(event) => setMergeSourceTagId(event.target.value)}
								disabled={isPending || tags.length < 2}
								className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500"
							>
								{tags.map((tag) => (
									<option key={tag.id} value={tag.id}>{`来源：#${tag.name}`}</option>
								))}
							</select>
							<select
								value={mergeTargetTagId}
								onChange={(event) => setMergeTargetTagId(event.target.value)}
								disabled={isPending || tags.length < 2}
								className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500"
							>
								<option value="">选择目标标签</option>
								{tags
									.filter((tag) => tag.id !== mergeSourceTagId)
									.map((tag) => (
										<option key={tag.id} value={tag.id}>{`目标：#${tag.name}`}</option>
									))}
							</select>
							<button
								type="button"
								onClick={() => void handleMerge()}
								disabled={isPending || tags.length < 2}
								className={`rounded-lg px-3 py-2 text-sm font-medium text-white ${
									isPending || tags.length < 2 ? "cursor-not-allowed bg-slate-300" : "bg-slate-900 hover:bg-slate-700"
								}`}
							>
								{pendingAction === "merge" ? "处理中..." : "确认合并"}
							</button>
						</div>
					</section>

					<section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
						<h2 className="text-sm font-semibold">3. 删除标签</h2>
						<p className="mt-1 text-xs text-slate-500">支持直接移除关联，或迁移后删除。</p>
						<div className="mt-3 space-y-3">
							<select
								value={deleteTagId}
								onChange={(event) => setDeleteTagId(event.target.value)}
								disabled={isPending || tags.length === 0}
								className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500"
							>
								{tags.map((tag) => (
									<option key={tag.id} value={tag.id}>{`#${tag.name}`}</option>
								))}
							</select>
							<div className="flex flex-wrap gap-2 text-xs">
								<label className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1">
									<input
										type="radio"
										name="delete-mode"
										checked={deleteMode === "detach"}
										onChange={() => setDeleteMode("detach")}
										disabled={isPending}
									/>
									直接移除关联
								</label>
								<label className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1">
									<input
										type="radio"
										name="delete-mode"
										checked={deleteMode === "migrate"}
										onChange={() => setDeleteMode("migrate")}
										disabled={isPending || tags.length < 2}
									/>
									迁移到其他标签
								</label>
							</div>
							{deleteMode === "migrate" ? (
								<select
									value={deleteTargetTagId}
									onChange={(event) => setDeleteTargetTagId(event.target.value)}
									disabled={isPending || tags.length < 2}
									className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500"
								>
									<option value="">选择迁移目标</option>
									{tags
										.filter((tag) => tag.id !== deleteTagId)
										.map((tag) => (
											<option key={tag.id} value={tag.id}>{`迁移到：#${tag.name}`}</option>
										))}
								</select>
							) : null}
							<button
								type="button"
								onClick={() => void handleDelete()}
								disabled={isPending || tags.length === 0}
								className={`rounded-lg px-3 py-2 text-sm font-medium text-white ${
									isPending || tags.length === 0 ? "cursor-not-allowed bg-slate-300" : "bg-rose-600 hover:bg-rose-500"
								}`}
							>
								{pendingAction === "delete" ? "处理中..." : "确认删除"}
							</button>
						</div>
					</section>

					<section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
						<h2 className="text-sm font-semibold">4. 孤儿标签清理</h2>
						<p className="mt-1 text-xs text-slate-500">先预览再执行，减少误删风险。</p>
						<div className="mt-3 space-y-3">
							<div>
								<p className="mb-1 text-xs text-slate-500">单次处理上限（1-500）</p>
								<input
									value={cleanupLimit}
									onChange={(event) => setCleanupLimit(event.target.value)}
									disabled={isPending}
									inputMode="numeric"
									className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500"
								/>
							</div>
							<div className="flex flex-wrap gap-2">
								<button
									type="button"
									onClick={() => void handleCleanupPreview()}
									disabled={isPending}
									className={`rounded-lg border px-3 py-2 text-sm font-medium ${
										isPending
											? "cursor-not-allowed border-slate-200 text-slate-300"
											: "border-slate-300 text-slate-700 hover:bg-slate-100"
									}`}
								>
									{pendingAction === "cleanup-dry" ? "预览中..." : "预览清理"}
								</button>
								<button
									type="button"
									onClick={() => void handleCleanupRun()}
									disabled={isPending}
									className={`rounded-lg px-3 py-2 text-sm font-medium text-white ${
										isPending ? "cursor-not-allowed bg-slate-300" : "bg-slate-900 hover:bg-slate-700"
									}`}
								>
									{pendingAction === "cleanup-run" ? "清理中..." : "执行清理"}
								</button>
							</div>
							{cleanupPreview ? (
								<div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
									<p>最近一次预览/执行：</p>
									<p className="mt-1">孤儿标签：{cleanupPreview.orphaned}，已删除：{cleanupPreview.deleted}</p>
								</div>
							) : null}
						</div>
					</section>
				</div>
			</div>
		</div>
	);

	async function refreshTags() {
		setIsLoading(true);
		setErrorMessage("");
		try {
			const data = await listTags({ status: "all" });
			const sorted = [...data].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
			setTags(sorted);
		} catch (error) {
			setErrorMessage(readErrorMessage(error));
		} finally {
			setIsLoading(false);
		}
	}
}

function normalizeLimit(value: string): number {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed)) {
		return 100;
	}
	return Math.min(500, Math.max(1, parsed));
}

function hasLeadingTagMarker(value: string): boolean {
	return /^\s*#+/u.test(value);
}

function stripLeadingTagMarker(value: string): string {
	return value.replace(/^\s*#+\s*/u, "");
}

function normalizeGovernanceTagName(value: string, maxLength = 48): string {
	const trimmed = stripLeadingTagMarker(value).trim().toLowerCase();
	if (!trimmed) {
		return "";
	}
	return trimmed
		.replace(/\s+/g, "-")
		.replace(/[^\p{L}\p{N}_-]+/gu, "-")
		.replace(/-+/g, "-")
		.replace(/^[-_]+|[-_]+$/g, "")
		.slice(0, maxLength);
}

function readErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	return "操作失败，请稍后重试。";
}
