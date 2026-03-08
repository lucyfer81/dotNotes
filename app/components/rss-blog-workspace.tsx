import { useEffect, useMemo, useState } from "react";
import {
	createRssFeed,
	deleteRssFeed,
	listRssFeeds,
	listRssItems,
	saveRssItemToReading,
	syncRssFeeds,
	translateRssItems,
	updateRssFeed,
	updateRssItemStatus,
	type RssFeedApiItem,
	type RssItemApiItem,
	type RssItemStatus,
	type RssSyncResultApiItem,
} from "../lib/api";

type BlogTab = "inbox" | "feeds";

export default function RssBlogWorkspace(props: {
	onOpenNote: (noteId: string) => void;
}) {
	const { onOpenNote } = props;
	const [tab, setTab] = useState<BlogTab>("inbox");
	const [showSavedOnly, setShowSavedOnly] = useState(false);
	const [feeds, setFeeds] = useState<RssFeedApiItem[]>([]);
	const [items, setItems] = useState<RssItemApiItem[]>([]);
	const [selectedFeedId, setSelectedFeedId] = useState<string>("all");
	const [selectedItemId, setSelectedItemId] = useState<string>("");
	const [newFeedUrl, setNewFeedUrl] = useState("");
	const [newFeedTitle, setNewFeedTitle] = useState("");
	const [isLoadingFeeds, setIsLoadingFeeds] = useState(false);
	const [isLoadingItems, setIsLoadingItems] = useState(false);
	const [isSyncing, setIsSyncing] = useState(false);
	const [isTranslating, setIsTranslating] = useState(false);
	const [isCreatingFeed, setIsCreatingFeed] = useState(false);
	const [updatingFeedId, setUpdatingFeedId] = useState("");
	const [deletingFeedId, setDeletingFeedId] = useState("");
	const [updatingItemId, setUpdatingItemId] = useState("");
	const [savingItemId, setSavingItemId] = useState("");
	const [errorMessage, setErrorMessage] = useState("");
	const [successMessage, setSuccessMessage] = useState("");
	const [lastSyncResult, setLastSyncResult] = useState<RssSyncResultApiItem | null>(null);

	const activeStatuses = useMemo<RssItemStatus[]>(() => {
		if (showSavedOnly) {
			return ["saved"];
		}
		return ["new"];
	}, [showSavedOnly]);

	const selectedItem = useMemo(
		() => items.find((item) => item.id === selectedItemId) ?? items[0] ?? null,
		[items, selectedItemId],
	);

	const loadFeeds = async () => {
		setIsLoadingFeeds(true);
		try {
			const next = await listRssFeeds();
			setFeeds(next);
			if (selectedFeedId !== "all" && !next.some((feed) => feed.id === selectedFeedId)) {
				setSelectedFeedId("all");
			}
		} catch (error) {
			setErrorMessage(readErrorMessage(error));
		} finally {
			setIsLoadingFeeds(false);
		}
	};

	const loadItems = async () => {
		if (tab === "feeds") {
			return;
		}
		setIsLoadingItems(true);
		try {
			const next = await listRssItems({
				feedId: selectedFeedId === "all" ? null : selectedFeedId,
				statuses: activeStatuses,
				limit: 80,
				offset: 0,
			});
			setItems(next);
			setSelectedItemId((prev) => {
				if (next.some((item) => item.id === prev)) {
					return prev;
				}
				return next[0]?.id ?? "";
			});
		} catch (error) {
			setErrorMessage(readErrorMessage(error));
		} finally {
			setIsLoadingItems(false);
		}
	};

	useEffect(() => {
		void loadFeeds();
	}, []);

	useEffect(() => {
		void loadItems();
	}, [tab, selectedFeedId, showSavedOnly]);

	const handleSyncNow = async () => {
		setIsSyncing(true);
		setErrorMessage("");
		setSuccessMessage("");
		try {
			const targets = selectedFeedId === "all"
				? feeds.filter((feed) => feed.enabled)
				: feeds.filter((feed) => feed.enabled && feed.id === selectedFeedId);
			if (targets.length === 0) {
				setLastSyncResult(null);
				setSuccessMessage("没有可同步的启用订阅源");
				return;
			}
			const aggregate: RssSyncResultApiItem = {
				processedFeeds: 0,
				totalFetchedItems: 0,
				totalCreated: 0,
				totalUpdated: 0,
				totalSkipped: 0,
				results: [],
			};
			for (const feed of targets) {
				try {
					const result = await syncRssFeeds({
						feedId: feed.id,
						feedLimit: 1,
						itemLimit: 10,
						translate: false,
						translateBudget: 0,
					});
					aggregate.processedFeeds += result.processedFeeds;
					aggregate.totalFetchedItems += result.totalFetchedItems;
					aggregate.totalCreated += result.totalCreated;
					aggregate.totalUpdated += result.totalUpdated;
					aggregate.totalSkipped += result.totalSkipped;
					aggregate.results.push(...result.results);
				} catch (error) {
					aggregate.processedFeeds += 1;
					aggregate.results.push({
						feedId: feed.id,
						url: feed.url,
						feedTitle: feed.title,
						fetched: 0,
						created: 0,
						updated: 0,
						skipped: 0,
						errors: [readErrorMessage(error)],
					});
				}
			}
			const failedFeeds = aggregate.results.filter((item) => item.errors.length > 0).length;
			setLastSyncResult(aggregate);
			setSuccessMessage(
				`同步完成：处理 ${aggregate.processedFeeds} 源，新增 ${aggregate.totalCreated}，更新 ${aggregate.totalUpdated}，失败 ${failedFeeds}`,
			);
			await loadFeeds();
			await loadItems();
		} catch (error) {
			setErrorMessage(readErrorMessage(error));
		} finally {
			setIsSyncing(false);
		}
	};

	const handleTranslateNow = async () => {
		setIsTranslating(true);
		setErrorMessage("");
		setSuccessMessage("");
		try {
			const result = await translateRssItems({
				feedId: selectedFeedId === "all" ? undefined : selectedFeedId,
				limit: 20,
			});
			setSuccessMessage(`翻译补全完成：处理 ${result.requested} 条，成功 ${result.translated}，失败 ${result.failed}`);
			await loadItems();
		} catch (error) {
			setErrorMessage(readErrorMessage(error));
		} finally {
			setIsTranslating(false);
		}
	};

	const handleCreateFeed = async () => {
		const url = newFeedUrl.trim();
		if (!url) {
			setErrorMessage("请输入订阅链接");
			return;
		}
		setIsCreatingFeed(true);
		setErrorMessage("");
		setSuccessMessage("");
		try {
			const created = await createRssFeed({
				url,
				title: newFeedTitle.trim() || undefined,
				enabled: true,
			});
			setNewFeedUrl("");
			setNewFeedTitle("");
			setSuccessMessage("已添加订阅源");
			setSelectedFeedId(created.id);
			await loadFeeds();
		} catch (error) {
			setErrorMessage(readErrorMessage(error));
		} finally {
			setIsCreatingFeed(false);
		}
	};

	const handleToggleFeed = async (feed: RssFeedApiItem) => {
		setUpdatingFeedId(feed.id);
		setErrorMessage("");
		setSuccessMessage("");
		try {
			await updateRssFeed(feed.id, {
				enabled: !feed.enabled,
			});
			await loadFeeds();
		} catch (error) {
			setErrorMessage(readErrorMessage(error));
		} finally {
			setUpdatingFeedId("");
		}
	};

	const handleDeleteFeed = async (feedId: string) => {
		if (!window.confirm("删除该订阅源将同时删除其抓取条目，是否继续？")) {
			return;
		}
		setDeletingFeedId(feedId);
		setErrorMessage("");
		setSuccessMessage("");
		try {
			await deleteRssFeed(feedId);
			setSuccessMessage("订阅源已删除");
			if (selectedFeedId === feedId) {
				setSelectedFeedId("all");
			}
			await loadFeeds();
			await loadItems();
		} catch (error) {
			setErrorMessage(readErrorMessage(error));
		} finally {
			setDeletingFeedId("");
		}
	};

	const handleSaveItem = async (item: RssItemApiItem) => {
		if (item.noteId) {
			onOpenNote(item.noteId);
			return;
		}
		setSavingItemId(item.id);
		setErrorMessage("");
		setSuccessMessage("");
		try {
			const saved = await saveRssItemToReading(item.id);
			setSuccessMessage(saved.created ? "已保存到 Reading" : "已关联到 Reading");
			await loadItems();
		} catch (error) {
			setErrorMessage(readErrorMessage(error));
		} finally {
			setSavingItemId("");
		}
	};

	const handleSetItemStatus = async (item: RssItemApiItem, status: RssItemStatus) => {
		setUpdatingItemId(item.id);
		setErrorMessage("");
		try {
			await updateRssItemStatus(item.id, status);
			await loadItems();
		} catch (error) {
			setErrorMessage(readErrorMessage(error));
		} finally {
			setUpdatingItemId("");
		}
	};

	return (
		<div className="flex h-full min-h-0 flex-col gap-3">
			<section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm md:p-4">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
						<TabButton label="Inbox" active={tab === "inbox"} onClick={() => setTab("inbox")} />
						<TabButton label="Feeds" active={tab === "feeds"} onClick={() => setTab("feeds")} />
					</div>
					<div className="flex flex-wrap items-center gap-2">
						{tab !== "feeds" ? (
							<button
								type="button"
								onClick={() => setShowSavedOnly((prev) => !prev)}
								className={`rounded-lg border px-3 py-2 text-xs font-medium md:text-sm ${
									showSavedOnly
										? "border-emerald-200 bg-emerald-50 text-emerald-700"
										: "border-slate-200 text-slate-600 hover:bg-slate-100"
								}`}
							>
								{showSavedOnly ? "仅看已保存：开" : "仅看已保存"}
							</button>
						) : null}
						<select
							value={selectedFeedId}
							onChange={(event) => setSelectedFeedId(event.target.value)}
							className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-600 md:text-sm"
						>
							<option value="all">全部订阅源</option>
							{feeds.map((feed) => (
								<option key={feed.id} value={feed.id}>
									{feed.title || feed.url}
								</option>
							))}
						</select>
						<button
							type="button"
							onClick={handleSyncNow}
							disabled={isSyncing}
							className={`rounded-lg border px-3 py-2 text-xs font-medium md:text-sm ${
								isSyncing
									? "cursor-not-allowed border-slate-200 text-slate-300"
									: "border-sky-200 text-sky-700 hover:bg-sky-50"
							}`}
						>
							{isSyncing ? "同步中..." : "立即同步"}
						</button>
						<button
							type="button"
							onClick={handleTranslateNow}
							disabled={isTranslating}
							className={`rounded-lg border px-3 py-2 text-xs font-medium md:text-sm ${
								isTranslating
									? "cursor-not-allowed border-slate-200 text-slate-300"
									: "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
							}`}
						>
							{isTranslating ? "翻译中..." : "补全翻译"}
						</button>
					</div>
				</div>
				{lastSyncResult ? (
					<p className="mt-2 text-xs text-slate-500">
						最近同步：处理 {lastSyncResult.processedFeeds} 源，抓取 {lastSyncResult.totalFetchedItems} 条
					</p>
				) : null}
				{errorMessage ? <p className="mt-2 text-xs text-rose-600">{errorMessage}</p> : null}
				{successMessage ? <p className="mt-2 text-xs text-emerald-700">{successMessage}</p> : null}
			</section>

			{tab === "feeds" ? (
				<div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
					<section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm md:p-4">
						<p className="mb-2 text-sm font-semibold text-slate-800">添加订阅源</p>
						<div className="space-y-2">
							<input
								type="url"
								value={newFeedUrl}
								onChange={(event) => setNewFeedUrl(event.target.value)}
								placeholder="https://example.com/feed.xml"
								className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:ring"
							/>
							<input
								type="text"
								value={newFeedTitle}
								onChange={(event) => setNewFeedTitle(event.target.value)}
								placeholder="可选：显示名称"
								className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:ring"
							/>
							<button
								type="button"
								onClick={handleCreateFeed}
								disabled={isCreatingFeed}
								className={`rounded-lg px-3 py-2 text-sm font-medium ${
									isCreatingFeed
										? "cursor-not-allowed bg-slate-200 text-slate-400"
										: "bg-slate-900 text-white hover:bg-slate-700"
								}`}
							>
								{isCreatingFeed ? "添加中..." : "添加订阅源"}
							</button>
						</div>
					</section>

					<section className="min-h-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm md:p-4">
						<div className="mb-2 flex items-center justify-between">
							<p className="text-sm font-semibold text-slate-800">订阅源列表</p>
							<span className="text-xs text-slate-500">{feeds.length} 个</span>
						</div>
						<div className="max-h-[58dvh] space-y-2 overflow-y-auto pr-1 lg:max-h-[62dvh]">
							{isLoadingFeeds ? (
								<p className="text-xs text-slate-500">加载中...</p>
							) : feeds.length === 0 ? (
								<p className="text-xs text-slate-500">还没有订阅源</p>
							) : (
								feeds.map((feed) => (
									<div key={feed.id} className="rounded-xl border border-slate-200 p-3">
										<div className="flex items-start justify-between gap-2">
											<div className="min-w-0 flex-1">
												<p className="truncate text-sm font-medium text-slate-800">{feed.title || "未命名订阅源"}</p>
												<p className="mt-1 break-all text-xs text-slate-500">{feed.url}</p>
												<p className="mt-1 text-[11px] text-slate-400">
													最近抓取：{feed.lastFetchedAt ? formatDateTime(feed.lastFetchedAt) : "未抓取"}
												</p>
												{feed.lastError ? <p className="mt-1 text-[11px] text-rose-600">{feed.lastError}</p> : null}
											</div>
											<div className="flex shrink-0 items-center gap-2">
												<button
													type="button"
													onClick={() => handleToggleFeed(feed)}
													disabled={updatingFeedId === feed.id}
													className={`rounded-md border px-2 py-1 text-[11px] ${
														updatingFeedId === feed.id
															? "cursor-not-allowed border-slate-200 text-slate-300"
															: feed.enabled
																? "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
																: "border-amber-200 text-amber-700 hover:bg-amber-50"
													}`}
												>
													{feed.enabled ? "启用中" : "已停用"}
												</button>
												<button
													type="button"
													onClick={() => handleDeleteFeed(feed.id)}
													disabled={deletingFeedId === feed.id}
													className={`rounded-md border px-2 py-1 text-[11px] ${
														deletingFeedId === feed.id
															? "cursor-not-allowed border-slate-200 text-slate-300"
															: "border-rose-200 text-rose-600 hover:bg-rose-50"
													}`}
												>
													删除
												</button>
											</div>
										</div>
									</div>
								))
							)}
						</div>
					</section>
				</div>
				) : (
					<div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
						<section className="min-h-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm md:p-4">
							<div className="mb-2 flex items-center justify-between">
								<p className="text-sm font-semibold text-slate-800">
									{showSavedOnly ? "已保存条目" : "待阅读条目"}
								</p>
								<span className="text-xs text-slate-500">{items.length} 条</span>
							</div>
							<div className="max-h-[54dvh] space-y-2 overflow-y-auto pr-1 lg:max-h-[68dvh]">
								{isLoadingItems ? (
									<p className="text-xs text-slate-500">加载中...</p>
								) : items.length === 0 ? (
									<p className="text-xs text-slate-500">
										{showSavedOnly ? "暂无已保存条目。" : "暂无条目，点“立即同步”拉取最新内容。"}
									</p>
								) : (
									items.map((item) => {
										const active = selectedItem?.id === item.id;
										return (
											<button
												key={item.id}
												type="button"
												onClick={() => setSelectedItemId(item.id)}
												className={`w-full rounded-xl border px-3 py-3 text-left ${
													active
														? "border-slate-900 bg-slate-900 text-white"
														: "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
												}`}
											>
												<p className="line-clamp-2 text-sm font-medium">{item.title || "（无标题）"}</p>
												<p className={`mt-1 text-[11px] ${active ? "text-slate-200" : "text-slate-500"}`}>
													{item.feedTitle || "未命名源"} · {formatDateTime(item.publishedAt || item.createdAt)}
												</p>
												<p className={`mt-1 line-clamp-2 text-xs ${active ? "text-slate-100" : "text-slate-600"}`}>
													{item.summaryZh || item.summaryRaw || "无摘要"}
												</p>
											</button>
										);
									})
								)}
							</div>
						</section>

					<section className="min-h-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm md:p-4">
						{selectedItem ? (
							<div className="flex h-full min-h-0 flex-col">
								<div className="mb-2 flex items-start justify-between gap-3">
									<div className="min-w-0 flex-1">
										<p className="text-lg font-semibold tracking-tight text-slate-900">{selectedItem.title || "（无标题）"}</p>
										<p className="mt-1 text-xs text-slate-500">
											{selectedItem.feedTitle || "未命名源"} · {formatDateTime(selectedItem.publishedAt || selectedItem.createdAt)}
										</p>
									</div>
									<div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
										{selectedItem.link ? (
											<a
												href={selectedItem.link}
												target="_blank"
												rel="noreferrer"
												className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 md:text-sm"
											>
												打开原文
											</a>
										) : null}
										<button
											type="button"
											onClick={() => handleSaveItem(selectedItem)}
											disabled={savingItemId === selectedItem.id}
											className={`rounded-lg border px-3 py-2 text-xs font-medium md:text-sm ${
												savingItemId === selectedItem.id
													? "cursor-not-allowed border-slate-200 text-slate-300"
													: selectedItem.noteId
														? "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
														: "border-sky-200 text-sky-700 hover:bg-sky-50"
											}`}
										>
											{savingItemId === selectedItem.id ? "处理中..." : selectedItem.noteId ? "打开 Reading 笔记" : "保存到 Reading"}
										</button>
										{selectedItem.status === "new" ? (
											<button
												type="button"
												onClick={() => handleSetItemStatus(selectedItem, "ignored")}
												disabled={updatingItemId === selectedItem.id}
												className={`rounded-lg border px-3 py-2 text-xs font-medium md:text-sm ${
													updatingItemId === selectedItem.id
														? "cursor-not-allowed border-slate-200 text-slate-300"
														: "border-amber-200 text-amber-700 hover:bg-amber-50"
												}`}
											>
												忽略
											</button>
										) : null}
										{selectedItem.status === "saved" ? (
											<button
												type="button"
												onClick={() => handleSetItemStatus(selectedItem, "new")}
												disabled={updatingItemId === selectedItem.id}
												className={`rounded-lg border px-3 py-2 text-xs font-medium md:text-sm ${
													updatingItemId === selectedItem.id
														? "cursor-not-allowed border-slate-200 text-slate-300"
														: "border-slate-200 text-slate-700 hover:bg-slate-100"
												}`}
											>
												移回 Inbox
											</button>
										) : null}
									</div>
								</div>
								<div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3">
									{selectedItem.summaryZh ? (
										<div>
											<p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">摘要（中文）</p>
											<p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">{selectedItem.summaryZh}</p>
										</div>
									) : null}
									<div>
										<p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">原始摘要</p>
										<p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{selectedItem.summaryRaw || "无摘要"}</p>
									</div>
								</div>
							</div>
						) : (
							<div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6">
								<p className="text-sm text-slate-500">请选择一条 RSS 内容查看详情</p>
							</div>
						)}
					</section>
				</div>
			)}
		</div>
	);
}

function TabButton(props: {
	label: string;
	active: boolean;
	onClick: () => void;
}) {
	const { label, active, onClick } = props;
	return (
		<button
			type="button"
			onClick={onClick}
			className={`rounded-lg px-3 py-1.5 text-xs font-medium transition md:text-sm ${
				active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-200"
			}`}
		>
			{label}
		</button>
	);
}

function formatDateTime(value: string): string {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		return value;
	}
	const month = parsed.getMonth() + 1;
	const day = parsed.getDate();
	const hours = String(parsed.getHours()).padStart(2, "0");
	const minutes = String(parsed.getMinutes()).padStart(2, "0");
	return `${month}月${day}日 ${hours}:${minutes}`;
}

function readErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	return "操作失败，请稍后重试";
}
