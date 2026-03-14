import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "react-router";
import {
	archiveNote,
	createFolder,
	createNote,
	deleteNoteAsset,
	deleteNote,
	deleteNoteRelation,
	enhanceNoteWithAiTaskStream,
	getNoteLinks,
	hardDeleteNote,
	listFolders,
	listNoteAssets,
	listNotes,
	listNoteRelations,
	listTags,
	restoreNote,
	upsertNoteRelations,
	uploadNoteAsset,
	updateFolder,
	updateNote,
	updateNoteRelation,
	type AiEnhanceRelationSuggestionApiItem,
	type AiEnhanceRelatedNoteApiItem,
	type AiEnhanceResultApiItem,
	type AiEnhanceTaskStreamProgress,
	type AiEnhanceTaskApiKey,
	type FolderApiItem,
	type NoteAssetApiItem,
	type NoteLinkApiItem,
	type NoteLinksApiItem,
	type NoteRelationApiItem,
	type NoteRelationTypeApiItem,
	type NoteApiItem,
	type NoteStatus,
	type TagApiItem,
} from "../lib/api";
import { formatMonthDayTime } from "../lib/datetime";
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
	isArchived: boolean;
	deletedAt: string | null;
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
type WikiLinkCandidate = {
	label: string;
	slug: string;
};

const WORKSPACE_MODE_STORAGE_KEY = "dotnotes.workspace.mode";
const EDITOR_MODE_STORAGE_KEY = "dotnotes.editor.mode";
const RECENT_NOTE_IDS_STORAGE_KEY = "dotnotes.command.recent-note-ids";
const RECENT_NOTE_LIMIT = 12;
const WIKI_LINK_PATTERN = /\[\[([^\[\]]+)\]\]/g;
const AI_TASK_ITEMS: Array<{ key: AiEnhanceTaskApiKey; label: string }> = [
	{ key: "title", label: "生成标题" },
	{ key: "tags", label: "生成标签" },
	{ key: "semantic", label: "语义搜索" },
	{ key: "relations", label: "关系建议" },
	{ key: "summary", label: "摘要大纲" },
	{ key: "similar", label: "相似笔记" },
];

const defaultRootFolders: FolderApiItem[] = [
	{ id: "folder-00-inbox", parentId: null, name: "00-Inbox", sortOrder: 0 },
	{ id: "folder-10-projects", parentId: null, name: "10-Projects", sortOrder: 10 },
	{ id: "folder-20-areas", parentId: null, name: "20-Areas", sortOrder: 20 },
	{ id: "folder-30-resource", parentId: null, name: "30-Resource", sortOrder: 30 },
	{ id: "folder-40-archive", parentId: null, name: "40-Archive", sortOrder: 40 },
];
const PARA_MAIN_ROOT_IDS = new Set([
	"folder-10-projects",
	"folder-20-areas",
	"folder-30-resource",
	"folder-40-archive",
]);
const RELATION_TYPE_OPTIONS: Array<{ value: NoteRelationTypeApiItem; label: string }> = [
	{ value: "related", label: "相关" },
	{ value: "similar", label: "相似" },
	{ value: "complements", label: "互补" },
	{ value: "contrasts", label: "对照" },
	{ value: "same_project", label: "同项目" },
	{ value: "same_area", label: "同领域" },
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
	const [isFocusFullscreen, setIsFocusFullscreen] = useState(false);
	const [viewportWidth, setViewportWidth] = useState(0);
	const [aiOpen, setAiOpen] = useState(false);
	const [aiQuery, setAiQuery] = useState("");
	const [activeAiTask, setActiveAiTask] = useState<AiEnhanceTaskApiKey | null>(null);
	const [aiEnhanceResult, setAiEnhanceResult] = useState<AiEnhanceResultApiItem | null>(null);
	const [runningAiTasks, setRunningAiTasks] = useState<AiEnhanceTaskApiKey[]>([]);
	const [aiTaskStages, setAiTaskStages] = useState<Partial<Record<AiEnhanceTaskApiKey, string>>>({});
	const [aiErrorMessage, setAiErrorMessage] = useState("");
	const [isApplyingAiTitle, setIsApplyingAiTitle] = useState(false);
	const [isApplyingAiTags, setIsApplyingAiTags] = useState(false);
	const [isApplyingAiRelations, setIsApplyingAiRelations] = useState(false);
	const [folderItems, setFolderItems] = useState<FolderApiItem[]>(defaultRootFolders);
	const [organizeFolderId, setOrganizeFolderId] = useState<string | null>(null);
	const [captureFolderId, setCaptureFolderId] = useState<string>(defaultRootFolders[0].id);
	const [newFolderName, setNewFolderName] = useState("");
	const [newFolderParentId, setNewFolderParentId] = useState("folder-10-projects");
	const [isCreatingFolder, setIsCreatingFolder] = useState(false);
	const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
	const [editingFolderName, setEditingFolderName] = useState("");
	const [isUpdatingFolder, setIsUpdatingFolder] = useState(false);
	const [isMovingNote, setIsMovingNote] = useState(false);
	const [folderErrorMessage, setFolderErrorMessage] = useState("");
	const [captureInput, setCaptureInput] = useState("");
	const [noteItems, setNoteItems] = useState<NoteItem[]>([]);
	const [noteStatusFilter, setNoteStatusFilter] = useState<NoteStatus>("active");
	const [tagItems, setTagItems] = useState<TagApiItem[]>([]);
	const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
	const [activeNoteId, setActiveNoteId] = useState("");
	const [titleDraft, setTitleDraft] = useState("");
	const [isTitleEditing, setIsTitleEditing] = useState(false);
	const [draft, setDraft] = useState("");
	const [isCreatingNote, setIsCreatingNote] = useState(false);
	const [isSavingDraft, setIsSavingDraft] = useState(false);
	const [isArchivingNote, setIsArchivingNote] = useState(false);
	const [isRestoringNote, setIsRestoringNote] = useState(false);
	const [isDeletingNote, setIsDeletingNote] = useState(false);
	const [linkInsertOpen, setLinkInsertOpen] = useState(false);
	const [linkInsertQuery, setLinkInsertQuery] = useState("");
	const [linkInsertResults, setLinkInsertResults] = useState<NoteItem[]>([]);
	const [isLinkInsertLoading, setIsLinkInsertLoading] = useState(false);
	const [isSyncingLinks, setIsSyncingLinks] = useState(false);
	const [commandOpen, setCommandOpen] = useState(false);
	const [commandQuery, setCommandQuery] = useState("");
	const [commandResults, setCommandResults] = useState<NoteItem[]>([]);
	const [isCommandLoading, setIsCommandLoading] = useState(false);
	const [commandActiveIndex, setCommandActiveIndex] = useState(0);
	const [recentNoteIds, setRecentNoteIds] = useState<string[]>([]);
	const [noteLinks, setNoteLinks] = useState<NoteLinksApiItem | null>(null);
	const [noteRelations, setNoteRelations] = useState<NoteRelationApiItem[]>([]);
	const [isLoadingNoteLinks, setIsLoadingNoteLinks] = useState(false);
	const [isLoadingNoteRelations, setIsLoadingNoteRelations] = useState(false);
	const [mutatingRelationId, setMutatingRelationId] = useState("");
	const [noteAssets, setNoteAssets] = useState<NoteAssetApiItem[]>([]);
	const [isLoadingAssets, setIsLoadingAssets] = useState(false);
	const [isUploadingAsset, setIsUploadingAsset] = useState(false);
	const [deletingAssetId, setDeletingAssetId] = useState("");
	const [assetErrorMessage, setAssetErrorMessage] = useState("");
	const [isClientReady, setIsClientReady] = useState(false);
	const [markdownEditorComponent, setMarkdownEditorComponent] =
		useState<ComponentType<{
			value: string;
			onChange: (value: string) => void;
			height?: string;
			className?: string;
		}> | null>(null);

	const noteItemsRef = useRef<NoteItem[]>([]);
	const selectedTagIdsRef = useRef<string[]>([]);
	const saveTimerRef = useRef<number | null>(null);
	const pendingSaveRef = useRef<{ noteId: string; content: string } | null>(null);
	const saveInFlightRef = useRef(false);
	const aiTaskRunIdRef = useRef<Record<AiEnhanceTaskApiKey, number>>({
		title: 0,
		tags: 0,
		semantic: 0,
		relations: 0,
		summary: 0,
		similar: 0,
	});
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
	const rootFolderItems = useMemo(
		() =>
			folderItems
				.filter((folder) => folder.parentId === null)
				.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-CN")),
		[folderItems],
	);
	const folderChildrenByParent = useMemo(() => {
		const mapping = new Map<string, FolderApiItem[]>();
		for (const folder of folderItems) {
			if (!folder.parentId) {
				continue;
			}
			const list = mapping.get(folder.parentId) ?? [];
			list.push(folder);
			mapping.set(folder.parentId, list);
		}
		for (const list of mapping.values()) {
			list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-CN"));
		}
		return mapping;
	}, [folderItems]);
	const folderFilterItems = useMemo(() => {
		const rows: Array<{ folder: FolderApiItem; level: 0 | 1 }> = [];
		for (const root of rootFolderItems) {
			rows.push({ folder: root, level: 0 });
			const children = folderChildrenByParent.get(root.id) ?? [];
			for (const child of children) {
				rows.push({ folder: child, level: 1 });
			}
		}
		return rows;
	}, [rootFolderItems, folderChildrenByParent]);
	const createFolderParentOptions = useMemo(
		() => rootFolderItems.filter((folder) => PARA_MAIN_ROOT_IDS.has(folder.id)),
		[rootFolderItems],
	);
	const organizeFolderIdSet = useMemo(() => {
		if (!organizeFolderId) {
			return null;
		}
		return collectDescendantFolderIds(organizeFolderId, folderChildrenByParent);
	}, [organizeFolderId, folderChildrenByParent]);
	const organizeNotes = useMemo(() => {
		if (!organizeFolderIdSet) {
			return noteItems;
		}
		return noteItems.filter((note) => organizeFolderIdSet.has(note.folderId));
	}, [noteItems, organizeFolderIdSet]);
	const noteIdBySlug = useMemo(
		() => new Map(noteItems.map((note) => [note.slug, note.id] as const)),
		[noteItems],
	);
	const previewMarkdown = useMemo(() => toMarkdownWithWikiLinks(draft), [draft]);
	const canUseSplit = viewportWidth >= 1280;
	const useHorizontalSplit = viewportWidth >= 1600;
	const effectiveEditorMode = editorMode === "split" && !canUseSplit ? "edit" : editorMode;
	const isActiveNoteDeleted = Boolean(activeNote?.deletedAt);
	const focusEditorMode = isActiveNoteDeleted ? "preview" : effectiveEditorMode;
	const mobileEditorMode = focusEditorMode === "split" ? "edit" : focusEditorMode;

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
		setTitleDraft(activeNote?.title ?? "");
		setIsTitleEditing(false);
	}, [activeNoteId]);

	useEffect(() => {
		setAiEnhanceResult(null);
		setAiErrorMessage("");
		setAiQuery("");
		setActiveAiTask(null);
		setRunningAiTasks([]);
		setAiTaskStages({});
		aiTaskRunIdRef.current = {
			title: 0,
			tags: 0,
			semantic: 0,
			relations: 0,
			summary: 0,
			similar: 0,
		};
	}, [activeNoteId]);

	useEffect(() => {
		if (import.meta.env.SSR || typeof window === "undefined") {
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
		setIsClientReady(true);
		let cancelled = false;
		if (typeof window !== "undefined") {
			void import("../components/markdown-editor.client")
				.then((module) => {
					if (!cancelled) {
						setMarkdownEditorComponent(() => module.default);
					}
				})
				.catch((error) => {
					console.error("Failed to load markdown editor component", error);
				});
		}
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		const storedWorkspaceMode = window.localStorage.getItem(WORKSPACE_MODE_STORAGE_KEY);
		if (
			storedWorkspaceMode === "capture" ||
			storedWorkspaceMode === "organize" ||
			storedWorkspaceMode === "focus"
		) {
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
		if (workspaceMode !== "capture" || noteStatusFilter === "active") {
			return;
		}
		setNoteStatusFilter("active");
	}, [workspaceMode, noteStatusFilter]);

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
		if (workspaceMode === "focus") {
			return;
		}
		setLinkInsertOpen(false);
		setLinkInsertQuery("");
		setIsFocusFullscreen(false);
	}, [workspaceMode]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		if (!isFocusFullscreen) {
			return;
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setIsFocusFullscreen(false);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [isFocusFullscreen]);

	useEffect(() => {
		if (typeof document === "undefined") {
			return;
		}
		if (!isFocusFullscreen) {
			return;
		}
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = previousOverflow;
		};
	}, [isFocusFullscreen]);

	useEffect(() => {
		setLinkInsertOpen(false);
		setLinkInsertQuery("");
	}, [activeNoteId]);

	useEffect(() => {
		if (!linkInsertOpen || typeof window === "undefined") {
			return;
		}
		const onMouseDown = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof HTMLElement)) {
				return;
			}
			if (target.closest("[data-link-panel='true']") || target.closest("[data-link-toggle='true']")) {
				return;
			}
			setLinkInsertOpen(false);
			setLinkInsertQuery("");
		};
		window.addEventListener("mousedown", onMouseDown);
		return () => {
			window.removeEventListener("mousedown", onMouseDown);
		};
	}, [linkInsertOpen]);

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
		if (
			newFolderParentId &&
			createFolderParentOptions.some((folder) => folder.id === newFolderParentId)
		) {
			return;
		}
		setNewFolderParentId(createFolderParentOptions[0]?.id ?? "folder-10-projects");
	}, [createFolderParentOptions, newFolderParentId]);

	useEffect(() => {
		if (organizeFolderId && !folderItems.some((folder) => folder.id === organizeFolderId)) {
			setOrganizeFolderId(null);
		}
	}, [folderItems, organizeFolderId]);

	useEffect(() => {
		if (editingFolderId && !folderItems.some((folder) => folder.id === editingFolderId)) {
			setEditingFolderId(null);
			setEditingFolderName("");
		}
	}, [folderItems, editingFolderId]);

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
		const tags = await listTags({ status: noteStatusFilter }).catch(() => null);
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
			const folders = await listFolders().catch(() => null);
			if (!folders || cancelled || folders.length === 0) {
				return;
			}
			setFolderItems(sortFolderItems(folders));
		};

		void loadFolders();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		const loadTags = async () => {
			const tags = await listTags({ status: noteStatusFilter }).catch(() => null);
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
	}, [noteStatusFilter]);

	useEffect(() => {
		let cancelled = false;
		const loadNotes = async () => {
			const notes = await listNotes({
				limit: 100,
				tagIds: selectedTagIds,
				tagMode: "any",
				status: noteStatusFilter,
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
	}, [selectedTagIds, noteStatusFilter]);

	useEffect(() => {
		if (!activeNoteId || !activeNote) {
			setNoteLinks(null);
			setIsLoadingNoteLinks(false);
			return;
		}

		let cancelled = false;
		setIsLoadingNoteLinks(true);
		void getNoteLinks(activeNoteId, noteStatusFilter)
			.then((links) => {
				if (!cancelled) {
					setNoteLinks(links);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setNoteLinks(null);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoadingNoteLinks(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [activeNoteId, activeNote?.updatedAt, noteStatusFilter]);

	useEffect(() => {
		if (!activeNoteId || !activeNote || activeNote.deletedAt) {
			setNoteRelations([]);
			setIsLoadingNoteRelations(false);
			return;
		}

		let cancelled = false;
		setIsLoadingNoteRelations(true);
		void listNoteRelations(activeNoteId, {
			status: "all",
			source: "all",
			limit: 48,
		})
			.then((response) => {
				if (!cancelled) {
					setNoteRelations(response.items);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setNoteRelations([]);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoadingNoteRelations(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [activeNoteId, activeNote?.deletedAt]);

	useEffect(() => {
		if (!activeNoteId || !activeNote || activeNote.deletedAt) {
			setNoteAssets([]);
			setIsLoadingAssets(false);
			setAssetErrorMessage("");
			return;
		}

		let cancelled = false;
		setIsLoadingAssets(true);
		void listNoteAssets(activeNoteId)
			.then((assets) => {
				if (!cancelled) {
					setNoteAssets(assets);
				}
			})
			.catch((error) => {
				if (!cancelled) {
					setNoteAssets([]);
					setAssetErrorMessage(readErrorMessage(error));
				}
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoadingAssets(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [activeNoteId, activeNote?.updatedAt, activeNote?.deletedAt]);

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
				status: noteStatusFilter,
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
	}, [commandOpen, commandQuery, defaultCommandNotes, noteStatusFilter]);

	useEffect(() => {
		if (workspaceMode !== "focus" || !activeNote || !linkInsertOpen) {
			setIsLinkInsertLoading(false);
			setLinkInsertResults([]);
			return;
		}
		const keyword = linkInsertQuery.trim();
		if (!keyword) {
			const defaults = noteItems
				.filter((note) => note.id !== activeNote.id && !note.deletedAt)
				.slice(0, 12);
			setIsLinkInsertLoading(false);
			setLinkInsertResults(defaults);
			return;
		}

		let cancelled = false;
		setIsLinkInsertLoading(true);
		const timer = window.setTimeout(() => {
			void listNotes({
				limit: 20,
				keyword,
				status: "all",
			})
				.then((notes) => {
					if (cancelled) {
						return;
					}
					setLinkInsertResults(
						notes
							.map((note) => toNoteItem(note))
							.filter((note) => note.id !== activeNote.id && !note.deletedAt),
					);
				})
				.catch(() => {
					if (!cancelled) {
						setLinkInsertResults([]);
					}
				})
				.finally(() => {
					if (!cancelled) {
						setIsLinkInsertLoading(false);
					}
				});
		}, 180);

		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [workspaceMode, activeNote?.id, linkInsertQuery, noteItems, linkInsertOpen]);

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
				const matchesFilters =
					(currentTagFilter.length === 0 || matchesTagFilter(next, currentTagFilter)) &&
					matchesStatusFilter(next, noteStatusFilter);
				if (matchesFilters) {
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
		if (isActiveNoteDeleted) {
			return;
		}
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

	const handleTitleChange = (value: string) => {
		setTitleDraft(value);
	};

	const startTitleEdit = () => {
		if (!activeNote || isActiveNoteDeleted) {
			return;
		}
		setTitleDraft(activeNote.title);
		setIsTitleEditing(true);
	};

	const cancelTitleEdit = () => {
		if (!activeNote) {
			setIsTitleEditing(false);
			return;
		}
		setTitleDraft(activeNote.title);
		setIsTitleEditing(false);
	};

	const confirmTitleEdit = () => {
		if (!activeNote || isActiveNoteDeleted) {
			return;
		}
		const nextTitle = titleDraft.trim();
		if (!nextTitle) {
			return;
		}
		setIsTitleEditing(false);
		if (nextTitle === activeNote.title) {
			return;
		}
		setNoteItems((prev) =>
			prev.map((note) =>
				note.id === activeNote.id
					? {
						...note,
						title: nextTitle,
					}
					: note,
			),
		);
		setTitleDraft(nextTitle);
		scheduleAutoSave(activeNote.id, draft);
	};

	const handleInsertWikiLink = (note: NoteItem) => {
		if (!activeNote || isActiveNoteDeleted || !noteLinks) {
			return;
		}
		const currentSlugs = new Set(noteLinks.outbound.map((item) => item.slug));
		currentSlugs.add(note.slug);
		void syncActiveNoteLinks([...currentSlugs]);
		setLinkInsertOpen(false);
		setLinkInsertQuery("");
	};

	const syncActiveNoteLinks = async (nextSlugs: string[]) => {
		if (!activeNote || isActiveNoteDeleted || isSyncingLinks) {
			return;
		}
		setIsSyncingLinks(true);
		try {
			const updated = await updateNote(activeNote.id, { linkSlugs: nextSlugs });
			const next = toNoteItem(updated);
			setNoteItems((prev) => prev.map((note) => (note.id === next.id ? { ...note, ...next } : note)));
		} catch (error) {
			console.error("Failed to sync note links", error);
		} finally {
			setIsSyncingLinks(false);
		}
	};

	const handleRemoveOutboundLink = (noteId: string) => {
		if (!activeNote || isActiveNoteDeleted || !noteLinks) {
			return;
		}
		const nextSlugs = noteLinks.outbound
			.filter((item) => item.noteId !== noteId)
			.map((item) => item.slug);
		void syncActiveNoteLinks(nextSlugs);
	};

	const refreshActiveNoteRelations = async (noteId: string) => {
		const response = await listNoteRelations(noteId, {
			status: "all",
			source: "all",
			limit: 48,
		});
		setNoteRelations(response.items);
	};

	const handleUpdateRelationType = async (relationId: string, relationType: NoteRelationTypeApiItem) => {
		if (!activeNote || isActiveNoteDeleted || mutatingRelationId) {
			return;
		}
		setMutatingRelationId(relationId);
		try {
			await updateNoteRelation(activeNote.id, relationId, { relationType });
			await refreshActiveNoteRelations(activeNote.id);
		} catch (error) {
			setAiErrorMessage(readErrorMessage(error));
		} finally {
			setMutatingRelationId("");
		}
	};

	const handleAcceptRelation = async (relationId: string) => {
		if (!activeNote || isActiveNoteDeleted || mutatingRelationId) {
			return;
		}
		const target = noteRelations.find((item) => item.id === relationId) ?? null;
		setMutatingRelationId(relationId);
		try {
			await updateNoteRelation(activeNote.id, relationId, { status: "accepted" });
			await refreshActiveNoteRelations(activeNote.id);
			if (target) {
				setAiEnhanceResult((prev) => prev
					? {
						...prev,
						relationSuggestions: prev.relationSuggestions.filter((item) => item.noteId !== target.otherNote.id),
					}
					: prev);
			}
		} catch (error) {
			setAiErrorMessage(readErrorMessage(error));
		} finally {
			setMutatingRelationId("");
		}
	};

	const handleRejectRelation = async (relationId: string) => {
		if (!activeNote || isActiveNoteDeleted || mutatingRelationId) {
			return;
		}
		const target = noteRelations.find((item) => item.id === relationId) ?? null;
		setMutatingRelationId(relationId);
		try {
			await updateNoteRelation(activeNote.id, relationId, { status: "rejected" });
			await refreshActiveNoteRelations(activeNote.id);
			if (target) {
				setAiEnhanceResult((prev) => prev
					? {
						...prev,
						relationSuggestions: prev.relationSuggestions.filter((item) => item.noteId !== target.otherNote.id),
					}
					: prev);
			}
		} catch (error) {
			setAiErrorMessage(readErrorMessage(error));
		} finally {
			setMutatingRelationId("");
		}
	};

	const handleAcceptAiRelationSuggestion = async (otherNoteId: string) => {
		if (!activeNote || isActiveNoteDeleted || !aiEnhanceResult || mutatingRelationId) {
			return;
		}
		const target = aiEnhanceResult.relationSuggestions.find((item) => item.noteId === otherNoteId);
		if (!target) {
			return;
		}
		setMutatingRelationId(`suggestion:${otherNoteId}`);
		try {
			await upsertNoteRelations(activeNote.id, [{
				otherNoteId: target.noteId,
				relationType: target.relationType,
				status: "accepted",
				source: "ai",
				score: target.score,
				reason: target.reason,
				evidenceExcerpt: target.evidenceExcerpt,
			}]);
			await refreshActiveNoteRelations(activeNote.id);
			setAiEnhanceResult((prev) => prev
				? {
					...prev,
					relationSuggestions: prev.relationSuggestions.filter((item) => item.noteId !== otherNoteId),
				}
				: prev);
		} catch (error) {
			setAiErrorMessage(readErrorMessage(error));
		} finally {
			setMutatingRelationId("");
		}
	};

	const handleDeleteRelation = async (relationId: string) => {
		if (!activeNote || isActiveNoteDeleted || mutatingRelationId) {
			return;
		}
		setMutatingRelationId(relationId);
		try {
			await deleteNoteRelation(activeNote.id, relationId);
			await refreshActiveNoteRelations(activeNote.id);
		} catch (error) {
			setAiErrorMessage(readErrorMessage(error));
		} finally {
			setMutatingRelationId("");
		}
	};

	const handleRunAiTask = async (task: AiEnhanceTaskApiKey) => {
		if (!activeNote || activeNote.deletedAt || runningAiTasks.includes(task)) {
			return;
		}
		setActiveAiTask(task);
		const noteId = activeNote.id;
		const query = aiQuery.trim() || undefined;
		const runId = (aiTaskRunIdRef.current[task] ?? 0) + 1;
		aiTaskRunIdRef.current[task] = runId;
		setAiErrorMessage("");
		setRunningAiTasks((prev) => (prev.includes(task) ? prev : [...prev, task]));
		setAiTaskStages((prev) => ({
			...prev,
			[task]: "准备中",
		}));
		setAiEnhanceResult((prev) =>
			prev && prev.noteId === noteId ? prev : buildInitialAiEnhanceResult(noteId, query ?? ""),
		);
		try {
			const partial = await enhanceNoteWithAiTaskStream(noteId, task, {
				query,
				topK: 6,
			}, {
				onProgress: (progress) => {
					if (aiTaskRunIdRef.current[task] !== runId) {
						return;
					}
					setAiTaskStages((prev) => ({
						...prev,
						[task]: formatAiTaskStage(progress),
					}));
				},
			});
			if (aiTaskRunIdRef.current[task] !== runId) {
				return;
			}
			if (task === "relations" && partial.relationSuggestions.length > 0) {
				await upsertNoteRelations(
					noteId,
					partial.relationSuggestions.map((item) => ({
						otherNoteId: item.noteId,
						relationType: item.relationType,
						status: "suggested",
						source: "ai",
						score: item.score,
						reason: item.reason,
						evidenceExcerpt: item.evidenceExcerpt,
					})),
				);
				await refreshActiveNoteRelations(noteId);
			}
			setAiEnhanceResult((prev) => mergeAiEnhanceResult(prev, partial, noteId, query ?? ""));
		} catch (error) {
			if (aiTaskRunIdRef.current[task] === runId) {
				setAiErrorMessage(readErrorMessage(error));
			}
		} finally {
			if (aiTaskRunIdRef.current[task] === runId) {
				setRunningAiTasks((prev) => prev.filter((item) => item !== task));
				setAiTaskStages((prev) => {
					const next = { ...prev };
					delete next[task];
					return next;
				});
			}
		}
	};

	const handleApplyAiTitle = async (title: string) => {
		if (!activeNote || isActiveNoteDeleted || isApplyingAiTitle) {
			return;
		}
		const nextTitle = title.trim();
		if (!nextTitle || nextTitle === activeNote.title) {
			return;
		}
		setIsApplyingAiTitle(true);
		setAiErrorMessage("");
		try {
			const updated = await updateNote(activeNote.id, { title: nextTitle });
			const next = toNoteItem(updated);
			setNoteItems((prev) => prev.map((item) => (item.id === next.id ? { ...item, ...next } : item)));
			setTitleDraft(nextTitle);
		} catch (error) {
			setAiErrorMessage(readErrorMessage(error));
		} finally {
			setIsApplyingAiTitle(false);
		}
	};

	const handleApplyAiTags = async () => {
		if (!activeNote || isActiveNoteDeleted || isApplyingAiTags || !aiEnhanceResult) {
			return;
		}
		const suggestedTags = aiEnhanceResult.tagSuggestions.map((item) => item.name).filter((item) => item.trim().length > 0);
		if (suggestedTags.length === 0) {
			return;
		}
		const mergedTagNames = [...new Set([...activeNote.tags, ...suggestedTags])];
		setIsApplyingAiTags(true);
		setAiErrorMessage("");
		try {
			const updated = await updateNote(activeNote.id, { tagNames: mergedTagNames });
			const next = toNoteItem(updated);
			setNoteItems((prev) => prev.map((item) => (item.id === next.id ? { ...item, ...next } : item)));
			await refreshTags();
		} catch (error) {
			setAiErrorMessage(readErrorMessage(error));
		} finally {
			setIsApplyingAiTags(false);
		}
	};

	const handleApplyAiRelations = async () => {
		if (!activeNote || isActiveNoteDeleted || isApplyingAiRelations || !aiEnhanceResult) {
			return;
		}
		if (aiEnhanceResult.relationSuggestions.length === 0) {
			return;
		}
		setIsApplyingAiRelations(true);
		setAiErrorMessage("");
		try {
			await upsertNoteRelations(
				activeNote.id,
				aiEnhanceResult.relationSuggestions.map((item) => ({
					otherNoteId: item.noteId,
					relationType: item.relationType,
					status: "accepted",
					source: "ai",
					score: item.score,
					reason: item.reason,
					evidenceExcerpt: item.evidenceExcerpt,
				})),
			);
			await refreshActiveNoteRelations(activeNote.id);
			setAiEnhanceResult((prev) => prev
				? {
					...prev,
					relationSuggestions: [],
				}
				: prev);
		} catch (error) {
			setAiErrorMessage(readErrorMessage(error));
		} finally {
			setIsApplyingAiRelations(false);
		}
	};

	const handleInsertAssetLink = (asset: NoteAssetApiItem) => {
		if (!activeNote || isActiveNoteDeleted) {
			return;
		}
		const label = asset.fileName || "attachment";
		const escapedLabel = label.replace(/\]/g, "\\]");
		const nextValue = draft.length === 0
			? `[${escapedLabel}](${asset.downloadUrl})`
			: `${draft}${draft.endsWith("\n") ? "" : "\n"}[${escapedLabel}](${asset.downloadUrl})`;
		handleDraftChange(nextValue);
	};

	const handleUploadAsset = async (files: FileList | null) => {
		if (!activeNote || isActiveNoteDeleted || !files || files.length === 0) {
			return;
		}
		const file = files[0];
		setIsUploadingAsset(true);
		setAssetErrorMessage("");
		try {
			const uploaded = await uploadNoteAsset(activeNote.id, file);
			setNoteAssets((prev) => [uploaded, ...prev.filter((item) => item.id !== uploaded.id)]);
			handleInsertAssetLink(uploaded);
		} catch (error) {
			setAssetErrorMessage(readErrorMessage(error));
		} finally {
			setIsUploadingAsset(false);
		}
	};

	const handleDeleteAsset = async (asset: NoteAssetApiItem) => {
		if (!activeNote || isActiveNoteDeleted || deletingAssetId) {
			return;
		}
		if (typeof window !== "undefined") {
			const confirmed = window.confirm(`确定删除附件「${asset.fileName || asset.id}」吗？`);
			if (!confirmed) {
				return;
			}
		}
		setDeletingAssetId(asset.id);
		setAssetErrorMessage("");
		try {
			await deleteNoteAsset(asset.id);
			setNoteAssets((prev) => prev.filter((item) => item.id !== asset.id));
		} catch (error) {
			setAssetErrorMessage(readErrorMessage(error));
		} finally {
			setDeletingAssetId("");
		}
	};

	const closeLinkInsertPanel = () => {
		setLinkInsertOpen(false);
		setLinkInsertQuery("");
	};

	const toggleLinkInsertPanel = () => {
		if (linkInsertOpen) {
			closeLinkInsertPanel();
			return;
		}
		setLinkInsertOpen(true);
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
			const matchesFilters =
				(currentTagFilter.length === 0 || matchesTagFilter(next, currentTagFilter)) &&
				matchesStatusFilter(next, noteStatusFilter);
			if (matchesFilters) {
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

	const handleCreateFolder = async () => {
		const name = newFolderName.trim();
		if (!name || isCreatingFolder) {
			return;
		}
		setIsCreatingFolder(true);
		setFolderErrorMessage("");
		try {
			const created = await createFolder({
				name,
				parentId: newFolderParentId,
			});
			setFolderItems((prev) => sortFolderItems([...prev.filter((folder) => folder.id !== created.id), created]));
			setCaptureFolderId(created.id);
			setOrganizeFolderId(created.id);
			setNewFolderName("");
		} catch (error) {
			setFolderErrorMessage(readErrorMessage(error));
		} finally {
			setIsCreatingFolder(false);
		}
	};

	const startRenameFolder = (folder: FolderApiItem) => {
		if (folder.parentId === null) {
			return;
		}
		setEditingFolderId(folder.id);
		setEditingFolderName(folder.name);
		setFolderErrorMessage("");
	};

	const cancelRenameFolder = () => {
		setEditingFolderId(null);
		setEditingFolderName("");
	};

	const handleRenameFolder = async () => {
		const folderId = editingFolderId;
		const name = editingFolderName.trim();
		if (!folderId || !name || isUpdatingFolder) {
			return;
		}
		setIsUpdatingFolder(true);
		setFolderErrorMessage("");
		try {
			const updated = await updateFolder(folderId, { name });
			setFolderItems((prev) => sortFolderItems(prev.map((folder) => (folder.id === updated.id ? updated : folder))));
			setEditingFolderId(null);
			setEditingFolderName("");
		} catch (error) {
			setFolderErrorMessage(readErrorMessage(error));
		} finally {
			setIsUpdatingFolder(false);
		}
	};

	const focusNote = (noteId: string) => {
		setActiveNoteId(noteId);
		setWorkspaceMode("focus");
	};

	const handleMoveActiveNote = async (folderId: string) => {
		if (!activeNote || !folderId || folderId === activeNote.folderId || isMovingNote) {
			return;
		}
		setIsMovingNote(true);
		try {
			const updated = await updateNote(activeNote.id, { folderId });
			const next = toNoteItem(updated);
			setNoteItems((prev) => {
				const updatedList = prev.map((note) => (note.id === next.id ? { ...note, ...next } : note));
				const currentTagFilter = selectedTagIdsRef.current;
				const matchesFilters =
					(currentTagFilter.length === 0 || matchesTagFilter(next, currentTagFilter)) &&
					matchesStatusFilter(next, noteStatusFilter);
				if (matchesFilters) {
					return updatedList;
				}
				return updatedList.filter((note) => note.id !== next.id);
			});
		} catch (error) {
			console.error("Failed to move note", error);
		} finally {
			setIsMovingNote(false);
		}
	};

	const removeNoteFromListById = (noteId: string) => {
		const previous = noteItemsRef.current;
		const removedIndex = previous.findIndex((note) => note.id === noteId);
		const next = previous.filter((note) => note.id !== noteId);
		const fallbackId = removedIndex >= 0
			? (next[removedIndex]?.id ?? next[removedIndex - 1]?.id ?? next[0]?.id ?? "")
			: (next[0]?.id ?? "");

		setNoteItems(next);
		setActiveNoteId(fallbackId);
		if (!fallbackId) {
			setDraft("");
			setWorkspaceMode("organize");
		}
	};

	const upsertNoteByFilters = (next: NoteItem) => {
		setNoteItems((prev) => {
			const merged = prev.some((note) => note.id === next.id)
				? prev.map((note) => (note.id === next.id ? { ...note, ...next } : note))
				: [next, ...prev];
			const currentTagFilter = selectedTagIdsRef.current;
			const matchesFilters =
				(currentTagFilter.length === 0 || matchesTagFilter(next, currentTagFilter)) &&
				matchesStatusFilter(next, noteStatusFilter);
			if (matchesFilters) {
				return merged;
			}
			return merged.filter((note) => note.id !== next.id);
		});
	};

	const handleToggleArchiveActiveNote = async () => {
		if (!activeNote || activeNote.deletedAt || isArchivingNote) {
			return;
		}
		const nextArchived = !activeNote.isArchived;
		if (typeof window !== "undefined") {
			const confirmed = window.confirm(
				nextArchived
					? `确定归档「${activeNote.title}」吗？`
					: `确定取消归档「${activeNote.title}」吗？`,
			);
			if (!confirmed) {
				return;
			}
		}
		setIsArchivingNote(true);
		try {
			const updated = await archiveNote(activeNote.id, nextArchived);
			upsertNoteByFilters(toNoteItem(updated));
			await refreshTags();
		} catch (error) {
			console.error("Failed to toggle archive note", error);
		} finally {
			setIsArchivingNote(false);
		}
	};

	const handleRestoreActiveNote = async () => {
		if (!activeNote || !activeNote.deletedAt || isRestoringNote) {
			return;
		}
		if (typeof window !== "undefined") {
			const confirmed = window.confirm(`确定恢复「${activeNote.title}」吗？`);
			if (!confirmed) {
				return;
			}
		}
		setIsRestoringNote(true);
		try {
			const restored = await restoreNote(activeNote.id);
			upsertNoteByFilters(toNoteItem(restored));
			await refreshTags();
		} catch (error) {
			console.error("Failed to restore note", error);
		} finally {
			setIsRestoringNote(false);
		}
	};

	const handleDeleteActiveNote = async () => {
		if (!activeNote || isDeletingNote) {
			return;
		}
		const isHardDelete = Boolean(activeNote.deletedAt);
		if (typeof window !== "undefined") {
			const confirmed = window.confirm(
				isHardDelete
					? `确定永久删除「${activeNote.title}」吗？此操作不可恢复。`
					: `确定将「${activeNote.title}」移入回收站吗？`,
			);
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
			if (isHardDelete) {
				await hardDeleteNote(deletingId);
			} else {
				await deleteNote(deletingId);
			}
			removeNoteFromListById(deletingId);
			await refreshTags();
		} catch (error) {
			console.error("Failed to delete note", error);
		} finally {
			setIsDeletingNote(false);
		}
	};

	const toggleFocusFullscreen = () => {
		setIsFocusFullscreen((prev) => !prev);
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
				id: "action-status-active",
				label: "查看活跃笔记",
				description: "仅显示未归档且未删除笔记",
				keywords: ["status", "active", "活跃", "状态", "回收站", "归档"],
				run: () => setNoteStatusFilter("active"),
			},
			{
				id: "action-status-archived",
				label: "查看归档笔记",
				description: "仅显示归档笔记",
				keywords: ["status", "archived", "归档", "状态"],
				run: () => setNoteStatusFilter("archived"),
			},
			{
				id: "action-status-deleted",
				label: "查看回收站",
				description: "仅显示已删除笔记",
				keywords: ["status", "deleted", "trash", "回收站", "删除", "状态"],
				run: () => setNoteStatusFilter("deleted"),
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
	const activeNoteFolderId = activeNote?.folderId ?? "";
	const MarkdownEditorComponent = markdownEditorComponent;
	const saveStateText = isSavingDraft ? "自动保存中..." : "已保存";
	const hasTagFilters = selectedTagIds.length > 0;
	const noteStatusLabel = noteStatusFilter === "active"
		? "活跃"
		: noteStatusFilter === "archived"
			? "归档"
			: noteStatusFilter === "deleted"
				? "回收站"
				: "全部";
	const canArchiveActiveNote = Boolean(activeNote && !activeNote.deletedAt);
	const canRestoreActiveNote = Boolean(activeNote?.deletedAt);
	const canConfirmTitleEdit = titleDraft.trim().length > 0 && !isActiveNoteDeleted;
	const outboundLinks = noteLinks?.outbound ?? [];
	const inboundLinks = noteLinks?.inbound ?? [];
	const acceptedRelations = noteRelations.filter((item) => item.status === "accepted");
	const canEditLinks = Boolean(activeNote && noteLinks && !isActiveNoteDeleted && !isSyncingLinks && !isLoadingNoteLinks);

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
							<Link
								to="/tags"
								className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 md:text-sm"
							>
								标签治理
							</Link>
							<Link
								to="/ops"
								className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 md:text-sm"
							>
								运维控制台
							</Link>
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
									placeholder="随手记一条，支持 #tag"
									className="h-28 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:ring"
								/>
									<div className="mt-3 flex items-center justify-between">
										<select
											value={captureFolderId}
											onChange={(e) => setCaptureFolderId(e.target.value)}
											className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-600"
										>
											{folderFilterItems.map((item) => (
												<option key={item.folder.id} value={item.folder.id}>
													{formatFolderOptionLabel(item.folder.name, item.level)}
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
									<p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">状态</p>
									<div className="grid grid-cols-3 gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
										<ModeButton label="活跃" active={noteStatusFilter === "active"} onClick={() => setNoteStatusFilter("active")} />
										<ModeButton label="归档" active={noteStatusFilter === "archived"} onClick={() => setNoteStatusFilter("archived")} />
										<ModeButton label="回收站" active={noteStatusFilter === "deleted"} onClick={() => setNoteStatusFilter("deleted")} />
									</div>
								</div>
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
										{folderFilterItems.map((item) => {
											const active = organizeFolderId === item.folder.id;
											const isEditing = editingFolderId === item.folder.id;
											const editable = item.folder.parentId !== null;
											return (
												<div
													key={item.folder.id}
													className={`rounded-lg border ${
														active ? "border-slate-900 bg-slate-900" : "border-slate-200 bg-white"
													}`}
												>
													{isEditing ? (
														<div className="space-y-2 p-2">
															<input
																type="text"
																value={editingFolderName}
																onChange={(event) => setEditingFolderName(event.target.value)}
																className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-800"
															/>
															<div className="flex gap-2">
																<button
																	type="button"
																	onClick={handleRenameFolder}
																	disabled={isUpdatingFolder}
																	className={`rounded-md px-2 py-1 text-xs ${
																		isUpdatingFolder
																			? "cursor-not-allowed bg-slate-200 text-slate-400"
																			: "bg-slate-900 text-white"
																	}`}
																>
																	保存
																</button>
																<button
																	type="button"
																	onClick={cancelRenameFolder}
																	className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600"
																>
																	取消
																</button>
															</div>
														</div>
													) : (
														<div className="flex items-center gap-2 px-1 py-1">
															<button
																type="button"
																onClick={() => setOrganizeFolderId(item.folder.id)}
																className={`min-w-0 flex-1 rounded-md px-2 py-1 text-left text-sm ${
																	active ? "text-white" : "text-slate-700 hover:bg-slate-100"
																}`}
															>
																{formatFolderOptionLabel(item.folder.name, item.level)}
															</button>
															{editable ? (
																<button
																	type="button"
																	onClick={() => startRenameFolder(item.folder)}
																	className={`rounded-md px-2 py-1 text-xs ${
																		active
																			? "text-slate-200 hover:bg-white/15"
																			: "text-slate-500 hover:bg-slate-100"
																	}`}
																>
																	重命名
																</button>
															) : null}
														</div>
													)}
												</div>
											);
										})}
									</div>
									<div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
										<p className="text-xs font-semibold uppercase tracking-wide text-slate-500">新建子目录</p>
										<select
											value={newFolderParentId}
											onChange={(event) => setNewFolderParentId(event.target.value)}
											className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-600"
										>
											{createFolderParentOptions.map((folder) => (
												<option key={folder.id} value={folder.id}>
													{folder.name}
												</option>
											))}
										</select>
										<div className="flex gap-2">
											<input
												type="text"
												value={newFolderName}
												onChange={(event) => setNewFolderName(event.target.value)}
												placeholder="输入子目录名称"
												className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700"
											/>
											<button
												type="button"
												onClick={handleCreateFolder}
												disabled={isCreatingFolder}
												className={`rounded-lg px-3 py-2 text-xs font-medium ${
													isCreatingFolder
														? "cursor-not-allowed bg-slate-200 text-slate-400"
														: "bg-slate-900 text-white"
												}`}
											>
												{isCreatingFolder ? "创建中" : "创建"}
											</button>
										</div>
										{folderErrorMessage ? (
											<p className="text-xs text-rose-600">{folderErrorMessage}</p>
										) : null}
									</div>
								</aside>

							<section className="flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
								<div className="mb-3 flex items-center justify-between">
									<p className="text-sm font-semibold">笔记列表 · {noteStatusLabel}</p>
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
						<section
							className={`flex min-h-0 flex-col bg-white ${
								isFocusFullscreen
									? "fixed inset-0 z-[80] h-[100dvh] rounded-none border-0 p-4 shadow-none"
									: "h-full rounded-2xl border border-slate-200 p-4 shadow-sm"
							}`}
						>
							{!isFocusFullscreen ? (
								<div className="mb-3 border-b border-slate-100 pb-3">
								<div className="flex items-center justify-between gap-3">
									<div className="min-w-0 flex-1">
										{activeNote ? (
											<div className="flex items-center gap-2">
												{isTitleEditing ? (
													<>
														<input
															type="text"
															value={titleDraft}
															onChange={(event) => handleTitleChange(event.target.value)}
															placeholder="输入笔记标题"
															disabled={isActiveNoteDeleted}
															className={`min-w-0 flex-1 rounded-lg border px-3 py-2 text-lg font-semibold tracking-tight outline-none ${
																isActiveNoteDeleted
																	? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
																	: "border-slate-200 bg-white text-slate-900 focus:border-slate-400"
															}`}
														/>
														<button
															type="button"
															onClick={confirmTitleEdit}
															disabled={!canConfirmTitleEdit}
															aria-label="确认标题"
															className={`rounded-lg border p-2 ${
																!canConfirmTitleEdit
																	? "cursor-not-allowed border-slate-200 text-slate-300"
																	: "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
															}`}
														>
															<svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
																<path d="M4 10.5L8 14.5L16 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
															</svg>
														</button>
														<button
															type="button"
															onClick={cancelTitleEdit}
															aria-label="取消标题编辑"
															className="rounded-lg border border-rose-200 p-2 text-rose-600 hover:bg-rose-50"
														>
															<svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
																<path d="M5.5 5.5L14.5 14.5M14.5 5.5L5.5 14.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
															</svg>
														</button>
													</>
												) : (
													<>
														<p className="truncate text-lg font-semibold tracking-tight">{activeNote.title}</p>
														<button
															type="button"
															onClick={startTitleEdit}
															disabled={isActiveNoteDeleted}
															aria-label="编辑标题"
															className={`rounded-lg border p-2 ${
																isActiveNoteDeleted
																	? "cursor-not-allowed border-slate-200 text-slate-300"
																	: "border-slate-200 text-slate-600 hover:bg-slate-100"
															}`}
														>
															<svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
																<path d="M13.5 4.5L15.5 6.5M6 14L10.5 13L16 7.5L13.5 5L8 10.5L7 15L6 14Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
															</svg>
														</button>
													</>
												)}
											</div>
										) : (
											<p className="text-lg font-semibold tracking-tight">未选择笔记</p>
										)}
										<p className="mt-1 text-xs text-slate-500">
											{activeNote?.updatedAt ? formatUpdatedAt(activeNote.updatedAt) : ""} · {saveStateText} · {noteStatusLabel}
										</p>
									</div>
									<div className="flex items-center gap-2">
										<div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
											<ModeButton
												label="编辑"
												active={focusEditorMode === "edit"}
												disabled={isActiveNoteDeleted}
												onClick={() => setEditorMode("edit")}
											/>
											<ModeButton label="预览" active={focusEditorMode === "preview"} onClick={() => setEditorMode("preview")} />
											<ModeButton
												label="分屏"
												active={focusEditorMode === "split"}
												disabled={!canUseSplit || isActiveNoteDeleted}
												onClick={() => setEditorMode("split")}
											/>
										</div>
										<button
											type="button"
											onClick={toggleFocusFullscreen}
											className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
										>
											{isFocusFullscreen ? "退出全屏" : "全屏"}
										</button>
										{canArchiveActiveNote ? (
											<button
												type="button"
												onClick={handleToggleArchiveActiveNote}
												disabled={!activeNote || isArchivingNote || isDeletingNote || isRestoringNote}
												className={`rounded-lg border px-3 py-2 text-xs font-medium ${
													!activeNote || isArchivingNote || isDeletingNote || isRestoringNote
														? "cursor-not-allowed border-slate-200 text-slate-300"
														: "border-amber-200 text-amber-700 hover:bg-amber-50"
												}`}
											>
												{isArchivingNote ? "处理中..." : activeNote?.isArchived ? "取消归档" : "归档"}
											</button>
										) : null}
										{canRestoreActiveNote ? (
											<button
												type="button"
												onClick={handleRestoreActiveNote}
												disabled={!activeNote || isRestoringNote || isDeletingNote}
												className={`rounded-lg border px-3 py-2 text-xs font-medium ${
													!activeNote || isRestoringNote || isDeletingNote
														? "cursor-not-allowed border-slate-200 text-slate-300"
														: "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
												}`}
											>
												{isRestoringNote ? "恢复中..." : "恢复"}
											</button>
										) : null}
										<button
											type="button"
											onClick={handleDeleteActiveNote}
											disabled={!activeNote || isDeletingNote || isArchivingNote || isRestoringNote}
											className={`rounded-lg border px-3 py-2 text-xs font-medium ${
												!activeNote || isDeletingNote || isArchivingNote || isRestoringNote
													? "cursor-not-allowed border-slate-200 text-slate-300"
													: "border-rose-200 text-rose-600 hover:bg-rose-50"
											}`}
										>
											{isDeletingNote ? "处理中..." : activeNote?.deletedAt ? "永久删除" : "移入回收站"}
										</button>
									</div>
								</div>
									<div className="mt-2 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
										<ModeButton label="活跃" active={noteStatusFilter === "active"} onClick={() => setNoteStatusFilter("active")} />
										<ModeButton label="归档" active={noteStatusFilter === "archived"} onClick={() => setNoteStatusFilter("archived")} />
										<ModeButton label="回收站" active={noteStatusFilter === "deleted"} onClick={() => setNoteStatusFilter("deleted")} />
									</div>
									<div className="mt-2 flex flex-wrap gap-2">
										{(activeNote?.tags ?? []).map((tag) => (
											<span key={tag} className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600">
												{tag}
											</span>
										))}
									</div>
									<div className="mt-3 flex items-center gap-2">
										<select
											value={activeNoteFolderId}
											onChange={(event) => void handleMoveActiveNote(event.target.value)}
											disabled={!activeNote || isMovingNote || isActiveNoteDeleted}
											className="max-w-[18rem] rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-600"
										>
											{folderFilterItems.map((item) => (
												<option key={item.folder.id} value={item.folder.id}>
													{formatFolderOptionLabel(item.folder.name, item.level)}
												</option>
											))}
										</select>
										<span className="text-xs text-slate-400">
											{isActiveNoteDeleted ? "回收站笔记不可移动" : isMovingNote ? "移动中..." : "切换即移动"}
										</span>
										<button
											type="button"
											data-link-toggle="true"
											onClick={toggleLinkInsertPanel}
											disabled={!activeNote || isActiveNoteDeleted || (!linkInsertOpen && !canEditLinks)}
											className={`rounded-lg border px-3 py-2 text-xs font-medium ${
												!activeNote || isActiveNoteDeleted || (!linkInsertOpen && !canEditLinks)
													? "cursor-not-allowed border-slate-200 text-slate-300"
													: "border-sky-200 text-sky-700 hover:bg-sky-50"
											}`}
										>
											{linkInsertOpen ? "收起双链" : "添加双链"}
										</button>
									</div>
									{linkInsertOpen ? (
										<div data-link-panel="true">
											<WikiLinkInsertPanel
												query={linkInsertQuery}
												onQueryChange={setLinkInsertQuery}
												results={linkInsertResults}
												isLoading={isLinkInsertLoading}
												disabled={!canEditLinks}
												onInsert={handleInsertWikiLink}
												onClose={closeLinkInsertPanel}
											/>
										</div>
									) : null}
									<div className="mt-3">
										<AttachmentPanel
											assets={noteAssets}
											isLoading={isLoadingAssets}
											isUploading={isUploadingAsset}
											deletingAssetId={deletingAssetId}
											disabled={!activeNote || isActiveNoteDeleted || isDeletingNote || isArchivingNote || isRestoringNote}
											errorMessage={assetErrorMessage}
											onUpload={handleUploadAsset}
											onInsert={handleInsertAssetLink}
											onDelete={handleDeleteAsset}
										/>
									</div>
								</div>
							) : null}

								{focusEditorMode === "edit" ? (
									isClientReady && MarkdownEditorComponent ? (
										<div
											className={`min-h-0 flex-1 overflow-hidden bg-white [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto [&_.cm-theme]:h-full ${
												isFocusFullscreen ? "" : "rounded-xl border border-slate-200"
											}`}
										>
											<MarkdownEditorComponent
												value={draft}
												height="100%"
												onChange={(value) => handleDraftChange(value)}
												className="h-full text-sm"
											/>
										</div>
									) : (
										<textarea
											value={draft}
											onChange={(event) => handleDraftChange(event.target.value)}
											className={`min-h-0 h-full flex-1 resize-none bg-white text-sm ${
												isFocusFullscreen ? "border-0 p-0" : "rounded-xl border border-slate-200 p-3"
											}`}
										/>
									)
								) : null}

							{focusEditorMode === "preview" ? (
								<div
									className={`min-h-0 flex-1 overflow-y-auto ${
										isFocusFullscreen
											? "bg-white p-0"
											: "rounded-xl border border-slate-200 bg-slate-50 p-4"
									}`}
								>
									<ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
										{previewMarkdown || "*（空白笔记）*"}
									</ReactMarkdown>
								</div>
							) : null}

								{focusEditorMode === "split" ? (
									<div
										className={`grid min-h-0 flex-1 gap-3 ${
											useHorizontalSplit
												? "grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
												: "grid-rows-[minmax(0,1fr)_minmax(0,1fr)]"
										}`}
									>
										{isClientReady && MarkdownEditorComponent ? (
											<div
												className={`min-h-0 overflow-hidden bg-white [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto [&_.cm-theme]:h-full ${
													isFocusFullscreen ? "" : "rounded-xl border border-slate-200"
												}`}
											>
												<MarkdownEditorComponent
													value={draft}
													height="100%"
													onChange={(value) => handleDraftChange(value)}
													className="h-full text-sm"
												/>
											</div>
										) : (
											<textarea
												value={draft}
												onChange={(event) => handleDraftChange(event.target.value)}
												className={`min-h-0 h-full w-full resize-none bg-white text-sm ${
													isFocusFullscreen ? "border-0 p-0" : "rounded-xl border border-slate-200 p-3"
												}`}
											/>
										)}
										<div
											className={`min-h-0 overflow-y-auto ${
												isFocusFullscreen
													? "bg-white p-0"
													: "rounded-xl border border-slate-200 bg-slate-50 p-4"
											}`}
										>
											<ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
												{previewMarkdown || "*（空白笔记）*"}
										</ReactMarkdown>
									</div>
								</div>
							) : null}

							{!isFocusFullscreen ? (
								<div className="mt-3">
								<LinkSummaryPanel
									isLoading={isLoadingNoteLinks}
									isMutating={isSyncingLinks}
									outbound={outboundLinks}
									inbound={inboundLinks}
									onOpenNote={focusNote}
									onRemoveOutbound={handleRemoveOutboundLink}
									canRemoveOutbound={canEditLinks}
								/>
								<div className="mt-3">
									<RelationSummaryPanel
										isLoading={isLoadingNoteRelations}
										items={acceptedRelations}
										onOpenNote={focusNote}
										mutatingRelationId={mutatingRelationId}
										onUpdateRelationType={handleUpdateRelationType}
										onDeleteRelation={handleDeleteRelation}
									/>
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
											{folderFilterItems.map((item) => (
												<option key={item.folder.id} value={item.folder.id}>
													{formatFolderOptionLabel(item.folder.name, item.level)}
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
								<section className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
									<div className="grid grid-cols-3 gap-2">
										<ModeButton label="活跃" active={noteStatusFilter === "active"} onClick={() => setNoteStatusFilter("active")} />
										<ModeButton label="归档" active={noteStatusFilter === "archived"} onClick={() => setNoteStatusFilter("archived")} />
										<ModeButton label="回收站" active={noteStatusFilter === "deleted"} onClick={() => setNoteStatusFilter("deleted")} />
									</div>
								</section>
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
										{folderFilterItems.map((item) => (
											<button
												key={item.folder.id}
												onClick={() => setOrganizeFolderId(item.folder.id)}
												className={`shrink-0 rounded-lg px-3 py-2 text-xs ${
													organizeFolderId === item.folder.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
												}`}
											>
												{formatFolderOptionLabel(item.folder.name, item.level)}
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

								<section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
									<p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">新建子目录</p>
									<select
										value={newFolderParentId}
										onChange={(event) => setNewFolderParentId(event.target.value)}
										className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-600"
									>
										{createFolderParentOptions.map((folder) => (
											<option key={folder.id} value={folder.id}>
												{folder.name}
											</option>
										))}
									</select>
									<div className="mt-2 flex gap-2">
										<input
											type="text"
											value={newFolderName}
											onChange={(event) => setNewFolderName(event.target.value)}
											placeholder="输入子目录名称"
											className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700"
										/>
										<button
											type="button"
											onClick={handleCreateFolder}
											disabled={isCreatingFolder}
											className={`rounded-lg px-3 py-2 text-xs font-medium ${
												isCreatingFolder
													? "cursor-not-allowed bg-slate-200 text-slate-400"
													: "bg-slate-900 text-white"
											}`}
										>
											{isCreatingFolder ? "创建中" : "创建"}
										</button>
									</div>
									{folderErrorMessage ? <p className="mt-2 text-xs text-rose-600">{folderErrorMessage}</p> : null}
								</section>

								<section className="max-h-[62dvh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
								<p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">笔记列表 · {noteStatusLabel}</p>
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
							<section
								className={`bg-white ${
									isFocusFullscreen
										? "fixed inset-0 z-[80] h-[100dvh] overflow-y-auto border-0 p-3 shadow-none"
										: "rounded-2xl border border-slate-200 p-3 shadow-sm"
								}`}
							>
								{!isFocusFullscreen ? (
									<>
									<div className="mb-2 flex items-center justify-between gap-2">
									{activeNote ? (
										<div className="flex min-w-0 flex-1 items-center gap-2">
											{isTitleEditing ? (
												<>
													<input
														type="text"
														value={titleDraft}
														onChange={(event) => handleTitleChange(event.target.value)}
														placeholder="输入笔记标题"
														disabled={isActiveNoteDeleted}
														className={`min-w-0 flex-1 rounded-lg border px-2 py-1 text-sm font-semibold outline-none ${
															isActiveNoteDeleted
																? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
																: "border-slate-200 bg-white text-slate-900 focus:border-slate-400"
														}`}
													/>
													<button
														type="button"
														onClick={confirmTitleEdit}
														disabled={!canConfirmTitleEdit}
														aria-label="确认标题"
														className={`rounded-md border p-1.5 ${
															!canConfirmTitleEdit
																? "cursor-not-allowed border-slate-200 text-slate-300"
																: "border-emerald-200 text-emerald-700"
														}`}
													>
														<svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
															<path d="M4 10.5L8 14.5L16 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
														</svg>
													</button>
													<button
														type="button"
														onClick={cancelTitleEdit}
														aria-label="取消标题编辑"
														className="rounded-md border border-rose-200 p-1.5 text-rose-600"
													>
														<svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
															<path d="M5.5 5.5L14.5 14.5M14.5 5.5L5.5 14.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
														</svg>
													</button>
												</>
											) : (
												<>
													<p className="truncate text-sm font-semibold">{activeNote.title}</p>
													<button
														type="button"
														onClick={startTitleEdit}
														disabled={isActiveNoteDeleted}
														aria-label="编辑标题"
														className={`rounded-md border p-1.5 ${
															isActiveNoteDeleted
																? "cursor-not-allowed border-slate-200 text-slate-300"
																: "border-slate-200 text-slate-600"
														}`}
													>
														<svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
															<path d="M13.5 4.5L15.5 6.5M6 14L10.5 13L16 7.5L13.5 5L8 10.5L7 15L6 14Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
														</svg>
													</button>
												</>
											)}
										</div>
									) : (
										<p className="text-sm font-semibold">未选择笔记</p>
									)}
								<div className="flex items-center gap-2">
									<div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
										<ModeButton
											label="编辑"
											active={mobileEditorMode === "edit"}
											disabled={isActiveNoteDeleted}
											onClick={() => setEditorMode("edit")}
										/>
										<ModeButton label="预览" active={mobileEditorMode === "preview"} onClick={() => setEditorMode("preview")} />
									</div>
									<button
										type="button"
										onClick={toggleFocusFullscreen}
										className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600"
									>
										{isFocusFullscreen ? "退出全屏" : "全屏"}
									</button>
									{canArchiveActiveNote ? (
										<button
											type="button"
											onClick={handleToggleArchiveActiveNote}
											disabled={!activeNote || isArchivingNote || isDeletingNote || isRestoringNote}
											className={`rounded-lg border px-2 py-1 text-xs ${
												!activeNote || isArchivingNote || isDeletingNote || isRestoringNote
													? "cursor-not-allowed border-slate-200 text-slate-300"
													: "border-amber-200 text-amber-700"
											}`}
										>
											{isArchivingNote ? "处理中" : activeNote?.isArchived ? "取消归档" : "归档"}
										</button>
									) : null}
									{canRestoreActiveNote ? (
										<button
											type="button"
											onClick={handleRestoreActiveNote}
											disabled={!activeNote || isRestoringNote || isDeletingNote}
											className={`rounded-lg border px-2 py-1 text-xs ${
												!activeNote || isRestoringNote || isDeletingNote
													? "cursor-not-allowed border-slate-200 text-slate-300"
													: "border-emerald-200 text-emerald-700"
											}`}
										>
											{isRestoringNote ? "恢复中" : "恢复"}
										</button>
									) : null}
									<button
										type="button"
										onClick={handleDeleteActiveNote}
										disabled={!activeNote || isDeletingNote || isArchivingNote || isRestoringNote}
										className={`rounded-lg border px-2 py-1 text-xs ${
											!activeNote || isDeletingNote || isArchivingNote || isRestoringNote
												? "cursor-not-allowed border-slate-200 text-slate-300"
												: "border-rose-200 text-rose-600"
										}`}
									>
										{isDeletingNote ? "处理中" : activeNote?.deletedAt ? "永久删除" : "移入回收站"}
									</button>
									</div>
								</div>
								<p className="mb-2 text-xs text-slate-500">当前状态筛选：{noteStatusLabel}</p>
								<div className="mb-2 grid grid-cols-3 gap-2">
									<ModeButton label="活跃" active={noteStatusFilter === "active"} onClick={() => setNoteStatusFilter("active")} />
									<ModeButton label="归档" active={noteStatusFilter === "archived"} onClick={() => setNoteStatusFilter("archived")} />
									<ModeButton label="回收站" active={noteStatusFilter === "deleted"} onClick={() => setNoteStatusFilter("deleted")} />
								</div>
								<div className="mb-2 flex items-center gap-2">
									<select
										value={activeNoteFolderId}
										onChange={(event) => void handleMoveActiveNote(event.target.value)}
										disabled={!activeNote || isMovingNote || isActiveNoteDeleted}
										className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-600"
									>
										{folderFilterItems.map((item) => (
											<option key={item.folder.id} value={item.folder.id}>
												{formatFolderOptionLabel(item.folder.name, item.level)}
											</option>
										))}
									</select>
									<span className="text-xs text-slate-400">
										{isActiveNoteDeleted ? "回收站笔记不可移动" : isMovingNote ? "移动中" : "切换即移动"}
									</span>
									<button
										type="button"
										data-link-toggle="true"
										onClick={toggleLinkInsertPanel}
										disabled={!activeNote || isActiveNoteDeleted || (!linkInsertOpen && !canEditLinks)}
										className={`rounded-lg border px-2 py-1 text-xs ${
											!activeNote || isActiveNoteDeleted || (!linkInsertOpen && !canEditLinks)
												? "cursor-not-allowed border-slate-200 text-slate-300"
												: "border-sky-200 text-sky-700"
										}`}
									>
										{linkInsertOpen ? "收起双链" : "添加双链"}
									</button>
								</div>
								{linkInsertOpen ? (
									<div data-link-panel="true">
										<WikiLinkInsertPanel
											query={linkInsertQuery}
											onQueryChange={setLinkInsertQuery}
											results={linkInsertResults}
											isLoading={isLinkInsertLoading}
											disabled={!canEditLinks}
											onInsert={handleInsertWikiLink}
											onClose={closeLinkInsertPanel}
										/>
									</div>
								) : null}
								<div className="mb-2">
									<AttachmentPanel
										assets={noteAssets}
										isLoading={isLoadingAssets}
										isUploading={isUploadingAsset}
										deletingAssetId={deletingAssetId}
										disabled={!activeNote || isActiveNoteDeleted || isDeletingNote || isArchivingNote || isRestoringNote}
										errorMessage={assetErrorMessage}
										onUpload={handleUploadAsset}
										onInsert={handleInsertAssetLink}
										onDelete={handleDeleteAsset}
									/>
								</div>
								</>
								) : null}
								{mobileEditorMode === "edit" ? (
									<textarea
										value={draft}
										onChange={(e) => handleDraftChange(e.target.value)}
										className={`w-full text-sm ${
											isFocusFullscreen
												? "h-[calc(100dvh-1.5rem)] resize-none border-0 bg-white p-0"
												: "h-[58dvh] rounded-xl border border-slate-200 bg-slate-50 p-3"
										}`}
									/>
								) : (
									<div
										className={`overflow-y-auto ${
											isFocusFullscreen
												? "h-[calc(100dvh-1.5rem)] bg-white p-0"
												: "h-[58dvh] rounded-xl border border-slate-200 bg-slate-50 p-3"
										}`}
									>
										<ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
											{previewMarkdown || "*（空白笔记）*"}
										</ReactMarkdown>
									</div>
								)}
							{!isFocusFullscreen ? (
								<div className="mt-3">
								<LinkSummaryPanel
									isLoading={isLoadingNoteLinks}
									isMutating={isSyncingLinks}
									outbound={outboundLinks}
									inbound={inboundLinks}
									onOpenNote={focusNote}
									onRemoveOutbound={handleRemoveOutboundLink}
									canRemoveOutbound={canEditLinks}
								/>
								<div className="mt-3">
									<RelationSummaryPanel
										isLoading={isLoadingNoteRelations}
										items={acceptedRelations}
										onOpenNote={focusNote}
										mutatingRelationId={mutatingRelationId}
										onUpdateRelationType={handleUpdateRelationType}
										onDeleteRelation={handleDeleteRelation}
									/>
								</div>
							</div>
							) : null}
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
					<AiPanel
						activeNote={activeNote}
						query={aiQuery}
						onQueryChange={setAiQuery}
						activeTask={activeAiTask}
						onSelectTask={setActiveAiTask}
						onRunTask={handleRunAiTask}
						runningTasks={runningAiTasks}
						taskStages={aiTaskStages}
						errorMessage={aiErrorMessage}
						result={aiEnhanceResult}
						noteRelations={noteRelations}
						isLoadingRelations={isLoadingNoteRelations}
						mutatingRelationId={mutatingRelationId}
						onApplyTitle={handleApplyAiTitle}
						onApplyTags={handleApplyAiTags}
						onApplyRelations={handleApplyAiRelations}
						onAcceptSuggestion={handleAcceptAiRelationSuggestion}
						onUpdateRelationType={handleUpdateRelationType}
						onAcceptRelation={handleAcceptRelation}
						onRejectRelation={handleRejectRelation}
						onDeleteRelation={handleDeleteRelation}
						isApplyingTitle={isApplyingAiTitle}
						isApplyingTags={isApplyingAiTags}
						isApplyingRelations={isApplyingAiRelations}
						onOpenNote={focusNote}
					/>
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
						<AiPanel
							activeNote={activeNote}
							query={aiQuery}
							onQueryChange={setAiQuery}
							activeTask={activeAiTask}
							onSelectTask={setActiveAiTask}
							onRunTask={handleRunAiTask}
							runningTasks={runningAiTasks}
							taskStages={aiTaskStages}
							errorMessage={aiErrorMessage}
							result={aiEnhanceResult}
							noteRelations={noteRelations}
							isLoadingRelations={isLoadingNoteRelations}
							mutatingRelationId={mutatingRelationId}
							onApplyTitle={handleApplyAiTitle}
							onApplyTags={handleApplyAiTags}
							onApplyRelations={handleApplyAiRelations}
							onAcceptSuggestion={handleAcceptAiRelationSuggestion}
							onUpdateRelationType={handleUpdateRelationType}
							onAcceptRelation={handleAcceptRelation}
							onRejectRelation={handleRejectRelation}
							onDeleteRelation={handleDeleteRelation}
							isApplyingTitle={isApplyingAiTitle}
							isApplyingTags={isApplyingAiTags}
							isApplyingRelations={isApplyingAiRelations}
							onOpenNote={focusNote}
						/>
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

function sortFolderItems(folders: FolderApiItem[]): FolderApiItem[] {
	return [...folders].sort((a, b) => {
		if (a.parentId === b.parentId) {
			return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-CN");
		}
		if (a.parentId === null) {
			return -1;
		}
		if (b.parentId === null) {
			return 1;
		}
		return a.parentId.localeCompare(b.parentId, "zh-CN");
	});
}

function collectDescendantFolderIds(rootId: string, childrenByParent: Map<string, FolderApiItem[]>): Set<string> {
	const result = new Set<string>();
	const queue = [rootId];
	while (queue.length > 0) {
		const current = queue.shift();
		if (!current || result.has(current)) {
			continue;
		}
		result.add(current);
		const children = childrenByParent.get(current) ?? [];
		for (const child of children) {
			queue.push(child.id);
		}
	}
	return result;
}

function formatFolderOptionLabel(name: string, level: number): string {
	return level > 0 ? `${"  ".repeat(level)}- ${name}` : name;
}

function readErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	return "操作失败，请稍后重试";
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

function WikiLinkInsertPanel(props: {
	query: string;
	onQueryChange: (value: string) => void;
	results: NoteItem[];
	isLoading: boolean;
	disabled: boolean;
	onInsert: (note: NoteItem) => void;
	onClose: () => void;
}) {
	const { query, onQueryChange, results, isLoading, disabled, onInsert, onClose } = props;
	return (
		<section className="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 p-2">
			<div className="mb-2 flex items-center justify-between">
				<p className="text-xs font-medium text-slate-600">双链管理</p>
				<button
					type="button"
					onClick={onClose}
					className="rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100"
				>
					收起
				</button>
			</div>
			<div className="flex items-center gap-2">
				<input
					type="text"
					value={query}
					onChange={(event) => onQueryChange(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							event.preventDefault();
							onClose();
							return;
						}
						if (event.key === "Enter") {
							event.preventDefault();
							const first = results[0];
							if (first && !disabled) {
								onInsert(first);
							}
						}
					}}
					disabled={disabled}
					placeholder={disabled ? "当前状态不可编辑双链" : "搜索其他笔记并建立出链"}
					className={`min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700 ${
						disabled ? "cursor-not-allowed opacity-60" : ""
					}`}
				/>
				<span className="shrink-0 text-[11px] text-slate-400">Enter 添加首项</span>
			</div>
			<p className="mt-2 px-1 text-[11px] text-slate-400">链接仅存储在数据库中，不写入正文。</p>
			<div className="mt-2 max-h-24 space-y-1 overflow-y-auto pr-1">
				{isLoading ? (
					<p className="px-2 py-1 text-xs text-slate-400">搜索中...</p>
				) : null}
				{!isLoading && results.length === 0 ? (
					<p className="px-2 py-1 text-xs text-slate-400">没有可添加的笔记</p>
				) : null}
				{!isLoading
					? results.map((note) => (
						<button
							key={`insert-${note.id}`}
							type="button"
							onClick={() => onInsert(note)}
							disabled={disabled}
							className={`w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-left text-xs ${
								disabled ? "cursor-not-allowed text-slate-300" : "text-slate-700 hover:bg-slate-100"
							}`}
						>
							<span className="font-medium text-slate-800">{note.title}</span>
							<span className="ml-2 text-slate-400">→ 添加为出链</span>
						</button>
					))
					: null}
			</div>
		</section>
	);
}

function AttachmentPanel(props: {
	assets: NoteAssetApiItem[];
	isLoading: boolean;
	isUploading: boolean;
	deletingAssetId: string;
	disabled: boolean;
	errorMessage: string;
	onUpload: (files: FileList | null) => void;
	onInsert: (asset: NoteAssetApiItem) => void;
	onDelete: (asset: NoteAssetApiItem) => void;
}) {
	const { assets, isLoading, isUploading, deletingAssetId, disabled, errorMessage, onUpload, onInsert, onDelete } = props;
	return (
		<section className="rounded-xl border border-slate-200 bg-slate-50/70 p-2">
			<div className="mb-2 flex items-center justify-between">
				<p className="text-xs font-medium text-slate-600">附件</p>
				<label
					className={`rounded-md border px-2 py-1 text-[11px] ${
						disabled || isUploading
							? "cursor-not-allowed border-slate-200 text-slate-300"
							: "border-slate-200 text-slate-600 hover:bg-slate-100"
					}`}
				>
					{isUploading ? "上传中..." : "上传"}
					<input
						type="file"
						disabled={disabled || isUploading}
						className="hidden"
						onChange={(event) => {
							onUpload(event.target.files);
							event.currentTarget.value = "";
						}}
					/>
				</label>
			</div>
			{errorMessage ? (
				<p className="mb-2 rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-600">{errorMessage}</p>
			) : null}
			<div className="max-h-32 space-y-1 overflow-y-auto pr-1">
				{isLoading ? <p className="px-2 py-1 text-xs text-slate-400">加载中...</p> : null}
				{!isLoading && assets.length === 0 ? <p className="px-2 py-1 text-xs text-slate-400">暂无附件</p> : null}
				{!isLoading
					? assets.map((asset) => (
						<div
							key={asset.id}
							className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2 py-1"
						>
							<button
								type="button"
								className="min-w-0 flex-1 truncate text-left text-xs text-slate-700 hover:text-slate-900"
								onClick={() => onInsert(asset)}
								disabled={disabled}
								title={asset.fileName || asset.id}
							>
								{asset.fileName || asset.id}
							</button>
							<div className="flex items-center gap-1">
								<a
									href={asset.downloadUrl}
									target="_blank"
									rel="noreferrer"
									className="rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100"
								>
									查看
								</a>
								<button
									type="button"
									onClick={() => onDelete(asset)}
									disabled={disabled || deletingAssetId === asset.id}
									className={`rounded border px-2 py-0.5 text-[11px] ${
										disabled || deletingAssetId === asset.id
											? "cursor-not-allowed border-slate-200 text-slate-300"
											: "border-rose-200 text-rose-600 hover:bg-rose-50"
									}`}
								>
									{deletingAssetId === asset.id ? "删除中" : "删除"}
								</button>
							</div>
						</div>
					))
					: null}
			</div>
			<p className="mt-2 px-1 text-[11px] text-slate-400">点击文件名可插入 Markdown 链接。</p>
		</section>
	);
}

function LinkSummaryPanel(props: {
	isLoading: boolean;
	isMutating: boolean;
	outbound: NoteLinkApiItem[];
	inbound: NoteLinkApiItem[];
	onOpenNote: (noteId: string) => void;
	onRemoveOutbound: (noteId: string) => void;
	canRemoveOutbound: boolean;
}) {
	const { isLoading, isMutating, outbound, inbound, onOpenNote, onRemoveOutbound, canRemoveOutbound } = props;

	return (
		<section className="rounded-xl border border-slate-200 bg-slate-50 p-3">
			<div className="mb-2 flex items-center justify-between">
				<p className="text-xs font-semibold uppercase tracking-wide text-slate-500">链接概览</p>
				{isLoading || isMutating ? <span className="text-xs text-slate-400">{isMutating ? "处理中..." : "更新中..."}</span> : null}
			</div>
			<div className="grid gap-3 lg:grid-cols-2">
				<LinkNoteList
					title="出链"
					items={outbound}
					emptyText="暂无出链"
					onOpenNote={onOpenNote}
					onRemoveNote={onRemoveOutbound}
					canRemove={canRemoveOutbound}
				/>
				<LinkNoteList title="反链" items={inbound} emptyText="暂无反链" onOpenNote={onOpenNote} />
			</div>
		</section>
	);
}

function RelationSummaryPanel(props: {
	isLoading: boolean;
	items: NoteRelationApiItem[];
	onOpenNote: (noteId: string) => void;
	mutatingRelationId?: string;
	onUpdateRelationType?: (relationId: string, relationType: NoteRelationTypeApiItem) => void;
	onAcceptRelation?: (relationId: string) => void;
	onRejectRelation?: (relationId: string) => void;
	onDeleteRelation?: (relationId: string) => void;
	emptyText?: string;
}) {
	const {
		isLoading,
		items,
		onOpenNote,
		mutatingRelationId = "",
		onUpdateRelationType,
		onAcceptRelation,
		onRejectRelation,
		onDeleteRelation,
		emptyText = "暂无已保存关系",
	} = props;

	return (
		<section className="rounded-xl border border-slate-200 bg-slate-50 p-3">
			<div className="mb-2 flex items-center justify-between">
				<p className="text-xs font-semibold uppercase tracking-wide text-slate-500">已保存关系</p>
				{isLoading ? <span className="text-xs text-slate-400">更新中...</span> : null}
			</div>
			<div className="space-y-2">
				{!isLoading && items.length === 0 ? (
					<p className="text-xs text-slate-400">{emptyText}</p>
				) : null}
				{items.map((item) => (
					<div key={item.id} className="rounded-lg border border-slate-200 bg-white p-2">
						<div className="flex items-start justify-between gap-2">
							<div className="min-w-0 flex-1">
								<button
									type="button"
									onClick={() => onOpenNote(item.otherNote.id)}
									className="truncate text-left text-xs font-medium text-slate-800 hover:text-sky-700"
								>
									{item.otherNote.title}
								</button>
								<p className="mt-1 text-[11px] text-slate-500">
									{formatRelationTypeLabel(item.relationType)} · {Math.round(item.score * 100)}%
								</p>
							</div>
							<span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
								{item.source === "ai" ? "AI" : "人工"}
							</span>
						</div>
						<p className="mt-2 line-clamp-2 text-[11px] text-slate-600">
							{item.reason || item.evidenceExcerpt || item.otherNote.excerpt || "已保存关系"}
						</p>
						{onUpdateRelationType || onAcceptRelation || onRejectRelation || onDeleteRelation ? (
							<div className="mt-2 flex items-center gap-2">
								{onUpdateRelationType ? (
									<select
										value={item.relationType}
										onChange={(event) => onUpdateRelationType(item.id, event.target.value as NoteRelationTypeApiItem)}
										disabled={mutatingRelationId === item.id}
										className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600"
									>
										{RELATION_TYPE_OPTIONS.map((option) => (
											<option key={option.value} value={option.value}>
												{option.label}
											</option>
										))}
									</select>
								) : null}
								{onAcceptRelation && item.status === "suggested" ? (
									<button
										type="button"
										onClick={() => onAcceptRelation(item.id)}
										disabled={mutatingRelationId === item.id}
										className={`rounded border px-2 py-1 text-[11px] ${
											mutatingRelationId === item.id
												? "cursor-not-allowed border-slate-200 text-slate-300"
												: "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
										}`}
									>
										{mutatingRelationId === item.id ? "处理中..." : "接受"}
									</button>
								) : null}
								{onRejectRelation && item.status === "suggested" ? (
									<button
										type="button"
										onClick={() => onRejectRelation(item.id)}
										disabled={mutatingRelationId === item.id}
										className={`rounded border px-2 py-1 text-[11px] ${
											mutatingRelationId === item.id
												? "cursor-not-allowed border-slate-200 text-slate-300"
												: "border-amber-200 text-amber-700 hover:bg-amber-50"
										}`}
									>
										{mutatingRelationId === item.id ? "处理中..." : "忽略"}
									</button>
								) : null}
								{onDeleteRelation ? (
									<button
										type="button"
										onClick={() => onDeleteRelation(item.id)}
										disabled={mutatingRelationId === item.id}
										className={`rounded border px-2 py-1 text-[11px] ${
											mutatingRelationId === item.id
												? "cursor-not-allowed border-slate-200 text-slate-300"
												: "border-rose-200 text-rose-600 hover:bg-rose-50"
										}`}
									>
										{mutatingRelationId === item.id ? "处理中..." : "删除"}
									</button>
								) : null}
							</div>
						) : null}
					</div>
				))}
			</div>
		</section>
	);
}

function LinkNoteList(props: {
	title: string;
	items: NoteLinkApiItem[];
	emptyText: string;
	onOpenNote: (noteId: string) => void;
	onRemoveNote?: (noteId: string) => void;
	canRemove?: boolean;
}) {
	const { title, items, emptyText, onOpenNote, onRemoveNote, canRemove = false } = props;

	return (
		<div className="rounded-lg border border-slate-200 bg-white p-2">
			<p className="text-xs font-medium text-slate-600">{title}</p>
			<div className="mt-2 max-h-28 space-y-1 overflow-y-auto pr-1">
				{items.length === 0 ? (
					<p className="text-xs text-slate-400">{emptyText}</p>
				) : (
					items.map((item) => (
						<div key={`${title}-${item.noteId}`} className="flex items-center gap-1 rounded-md px-1 py-1 hover:bg-slate-100">
							<button
								type="button"
								onClick={() => onOpenNote(item.noteId)}
								className="min-w-0 flex-1 rounded-md px-2 py-1 text-left text-xs text-slate-700"
							>
								<p className="truncate font-medium text-slate-800">{item.title}</p>
								<p className="mt-0.5 truncate text-[11px] text-slate-500">{formatUpdatedAt(item.updatedAt)}</p>
							</button>
							{onRemoveNote ? (
								<button
									type="button"
									onClick={() => onRemoveNote(item.noteId)}
									disabled={!canRemove}
									className={`rounded border px-2 py-0.5 text-[11px] ${
										!canRemove
											? "cursor-not-allowed border-slate-200 text-slate-300"
											: "border-rose-200 text-rose-600 hover:bg-rose-50"
									}`}
								>
									删除
								</button>
							) : null}
						</div>
					))
				)}
			</div>
		</div>
	);
}

function AiPanel(props: {
	activeNote: NoteItem | null;
	query: string;
	onQueryChange: (value: string) => void;
	activeTask: AiEnhanceTaskApiKey | null;
	onSelectTask: (task: AiEnhanceTaskApiKey) => void;
	onRunTask: (task: AiEnhanceTaskApiKey) => void;
	runningTasks: AiEnhanceTaskApiKey[];
	taskStages: Partial<Record<AiEnhanceTaskApiKey, string>>;
	errorMessage: string;
	result: AiEnhanceResultApiItem | null;
	noteRelations: NoteRelationApiItem[];
	isLoadingRelations: boolean;
	mutatingRelationId: string;
	onApplyTitle: (title: string) => void;
	onApplyTags: () => void;
	onApplyRelations: () => void;
	onAcceptSuggestion: (otherNoteId: string) => void;
	onUpdateRelationType: (relationId: string, relationType: NoteRelationTypeApiItem) => void;
	onAcceptRelation: (relationId: string) => void;
	onRejectRelation: (relationId: string) => void;
	onDeleteRelation: (relationId: string) => void;
	isApplyingTitle: boolean;
	isApplyingTags: boolean;
	isApplyingRelations: boolean;
	onOpenNote: (noteId: string) => void;
}) {
	const {
		activeNote,
		query,
		onQueryChange,
		activeTask,
		onSelectTask,
		onRunTask,
		runningTasks,
		taskStages,
		errorMessage,
		result,
		noteRelations,
		isLoadingRelations,
		mutatingRelationId,
		onApplyTitle,
		onApplyTags,
		onApplyRelations,
		onAcceptSuggestion,
		onUpdateRelationType,
		onAcceptRelation,
		onRejectRelation,
		onDeleteRelation,
		isApplyingTitle,
		isApplyingTags,
		isApplyingRelations,
		onOpenNote,
	} = props;
	const unavailable = !activeNote || Boolean(activeNote.deletedAt);
	const runningTaskSet = new Set(runningTasks);
	const tagNames = result?.tagSuggestions.map((item) => item.name) ?? [];
	const [relationViewStatus, setRelationViewStatus] = useState<"suggested" | "accepted">("suggested");
	const relationItems = noteRelations.filter((item) => item.status === relationViewStatus);

	return (
		<div>
			<div className="mb-3 flex items-center justify-between">
				<p className="text-sm font-semibold">AI 助手</p>
				<span className="rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
					{result?.provider === "siliconflow" ? "Siliconflow" : "在线"}
				</span>
			</div>
			<div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
				<p className="text-xs text-slate-500">当前笔记</p>
				<p className="mt-1 truncate text-sm font-medium text-slate-800">
					{activeNote?.title ?? "未选中笔记"}
				</p>
				<input
					value={query}
					onChange={(event) => onQueryChange(event.target.value)}
					placeholder="可选：输入补充检索词"
					disabled={unavailable}
					className="mt-3 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700 outline-none focus:ring disabled:cursor-not-allowed disabled:bg-slate-100"
				/>
					<div className="mt-3 grid grid-cols-2 gap-2">
						{AI_TASK_ITEMS.map((item) => {
							const isRunningTask = runningTaskSet.has(item.key);
							const canRunTask = !unavailable && !isRunningTask;
							const isActiveTask = activeTask === item.key;
							return (
								<button
									key={item.key}
									type="button"
									onClick={() => {
										onSelectTask(item.key);
										onRunTask(item.key);
									}}
									disabled={!canRunTask}
									className={`rounded-lg px-2 py-2 text-xs font-medium ${
										canRunTask
											? isActiveTask
												? "bg-sky-600 text-white hover:bg-sky-500"
												: "bg-slate-900 text-white hover:bg-slate-700"
											: "cursor-not-allowed bg-slate-200 text-slate-500"
									}`}
								>
								{isRunningTask ? taskStages[item.key] ?? "生成中..." : item.label}
							</button>
						);
					})}
				</div>
				{unavailable ? <p className="mt-2 text-xs text-amber-600">请选中未删除笔记后使用。</p> : null}
				{errorMessage ? <p className="mt-2 text-xs text-rose-600">{errorMessage}</p> : null}
			</div>

			<div className="mt-3">
				<section className="rounded-xl border border-slate-200 bg-slate-50 p-3">
					<div className="mb-2 flex items-center justify-between">
						<p className="text-xs font-semibold uppercase tracking-wide text-slate-500">关系状态</p>
						<div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
							<ModeButton
								label="待确认"
								active={relationViewStatus === "suggested"}
								onClick={() => setRelationViewStatus("suggested")}
							/>
							<ModeButton
								label="已确认"
								active={relationViewStatus === "accepted"}
								onClick={() => setRelationViewStatus("accepted")}
							/>
						</div>
					</div>
					<RelationSummaryPanel
						isLoading={isLoadingRelations}
						items={relationItems}
						onOpenNote={onOpenNote}
						mutatingRelationId={mutatingRelationId}
						onUpdateRelationType={onUpdateRelationType}
						onAcceptRelation={onAcceptRelation}
						onRejectRelation={onRejectRelation}
						onDeleteRelation={onDeleteRelation}
						emptyText={relationViewStatus === "suggested" ? "暂无待确认关系" : "暂无已确认关系"}
					/>
				</section>
			</div>

			{result ? (
				<div className="mt-3 space-y-3">
					{result.warnings.length > 0 ? (
						<div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
							{result.warnings[0]}
						</div>
					) : null}

						{activeTask === "title" ? (
							<section className="rounded-lg border border-slate-200 bg-white p-3">
								<div className="mb-2 flex items-center justify-between">
									<p className="text-xs font-semibold text-slate-600">标题候选</p>
									<span className="text-[11px] text-slate-400">{formatUpdatedAt(result.generatedAt)}</span>
								</div>
								<div className="space-y-2">
									{result.titleCandidates.length === 0 ? (
										<p className="text-xs text-slate-400">暂无建议</p>
									) : (
										result.titleCandidates.map((item, index) => (
											<div key={`${item.title}-${index}`} className="rounded-md border border-slate-200 p-2">
												<p className="text-sm text-slate-800">{item.title}</p>
												<p className="mt-1 text-[11px] text-slate-500">{item.reason}</p>
												<button
													type="button"
													onClick={() => onApplyTitle(item.title)}
													disabled={isApplyingTitle}
													className={`mt-2 rounded border px-2 py-1 text-[11px] ${
														isApplyingTitle
															? "cursor-not-allowed border-slate-200 text-slate-300"
															: "border-slate-300 text-slate-700 hover:bg-slate-100"
													}`}
												>
													{isApplyingTitle ? "应用中..." : "应用标题"}
												</button>
											</div>
										))
									)}
								</div>
							</section>
						) : null}

						{activeTask === "tags" ? (
							<section className="rounded-lg border border-slate-200 bg-white p-3">
								<div className="mb-2 flex items-center justify-between">
									<p className="text-xs font-semibold text-slate-600">标签建议</p>
									<button
										type="button"
										onClick={onApplyTags}
										disabled={isApplyingTags || tagNames.length === 0}
										className={`rounded border px-2 py-1 text-[11px] ${
											isApplyingTags || tagNames.length === 0
												? "cursor-not-allowed border-slate-200 text-slate-300"
												: "border-slate-300 text-slate-700 hover:bg-slate-100"
										}`}
									>
										{isApplyingTags ? "应用中..." : "应用标签"}
									</button>
								</div>
								<div className="flex flex-wrap gap-1">
									{tagNames.length === 0 ? (
										<p className="text-xs text-slate-400">暂无建议</p>
									) : (
										tagNames.map((name) => (
											<span key={name} className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-700">
												#{name}
											</span>
										))
									)}
								</div>
							</section>
						) : null}

						{activeTask === "summary" ? (
							<section className="rounded-lg border border-slate-200 bg-white p-3">
								<div className="mb-2 flex items-center justify-between">
									<p className="text-xs font-semibold text-slate-600">摘要 / 大纲</p>
								</div>
								{result.summaryMeta.skipped ? (
									<p className="text-xs text-slate-500">笔记较短，已跳过摘要（阈值策略）。</p>
								) : (
									<p className="text-sm leading-6 text-slate-700">{result.summary || "暂无摘要"}</p>
								)}
								{result.outline.length > 0 ? (
									<div className="mt-2 space-y-1">
										{result.outline.map((item, index) => (
											<p key={`${item}-${index}`} className="text-xs text-slate-600">
												{index + 1}. {item}
											</p>
										))}
									</div>
								) : null}
							</section>
						) : null}

						{activeTask === "relations" ? (
							<section className="rounded-lg border border-slate-200 bg-white p-3">
								<div className="mb-2 flex items-center justify-between">
									<p className="text-xs font-semibold text-slate-600">关系建议</p>
									<button
										type="button"
										onClick={onApplyRelations}
										disabled={isApplyingRelations || result.relationSuggestions.length === 0}
										className={`rounded border px-2 py-1 text-[11px] ${
											isApplyingRelations || result.relationSuggestions.length === 0
												? "cursor-not-allowed border-slate-200 text-slate-300"
												: "border-slate-300 text-slate-700 hover:bg-slate-100"
										}`}
									>
										{isApplyingRelations ? "保存中..." : "保存关系"}
									</button>
								</div>
								<AiRelationSuggestionList
									items={result.relationSuggestions}
									onOpenNote={onOpenNote}
									onAcceptSuggestion={onAcceptSuggestion}
									mutatingRelationId={mutatingRelationId}
									emptyText="暂无关系建议"
								/>
							</section>
						) : null}

						{activeTask === "semantic" ? (
							<section className="rounded-lg border border-slate-200 bg-white p-3">
								<p className="mb-2 text-xs font-semibold text-slate-600">语义搜索候选</p>
								<AiRelatedNoteList
									items={result.semanticSearch}
									onOpenNote={onOpenNote}
									emptyText="暂无结果"
								/>
							</section>
						) : null}

						{activeTask === "similar" ? (
							<section className="rounded-lg border border-slate-200 bg-white p-3">
								<p className="mb-2 text-xs font-semibold text-slate-600">相似笔记</p>
								<AiRelatedNoteList
									items={result.similarNotes}
									onOpenNote={onOpenNote}
									emptyText="暂无相似笔记"
								/>
							</section>
						) : null}
				</div>
			) : null}
		</div>
	);
}

function AiRelatedNoteList(props: {
	items: AiEnhanceRelatedNoteApiItem[];
	onOpenNote: (noteId: string) => void;
	emptyText: string;
}) {
	const { items, onOpenNote, emptyText } = props;
	return items.length === 0 ? (
		<p className="text-xs text-slate-400">{emptyText}</p>
	) : (
		<div className="space-y-2">
			{items.map((item) => (
				<div key={`${item.noteId}-${item.slug}`} className="rounded-md border border-slate-200 p-2">
					<div className="flex items-center justify-between gap-2">
						<button
							type="button"
							onClick={() => onOpenNote(item.noteId)}
							className="truncate text-left text-xs font-medium text-slate-800 hover:text-sky-700"
						>
							{item.title}
						</button>
						<span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
							{Math.round(item.score * 100)}%
						</span>
					</div>
					<p className="mt-1 line-clamp-2 text-[11px] text-slate-500">{item.snippet || item.reason}</p>
				</div>
			))}
		</div>
	);
}

function AiRelationSuggestionList(props: {
	items: AiEnhanceRelationSuggestionApiItem[];
	onOpenNote: (noteId: string) => void;
	onAcceptSuggestion: (otherNoteId: string) => void;
	mutatingRelationId: string;
	emptyText: string;
}) {
	const { items, onOpenNote, onAcceptSuggestion, mutatingRelationId, emptyText } = props;
	return items.length === 0 ? (
		<p className="text-xs text-slate-400">{emptyText}</p>
	) : (
		<div className="space-y-2">
			{items.map((item) => {
				const actionId = `suggestion:${item.noteId}`;
				return (
					<div key={`${item.noteId}-${item.slug}`} className="rounded-md border border-slate-200 p-2">
						<div className="flex items-center justify-between gap-2">
							<button
								type="button"
								onClick={() => onOpenNote(item.noteId)}
								className="truncate text-left text-xs font-medium text-slate-800 hover:text-sky-700"
							>
								{item.title}
							</button>
							<span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
								{Math.round(item.score * 100)}%
							</span>
						</div>
						<p className="mt-1 text-[11px] text-slate-500">
							{formatRelationTypeLabel(item.relationType)} · {item.evidenceExcerpt ?? item.snippet}
						</p>
						<p className="mt-1 line-clamp-2 text-[11px] text-slate-600">{item.reason}</p>
						<div className="mt-2 flex justify-end">
							<button
								type="button"
								onClick={() => onAcceptSuggestion(item.noteId)}
								disabled={mutatingRelationId === actionId}
								className={`rounded border px-2 py-1 text-[11px] ${
									mutatingRelationId === actionId
										? "cursor-not-allowed border-slate-200 text-slate-300"
										: "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
								}`}
							>
								{mutatingRelationId === actionId ? "处理中..." : "接受"}
							</button>
						</div>
					</div>
				);
			})}
		</div>
	);
}

function formatAiTaskStage(progress: AiEnhanceTaskStreamProgress): string {
	if (progress.stage === "prepare") {
		return "准备中";
	}
	if (progress.stage === "generate") {
		return "生成中";
	}
	return "处理中";
}

function formatRelationTypeLabel(value: string): string {
	if (value === "similar") {
		return "相似";
	}
	if (value === "complements") {
		return "互补";
	}
	if (value === "contrasts") {
		return "对照";
	}
	if (value === "same_project") {
		return "同项目";
	}
	if (value === "same_area") {
		return "同领域";
	}
	return "相关";
}

function buildInitialAiEnhanceResult(noteId: string, query: string): AiEnhanceResultApiItem {
	return {
		noteId,
		query,
		generatedAt: new Date().toISOString(),
		provider: "siliconflow",
		model: null,
		warnings: [],
		titleCandidates: [],
		tagSuggestions: [],
		semanticSearch: [],
		relationSuggestions: [],
		summary: "",
		outline: [],
		summaryMeta: {
			mode: "full",
			skipped: false,
			reason: null,
		},
		similarNotes: [],
	};
}

function mergeAiEnhanceResult(
	current: AiEnhanceResultApiItem | null,
	partial: AiEnhanceResultApiItem,
	noteId: string,
	query: string,
): AiEnhanceResultApiItem {
	const base = current ?? buildInitialAiEnhanceResult(noteId, query);
	return {
		...base,
		generatedAt: partial.generatedAt || base.generatedAt,
		provider: partial.provider || base.provider,
		model: partial.model,
		warnings: [...new Set([...base.warnings, ...partial.warnings])],
		titleCandidates: partial.titleCandidates.length > 0 ? partial.titleCandidates : base.titleCandidates,
		tagSuggestions: partial.tagSuggestions.length > 0 ? partial.tagSuggestions : base.tagSuggestions,
		semanticSearch: partial.semanticSearch.length > 0 ? partial.semanticSearch : base.semanticSearch,
		relationSuggestions: partial.relationSuggestions.length > 0 ? partial.relationSuggestions : base.relationSuggestions,
		summary: partial.summary || base.summary,
		outline: partial.outline.length > 0 ? partial.outline : base.outline,
		summaryMeta: partial.summaryMeta ?? base.summaryMeta,
		similarNotes: partial.similarNotes.length > 0 ? partial.similarNotes : base.similarNotes,
	};
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
		isArchived: note.isArchived,
		deletedAt: note.deletedAt,
	};
}

function matchesStatusFilter(note: NoteItem, status: NoteStatus): boolean {
	if (status === "all") {
		return true;
	}
	if (status === "deleted") {
		return Boolean(note.deletedAt);
	}
	if (status === "archived") {
		return !note.deletedAt && note.isArchived;
	}
	return !note.deletedAt && !note.isArchived;
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
		const parsed = parseWikiLink(rawValue);
		if (!parsed) {
			return "";
		}
		return `[[${parsed.label}]](wiki:${encodeURIComponent(parsed.slug)})`;
	});
}

function parseWikiLink(rawValue: string): WikiLinkCandidate | null {
	const raw = rawValue.trim();
	if (!raw) {
		return null;
	}
	const separatorIndex = raw.lastIndexOf("|");
	const label = (separatorIndex >= 0 ? raw.slice(0, separatorIndex) : raw).trim();
	if (!label) {
		return null;
	}
	const explicitSlug = separatorIndex >= 0 ? raw.slice(separatorIndex + 1).trim() : "";
	const slugSource = explicitSlug || label;
	return { label, slug: toWikiSlug(slugSource) };
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
	return formatMonthDayTime(value);
}
