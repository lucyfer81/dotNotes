export type ImportNoteInput = {
	title: string;
	content: string;
	tags?: string[];
	folder?: string;
	folderId?: string;
};

export type ImportedTag = {
	id: string;
	name: string;
};

export type ImportedNote = {
	noteId: string;
	title: string;
	slug: string;
	folderId: string;
	created: true;
	tags: ImportedTag[];
};

type SuccessEnvelope<T> = {
	ok: true;
	data: T;
};

type ErrorEnvelope = {
	ok: false;
	error: string;
	details?: string;
};

export class DotNotesClientError extends Error {
	readonly status: number;
	readonly details?: string;

	constructor(message: string, status: number, details?: string) {
		super(message);
		this.name = "DotNotesClientError";
		this.status = status;
		this.details = details;
	}
}

export class DotNotesClient {
	private readonly baseUrl: string;
	private readonly sharedToken: string;
	private readonly fetchImpl: typeof fetch;

	constructor(options: {
		baseUrl: string;
		sharedToken: string;
		fetchImpl?: typeof fetch;
	}) {
		this.baseUrl = options.baseUrl.replace(/\/+$/, "");
		this.sharedToken = options.sharedToken;
		this.fetchImpl = options.fetchImpl ?? fetch;
	}

	async importNote(input: ImportNoteInput): Promise<ImportedNote> {
		const response = await this.fetchImpl(`${this.baseUrl}/api/internal/notes/imports`, {
			method: "POST",
			headers: {
				"Accept": "application/json",
				"Content-Type": "application/json",
				"x-dotfamily-internal-token": this.sharedToken,
			},
			body: JSON.stringify({
				title: input.title,
				content: input.content,
				tags: input.tags ?? [],
				folder: input.folder,
				folderId: input.folderId,
			}),
		});

		const payload = await response.json().catch(() => null) as
			| SuccessEnvelope<ImportedNote>
			| ErrorEnvelope
			| null;

		if (!response.ok || !payload || payload.ok !== true) {
			const errorMessage = payload && "error" in payload ? payload.error : "dotNotes import request failed";
			const errorDetails = payload && "details" in payload ? payload.details : undefined;
			throw new DotNotesClientError(errorMessage, response.status, errorDetails);
		}

		return payload.data;
	}
}

async function main() {
	const baseUrl = process.env.DOTNOTES_BASE_URL ?? "";
	const sharedToken = process.env.DOTNOTES_SHARED_TOKEN ?? "";
	if (!baseUrl || !sharedToken) {
		throw new Error("DOTNOTES_BASE_URL and DOTNOTES_SHARED_TOKEN are required");
	}

	const client = new DotNotesClient({ baseUrl, sharedToken });
	const created = await client.importNote({
		title: "TypeScript client example",
		content: "Imported from scripts/examples/dotnotes-client.ts",
		tags: ["example", "typescript"],
		folder: "00-Inbox",
	});

	console.log(JSON.stringify(created, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error: unknown) => {
		const message = error instanceof Error ? error.message : String(error);
		console.error(message);
		process.exitCode = 1;
	});
}
