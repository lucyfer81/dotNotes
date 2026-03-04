import { markdown } from "@codemirror/lang-markdown";
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Route } from "./+types/home";

type NoteItem = {
	id: string;
	slug: string;
	title: string;
	updatedAt: string;
	tags: string[];
	summary: string;
	content: string;
	folderId: string;
	favorite?: boolean;
};

type FolderApiItem = {
	id: string;
	parentId: string | null;
	name: string;
	sortOrder: number;
};

type WorkspaceMode = "capture" | "organize" | "focus";
type EditorMode = "edit" | "preview" | "split";

const WORKSPACE_MODE_STORAGE_KEY = "dotnotes.workspace.mode";
const EDITOR_MODE_STORAGE_KEY = "dotnotes.editor.mode";
const WIKI_LINK_PATTERN = /\[\[([^\[\]]+)\]\]/g;

const defaultRootFolders: FolderApiItem[] = [
	{ id: "folder-00-inbox", parentId: null, name: "00-Inbox", sortOrder: 0 },
	{ id: "folder-10-projects", parentId: null, name: "10-Projects", sortOrder: 10 },
	{ id: "folder-20-areas", parentId: null, name: "20-Areas", sortOrder: 20 },
	{ id: "folder-30-resource", parentId: null, name: "30-Resource", sortOrder: 30 },
	{ id: "folder-40-archive", parentId: null, name: "40-Archive", sortOrder: 40 },
];

const seedNotes: NoteItem[] = [
	{
		id: "n-001",
		slug: toWikiSlug("今天的会议记录"),
		title: "今天的会议记录",
		updatedAt: "3月4日 10:10",
		tags: ["产品", "会议"],
		summary: "确认了 dotNotes 的双速界面：Capture 与 Focus。",
		content:
			"# 今天的会议记录\\n\\n- 默认要 capture-first\\n- 深度编辑进入 focus\\n- 相关：[[RAG 方案草稿]]\\n\\n## 待办\\n\\n1. 接入 D1\\n2. 接入 Vectorize\\n3. 接入 SiliconFlow",
		folderId: "folder-10-projects",
		favorite: true,
	},
	{
		id: "n-002",
		slug: toWikiSlug("RAG 方案草稿"),
		title: "RAG 方案草稿",
		updatedAt: "3月3日 22:10",
		tags: ["AI", "架构"],
		summary: "定义 chunk 策略、召回流程与重排策略。",
		content:
			"# RAG 方案草稿\\n\\n- Embedding: SiliconFlow\\n- Vector DB: Cloudflare Vectorize\\n- 参考：[[今天的会议记录]]",
		folderId: "folder-30-resource",
	},
	{
		id: "n-003",
		slug: toWikiSlug("周报模板"),
		title: "周报模板",
		updatedAt: "3月1日 09:28",
		tags: ["模板"],
		summary: "复盘、进展、风险、下周计划四段式模板。",
		content:
			"# 周报模板\\n\\n## 本周进展\\n- \\n\\n## 风险与阻塞\\n- \\n\\n## 下周计划\\n- \\n",
		folderId: "folder-20-areas",
	},
];

export function meta({}: Route.MetaArgs) {
	return [
		{ title: "dotNotes" },
		{ name: "description", content: "dotNotes personal note workspace" },
	];
}

export default function Home() {
	const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("capture");
	const [editorMode, setEditorMode] = useState<EditorMode>("edit");
	const [viewportWidth, setViewportWidth] = useState(0);
	const [aiOpen, setAiOpen] = useState(false);
	const [folderItems, setFolderItems] = useState<FolderApiItem[]>(defaultRootFolders);
	const [organizeFolderId, setOrganizeFolderId] = useState<string | null>(null);
	const [captureFolderId, setCaptureFolderId] = useState<string>(defaultRootFolders[0].id);
	const [captureInput, setCaptureInput] = useState("");
	const [noteItems, setNoteItems] = useState<NoteItem[]>(seedNotes);
	const [activeNoteId, setActiveNoteId] = useState(seedNotes[0]?.id ?? "");
	const [draft, setDraft] = useState(seedNotes[0]?.content ?? "");

	const activeNote = useMemo(
		() => noteItems.find((note) => note.id === activeNoteId) ?? noteItems[0] ?? null,
		[noteItems, activeNoteId],
	);
	const organizeNotes = useMemo(() => {
		if (!organizeFolderId) {
			return noteItems;
		}
		return noteItems.filter((note) => note.folderId === organizeFolderId);
	}, [noteItems, organizeFolderId]);
	const noteIdBySlug = useMemo(
		() => new Map(noteItems.map((note) => [note.slug, note.id] as const)),
		[noteItems],
	);
	const previewMarkdown = useMemo(() => toMarkdownWithWikiLinks(draft), [draft]);
	const editorExtensions = useMemo(() => [markdown()], []);
	const canUseSplit = viewportWidth >= 1280;
	const useHorizontalSplit = viewportWidth >= 1600;
	const effectiveEditorMode = editorMode === "split" && !canUseSplit ? "edit" : editorMode;
	const mobileEditorMode = effectiveEditorMode === "split" ? "edit" : effectiveEditorMode;

	const markdownComponents: Components = useMemo(
		() => ({
			h1: ({ children }) => <h1 className="mb-3 text-2xl font-bold tracking-tight text-slate-900">{children}</h1>,
			h2: ({ children }) => <h2 className="mb-2 mt-5 text-xl font-semibold text-slate-900">{children}</h2>,
			h3: ({ children }) => <h3 className="mb-2 mt-4 text-lg font-semibold text-slate-900">{children}</h3>,
			p: ({ children }) => <p className="mb-3 leading-7 text-slate-700">{children}</p>,
			ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 text-slate-700">{children}</ul>,
			ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 text-slate-700">{children}</ol>,
			li: ({ children }) => <li>{children}</li>,
			code: ({ className, children }) => {
				if (className) {
					return (
						<code className="block overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
							{children}
						</code>
					);
				}
				return <code className="rounded bg-slate-200 px-1 py-0.5 text-xs text-slate-900">{children}</code>;
			},
			a: ({ href, children }) => {
				if (href?.startsWith("wiki:")) {
					const slug = decodeURIComponent(href.slice("wiki:".length));
					const targetNoteId = noteIdBySlug.get(slug);
					if (!targetNoteId) {
						return <span className="text-amber-700 underline decoration-dotted">{children}</span>;
					}
					return (
						<button
							type="button"
							onClick={() => {
								setActiveNoteId(targetNoteId);
								setWorkspaceMode("focus");
							}}
							className="cursor-pointer text-sky-700 underline decoration-dotted hover:text-sky-600"
						>
							{children}
						</button>
					);
				}
				return (
					<a href={href} target="_blank" rel="noreferrer" className="text-sky-700 underline hover:text-sky-600">
						{children}
					</a>
				);
			},
		}),
		[noteIdBySlug],
	);

	useEffect(() => {
		if (activeNote) {
			setDraft(activeNote.content);
		}
	}, [activeNote]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		const updateViewportWidth = () => {
			setViewportWidth(window.innerWidth);
		};
		updateViewportWidth();
		window.addEventListener("resize", updateViewportWidth);
		return () => {
			window.removeEventListener("resize", updateViewportWidth);
		};
	}, []);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		const storedWorkspaceMode = window.localStorage.getItem(WORKSPACE_MODE_STORAGE_KEY);
		if (storedWorkspaceMode === "capture" || storedWorkspaceMode === "organize" || storedWorkspaceMode === "focus") {
			setWorkspaceMode(storedWorkspaceMode);
		}
		const storedEditorMode = window.localStorage.getItem(EDITOR_MODE_STORAGE_KEY);
		if (storedEditorMode === "edit" || storedEditorMode === "preview" || storedEditorMode === "split") {
			setEditorMode(storedEditorMode);
		}
	}, []);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		window.localStorage.setItem(WORKSPACE_MODE_STORAGE_KEY, workspaceMode);
	}, [workspaceMode]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		window.localStorage.setItem(EDITOR_MODE_STORAGE_KEY, editorMode);
	}, [editorMode]);

	useEffect(() => {
		if (!folderItems.some((folder) => folder.id === captureFolderId)) {
			setCaptureFolderId(folderItems[0]?.id ?? defaultRootFolders[0].id);
		}
	}, [folderItems, captureFolderId]);

	useEffect(() => {
		let cancelled = false;
		const loadFolders = async () => {
			const response = await fetch("/api/folders", {
				headers: { Accept: "application/json" },
			}).catch(() => null);
			if (!response?.ok) {
				return;
			}
			const payload = await response.json().catch(() => null);
			if (!isRecord(payload) || payload.ok !== true || !Array.isArray(payload.data)) {
				return;
			}

			const roots = payload.data
				.filter((item): item is FolderApiItem => isFolderApiItem(item))
				.filter((item) => !item.parentId)
				.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-CN"));

			if (!cancelled && roots.length > 0) {
				setFolderItems(roots);
			}
		};

		void loadFolders();
		return () => {
			cancelled = true;
		};
	}, []);

	const handleDraftChange = (value: string) => {
		setDraft(value);
		setNoteItems((prev) =>
			prev.map((note) =>
				note.id === activeNoteId
					? {
						...note,
						content: value,
						summary: buildSummary(value),
					}
					: note,
			),
		);
	};

	const handleCaptureSend = () => {
		const content = captureInput.trim();
		if (!content) {
			return;
		}
		const title = buildTitle(content);
		const slug = ensureUniqueLocalSlug(toWikiSlug(title), noteItems);
		const newNote: NoteItem = {
			id: crypto.randomUUID(),
			slug,
			title,
			updatedAt: formatNow(),
			tags: extractHashTags(content),
			summary: buildSummary(content),
			content,
			folderId: captureFolderId,
		};
		setNoteItems((prev) => [newNote, ...prev]);
		setActiveNoteId(newNote.id);
		setDraft(newNote.content);
		setCaptureInput("");
	};

	const focusNote = (noteId: string) => {
		setActiveNoteId(noteId);
		setWorkspaceMode("focus");
	};

	const activeFolderName = folderItems.find((folder) => folder.id === captureFolderId)?.name ?? "00-Inbox";

	return (
		<div className="min-h-screen bg-[#f4f6f8] text-slate-900">
			<div
				className={`mx-auto flex min-h-screen w-full max-w-[1700px] flex-col px-3 py-3 transition-[padding] duration-300 md:px-4 md:py-4 ${
					aiOpen ? "md:pr-[23rem]" : ""
				}`}
			>
				<header className="mb-3 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/90 px-3 py-3 shadow-sm backdrop-blur md:mb-4 md:gap-3 md:px-4">
					<div className="min-w-0 flex-1">
						<p className="text-sm font-semibold tracking-tight text-slate-900">dotNotes</p>
						<p className="text-xs text-slate-500">Capture-first + Knowledge Workspace</p>
					</div>
					<input
						type="text"
						readOnly
						value="⌘K 搜索/命令"
						className="hidden h-10 w-full max-w-md rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500 lg:block"
					/>
					<div className="hidden rounded-xl border border-slate-200 bg-slate-50 p-1 md:inline-flex">
						<ModeButton label="Capture" active={workspaceMode === "capture"} onClick={() => setWorkspaceMode("capture")} />
						<ModeButton label="Organize" active={workspaceMode === "organize"} onClick={() => setWorkspaceMode("organize")} />
						<ModeButton label="Focus" active={workspaceMode === "focus"} onClick={() => setWorkspaceMode("focus")} />
					</div>
					<button
						onClick={() => setAiOpen((v) => !v)}
						className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 md:text-sm"
					>
						{aiOpen ? "隐藏 AI" : "打开 AI"}
					</button>
				</header>

				<div className="hidden min-h-0 flex-1 md:block">
					{workspaceMode === "capture" ? (
						<div className="mx-auto flex h-full w-full max-w-[920px] flex-col gap-3">
							<section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
								<div className="mb-2 flex items-center justify-between">
									<p className="text-sm font-semibold">快速记录</p>
									<span className="text-xs text-slate-500">当前目录：{activeFolderName}</span>
								</div>
								<textarea
									value={captureInput}
									onChange={(e) => setCaptureInput(e.target.value)}
									placeholder="随手记一条，支持 [[note]] 和 #tag"
									className="h-28 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:ring"
								/>
								<div className="mt-3 flex items-center justify-between">
									<select
										value={captureFolderId}
										onChange={(e) => setCaptureFolderId(e.target.value)}
										className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-600"
									>
										{folderItems.map((folder) => (
											<option key={folder.id} value={folder.id}>
												{folder.name}
											</option>
										))}
									</select>
									<button
										onClick={handleCaptureSend}
										className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
									>
										发送
									</button>
								</div>
							</section>

							<section className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
								<div className="space-y-2">
									{noteItems.map((note) => (
										<button
											key={note.id}
											onClick={() => focusNote(note.id)}
											className="w-full rounded-xl border border-slate-200 px-3 py-3 text-left hover:border-slate-300 hover:bg-slate-50"
										>
											<div className="mb-1 flex items-center justify-between">
												<p className="text-sm font-medium text-slate-900">{note.title}</p>
												<span className="text-xs text-slate-500">{note.updatedAt}</span>
											</div>
											<p className="line-clamp-2 text-xs text-slate-600">{note.summary}</p>
										</button>
									))}
								</div>
							</section>
						</div>
					) : null}

					{workspaceMode === "organize" ? (
						<div className="grid h-full grid-cols-[260px_minmax(0,1fr)] gap-4">
							<aside className="flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
								<p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">目录</p>
								<div className="space-y-1 overflow-y-auto">
									<button
										onClick={() => setOrganizeFolderId(null)}
										className={`w-full rounded-lg px-2 py-2 text-left text-sm ${
											organizeFolderId === null ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
										}`}
									>
										全部目录
									</button>
									{folderItems.map((folder) => (
										<button
											key={folder.id}
											onClick={() => setOrganizeFolderId(folder.id)}
											className={`w-full rounded-lg px-2 py-2 text-left text-sm ${
												organizeFolderId === folder.id
													? "bg-slate-900 text-white"
													: "text-slate-700 hover:bg-slate-100"
											}`}
										>
											{folder.name}
										</button>
									))}
								</div>
							</aside>

							<section className="flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
								<div className="mb-3 flex items-center justify-between">
									<p className="text-sm font-semibold">笔记列表</p>
									<span className="text-xs text-slate-500">{organizeNotes.length} 条</span>
								</div>
								<div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
									{organizeNotes.map((note) => (
										<button
											key={note.id}
											onClick={() => focusNote(note.id)}
											className="w-full rounded-xl border border-slate-200 px-3 py-3 text-left hover:border-slate-300 hover:bg-slate-50"
										>
											<p className="text-sm font-medium text-slate-900">{note.title}</p>
											<p className="mt-1 text-xs text-slate-500">{note.updatedAt}</p>
											<p className="mt-1 line-clamp-2 text-xs text-slate-600">{note.summary}</p>
										</button>
									))}
								</div>
							</section>
						</div>
					) : null}

					{workspaceMode === "focus" ? (
						<section className="flex h-full min-h-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
							<div className="mb-3 border-b border-slate-100 pb-3">
								<div className="flex items-center justify-between gap-3">
									<div>
										<p className="text-lg font-semibold tracking-tight">{activeNote?.title ?? "未选择笔记"}</p>
										<p className="mt-1 text-xs text-slate-500">{activeNote?.updatedAt ?? ""} · 自动保存中...</p>
									</div>
									<div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
										<ModeButton label="编辑" active={effectiveEditorMode === "edit"} onClick={() => setEditorMode("edit")} />
										<ModeButton label="预览" active={effectiveEditorMode === "preview"} onClick={() => setEditorMode("preview")} />
										<ModeButton
											label="分屏"
											active={effectiveEditorMode === "split"}
											disabled={!canUseSplit}
											onClick={() => setEditorMode("split")}
										/>
									</div>
								</div>
								<div className="mt-2 flex flex-wrap gap-2">
									{(activeNote?.tags ?? []).map((tag) => (
										<span key={tag} className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600">
											{tag}
										</span>
									))}
								</div>
							</div>

							{effectiveEditorMode === "edit" ? (
								<div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto [&_.cm-theme]:h-full">
									<CodeMirror
										value={draft}
										height="100%"
										extensions={editorExtensions}
										onChange={handleDraftChange}
										className="h-full text-sm"
									/>
								</div>
							) : null}

							{effectiveEditorMode === "preview" ? (
								<div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4">
									<ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
										{previewMarkdown || "*（空白笔记）*"}
									</ReactMarkdown>
								</div>
							) : null}

							{effectiveEditorMode === "split" ? (
								<div
									className={`grid min-h-0 flex-1 gap-3 ${
										useHorizontalSplit
											? "grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
											: "grid-rows-[minmax(0,1fr)_minmax(0,1fr)]"
									}`}
								>
									<div className="min-h-0 overflow-hidden rounded-xl border border-slate-200 bg-white [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto [&_.cm-theme]:h-full">
										<CodeMirror
											value={draft}
											height="100%"
											extensions={editorExtensions}
											onChange={handleDraftChange}
											className="h-full text-sm"
										/>
									</div>
									<div className="min-h-0 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4">
										<ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
											{previewMarkdown || "*（空白笔记）*"}
										</ReactMarkdown>
									</div>
								</div>
							) : null}
						</section>
					) : null}
				</div>

				<div className="space-y-3 md:hidden">
					<div className="rounded-2xl border border-slate-200 bg-white p-2">
						<div className="grid grid-cols-3 gap-2">
							<ModeButton label="Capture" active={workspaceMode === "capture"} onClick={() => setWorkspaceMode("capture")} />
							<ModeButton label="Organize" active={workspaceMode === "organize"} onClick={() => setWorkspaceMode("organize")} />
							<ModeButton label="Focus" active={workspaceMode === "focus"} onClick={() => setWorkspaceMode("focus")} />
						</div>
					</div>

					{workspaceMode === "capture" ? (
						<div className="space-y-3">
							<section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
								<textarea
									value={captureInput}
									onChange={(e) => setCaptureInput(e.target.value)}
									placeholder="快速记录..."
									className="h-24 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm"
								/>
								<div className="mt-2 flex items-center justify-between">
									<select
										value={captureFolderId}
										onChange={(e) => setCaptureFolderId(e.target.value)}
										className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-600"
									>
										{folderItems.map((folder) => (
											<option key={folder.id} value={folder.id}>
												{folder.name}
											</option>
										))}
									</select>
									<button
										onClick={handleCaptureSend}
										className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white"
									>
										发送
									</button>
								</div>
							</section>

							<section className="max-h-[56dvh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
								<div className="space-y-2">
									{noteItems.map((note) => (
										<button
											key={note.id}
											onClick={() => focusNote(note.id)}
											className="w-full rounded-xl border border-slate-200 px-3 py-3 text-left"
										>
											<p className="text-sm font-medium">{note.title}</p>
											<p className="mt-1 text-xs text-slate-500">{note.updatedAt}</p>
										</button>
									))}
								</div>
							</section>
						</div>
					) : null}

					{workspaceMode === "organize" ? (
						<div className="space-y-3">
							<section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
								<div className="flex gap-2">
									<button
										onClick={() => setOrganizeFolderId(null)}
										className={`shrink-0 rounded-lg px-3 py-2 text-xs ${
											organizeFolderId === null ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
										}`}
									>
										全部
									</button>
									{folderItems.map((folder) => (
										<button
											key={folder.id}
											onClick={() => setOrganizeFolderId(folder.id)}
											className={`shrink-0 rounded-lg px-3 py-2 text-xs ${
												organizeFolderId === folder.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
											}`}
										>
											{folder.name}
										</button>
									))}
								</div>
							</section>

							<section className="max-h-[62dvh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
								<div className="space-y-2">
									{organizeNotes.map((note) => (
										<button
											key={note.id}
											onClick={() => focusNote(note.id)}
											className="w-full rounded-xl border border-slate-200 px-3 py-3 text-left"
										>
											<p className="text-sm font-medium">{note.title}</p>
											<p className="mt-1 text-xs text-slate-500">{note.updatedAt}</p>
											<p className="mt-1 line-clamp-2 text-xs text-slate-600">{note.summary}</p>
										</button>
									))}
								</div>
							</section>
						</div>
					) : null}

					{workspaceMode === "focus" ? (
						<section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
							<div className="mb-2 flex items-center justify-between">
								<p className="text-sm font-semibold">{activeNote?.title ?? "未选择笔记"}</p>
								<div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
									<ModeButton label="编辑" active={mobileEditorMode === "edit"} onClick={() => setEditorMode("edit")} />
									<ModeButton label="预览" active={mobileEditorMode === "preview"} onClick={() => setEditorMode("preview")} />
								</div>
							</div>
							{mobileEditorMode === "edit" ? (
								<textarea
									value={draft}
									onChange={(e) => handleDraftChange(e.target.value)}
									className="h-[58dvh] w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm"
								/>
							) : (
								<div className="h-[58dvh] overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3">
									<ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
										{previewMarkdown || "*（空白笔记）*"}
									</ReactMarkdown>
								</div>
							)}
						</section>
					) : null}
				</div>
			</div>

			{aiOpen ? (
				<button
					onClick={() => setAiOpen(false)}
					className="fixed inset-0 z-20 hidden bg-slate-900/10 md:block"
					aria-label="关闭 AI 抽屉遮罩"
				/>
			) : null}

			{aiOpen ? (
				<button
					onClick={() => setAiOpen(false)}
					className="fixed inset-0 z-30 bg-slate-900/35 md:hidden"
					aria-label="关闭移动端 AI 抽屉遮罩"
				/>
			) : null}

			{!aiOpen ? (
				<button
					onClick={() => setAiOpen(true)}
					className="fixed right-0 top-1/2 z-20 hidden -translate-y-1/2 rounded-l-xl border border-r-0 border-slate-300 bg-white px-3 py-3 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 md:block"
				>
					AI 助手
				</button>
			) : null}

			<div
				className={`fixed right-0 top-0 z-30 hidden h-full w-full max-w-sm border-l border-slate-200 bg-white/95 p-4 shadow-2xl backdrop-blur transition-transform duration-300 md:block ${
					aiOpen ? "translate-x-0" : "translate-x-full"
				}`}
			>
				<div className="mb-3 flex items-center justify-end">
					<button
						onClick={() => setAiOpen(false)}
						className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
					>
						关闭
					</button>
				</div>
				<div className="h-[calc(100%-2.25rem)] overflow-y-auto">
					<AiPanel />
				</div>
			</div>

			<div
				className={`fixed inset-x-0 bottom-0 z-40 md:hidden ${
					aiOpen ? "translate-y-0" : "pointer-events-none translate-y-full"
				} transition-transform duration-300`}
			>
				<div className="rounded-t-2xl border border-slate-200 bg-white px-3 pb-4 pt-2 shadow-2xl">
					<div className="mb-2 flex items-center justify-center">
						<span className="h-1 w-12 rounded-full bg-slate-300" />
					</div>
					<div className="mb-2 flex items-center justify-end">
						<button
							onClick={() => setAiOpen(false)}
							className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600"
						>
							关闭
						</button>
					</div>
					<div className="max-h-[68dvh] overflow-y-auto pb-[max(env(safe-area-inset-bottom),0.5rem)]">
						<AiPanel />
					</div>
				</div>
			</div>
		</div>
	);
}

function ModeButton(props: {
	label: string;
	active: boolean;
	disabled?: boolean;
	onClick: () => void;
}) {
	const { label, active, disabled = false, onClick } = props;
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={`rounded-md px-3 py-1 text-xs font-medium transition ${
				active
					? "bg-slate-900 text-white"
					: "text-slate-600 hover:bg-slate-200"
			} ${disabled ? "cursor-not-allowed opacity-40 hover:bg-transparent" : ""}`}
		>
			{label}
		</button>
	);
}

function AiPanel() {
	return (
		<div>
			<div className="mb-4 flex items-center justify-between">
				<p className="text-sm font-semibold">AI 助手</p>
				<span className="rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-700">在线</span>
			</div>
			<div className="space-y-2">
				{["总结本笔记", "改写成行动项", "生成标签", "语义检索"].map((action) => (
					<button
						key={action}
						className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
					>
						{action}
					</button>
				))}
			</div>
			<div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
				<p className="text-xs font-medium text-slate-500">检索结果示例</p>
				<p className="mt-2 text-sm text-slate-700">RAG 方案草稿 · 命中 0.92</p>
				<p className="mt-1 text-xs text-slate-500">定义 chunk 策略、召回与重排流程。</p>
			</div>
		</div>
	);
}

function isFolderApiItem(value: unknown): value is FolderApiItem {
	if (!isRecord(value)) {
		return false;
	}
	return (
		typeof value.id === "string" &&
		typeof value.name === "string" &&
		(typeof value.parentId === "string" || value.parentId === null) &&
		typeof value.sortOrder === "number"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toMarkdownWithWikiLinks(content: string): string {
	return content.replace(WIKI_LINK_PATTERN, (_, rawValue: string) => {
		const label = rawValue.trim();
		if (!label) {
			return "";
		}
		const slug = toWikiSlug(label);
		return `[[${label}]](wiki:${encodeURIComponent(slug)})`;
	});
}

function toWikiSlug(input: string): string {
	const base = input
		.toLowerCase()
		.trim()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
	return base.length > 0 ? base : "untitled";
}

function buildSummary(content: string): string {
	const normalized = content.replace(/\s+/g, " ").trim();
	if (!normalized) {
		return "空白笔记";
	}
	return normalized.length > 88 ? `${normalized.slice(0, 88)}...` : normalized;
}

function buildTitle(content: string): string {
	const firstLine = content
		.split("\n")
		.map((line) => line.replace(/^#+\s*/, "").trim())
		.find((line) => line.length > 0);
	if (!firstLine) {
		return "快速记录";
	}
	return firstLine.length > 32 ? `${firstLine.slice(0, 32)}...` : firstLine;
}

function ensureUniqueLocalSlug(slug: string, notes: NoteItem[]): string {
	const existing = new Set(notes.map((note) => note.slug));
	if (!existing.has(slug)) {
		return slug;
	}
	let index = 1;
	while (existing.has(`${slug}-${index}`)) {
		index += 1;
	}
	return `${slug}-${index}`;
}

function extractHashTags(content: string): string[] {
	const tags = new Set<string>();
	for (const match of content.matchAll(/#([^\s#]+)/g)) {
		const value = match[1]?.trim();
		if (value) {
			tags.add(value);
		}
	}
	return [...tags].slice(0, 6);
}

function formatNow(): string {
	const now = new Date();
	const month = now.getMonth() + 1;
	const day = now.getDate();
	const hours = String(now.getHours()).padStart(2, "0");
	const minutes = String(now.getMinutes()).padStart(2, "0");
	return `${month}月${day}日 ${hours}:${minutes}`;
}
