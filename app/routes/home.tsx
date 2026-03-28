import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "react-router";
import {
	archiveNote,
	createFolder,
	getNote,
	createNote,
	deleteNoteAsset,
	deleteNote,
	deleteNoteRelation,
	enhanceNoteWithAiTaskStream,
	hardDeleteNote,
	listFolders,
	listNoteAssets,
	listNotes,
	listNoteRelations,
	listTags,
	restoreNote,
	resolveNoteUrl,
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
type SavedNoteSnapshot = {
	noteId: string;
	title: string;
	content: string;
};

type WorkspaceMode = "capture" | "organize" | "focus";
type EditorMode = "edit" | "preview" | "split";
type CopyState = "idle" | "copying" | "copied" | "failed";
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
const FOCUS_EDITOR_EXTRA_VISIBLE_LINES = 4;
const FOCUS_EDITOR_MIN_VISIBLE_LINES = 6;
const FOCUS_EDITOR_MAX_VISIBLE_LINES = 10;
const FRONTEND_TAG_NAME_MAX_LENGTH = 48;

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
	const [selectedAiTagNames, setSelectedAiTagNames] = useState<string[]>([]);
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
	const [captureTagNames, setCaptureTagNames] = useState<string[]>([]);
	const [noteItems, setNoteItems] = useState<NoteItem[]>([]);
	const [noteStatusFilter, setNoteStatusFilter] = useState<NoteStatus>("active");
	const [tagItems, setTagItems] = useState<TagApiItem[]>([]);
	const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
	const [activeNoteId, setActiveNoteId] = useState("");
	const [titleDraft, setTitleDraft] = useState("");
	const [isTitleEditing, setIsTitleEditing] = useState(false);
	const [draft, setDraft] = useState("");
	const [isCreatingNote, setIsCreatingNote] = useState(false);
	const [isResolvingCaptureUrl, setIsResolvingCaptureUrl] = useState(false);
	const [captureActionMessage, setCaptureActionMessage] = useState("");
	const [isSavingDraft, setIsSavingDraft] = useState(false);
	const [saveErrorMessage, setSaveErrorMessage] = useState("");
	const [savedNoteSnapshot, setSavedNoteSnapshot] = useState<SavedNoteSnapshot>({
		noteId: "",
		title: "",
		content: "",
	});
	const [isArchivingNote, setIsArchivingNote] = useState(false);
	const [isRestoringNote, setIsRestoringNote] = useState(false);
	const [isDeletingNote, setIsDeletingNote] = useState(false);
	const [isResolvingNoteUrl, setIsResolvingNoteUrl] = useState(false);
	const [noteActionMessage, setNoteActionMessage] = useState("");
	const [copyState, setCopyState] = useState<CopyState>("idle");
	const [isUpdatingNoteTags, setIsUpdatingNoteTags] = useState(false);
	const [tagErrorMessage, setTagErrorMessage] = useState("");
	const [commandOpen, setCommandOpen] = useState(false);
	const [commandQuery, setCommandQuery] = useState("");
	const [commandResults, setCommandResults] = useState<NoteItem[]>([]);
	const [isCommandLoading, setIsCommandLoading] = useState(false);
	const [commandActiveIndex, setCommandActiveIndex] = useState(0);
	const [recentNoteIds, setRecentNoteIds] = useState<string[]>([]);
	const [noteRelations, setNoteRelations] = useState<NoteRelationApiItem[]>([]);
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
	const draftRef = useRef(draft);
	const titleDraftRef = useRef(titleDraft);
	const draftOverridesRef = useRef<Record<string, string>>({});
	const titleOverridesRef = useRef<Record<string, string>>({});
	const titleEditInitialRef = useRef("");
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
	const activeNoteSourceUrl = useMemo(
		() => extractSingleUrl(draft),
		[draft],
	);
	const captureInputSourceUrl = useMemo(() => extractSingleUrl(captureInput), [captureInput]);
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
	const aiSuggestedTagKey = useMemo(
		() => (aiEnhanceResult?.tagSuggestions ?? []).map((item) => item.name).join("\u0001"),
		[aiEnhanceResult?.tagSuggestions],
	);
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
	const canResolveActiveNoteUrl = Boolean(activeNote && !activeNote.deletedAt && activeNoteSourceUrl);
	const isSubmittingCapture = isCreatingNote || isResolvingCaptureUrl;

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
		const nextContent = activeNoteId
			? (draftOverridesRef.current[activeNoteId] ?? activeNote?.content ?? "")
			: "";
		const nextTitle = activeNoteId
			? (titleOverridesRef.current[activeNoteId] ?? activeNote?.title ?? "")
			: "";
		setDraft(nextContent);
		setTitleDraft(nextTitle);
		setSavedNoteSnapshot(
			activeNote
				? {
					noteId: activeNote.id,
					title: activeNote.title,
					content: activeNote.content,
				}
				: {
					noteId: "",
					title: "",
					content: "",
				},
		);
		titleEditInitialRef.current = nextTitle;
		setIsTitleEditing(false);
		setSaveErrorMessage("");
	}, [activeNoteId, activeNote?.content, activeNote?.title]);

	useEffect(() => {
		setAiEnhanceResult(null);
		setAiErrorMessage("");
		setAiQuery("");
		setActiveAiTask(null);
		setRunningAiTasks([]);
		setAiTaskStages({});
		setSelectedAiTagNames([]);
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
		setNoteActionMessage("");
		setTagErrorMessage("");
		setCopyState("idle");
	}, [activeNoteId]);

	useEffect(() => {
		if (copyState === "idle" || copyState === "copying" || typeof window === "undefined") {
			return;
		}
		const timer = window.setTimeout(() => {
			setCopyState("idle");
		}, 1800);
		return () => {
			window.clearTimeout(timer);
		};
	}, [copyState]);

	useEffect(() => {
		setCaptureActionMessage("");
	}, [captureInput, captureTagNames]);

	useEffect(() => {
		const nextSelected = (aiEnhanceResult?.tagSuggestions ?? [])
			.map((item) => item.name.trim())
			.filter((item) => item.length > 0);
		setSelectedAiTagNames(nextSelected);
	}, [activeNoteId, aiSuggestedTagKey]);

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
		draftRef.current = draft;
	}, [draft]);

	useEffect(() => {
		titleDraftRef.current = titleDraft;
	}, [titleDraft]);

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
		if (typeof window === "undefined" || !activeNoteId || !activeNote) {
			return;
		}
		const hasDraftOverride = draftOverridesRef.current[activeNoteId] !== undefined;
		const hasTitleOverride = titleOverridesRef.current[activeNoteId] !== undefined;
		if (!hasDraftOverride && !hasTitleOverride) {
			return;
		}
		const onBeforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", onBeforeUnload);
		return () => {
			window.removeEventListener("beforeunload", onBeforeUnload);
		};
	}, [activeNoteId, activeNote, draft, titleDraft]);

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

	const handleDraftChange = (value: string) => {
		if (isActiveNoteDeleted) {
			return;
		}
		setDraft(value);
		setSaveErrorMessage("");
		if (!activeNoteId) {
			return;
		}
		if (value === (activeNote?.content ?? savedNoteSnapshot.content)) {
			delete draftOverridesRef.current[activeNoteId];
			return;
		}
		draftOverridesRef.current[activeNoteId] = value;
	};

	const handleTitleChange = (value: string) => {
		setTitleDraft(value);
		setSaveErrorMessage("");
		if (!activeNoteId) {
			return;
		}
		if (value.trim() === (activeNote?.title ?? savedNoteSnapshot.title)) {
			delete titleOverridesRef.current[activeNoteId];
			return;
		}
		titleOverridesRef.current[activeNoteId] = value;
	};

	const startTitleEdit = () => {
		if (!activeNote || isActiveNoteDeleted) {
			return;
		}
		titleEditInitialRef.current = titleDraft || activeNote.title;
		setIsTitleEditing(true);
	};

	const cancelTitleEdit = () => {
		const nextTitle = titleEditInitialRef.current || (activeNote?.title ?? "");
		setTitleDraft(nextTitle);
		if (activeNoteId) {
			if (nextTitle.trim() === (activeNote?.title ?? savedNoteSnapshot.title)) {
				delete titleOverridesRef.current[activeNoteId];
			} else {
				titleOverridesRef.current[activeNoteId] = nextTitle;
			}
		}
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
		setTitleDraft(nextTitle);
		titleEditInitialRef.current = nextTitle;
		if (nextTitle === activeNote.title) {
			delete titleOverridesRef.current[activeNote.id];
			return;
		}
		titleOverridesRef.current[activeNote.id] = nextTitle;
	};

	const handleSaveActiveNote = async () => {
		if (!activeNote || isActiveNoteDeleted || isSavingDraft) {
			return false;
		}
		const nextTitle = titleDraft.trim();
		const contentToSave = draft;
		if (!nextTitle) {
			setSaveErrorMessage("标题不能为空");
			setIsTitleEditing(true);
			return false;
		}

		setIsSavingDraft(true);
		setSaveErrorMessage("");
		try {
			const updated = await updateNote(activeNote.id, {
				title: nextTitle,
				folderId: activeNote.folderId,
				bodyText: contentToSave,
				excerpt: buildSummary(contentToSave),
			});
			void refreshTags();
			const next = toNoteItem(updated);
			upsertNoteByFilters(next);
			if (draftRef.current === contentToSave) {
				delete draftOverridesRef.current[activeNote.id];
				setDraft(next.content);
			}
			if (titleDraftRef.current.trim() === nextTitle) {
				delete titleOverridesRef.current[activeNote.id];
				setTitleDraft(next.title);
				titleEditInitialRef.current = next.title;
				setIsTitleEditing(false);
			}
			setSavedNoteSnapshot({
				noteId: next.id,
				title: next.title,
				content: next.content,
			});
			return true;
		} catch (error) {
			console.error("Failed to save note", error);
			setSaveErrorMessage(readErrorMessage(error));
			return false;
		} finally {
			setIsSavingDraft(false);
		}
	};

	const ensureActiveNoteSaved = async () => {
		const hasDraftOverride = Boolean(activeNoteId && draftOverridesRef.current[activeNoteId] !== undefined);
		const hasTitleOverride = Boolean(activeNoteId && titleOverridesRef.current[activeNoteId] !== undefined);
		if (!hasDraftOverride && !hasTitleOverride) {
			return true;
		}
		return handleSaveActiveNote();
	};

	const persistActiveNoteTags = async (nextTagNamesInput: string[]) => {
		if (!activeNote || isActiveNoteDeleted || isUpdatingNoteTags) {
			return false;
		}
		const nextTagNames = dedupeTagNames(nextTagNamesInput);
		if (areTagNameListsEqual(activeNote.tags, nextTagNames)) {
			setTagErrorMessage("");
			return true;
		}

		setIsUpdatingNoteTags(true);
		setTagErrorMessage("");
		try {
			const updated = await updateNote(activeNote.id, { tagNames: nextTagNames });
			const next = toNoteItem(updated);
			upsertNoteByFilters(next);
			await refreshTags();
			return true;
		} catch (error) {
			setTagErrorMessage(readErrorMessage(error));
			return false;
		} finally {
			setIsUpdatingNoteTags(false);
		}
	};

	const handleAddTagToActiveNote = async (rawTagName: string) => {
		if (!activeNote) {
			return false;
		}
		const nextTagName = rawTagName.trim();
		if (!nextTagName) {
			return false;
		}
		return persistActiveNoteTags([...activeNote.tags, nextTagName]);
	};

	const handleRemoveTagFromActiveNote = async (tagName: string) => {
		if (!activeNote) {
			return false;
		}
		return persistActiveNoteTags(
			activeNote.tags.filter((item) => item.toLowerCase() !== tagName.toLowerCase()),
		);
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
		const saved = await ensureActiveNoteSaved();
		if (!saved) {
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
		const saved = await ensureActiveNoteSaved();
		if (!saved) {
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
			titleEditInitialRef.current = nextTitle;
			setSavedNoteSnapshot((prev) => (prev.noteId === next.id ? { ...prev, title: next.title } : prev));
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
		const saved = await ensureActiveNoteSaved();
		if (!saved) {
			return;
		}
		const selectedTags = [...new Set(selectedAiTagNames.map((item) => item.trim()).filter((item) => item.length > 0))];
		if (selectedTags.length === 0) {
			return;
		}
		const mergedTagNames = dedupeTagNames([...activeNote.tags, ...selectedTags]);
		if (areTagNameListsEqual(activeNote.tags, mergedTagNames)) {
			return;
		}
		setIsApplyingAiTags(true);
		setAiErrorMessage("");
		try {
			const savedTags = await persistActiveNoteTags(mergedTagNames);
			if (!savedTags) {
				return;
			}
		} catch (error) {
			setAiErrorMessage(readErrorMessage(error));
		} finally {
			setIsApplyingAiTags(false);
		}
	};

	const toggleAiTagSelection = (tagName: string) => {
		setSelectedAiTagNames((prev) =>
			prev.includes(tagName)
				? prev.filter((item) => item !== tagName)
				: [...prev, tagName],
		);
	};

	const selectAllAiTags = () => {
		setSelectedAiTagNames(
			(aiEnhanceResult?.tagSuggestions ?? [])
				.map((item) => item.name.trim())
				.filter((item) => item.length > 0),
		);
	};

	const clearAiTagSelection = () => {
		setSelectedAiTagNames([]);
	};

	const handleApplyAiRelations = async () => {
		if (!activeNote || isActiveNoteDeleted || isApplyingAiRelations || !aiEnhanceResult) {
			return;
		}
		const saved = await ensureActiveNoteSaved();
		if (!saved) {
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

	const handleCaptureSubmit = async (options: { resolveUrlAfterCreate: boolean }) => {
		const content = captureInput.trim();
		if (!content || isSubmittingCapture) {
			return;
		}
		setCaptureActionMessage("");
		if (options.resolveUrlAfterCreate) {
			setIsResolvingCaptureUrl(true);
		} else {
			setIsCreatingNote(true);
		}
		try {
			const created = await createNote({
				title: buildTitle(content),
				folderId: captureFolderId,
				bodyText: content,
				tagNames: captureTagNames,
			});
			let finalNote = created;
			if (options.resolveUrlAfterCreate && captureInputSourceUrl) {
				const result = await resolveNoteUrl(created.id);
				finalNote = result.note;
				if (!result.resolved) {
					setCaptureActionMessage(
						`解析失败，已保留原 URL${result.fallbackReason ? `：${result.fallbackReason}` : ""}`,
					);
				}
			}
			void refreshTags();
			const next = toNoteItem(finalNote);
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
			setCaptureTagNames([]);
		} catch (error) {
			setCaptureActionMessage(readErrorMessage(error));
		} finally {
			if (options.resolveUrlAfterCreate) {
				setIsResolvingCaptureUrl(false);
			} else {
				setIsCreatingNote(false);
			}
		}
	};

	const handleCaptureSend = async () => {
		await handleCaptureSubmit({ resolveUrlAfterCreate: false });
	};

	const handleCaptureResolveSend = async () => {
		await handleCaptureSubmit({ resolveUrlAfterCreate: true });
	};

	const handleAddCaptureTag = (rawTagName: string): boolean => {
		const normalized = normalizeTagNamePreview(rawTagName, FRONTEND_TAG_NAME_MAX_LENGTH);
		if (!normalized) {
			return false;
		}
		let added = false;
		setCaptureTagNames((prev) => {
			const next = dedupeTagNames([...prev, normalized]);
			added = next.length > prev.length;
			return next;
		});
		return added;
	};

	const handleRemoveCaptureTag = (tagName: string) => {
		setCaptureTagNames((prev) => prev.filter((item) => item.toLowerCase() !== tagName.toLowerCase()));
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

	const openNoteFromRelation = async (noteId: string) => {
		const existing = noteItemsRef.current.find((note) => note.id === noteId) ?? null;
		if (existing) {
			setNoteActionMessage("");
			focusNote(noteId);
			return;
		}

		try {
			const fetched = toNoteItem(await getNote(noteId));
			const openedOutsideFilters =
				selectedTagIdsRef.current.length > 0 || !matchesStatusFilter(fetched, noteStatusFilter);

			setNoteItems((prev) => [fetched, ...prev.filter((note) => note.id !== fetched.id)]);
			setNoteActionMessage(openedOutsideFilters ? "已在当前标签打开关联笔记；它当前不在筛选结果里。" : "");
			focusNote(fetched.id);
		} catch (error) {
			setNoteActionMessage(readErrorMessage(error));
		}
	};

	const handleMoveActiveNote = async (folderId: string) => {
		if (!activeNote || !folderId || folderId === activeNote.folderId || isMovingNote || isSavingDraft) {
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

	const handleResolveActiveNoteUrl = async () => {
		if (!activeNote || activeNote.deletedAt || !activeNoteSourceUrl || isResolvingNoteUrl || isSavingDraft) {
			return;
		}
		setNoteActionMessage("");
		setIsResolvingNoteUrl(true);
		try {
			const saved = await ensureActiveNoteSaved();
			if (!saved) {
				return;
			}
			const result = await resolveNoteUrl(activeNote.id);
			const next = toNoteItem(result.note);
			upsertNoteByFilters(next);
			delete draftOverridesRef.current[activeNote.id];
			delete titleOverridesRef.current[activeNote.id];
			setDraft(next.content);
			setTitleDraft(next.title);
			titleEditInitialRef.current = next.title;
			setSavedNoteSnapshot({
				noteId: next.id,
				title: next.title,
				content: next.content,
			});
			setNoteActionMessage(
				result.resolved
					? ""
					: `解析失败，已保留原 URL${result.fallbackReason ? `：${result.fallbackReason}` : ""}`,
			);
		} catch (error) {
			setNoteActionMessage(readErrorMessage(error));
		} finally {
			setIsResolvingNoteUrl(false);
		}
	};

	const handleToggleArchiveActiveNote = async () => {
		if (!activeNote || activeNote.deletedAt || isArchivingNote || isSavingDraft) {
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
		if (!activeNote || !activeNote.deletedAt || isRestoringNote || isSavingDraft) {
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
		if (!activeNote || isDeletingNote || isSavingDraft) {
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

		setIsDeletingNote(true);
		try {
			if (isHardDelete) {
				await hardDeleteNote(deletingId);
			} else {
				await deleteNote(deletingId);
			}
			delete draftOverridesRef.current[deletingId];
			delete titleOverridesRef.current[deletingId];
			removeNoteFromListById(deletingId);
			await refreshTags();
		} catch (error) {
			console.error("Failed to delete note", error);
		} finally {
			setIsDeletingNote(false);
		}
	};

	const handleCopyActiveNoteContent = async () => {
		if (!activeNote || copyState === "copying") {
			return;
		}
		setCopyState("copying");
		try {
			await writeTextToClipboard(draftRef.current);
			setCopyState("copied");
		} catch (error) {
			console.error("Failed to copy note content", error);
			setCopyState("failed");
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
	const normalizedTitleDraft = titleDraft.trim();
	const hasUnsavedChanges = Boolean(
		activeNote &&
		(draft !== savedNoteSnapshot.content || normalizedTitleDraft !== savedNoteSnapshot.title),
	);
	const canSaveActiveNote = Boolean(
		activeNote &&
		!isActiveNoteDeleted &&
		!isSavingDraft &&
		!isDeletingNote &&
		!isArchivingNote &&
		!isRestoringNote &&
		!isResolvingNoteUrl &&
		normalizedTitleDraft.length > 0 &&
		hasUnsavedChanges,
	);
	const canCopyActiveNote = Boolean(activeNote) && copyState !== "copying";
	const copyButtonLabel = copyState === "copying"
		? "复制中..."
		: copyState === "copied"
			? "已复制"
			: copyState === "failed"
				? "复制失败"
				: "复制正文";
	const saveStateText = isSavingDraft ? "保存中..." : saveErrorMessage ? "保存失败" : hasUnsavedChanges ? "未保存" : "已保存";
	const focusEditorMinHeight = getFocusEditorMinHeight(draft);
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
	const acceptedRelations = noteRelations.filter((item) => item.status === "accepted");

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
									placeholder="随手记一条"
									className="h-28 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:ring"
								/>
								<div className="mt-3">
									<CaptureTagEditor
										tagNames={captureTagNames}
										tagItems={tagItems}
										disabled={isSubmittingCapture}
										onAddTag={handleAddCaptureTag}
										onRemoveTag={handleRemoveCaptureTag}
									/>
								</div>
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
										<div className="flex items-center gap-2">
											{captureInputSourceUrl ? (
												<button
													onClick={handleCaptureResolveSend}
													disabled={isSubmittingCapture}
													className={`rounded-xl border border-sky-200 px-4 py-2 text-sm font-medium text-sky-700 hover:bg-sky-50 ${
														isSubmittingCapture ? "cursor-not-allowed opacity-60" : ""
													}`}
												>
													{isResolvingCaptureUrl ? "解析中..." : "解析并发送"}
												</button>
											) : null}
											<button
												onClick={handleCaptureSend}
												disabled={isSubmittingCapture}
												className={`rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 ${
													isSubmittingCapture ? "cursor-not-allowed opacity-60" : ""
												}`}
											>
												{isCreatingNote ? "发送中..." : "发送"}
											</button>
										</div>
								</div>
								{captureActionMessage ? (
									<p className="mt-3 text-xs text-amber-700">{captureActionMessage}</p>
								) : null}
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
														<p className="truncate text-lg font-semibold tracking-tight">{titleDraft || activeNote.title}</p>
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
											onClick={() => void handleSaveActiveNote()}
											disabled={!canSaveActiveNote}
											className={`rounded-lg border px-3 py-2 text-xs font-medium ${
												!canSaveActiveNote
													? "cursor-not-allowed border-slate-200 text-slate-300"
													: "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
											}`}
										>
											{isSavingDraft ? "保存中..." : hasUnsavedChanges ? "保存" : "已保存"}
										</button>
										<button
											type="button"
											onClick={() => void handleCopyActiveNoteContent()}
											disabled={!canCopyActiveNote}
											className={`rounded-lg border px-3 py-2 text-xs font-medium ${
												!canCopyActiveNote
													? "cursor-not-allowed border-slate-200 text-slate-300"
													: copyState === "copied"
														? "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
														: copyState === "failed"
															? "border-rose-200 text-rose-600 hover:bg-rose-50"
															: "border-slate-200 text-slate-600 hover:bg-slate-100"
											}`}
										>
											{copyButtonLabel}
										</button>
										<button
											type="button"
											onClick={toggleFocusFullscreen}
											className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
										>
											{isFocusFullscreen ? "退出全屏" : "全屏"}
										</button>
										{canResolveActiveNoteUrl ? (
											<button
												type="button"
												onClick={handleResolveActiveNoteUrl}
												disabled={!activeNote || isResolvingNoteUrl || isDeletingNote || isArchivingNote || isRestoringNote || isSavingDraft}
												className={`rounded-lg border px-3 py-2 text-xs font-medium ${
													!activeNote || isResolvingNoteUrl || isDeletingNote || isArchivingNote || isRestoringNote || isSavingDraft
														? "cursor-not-allowed border-slate-200 text-slate-300"
														: "border-sky-200 text-sky-700 hover:bg-sky-50"
												}`}
											>
												{isResolvingNoteUrl ? "解析中..." : "解析 URL"}
											</button>
										) : null}
										{canArchiveActiveNote ? (
											<button
												type="button"
												onClick={handleToggleArchiveActiveNote}
												disabled={!activeNote || isArchivingNote || isDeletingNote || isRestoringNote || isSavingDraft}
												className={`rounded-lg border px-3 py-2 text-xs font-medium ${
													!activeNote || isArchivingNote || isDeletingNote || isRestoringNote || isSavingDraft
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
												disabled={!activeNote || isRestoringNote || isDeletingNote || isSavingDraft}
												className={`rounded-lg border px-3 py-2 text-xs font-medium ${
													!activeNote || isRestoringNote || isDeletingNote || isSavingDraft
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
											disabled={!activeNote || isDeletingNote || isArchivingNote || isRestoringNote || isSavingDraft}
											className={`rounded-lg border px-3 py-2 text-xs font-medium ${
												!activeNote || isDeletingNote || isArchivingNote || isRestoringNote || isSavingDraft
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
										{noteActionMessage ? (
											<p className="mt-2 text-xs text-amber-700">{noteActionMessage}</p>
										) : null}
										{saveErrorMessage ? (
											<p className="mt-2 text-xs text-rose-600">{saveErrorMessage}</p>
										) : null}
										<div className="mt-3">
											<NoteTagEditor
												key={`desktop-${activeNote?.id ?? "empty"}`}
												note={activeNote}
												tagItems={tagItems}
												disabled={!activeNote || isActiveNoteDeleted || isDeletingNote || isArchivingNote || isRestoringNote || isSavingDraft}
												isSaving={isUpdatingNoteTags}
												errorMessage={tagErrorMessage}
												onAddTag={handleAddTagToActiveNote}
												onRemoveTag={handleRemoveTagFromActiveNote}
											/>
										</div>
									<div className="mt-3 flex items-center gap-2">
										<select
											value={activeNoteFolderId}
											onChange={(event) => void handleMoveActiveNote(event.target.value)}
											disabled={!activeNote || isMovingNote || isActiveNoteDeleted || isSavingDraft}
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
									</div>
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
											style={{ minHeight: focusEditorMinHeight }}
											className={`min-h-0 flex-1 overflow-hidden bg-white [&_.cm-content]:min-h-full [&_.cm-editor]:h-full [&_.cm-editor]:min-h-full [&_.cm-scroller]:min-h-full [&_.cm-scroller]:overflow-auto [&_.cm-theme]:h-full ${
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
											style={{ minHeight: focusEditorMinHeight }}
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
												style={{ minHeight: focusEditorMinHeight }}
												className={`min-h-0 overflow-hidden bg-white [&_.cm-content]:min-h-full [&_.cm-editor]:h-full [&_.cm-editor]:min-h-full [&_.cm-scroller]:min-h-full [&_.cm-scroller]:overflow-auto [&_.cm-theme]:h-full ${
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
												style={{ minHeight: focusEditorMinHeight }}
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
									<RelationSummaryPanel
										isLoading={isLoadingNoteRelations}
										items={acceptedRelations}
										onOpenNote={openNoteFromRelation}
										mutatingRelationId={mutatingRelationId}
										onUpdateRelationType={handleUpdateRelationType}
										onDeleteRelation={handleDeleteRelation}
									/>
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
								<div className="mt-2">
									<CaptureTagEditor
										tagNames={captureTagNames}
										tagItems={tagItems}
										disabled={isSubmittingCapture}
										onAddTag={handleAddCaptureTag}
										onRemoveTag={handleRemoveCaptureTag}
									/>
								</div>
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
										<div className="flex items-center gap-2">
											{captureInputSourceUrl ? (
												<button
													onClick={handleCaptureResolveSend}
													disabled={isSubmittingCapture}
													className={`rounded-xl border border-sky-200 px-3 py-2 text-sm font-medium text-sky-700 ${
														isSubmittingCapture ? "cursor-not-allowed opacity-60" : ""
													}`}
												>
													{isResolvingCaptureUrl ? "解析中" : "解析"}
												</button>
											) : null}
											<button
												onClick={handleCaptureSend}
												disabled={isSubmittingCapture}
												className={`rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white ${
													isSubmittingCapture ? "cursor-not-allowed opacity-60" : ""
												}`}
											>
												{isCreatingNote ? "发送中..." : "发送"}
											</button>
										</div>
								</div>
								{captureActionMessage ? (
									<p className="mt-2 text-xs text-amber-700">{captureActionMessage}</p>
								) : null}
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
													<p className="truncate text-sm font-semibold">{titleDraft || activeNote.title}</p>
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
										onClick={() => void handleSaveActiveNote()}
										disabled={!canSaveActiveNote}
										className={`rounded-lg border px-2 py-1 text-xs ${
											!canSaveActiveNote
												? "cursor-not-allowed border-slate-200 text-slate-300"
												: "border-emerald-200 text-emerald-700"
										}`}
									>
										{isSavingDraft ? "保存中" : hasUnsavedChanges ? "保存" : "已保存"}
									</button>
									<button
										type="button"
										onClick={() => void handleCopyActiveNoteContent()}
										disabled={!canCopyActiveNote}
										className={`rounded-lg border px-2 py-1 text-xs ${
											!canCopyActiveNote
												? "cursor-not-allowed border-slate-200 text-slate-300"
												: copyState === "copied"
													? "border-emerald-200 text-emerald-700"
													: copyState === "failed"
														? "border-rose-200 text-rose-600"
														: "border-slate-200 text-slate-600"
										}`}
									>
										{copyButtonLabel}
									</button>
									<button
										type="button"
										onClick={toggleFocusFullscreen}
										className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600"
									>
										{isFocusFullscreen ? "退出全屏" : "全屏"}
									</button>
									{canResolveActiveNoteUrl ? (
										<button
											type="button"
											onClick={handleResolveActiveNoteUrl}
											disabled={!activeNote || isResolvingNoteUrl || isDeletingNote || isArchivingNote || isRestoringNote || isSavingDraft}
											className={`rounded-lg border px-2 py-1 text-xs ${
												!activeNote || isResolvingNoteUrl || isDeletingNote || isArchivingNote || isRestoringNote || isSavingDraft
													? "cursor-not-allowed border-slate-200 text-slate-300"
													: "border-sky-200 text-sky-700"
											}`}
										>
											{isResolvingNoteUrl ? "解析中" : "解析 URL"}
										</button>
									) : null}
									{canArchiveActiveNote ? (
										<button
											type="button"
											onClick={handleToggleArchiveActiveNote}
											disabled={!activeNote || isArchivingNote || isDeletingNote || isRestoringNote || isSavingDraft}
											className={`rounded-lg border px-2 py-1 text-xs ${
												!activeNote || isArchivingNote || isDeletingNote || isRestoringNote || isSavingDraft
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
											disabled={!activeNote || isRestoringNote || isDeletingNote || isSavingDraft}
											className={`rounded-lg border px-2 py-1 text-xs ${
												!activeNote || isRestoringNote || isDeletingNote || isSavingDraft
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
										disabled={!activeNote || isDeletingNote || isArchivingNote || isRestoringNote || isSavingDraft}
										className={`rounded-lg border px-2 py-1 text-xs ${
											!activeNote || isDeletingNote || isArchivingNote || isRestoringNote || isSavingDraft
												? "cursor-not-allowed border-slate-200 text-slate-300"
												: "border-rose-200 text-rose-600"
										}`}
									>
										{isDeletingNote ? "处理中" : activeNote?.deletedAt ? "永久删除" : "移入回收站"}
									</button>
									</div>
									</div>
								{noteActionMessage ? (
									<p className="mb-2 text-xs text-amber-700">{noteActionMessage}</p>
								) : null}
								{saveErrorMessage ? (
									<p className="mb-2 text-xs text-rose-600">{saveErrorMessage}</p>
								) : null}
								<p className="mb-2 text-xs text-slate-500">
									{activeNote?.updatedAt ? formatUpdatedAt(activeNote.updatedAt) : ""} · {saveStateText} · {noteStatusLabel}
								</p>
								<div className="mb-2">
									<NoteTagEditor
										key={`mobile-${activeNote?.id ?? "empty"}`}
										note={activeNote}
										tagItems={tagItems}
										disabled={!activeNote || isActiveNoteDeleted || isDeletingNote || isArchivingNote || isRestoringNote || isSavingDraft}
										isSaving={isUpdatingNoteTags}
										errorMessage={tagErrorMessage}
										onAddTag={handleAddTagToActiveNote}
										onRemoveTag={handleRemoveTagFromActiveNote}
									/>
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
										disabled={!activeNote || isMovingNote || isActiveNoteDeleted || isSavingDraft}
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
								</div>
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
										style={{ minHeight: focusEditorMinHeight }}
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
									<RelationSummaryPanel
										isLoading={isLoadingNoteRelations}
										items={acceptedRelations}
										onOpenNote={openNoteFromRelation}
										mutatingRelationId={mutatingRelationId}
										onUpdateRelationType={handleUpdateRelationType}
										onDeleteRelation={handleDeleteRelation}
									/>
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
						tagItems={tagItems}
						selectedAiTagNames={selectedAiTagNames}
						noteRelations={noteRelations}
						isLoadingRelations={isLoadingNoteRelations}
						mutatingRelationId={mutatingRelationId}
						onApplyTitle={handleApplyAiTitle}
						onApplyTags={handleApplyAiTags}
						onToggleTag={toggleAiTagSelection}
						onSelectAllTags={selectAllAiTags}
						onClearTagSelection={clearAiTagSelection}
						onApplyRelations={handleApplyAiRelations}
						onAcceptSuggestion={handleAcceptAiRelationSuggestion}
						onUpdateRelationType={handleUpdateRelationType}
						onAcceptRelation={handleAcceptRelation}
						onRejectRelation={handleRejectRelation}
						onDeleteRelation={handleDeleteRelation}
						isApplyingTitle={isApplyingAiTitle}
						isApplyingTags={isApplyingAiTags}
						isApplyingRelations={isApplyingAiRelations}
						onOpenNote={openNoteFromRelation}
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
							tagItems={tagItems}
							selectedAiTagNames={selectedAiTagNames}
							noteRelations={noteRelations}
							isLoadingRelations={isLoadingNoteRelations}
							mutatingRelationId={mutatingRelationId}
							onApplyTitle={handleApplyAiTitle}
							onApplyTags={handleApplyAiTags}
							onToggleTag={toggleAiTagSelection}
							onSelectAllTags={selectAllAiTags}
							onClearTagSelection={clearAiTagSelection}
							onApplyRelations={handleApplyAiRelations}
							onAcceptSuggestion={handleAcceptAiRelationSuggestion}
							onUpdateRelationType={handleUpdateRelationType}
							onAcceptRelation={handleAcceptRelation}
							onRejectRelation={handleRejectRelation}
							onDeleteRelation={handleDeleteRelation}
							isApplyingTitle={isApplyingAiTitle}
							isApplyingTags={isApplyingAiTags}
							isApplyingRelations={isApplyingAiRelations}
							onOpenNote={openNoteFromRelation}
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

function extractSingleUrl(input: string): string | null {
	const trimmed = input.trim();
	if (!trimmed || /\s/u.test(trimmed)) {
		return null;
	}
	try {
		const url = new URL(trimmed);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return null;
		}
		return url.toString();
	} catch {
		return null;
	}
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

function NoteTagEditor(props: {
	note: NoteItem | null;
	tagItems: TagApiItem[];
	disabled: boolean;
	isSaving: boolean;
	errorMessage: string;
	onAddTag: (tagName: string) => Promise<boolean>;
	onRemoveTag: (tagName: string) => Promise<boolean>;
}) {
	const { note, tagItems, disabled, isSaving, errorMessage, onAddTag, onRemoveTag } = props;
	const [inputValue, setInputValue] = useState("");
	const activeTagNameSet = useMemo(
		() => new Set((note?.tags ?? []).map((item) => item.toLowerCase())),
		[note?.tags],
	);
	const existingTagNameSet = useMemo(
		() => new Set(tagItems.map((item) => item.name.toLowerCase())),
		[tagItems],
	);
	const normalizedInputValue = useMemo(
		() => normalizeTagNamePreview(inputValue, FRONTEND_TAG_NAME_MAX_LENGTH),
		[inputValue],
	);
	const normalizedInputState = useMemo(() => {
		const rawValue = inputValue.trim();
		if (!rawValue) {
			return "";
		}
		if (!normalizedInputValue) {
			return "当前输入在归一化后为空，无法保存";
		}
		if (activeTagNameSet.has(normalizedInputValue.toLowerCase())) {
			return `当前笔记已有 #${normalizedInputValue}`;
		}
		if (normalizedInputValue !== rawValue) {
			return `将保存为 #${normalizedInputValue}`;
		}
		if (existingTagNameSet.has(normalizedInputValue.toLowerCase())) {
			return `将复用已有标签 #${normalizedInputValue}`;
		}
		return `将创建新标签 #${normalizedInputValue}`;
	}, [activeTagNameSet, existingTagNameSet, inputValue, normalizedInputValue]);
	const filteredSuggestions = useMemo(() => {
		const keyword = inputValue.trim().toLowerCase();
		if (!keyword) {
			return [];
		}
		return tagItems
			.filter((tag) => !activeTagNameSet.has(tag.name.toLowerCase()))
			.filter((tag) => tag.name.toLowerCase().includes(keyword))
			.slice(0, 6);
	}, [activeTagNameSet, inputValue, tagItems]);

	const submitTag = async (rawTagName: string) => {
		const nextTagName = rawTagName.trim();
		if (!nextTagName || !normalizeTagNamePreview(nextTagName, FRONTEND_TAG_NAME_MAX_LENGTH) || disabled || isSaving) {
			return;
		}
		const saved = await onAddTag(nextTagName);
		if (saved) {
			setInputValue("");
		}
	};

	return (
		<div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
			<div className="flex items-center justify-between gap-3">
				<p className="text-xs font-semibold uppercase tracking-wide text-slate-500">标签</p>
				<span className="text-[11px] text-slate-400">{isSaving ? "保存中..." : `${note?.tags.length ?? 0} 个`}</span>
			</div>
			<div className="mt-2 flex flex-wrap gap-2">
				{!note || note.tags.length === 0 ? (
					<span className="rounded-md bg-white px-2 py-1 text-xs text-slate-400">暂无标签</span>
				) : (
					note.tags.map((tag) => (
						<span
							key={tag}
							className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-xs text-slate-700"
						>
							<span>#{tag}</span>
							<button
								type="button"
								onClick={() => void onRemoveTag(tag)}
								disabled={disabled || isSaving}
								aria-label={`删除标签 ${tag}`}
								className={`rounded-full px-1 leading-none ${
									disabled || isSaving
										? "cursor-not-allowed text-slate-300"
										: "text-slate-400 hover:bg-slate-100 hover:text-rose-600"
								}`}
							>
								×
							</button>
						</span>
					))
				)}
			</div>
			<div className="mt-3 flex gap-2">
				<input
					type="text"
					value={inputValue}
					onChange={(event) => setInputValue(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							void submitTag(inputValue);
						}
					}}
					placeholder="输入标签后回车"
					disabled={disabled || isSaving || !note}
					className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100"
				/>
				<button
					type="button"
					onClick={() => void submitTag(inputValue)}
					disabled={disabled || isSaving || !note || inputValue.trim().length === 0 || normalizedInputValue.length === 0}
					className={`rounded-lg border px-3 py-2 text-xs font-medium ${
						disabled || isSaving || !note || inputValue.trim().length === 0 || normalizedInputValue.length === 0
							? "cursor-not-allowed border-slate-200 text-slate-300"
							: "border-slate-300 text-slate-700 hover:bg-white"
					}`}
				>
					添加
				</button>
			</div>
			{normalizedInputState ? (
				<p className="mt-2 text-[11px] text-slate-500">{normalizedInputState}</p>
			) : null}
			{filteredSuggestions.length > 0 ? (
				<div className="mt-2 flex flex-wrap gap-2">
					{filteredSuggestions.map((tag) => (
						<button
							key={tag.id}
							type="button"
							onClick={() => void submitTag(tag.name)}
							disabled={disabled || isSaving}
							className={`rounded-full border px-2 py-1 text-xs ${
								disabled || isSaving
									? "cursor-not-allowed border-slate-200 text-slate-300"
									: "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"
							}`}
						>
							使用 #{tag.name}
						</button>
					))}
				</div>
			) : null}
			{errorMessage ? <p className="mt-2 text-xs text-rose-600">{errorMessage}</p> : null}
		</div>
	);
}

function CaptureTagEditor(props: {
	tagNames: string[];
	tagItems: TagApiItem[];
	disabled: boolean;
	onAddTag: (tagName: string) => boolean;
	onRemoveTag: (tagName: string) => void;
}) {
	const { tagNames, tagItems, disabled, onAddTag, onRemoveTag } = props;
	const [inputValue, setInputValue] = useState("");
	const activeTagNameSet = useMemo(
		() => new Set(tagNames.map((item) => item.toLowerCase())),
		[tagNames],
	);
	const existingTagNameSet = useMemo(
		() => new Set(tagItems.map((item) => item.name.toLowerCase())),
		[tagItems],
	);
	const normalizedInputValue = useMemo(
		() => normalizeTagNamePreview(inputValue, FRONTEND_TAG_NAME_MAX_LENGTH),
		[inputValue],
	);
	const normalizedInputState = useMemo(() => {
		const rawValue = inputValue.trim();
		if (!rawValue) {
			return "可在发送前先补标签，回车即可加入。";
		}
		if (!normalizedInputValue) {
			return "当前输入在归一化后为空，无法加入";
		}
		if (activeTagNameSet.has(normalizedInputValue.toLowerCase())) {
			return `本次记录已选 #${normalizedInputValue}`;
		}
		if (normalizedInputValue !== rawValue) {
			return `加入后将保存为 #${normalizedInputValue}`;
		}
		if (existingTagNameSet.has(normalizedInputValue.toLowerCase())) {
			return `加入后将复用已有标签 #${normalizedInputValue}`;
		}
		return `加入后将创建新标签 #${normalizedInputValue}`;
	}, [activeTagNameSet, existingTagNameSet, inputValue, normalizedInputValue]);
	const filteredSuggestions = useMemo(() => {
		const keyword = inputValue.trim().toLowerCase();
		if (!keyword) {
			return [];
		}
		return tagItems
			.filter((tag) => !activeTagNameSet.has(tag.name.toLowerCase()))
			.filter((tag) => tag.name.toLowerCase().includes(keyword))
			.slice(0, 6);
	}, [activeTagNameSet, inputValue, tagItems]);

	const submitTag = (rawTagName: string) => {
		const nextTagName = rawTagName.trim();
		if (!nextTagName || !normalizeTagNamePreview(nextTagName, FRONTEND_TAG_NAME_MAX_LENGTH) || disabled) {
			return;
		}
		const added = onAddTag(nextTagName);
		if (added) {
			setInputValue("");
		}
	};

	return (
		<div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
			<div className="flex items-center justify-between gap-3">
				<p className="text-xs font-semibold uppercase tracking-wide text-slate-500">标签</p>
				<span className="text-[11px] text-slate-400">{tagNames.length} 个待发送</span>
			</div>
			<div className="mt-2 flex flex-wrap gap-2">
				{tagNames.length === 0 ? (
					<span className="rounded-md bg-white px-2 py-1 text-xs text-slate-400">未选择标签</span>
				) : (
					tagNames.map((tag) => (
						<span
							key={tag}
							className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-xs text-slate-700"
						>
							<span>#{tag}</span>
							<button
								type="button"
								onClick={() => onRemoveTag(tag)}
								disabled={disabled}
								aria-label={`删除标签 ${tag}`}
								className={`rounded-full px-1 leading-none ${
									disabled
										? "cursor-not-allowed text-slate-300"
										: "text-slate-400 hover:bg-slate-100 hover:text-rose-600"
								}`}
							>
								×
							</button>
						</span>
					))
				)}
			</div>
			<div className="mt-3 flex gap-2">
				<input
					type="text"
					value={inputValue}
					onChange={(event) => setInputValue(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							submitTag(inputValue);
							return;
						}
						if (event.key === "Backspace" && inputValue.length === 0 && tagNames.length > 0) {
							event.preventDefault();
							onRemoveTag(tagNames[tagNames.length - 1]);
						}
					}}
					placeholder="输入标签后回车"
					disabled={disabled}
					className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100"
				/>
				<button
					type="button"
					onClick={() => submitTag(inputValue)}
					disabled={disabled || inputValue.trim().length === 0 || normalizedInputValue.length === 0}
					className={`rounded-lg border px-3 py-2 text-xs font-medium ${
						disabled || inputValue.trim().length === 0 || normalizedInputValue.length === 0
							? "cursor-not-allowed border-slate-200 text-slate-300"
							: "border-slate-300 text-slate-700 hover:bg-white"
					}`}
				>
					加入
				</button>
			</div>
			<p className="mt-2 text-[11px] text-slate-500">{normalizedInputState}</p>
			{filteredSuggestions.length > 0 ? (
				<div className="mt-2 flex flex-wrap gap-2">
					{filteredSuggestions.map((tag) => (
						<button
							key={tag.id}
							type="button"
							onClick={() => submitTag(tag.name)}
							disabled={disabled}
							className={`rounded-full border px-2 py-1 text-xs ${
								disabled
									? "cursor-not-allowed border-slate-200 text-slate-300"
									: "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"
							}`}
						>
							加入 #{tag.name}
						</button>
					))}
				</div>
			) : null}
		</div>
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
								<a
									href={buildNotePreviewPath(item.otherNote.id)}
									target="_blank"
									rel="noreferrer"
									className="block truncate text-left text-xs font-medium text-slate-800 hover:text-sky-700"
								>
									{item.otherNote.title}
								</a>
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
								<button
									type="button"
									onClick={() => onOpenNote(item.otherNote.id)}
									className="rounded border border-sky-200 px-2 py-1 text-[11px] text-sky-700 hover:bg-sky-50"
								>
									当前标签跳转
								</button>
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
	tagItems: TagApiItem[];
	selectedAiTagNames: string[];
	noteRelations: NoteRelationApiItem[];
	isLoadingRelations: boolean;
	mutatingRelationId: string;
	onApplyTitle: (title: string) => void;
	onApplyTags: () => void;
	onToggleTag: (tagName: string) => void;
	onSelectAllTags: () => void;
	onClearTagSelection: () => void;
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
		tagItems,
		selectedAiTagNames,
		noteRelations,
		isLoadingRelations,
		mutatingRelationId,
		onApplyTitle,
		onApplyTags,
		onToggleTag,
		onSelectAllTags,
		onClearTagSelection,
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
	const existingTagNameSet = useMemo(
		() => new Set(tagItems.map((item) => item.name.toLowerCase())),
		[tagItems],
	);
	const activeTagNameSet = useMemo(
		() => new Set((activeNote?.tags ?? []).map((item) => item.toLowerCase())),
		[activeNote?.tags],
	);
	const tagSuggestions = result?.tagSuggestions ?? [];
	const selectedAiTagNameSet = useMemo(
		() => new Set(selectedAiTagNames.map((item) => item.toLowerCase())),
		[selectedAiTagNames],
	);
	const selectedTagCount = tagSuggestions.filter((item) => selectedAiTagNameSet.has(item.name.toLowerCase())).length;
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
								<div className="mb-2 flex items-start justify-between gap-3">
									<div>
										<p className="text-xs font-semibold text-slate-600">标签建议</p>
										<p className="mt-1 text-[11px] text-slate-400">
											已选 {selectedTagCount} / {tagSuggestions.length}
										</p>
									</div>
									<div className="flex flex-wrap justify-end gap-1">
										<button
											type="button"
											onClick={onSelectAllTags}
											disabled={isApplyingTags || tagSuggestions.length === 0}
											className={`rounded border px-2 py-1 text-[11px] ${
												isApplyingTags || tagSuggestions.length === 0
													? "cursor-not-allowed border-slate-200 text-slate-300"
													: "border-slate-300 text-slate-700 hover:bg-slate-100"
											}`}
										>
											全选
										</button>
										<button
											type="button"
											onClick={onClearTagSelection}
											disabled={isApplyingTags || selectedTagCount === 0}
											className={`rounded border px-2 py-1 text-[11px] ${
												isApplyingTags || selectedTagCount === 0
													? "cursor-not-allowed border-slate-200 text-slate-300"
													: "border-slate-300 text-slate-700 hover:bg-slate-100"
											}`}
										>
											清空
										</button>
										<button
											type="button"
											onClick={onApplyTags}
											disabled={isApplyingTags || selectedTagCount === 0}
											className={`rounded border px-2 py-1 text-[11px] ${
												isApplyingTags || selectedTagCount === 0
													? "cursor-not-allowed border-slate-200 text-slate-300"
													: "border-slate-300 text-slate-700 hover:bg-slate-100"
											}`}
										>
											{isApplyingTags ? "应用中..." : "应用所选"}
										</button>
									</div>
								</div>
								<div className="space-y-2">
									{tagSuggestions.length === 0 ? (
										<p className="text-xs text-slate-400">暂无建议</p>
									) : (
										tagSuggestions.map((item) => {
											const isSelected = selectedAiTagNameSet.has(item.name.toLowerCase());
											const isExistingOnNote = activeTagNameSet.has(item.name.toLowerCase());
											const existsGlobally = existingTagNameSet.has(item.name.toLowerCase());
											return (
												<label
													key={item.name}
													className={`flex cursor-pointer gap-2 rounded-lg border px-3 py-2 ${
														isSelected
															? "border-sky-300 bg-sky-50"
															: "border-slate-200 bg-white"
													}`}
												>
													<input
														type="checkbox"
														checked={isSelected}
														onChange={() => onToggleTag(item.name)}
														disabled={isApplyingTags}
														className="mt-0.5"
													/>
													<div className="min-w-0 flex-1">
														<div className="flex flex-wrap items-center gap-2">
															<span className="text-sm text-slate-800">#{item.name}</span>
															<span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
																{Math.round(item.confidence * 100)}%
															</span>
															<span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
																{isExistingOnNote ? "当前已有" : existsGlobally ? "复用已有" : "新标签"}
															</span>
														</div>
														<p className="mt-1 text-[11px] text-slate-500">{item.reason}</p>
													</div>
												</label>
											);
										})
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

async function writeTextToClipboard(value: string): Promise<void> {
	if (typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function") {
		await navigator.clipboard.writeText(value);
		return;
	}
	if (typeof document === "undefined") {
		throw new Error("Clipboard API is unavailable");
	}
	const textarea = document.createElement("textarea");
	textarea.value = value;
	textarea.setAttribute("readonly", "true");
	textarea.style.position = "fixed";
	textarea.style.opacity = "0";
	textarea.style.pointerEvents = "none";
	document.body.appendChild(textarea);
	try {
		textarea.focus();
		textarea.select();
		if (!document.execCommand("copy")) {
			throw new Error("execCommand copy failed");
		}
	} finally {
		document.body.removeChild(textarea);
	}
}

function getFocusEditorMinHeight(value: string): string {
	const lineCount = Math.max(value.split(/\r?\n/).length, 1);
	const visibleLines = Math.max(
		FOCUS_EDITOR_MIN_VISIBLE_LINES,
		Math.min(lineCount + FOCUS_EDITOR_EXTRA_VISIBLE_LINES, FOCUS_EDITOR_MAX_VISIBLE_LINES),
	);
	return `calc(${visibleLines} * 1.5rem + 1.5rem)`;
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

function dedupeTagNames(values: string[]): string[] {
	const unique = new Set<string>();
	const next: string[] = [];
	for (const value of values) {
		const trimmed = value.trim();
		const key = trimmed.toLowerCase();
		if (!trimmed || unique.has(key)) {
			continue;
		}
		unique.add(key);
		next.push(trimmed);
	}
	return next;
}

function normalizeTagNamePreview(value: string, maxLength: number): string {
	const trimmed = value.trim().toLowerCase();
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

function areTagNameListsEqual(left: string[], right: string[]): boolean {
	if (left.length !== right.length) {
		return false;
	}
	const rightSet = new Set(right.map((item) => item.toLowerCase()));
	return left.every((item) => rightSet.has(item.toLowerCase()));
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

function buildNotePreviewPath(noteId: string): string {
	return `/preview/${encodeURIComponent(noteId)}`;
}
