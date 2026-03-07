export type IndexAction = "upsert" | "delete";
export type IndexJobStatus = "pending" | "processing" | "success" | "failed";

export type NoteIndexProcessResult = {
	noteId: string;
	action: IndexAction;
	status: "success" | "failed";
	chunkCount: number;
	error: string | null;
	attemptCount: number;
};

export type NoteRow = {
	id: string;
	slug: string;
	title: string;
	isArchived: number;
	deletedAt: string | null;
	bodyText: string | null;
};

export type NoteChunkRow = {
	id: string;
	noteId: string;
	chunkIndex: number;
	chunkText: string;
	tokenCount: number;
	embeddingModel: string | null;
	vectorId: string | null;
	createdAt: string;
};
