import { markdown } from "@codemirror/lang-markdown";
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
	createNote,
	deleteNote,
	listNotes,
	listRootFolders,
	listTags,
	updateNote,
	type FolderApiItem,
	type NoteApiItem,
	type TagApiItem,
} from "../lib/api";
import type { Route } from "./+types/home";

type NoteItem = {
	id: string;
	slug: string;
	title: string;
	updatedAt: string;
	tagIds: string[];
	tags: string[];
	summary: string;
	content: string;
	folderId: string;
};

type WorkspaceMode = "capture" | "organize" | "focus";
type EditorMode = "edit" | "preview" | "split";
type CommandAction = {
	id: string;
	label: string;
	description: string;
	keywords: string[];
	run: () => void;
};
type CommandEntry = {
	id: string;
	type: "action" | "note";
	label: string;
	description: string;
	onSelect: () => void;
};

const WORKSPACE_MODE_STORAGE_KEY = "dotnotes.workspace.mode";
const EDITOR_MODE_STORAGE_KEY = "dotnotes.editor.mode";
const RECENT_NOTE_IDS_STORAGE_KEY = "dotnotes.command.recent-note-ids";
const RECENT_NOTE_LIMIT = 12;
const WIKI_LINK_PATTERN = /\[\[([^\[\]]+)\]\]/g;

const defaultRootFolders: FolderApiItem[] = [
	{ id: "folder-00-inbox", parentId: null, name: "00-Inbox", sortOrder: 0 },
	{ id: "folder-10-projects", parentId: null, name: "10-Projects", sortOrder: 10 },
	{ id: "folder-20-areas", parentId: null, name: "20-Areas", sortOrder: 20 },
	{ id: "folder-30-resource", parentId: null, name: "30-Resource", sortOrder: 30 },
	{ id: "folder-40-archive", parentId: null, name: "40-Archive", sortOrder: 40 },
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
	const [noteItems, setNoteItems] = useState<NoteItem[]>([]);
	const [tagItems, setTagItems] = useState<TagApiItem[]>([]);
	const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
	const [activeNoteId, setActiveNoteId] = useState("");
	const [draft, setDraft] = useState("");
	const [isCreatingNote, setIsCreatingNote] = useState(false);
	const [isSavingDraft, setIsSavingDraft] = useState(false);
	const [isDeletingNote, setIsDeletingNote] = useState(false);
	const [commandOpen, setCommandOpen] = useState(false);
	const [commandQuery, setCommandQuery] = useState("");
	const [commandResults, setCommandResults] = useState<NoteItem[]>([]);
	const [isCommandLoading, setIsCommandLoading] = useState(false);
	const [commandActiveIndex, setCommandActiveIndex] = useState(0);
	const [recentNoteIds, setRecentNoteIds] = useState<string[]>([]);

	const noteItemsRef = useRef<NoteItem[]>([]);
	const selectedTagIdsRef = useRef<string[]>([]);
	const saveTimerRef = useRef<number | null>(null);
	const pendingSaveRef = useRef<{ noteId: string; content: string } | null>(null);
	const saveInFlightRef = useRef(false);
	const commandInputRef = useRef<HTMLInputElement | null>(null);

	const activeNote = useMemo(
		() => noteItems.find((note) => note.id === activeNoteId) ?? noteItems[0] ?? null,
		[noteItems, activeNoteId],
	);
	const recentOpenedNotes = useMemo(() => {
		const notesById = new Map(noteItems.map((note) => [note.id, note] as const));
		return recentNoteIds
			.map((id) => notesById.get(id) ?? null)
			.filter((item): item is NoteItem => item !== null);
	}, [noteItems, recentNoteIds]);
	const defaultCommandNotes = useMemo(() => {
		const seen = new Set<string>();
		const merged: NoteItem[] = [];
		for (const note of recentOpenedNotes) {
			if (seen.has(note.id)) {
				continue;
			}
			seen.add(note.id);
			merged.push(note);
		}
		for (const note of noteItems) {
			if (seen.has(note.id)) {
				continue;
			}
			seen.add(note.id);
			merged.push(note);
		}
		return merged.slice(0, RECENT_NOTE_LIMIT);
	}, [noteItems, recentOpenedNotes]);
	const recentNoteIdSet = useMemo(() => new Set(recentNoteIds), [recentNoteIds]);
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
		setDraft(activeNote?.content ?? "");
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
		const storedRecentIds = window.localStorage.getItem(RECENT_NOTE_IDS_STORAGE_KEY);
		if (!storedRecentIds) {
			return;
		}
		try {
			const parsed = JSON.parse(storedRecentIds) as unknown;
			if (!Array.isArray(parsed)) {
				return;
			}
			const recentIds = parsed
				.filter((item): item is string => typeof item === "string")
				.slice(0, RECENT_NOTE_LIMIT);
			setRecentNoteIds(recentIds);
		} catch {
			setRecentNoteIds([]);
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
		if (typeof window === "undefined") {
			return;
		}
		window.localStorage.setItem(RECENT_NOTE_IDS_STORAGE_KEY, JSON.stringify(recentNoteIds));
	}, [recentNoteIds]);

	useEffect(() => {
		if (!commandOpen || typeof window === "undefined") {
			return;
		}
		const timer = window.setTimeout(() => {
			commandInputRef.current?.focus();
		}, 0);
		return () => {
			window.clearTimeout(timer);
		};
	}, [commandOpen]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		const onKeyDown = (event: KeyboardEvent) => {
			const key = event.key.toLowerCase();
			if ((event.metaKey || event.ctrlKey) && key === "k") {
				event.preventDefault();
				setCommandOpen(true);
				return;
			}
			if (event.key === "Escape") {
				setCommandOpen(false);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
		};
	}, []);

	useEffect(() => {
		noteItemsRef.current = noteItems;
	}, [noteItems]);

	useEffect(() => {
		selectedTagIdsRef.current = selectedTagIds;
	}, [selectedTagIds]);

	useEffect(() => {
		if (!activeNoteId) {
			return;
		}
		setRecentNoteIds((prev) => {
			const next = [activeNoteId, ...prev.filter((id) => id !== activeNoteId)];
			return next.slice(0, RECENT_NOTE_LIMIT);
		});
	}, [activeNoteId]);

	useEffect(() => {
		return () => {
			if (saveTimerRef.current !== null) {
				window.clearTimeout(saveTimerRef.current);
			}
		};
	}, []);

	useEffect(() => {
		if (!folderItems.some((folder) => folder.id === captureFolderId)) {
			setCaptureFolderId(folderItems[0]?.id ?? defaultRootFolders[0].id);
		}
	}, [folderItems, captureFolderId]);

	useEffect(() => {
		if (noteItems.length === 0) {
			if (activeNoteId) {
				setActiveNoteId("");
			}
			return;
		}
		if (!noteItems.some((note) => note.id === activeNoteId)) {
			setActiveNoteId(noteItems[0].id);
		}
	}, [noteItems, activeNoteId]);

	const refreshTags = async () => {
		const tags = await listTags().catch(() => null);
		if (!tags) {
			return;
		}
		const validTagIds = new Set(tags.map((tag) => tag.id));
		setTagItems(tags);
		setSelectedTagIds((prev) => {
			const next = prev.filter((id) => validTagIds.has(id));
			return next.length === prev.length ? prev : next;
		});
	};

	useEffect(() => {
		let cancelled = false;
		const loadFolders = async () => {
			const roots = await listRootFolders().catch(() => null);
			if (!roots || cancelled || roots.length === 0) {
				return;
			}
			setFolderItems(roots);
		};

		void loadFolders();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		const loadTags = async () => {
			const tags = await listTags().catch(() => null);
			if (!tags || cancelled) {
				return;
			}
			const validTagIds = new Set(tags.map((tag) => tag.id));
			setTagItems(tags);
			setSelectedTagIds((prev) => {
				const next = prev.filter((id) => validTagIds.has(id));
				return next.length === prev.length ? prev : next;
			});
		};

		void loadTags();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		const loadNotes = async () => {
			const notes = await listNotes({
				limit: 100,
				tagIds: selectedTagIds,
				tagMode: "any",
			}).catch(() => null);
			if (!notes || cancelled) {
				return;
			}
			const next = notes.map((note) => toNoteItem(note));
			setNoteItems(next);
			setActiveNoteId((prev) => {
				if (next.some((note) => note.id === prev)) {
					return prev;
				}
				return next[0]?.id ?? "";
			});
		};

		void loadNotes();
		return () => {
			cancelled = true;
		};
	}, [selectedTagIds]);

	useEffect(() => {
		if (!commandOpen) {
			return;
		}
		const keyword = commandQuery.trim();
		if (!keyword) {
			setIsCommandLoading(false);
			setCommandResults(defaultCommandNotes);
			return;
		}

		let cancelled = false;
		setIsCommandLoading(true);
		const timer = window.setTimeout(() => {
			void listNotes({
				limit: 20,
				keyword,
				tagMode: "any",
			})
				.then((notes) => {
					if (cancelled) {
						return;
					}
					setCommandResults(notes.map((note) => toNoteItem(note)));
				})
				.catch(() => {
					if (!cancelled) {
						setCommandResults([]);
					}
				})
				.finally(() => {
					if (!cancelled) {
						setIsCommandLoading(false);
					}
				});
		}, 180);

		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [commandOpen, commandQuery, defaultCommandNotes]);

	const flushPendingSave = async () => {
		if (saveInFlightRef.current) {
			return;
		}
		const pending = pendingSaveRef.current;
		if (!pending) {
			setIsSavingDraft(false);
			return;
		}

		pendingSaveRef.current = null;
		saveInFlightRef.current = true;
		const source = noteItemsRef.current.find((note) => note.id === pending.noteId);

		try {
			if (!source) {
				return;
			}
			const updated = await updateNote(pending.noteId, {
				title: source.title,
				folderId: source.folderId,
				bodyText: pending.content,
				excerpt: buildSummary(pending.content),
				tagNames: extractHashTags(pending.content),
			});
			void refreshTags();
			const next = toNoteItem(updated);
			setNoteItems((prev) => {
				const updatedList = prev.map((note) => (note.id === next.id ? { ...note, ...next } : note));
				const currentTagFilter = selectedTagIdsRef.current;
				if (currentTagFilter.length === 0 || matchesTagFilter(next, currentTagFilter)) {
					return updatedList;
				}
				return updatedList.filter((note) => note.id !== next.id);
			});
		} catch (error) {
			console.error("Failed to auto-save note", error);
		} finally {
			saveInFlightRef.current = false;
			if (pendingSaveRef.current) {
				void flushPendingSave();
			} else {
				setIsSavingDraft(false);
			}
		}
	};

	const scheduleAutoSave = (noteId: string, content: string) => {
		pendingSaveRef.current = { noteId, content };
		setIsSavingDraft(true);

		if (saveTimerRef.current !== null) {
			window.clearTimeout(saveTimerRef.current);
		}
		saveTimerRef.current = window.setTimeout(() => {
			saveTimerRef.current = null;
			void flushPendingSave();
		}, 700);
	};

	const handleDraftChange = (value: string) => {
		setDraft(value);
		if (!activeNoteId) {
			return;
		}
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
		scheduleAutoSave(activeNoteId, value);
	};

	const handleCaptureSend = async () => {
		const content = captureInput.trim();
		if (!content || isCreatingNote) {
			return;
		}
		setIsCreatingNote(true);
		try {
			const created = await createNote({
				title: buildTitle(content),
				folderId: captureFolderId,
				bodyText: content,
				tagNames: extractHashTags(content),
			});
			void refreshTags();
			const next = toNoteItem(created);
			const currentTagFilter = selectedTagIdsRef.current;
			if (currentTagFilter.length === 0 || matchesTagFilter(next, currentTagFilter)) {
				setNoteItems((prev) => [next, ...prev.filter((note) => note.id !== next.id)]);
				setActiveNoteId(next.id);
				setDraft(next.content);
			}
			setCaptureInput("");
		} catch (error) {
			console.error("Failed to create note", error);
		} finally {
			setIsCreatingNote(false);
		}
	};

	const toggleTagFilter = (tagId: string) => {
		setSelectedTagIds((prev) =>
			prev.includes(tagId)
				? prev.filter((id) => id !== tagId)
				: [...prev, tagId],
		);
	};

	const clearTagFilters = () => {
		setSelectedTagIds([]);
	};

	const focusNote = (noteId: string) => {
		setActiveNoteId(noteId);
		setWorkspaceMode("focus");
	};

	const handleDeleteActiveNote = async () => {
		if (!activeNote || isDeletingNote) {
			return;
		}
		if (typeof window !== "undefined") {
			const confirmed = window.confirm(`确定删除「${activeNote.title}」吗？`);
			if (!confirmed) {
				return;
			}
		}

		const deletingId = activeNote.id;
		if (saveTimerRef.current !== null) {
			window.clearTimeout(saveTimerRef.current);
			saveTimerRef.current = null;
		}
		if (pendingSaveRef.current?.noteId === deletingId) {
			pendingSaveRef.current = null;
			setIsSavingDraft(false);
		}

		setIsDeletingNote(true);
		try {
			await deleteNote(deletingId);
			const previous = noteItemsRef.current;
			const removedIndex = previous.findIndex((note) => note.id === deletingId);
			const next = previous.filter((note) => note.id !== deletingId);
			const fallbackId = removedIndex >= 0
				? (next[removedIndex]?.id ?? next[removedIndex - 1]?.id ?? next[0]?.id ?? "")
				: (next[0]?.id ?? "");

			setNoteItems(next);
			setActiveNoteId(fallbackId);
			if (!fallbackId) {
				setDraft("");
				setWorkspaceMode("organize");
			}
			await refreshTags();
		} catch (error) {
			console.error("Failed to delete note", error);
		} finally {
			setIsDeletingNote(false);
		}
	};

	const closeCommandPalette = () => {
		setCommandOpen(false);
		setCommandQuery("");
		setCommandActiveIndex(0);
	};

	const commandActions = useMemo<CommandAction[]>(
		() => [
			{
				id: "action-capture",
				label: "切换到 Capture",
				description: "打开快速记录面板",
				keywords: ["capture", "记录", "收集"],
				run: () => setWorkspaceMode("capture"),
			},
			{
				id: "action-organize",
				label: "切换到 Organize",
				description: "打开整理与筛选面板",
				keywords: ["organize", "整理", "标签", "目录"],
				run: () => setWorkspaceMode("organize"),
			},
			{
				id: "action-focus",
				label: "切换到 Focus",
				description: "打开当前笔记编辑器",
				keywords: ["focus", "专注", "编辑", "预览"],
				run: () => setWorkspaceMode("focus"),
			},
			{
				id: "action-clear-tags",
				label: "清空标签筛选",
				description: "移除当前所有标签过滤",
				keywords: ["tag", "标签", "filter", "筛选", "clear", "清空"],
				run: () => setSelectedTagIds([]),
			},
			{
				id: "action-toggle-ai",
				label: aiOpen ? "关闭 AI 面板" : "打开 AI 面板",
				description: "切换右侧 AI 助手抽屉",
				keywords: ["ai", "助手", "rag", "panel"],
				run: () => setAiOpen((v) => !v),
			},
		],
		[aiOpen],
	);

	const normalizedCommandQuery = commandQuery.trim().toLowerCase();
	const filteredCommandActions = useMemo(() => {
		if (!normalizedCommandQuery) {
			return commandActions;
		}
		return commandActions.filter((action) => {
			const label = action.label.toLowerCase();
			const description = action.description.toLowerCase();
			const keywords = action.keywords.some((keyword) => keyword.toLowerCase().includes(normalizedCommandQuery));
			return label.includes(normalizedCommandQuery) || description.includes(normalizedCommandQuery) || keywords;
		});
	}, [commandActions, normalizedCommandQuery]);

	const commandEntries = useMemo<CommandEntry[]>(() => {
		const actionEntries: CommandEntry[] = filteredCommandActions.map((action) => ({
			id: action.id,
			type: "action",
			label: action.label,
			description: action.description,
			onSelect: () => {
				action.run();
				closeCommandPalette();
			},
		}));
		const noteEntries: CommandEntry[] = commandResults.map((note) => ({
			id: `note-${note.id}`,
			type: "note",
			label: note.title,
			description: `${!normalizedCommandQuery && recentNoteIdSet.has(note.id) ? "最近打开 · " : ""}${formatUpdatedAt(note.updatedAt)} · ${note.tags.map((tag) => `#${tag}`).join(" ") || "无标签"}`,
			onSelect: () => {
				setNoteItems((prev) => {
					if (prev.some((item) => item.id === note.id)) {
						return prev;
					}
					return [note, ...prev];
				});
				setActiveNoteId(note.id);
				setWorkspaceMode("focus");
				closeCommandPalette();
			},
		}));
		return [...actionEntries, ...noteEntries];
	}, [filteredCommandActions, commandResults, normalizedCommandQuery, recentNoteIdSet]);

	useEffect(() => {
		setCommandActiveIndex(0);
	}, [normalizedCommandQuery, commandEntries.length]);

	const handleCommandInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setCommandActiveIndex((prev) => {
				if (commandEntries.length === 0) {
					return 0;
				}
				return (prev + 1) % commandEntries.length;
			});
			return;
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			setCommandActiveIndex((prev) => {
				if (commandEntries.length === 0) {
					return 0;
				}
				return prev === 0 ? commandEntries.length - 1 : prev - 1;
			});
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			commandEntries[commandActiveIndex]?.onSelect();
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			closeCommandPalette();
		}
	};

	const activeFolderName = folderItems.find((folder) => folder.id === captureFolderId)?.name ?? "00-Inbox";
	const saveStateText = isSavingDraft ? "自动保存中..." : "已保存";
	const hasTagFilters = selectedTagIds.length > 0;

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
					<button
						type="button"
						onClick={() => setCommandOpen(true)}
						className="hidden h-10 w-full max-w-md rounded-xl border border-slate-200 bg-slate-50 px-3 text-left text-sm text-slate-500 hover:bg-slate-100 lg:block"
					>
						⌘K 搜索/命令
					</button>
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
										disabled={isCreatingNote}
										className={`rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 ${
											isCreatingNote ? "cursor-not-allowed opacity-60" : ""
										}`}
									>
										{isCreatingNote ? "发送中..." : "发送"}
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
												<span className="text-xs text-slate-500">{formatUpdatedAt(note.updatedAt)}</span>
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
								<div className="mb-4">
									<div className="mb-2 flex items-center justify-between">
										<p className="text-xs font-semibold uppercase tracking-wide text-slate-500">标签</p>
										<button
											type="button"
											onClick={clearTagFilters}
											disabled={!hasTagFilters}
											className={`text-xs ${
												hasTagFilters ? "text-slate-600 hover:text-slate-900" : "text-slate-300"
											}`}
										>
											清空
										</button>
									</div>
									<div className="max-h-28 space-y-1 overflow-y-auto pr-1">
										{tagItems.length === 0 ? (
											<p className="px-2 py-1 text-xs text-slate-400">暂无标签</p>
										) : (
											tagItems.map((tag) => {
												const active = selectedTagIds.includes(tag.id);
												return (
													<button
														key={tag.id}
														type="button"
														onClick={() => toggleTagFilter(tag.id)}
														className={`w-full rounded-lg px-2 py-2 text-left text-sm ${
															active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
														}`}
													>
														#{tag.name}
													</button>
												);
											})
										)}
									</div>
								</div>
								<p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">目录</p>
								<div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
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
											<p className="mt-1 text-xs text-slate-500">{formatUpdatedAt(note.updatedAt)}</p>
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
										<p className="mt-1 text-xs text-slate-500">
											{activeNote?.updatedAt ? formatUpdatedAt(activeNote.updatedAt) : ""} · {saveStateText}
										</p>
									</div>
									<div className="flex items-center gap-2">
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
										<button
											type="button"
											onClick={handleDeleteActiveNote}
											disabled={!activeNote || isDeletingNote}
											className={`rounded-lg border px-3 py-2 text-xs font-medium ${
												!activeNote || isDeletingNote
													? "cursor-not-allowed border-slate-200 text-slate-300"
													: "border-rose-200 text-rose-600 hover:bg-rose-50"
											}`}
										>
											{isDeletingNote ? "删除中..." : "删除"}
										</button>
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
										disabled={isCreatingNote}
										className={`rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white ${
											isCreatingNote ? "cursor-not-allowed opacity-60" : ""
										}`}
									>
										{isCreatingNote ? "发送中..." : "发送"}
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
											<p className="mt-1 text-xs text-slate-500">{formatUpdatedAt(note.updatedAt)}</p>
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

							<section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
								<div className="mb-2 flex items-center justify-between px-1">
									<p className="text-xs font-semibold uppercase tracking-wide text-slate-500">标签</p>
									<button
										type="button"
										onClick={clearTagFilters}
										disabled={!hasTagFilters}
										className={`text-xs ${
											hasTagFilters ? "text-slate-600" : "text-slate-300"
										}`}
									>
										清空
									</button>
								</div>
								<div className="flex gap-2">
									{tagItems.length === 0 ? (
										<span className="px-2 py-2 text-xs text-slate-400">暂无标签</span>
									) : (
										tagItems.map((tag) => {
											const active = selectedTagIds.includes(tag.id);
											return (
												<button
													key={tag.id}
													type="button"
													onClick={() => toggleTagFilter(tag.id)}
													className={`shrink-0 rounded-lg px-3 py-2 text-xs ${
														active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
													}`}
												>
													#{tag.name}
												</button>
											);
										})
									)}
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
											<p className="mt-1 text-xs text-slate-500">{formatUpdatedAt(note.updatedAt)}</p>
											<p className="mt-1 line-clamp-2 text-xs text-slate-600">{note.summary}</p>
										</button>
									))}
								</div>
							</section>
						</div>
					) : null}

					{workspaceMode === "focus" ? (
						<section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
							<div className="mb-2 flex items-center justify-between gap-2">
								<p className="text-sm font-semibold">{activeNote?.title ?? "未选择笔记"}</p>
								<div className="flex items-center gap-2">
									<div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
										<ModeButton label="编辑" active={mobileEditorMode === "edit"} onClick={() => setEditorMode("edit")} />
										<ModeButton label="预览" active={mobileEditorMode === "preview"} onClick={() => setEditorMode("preview")} />
									</div>
									<button
										type="button"
										onClick={handleDeleteActiveNote}
										disabled={!activeNote || isDeletingNote}
										className={`rounded-lg border px-2 py-1 text-xs ${
											!activeNote || isDeletingNote
												? "cursor-not-allowed border-slate-200 text-slate-300"
												: "border-rose-200 text-rose-600"
										}`}
									>
										{isDeletingNote ? "删除中" : "删除"}
									</button>
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

			{commandOpen ? (
				<button
					type="button"
					onClick={closeCommandPalette}
					className="fixed inset-0 z-50 bg-slate-900/45"
					aria-label="关闭搜索与命令面板遮罩"
				/>
			) : null}

			{commandOpen ? (
				<section className="fixed inset-x-0 top-[8vh] z-[60] mx-auto w-[min(92vw,52rem)] rounded-2xl border border-slate-200 bg-white shadow-2xl">
					<div className="border-b border-slate-100 px-4 py-3">
						<input
							ref={commandInputRef}
							type="text"
							value={commandQuery}
							onChange={(event) => setCommandQuery(event.target.value)}
							onKeyDown={handleCommandInputKeyDown}
							placeholder="搜索笔记或输入命令..."
							className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none focus:ring"
						/>
						<p className="mt-2 text-xs text-slate-400">Enter 执行 · ↑↓ 选择 · Esc 关闭</p>
					</div>
					<div className="max-h-[62dvh] overflow-y-auto p-2">
						{isCommandLoading ? (
							<p className="px-3 py-4 text-sm text-slate-500">搜索中...</p>
						) : null}
						{!isCommandLoading && commandEntries.length === 0 ? (
							<p className="px-3 py-4 text-sm text-slate-500">没有匹配结果</p>
						) : null}
							{commandEntries.map((entry, index) => (
								<button
									key={entry.id}
									type="button"
									onClick={entry.onSelect}
								className={`mb-1 w-full rounded-xl px-3 py-2 text-left ${
										index === commandActiveIndex ? "bg-slate-900 text-white" : "hover:bg-slate-100"
									}`}
								>
									<p className="text-sm font-medium">
										{renderHighlightedText(entry.label, commandQuery, index === commandActiveIndex)}
									</p>
									<p className={`mt-1 text-xs ${index === commandActiveIndex ? "text-slate-200" : "text-slate-500"}`}>
										{renderHighlightedText(entry.description, commandQuery, index === commandActiveIndex)}
									</p>
								</button>
							))}
						</div>
					</section>
			) : null}
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

function toNoteItem(note: NoteApiItem): NoteItem {
	const content = note.bodyText ?? "";
	return {
		id: note.id,
		slug: note.slug,
		title: note.title,
		updatedAt: note.updatedAt,
		tagIds: note.tags.map((tag) => tag.id),
		tags: note.tags.map((tag) => tag.name),
		summary: note.excerpt || buildSummary(content),
		content,
		folderId: note.folderId,
	};
}

function matchesTagFilter(note: NoteItem, selectedTagIds: string[]): boolean {
	if (selectedTagIds.length === 0) {
		return true;
	}
	const idSet = new Set(note.tagIds);
	return selectedTagIds.some((tagId) => idSet.has(tagId));
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

function renderHighlightedText(value: string, query: string, isActiveRow: boolean): ReactNode {
	const keyword = query.trim();
	if (!keyword) {
		return value;
	}
	const escaped = escapeRegExp(keyword);
	if (!escaped) {
		return value;
	}
	const matcher = new RegExp(`(${escaped})`, "ig");
	const parts = value.split(matcher);
	if (parts.length <= 1) {
		return value;
	}
	return (
		<>
			{parts.map((part, index) => {
				if (part.toLowerCase() === keyword.toLowerCase()) {
					return (
						<mark
							key={`${part}-${index}`}
							className={`rounded px-0.5 ${
								isActiveRow
									? "bg-white/25 text-white"
									: "bg-amber-100 text-amber-900"
							}`}
						>
							{part}
						</mark>
					);
				}
				return <span key={`${part}-${index}`}>{part}</span>;
			})}
		</>
	);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatUpdatedAt(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return value;
	}
	const month = date.getMonth() + 1;
	const day = date.getDate();
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	return `${month}月${day}日 ${hours}:${minutes}`;
}
