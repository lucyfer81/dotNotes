type StoredVector = {
	id: string;
	values: number[];
	metadata?: Record<string, unknown>;
};

export class FakeVectorIndex {
	private readonly vectors = new Map<string, StoredVector>();

	async upsert(items: Array<{ id: string; values: ArrayLike<number>; metadata?: Record<string, unknown> }>) {
		for (const item of items) {
			this.vectors.set(item.id, {
				id: item.id,
				values: Array.from(item.values),
				metadata: item.metadata,
			});
		}
		return { ids: items.map((item) => item.id), count: items.length };
	}

	async deleteByIds(ids: string[]) {
		const removed: string[] = [];
		for (const id of ids) {
			if (this.vectors.delete(id)) {
				removed.push(id);
			}
		}
		return { ids: removed, count: removed.length };
	}

	async query(
		vector: ArrayLike<number>,
		options?: { topK?: number; returnMetadata?: boolean | string },
	): Promise<{
		matches: Array<{ id: string; score: number; metadata?: Record<string, unknown> }>;
		count: number;
	}> {
		const input = normalize(Array.from(vector));
		const topK = Math.max(1, options?.topK ?? 20);
		const scored = [...this.vectors.values()]
			.map((item) => ({
				id: item.id,
				score: cosine(input, normalize(item.values)),
				metadata: options?.returnMetadata ? item.metadata : undefined,
			}))
			.sort((a, b) => b.score - a.score)
			.slice(0, topK);
		return {
			matches: scored,
			count: scored.length,
		};
	}

	size(): number {
		return this.vectors.size;
	}
}

function normalize(values: number[]): number[] {
	let norm = 0;
	for (const value of values) {
		norm += value * value;
	}
	const denominator = Math.sqrt(norm) || 1;
	return values.map((value) => value / denominator);
}

function cosine(a: number[], b: number[]): number {
	const maxLength = Math.max(a.length, b.length);
	let dot = 0;
	for (let index = 0; index < maxLength; index += 1) {
		dot += (a[index] ?? 0) * (b[index] ?? 0);
	}
	return dot;
}
