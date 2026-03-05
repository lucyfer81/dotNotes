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

	size(): number {
		return this.vectors.size;
	}
}
