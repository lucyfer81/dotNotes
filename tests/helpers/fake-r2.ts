type StoredObject = {
	body: Uint8Array;
	contentType: string;
};

export class FakeR2Bucket {
	private readonly objects = new Map<string, StoredObject>();

	async put(key: string, value: ArrayBuffer | ArrayBufferView | string, options?: { httpMetadata?: { contentType?: string } }) {
		const bytes = toUint8Array(value);
		this.objects.set(key, {
			body: bytes,
			contentType: options?.httpMetadata?.contentType || "application/octet-stream",
		});
	}

	async get(key: string) {
		const found = this.objects.get(key);
		if (!found) {
			return null;
		}
		return {
			body: new Blob([found.body]),
			text: async () => new TextDecoder().decode(found.body),
			httpMetadata: {
				contentType: found.contentType,
			},
		};
	}

	async delete(key: string) {
		this.objects.delete(key);
	}
}

function toUint8Array(value: ArrayBuffer | ArrayBufferView | string): Uint8Array {
	if (typeof value === "string") {
		return new TextEncoder().encode(value);
	}
	if (value instanceof ArrayBuffer) {
		return new Uint8Array(value);
	}
	return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}
