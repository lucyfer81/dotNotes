import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getNote, type NoteApiItem } from "../lib/api";
import { formatMonthDayTime } from "../lib/datetime";
import type { Route } from "./+types/note-preview";

export function meta({ params }: Route.MetaArgs) {
	return [
		{ title: `笔记预览 ${params.noteId}` },
		{ name: "description", content: "dotNotes read-only note preview" },
	];
}

export default function NotePreview({ params }: Route.ComponentProps) {
	const [note, setNote] = useState<NoteApiItem | null>(null);
	const [errorMessage, setErrorMessage] = useState("");
	const [isLoading, setIsLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		setIsLoading(true);
		setErrorMessage("");
		void getNote(params.noteId)
			.then((item) => {
				if (!cancelled) {
					setNote(item);
				}
			})
			.catch((error) => {
				if (!cancelled) {
					setNote(null);
					setErrorMessage(readErrorMessage(error));
				}
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoading(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [params.noteId]);

	const handleClose = () => {
		if (typeof window === "undefined") {
			return;
		}
		window.close();
		window.setTimeout(() => {
			if (window.history.length > 1) {
				window.history.back();
				return;
			}
			window.location.assign("/");
		}, 120);
	};

	return (
		<main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900">
			<div className="mx-auto max-w-4xl rounded-3xl border border-slate-200 bg-white shadow-sm">
				<div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
					<div className="min-w-0">
						<p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">只读预览</p>
						<p className="mt-1 truncate text-lg font-semibold">
							{note?.title ?? (isLoading ? "加载中..." : "笔记预览")}
						</p>
						{note ? (
							<p className="mt-1 text-xs text-slate-500">
								最近更新 {formatMonthDayTime(note.updatedAt)}
							</p>
						) : null}
					</div>
					<button
						type="button"
						onClick={handleClose}
						className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
					>
						关闭
					</button>
				</div>

				<div className="px-5 py-5">
					{isLoading ? (
						<p className="text-sm text-slate-500">正在加载笔记...</p>
					) : null}
					{!isLoading && errorMessage ? (
						<div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
							{errorMessage}
						</div>
					) : null}
					{!isLoading && note ? (
						<>
							{note.tags.length > 0 ? (
								<div className="mb-4 flex flex-wrap gap-2">
									{note.tags.map((tag) => (
										<span key={tag.id} className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600">
											#{tag.name}
										</span>
									))}
								</div>
							) : null}
							<article className="max-w-none text-sm leading-7 text-slate-700 [&_a]:text-sky-700 [&_blockquote]:border-l-2 [&_blockquote]:border-slate-200 [&_blockquote]:pl-4 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:text-lg [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ol]:ml-5 [&_ol]:list-decimal [&_p]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-2xl [&_pre]:bg-slate-950 [&_pre]:p-4 [&_pre]:text-slate-100 [&_ul]:ml-5 [&_ul]:list-disc">
								<ReactMarkdown remarkPlugins={[remarkGfm]}>
									{note.bodyText?.trim() ? note.bodyText : "*（空白笔记）*"}
								</ReactMarkdown>
							</article>
						</>
					) : null}
				</div>
			</div>
		</main>
	);
}

function readErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	return "加载笔记失败";
}
