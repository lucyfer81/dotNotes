import Database from "better-sqlite3";

type SqlValue = string | number | null;

export class FakeD1Database {
	private readonly db: Database.Database;

	constructor() {
		this.db = new Database(":memory:");
		this.db.pragma("foreign_keys = ON");
	}

	prepare(sql: string): FakeD1PreparedStatement {
		return new FakeD1PreparedStatement(this.db, sql, []);
	}

	async batch(statements: FakeD1PreparedStatement[]) {
		const tx = this.db.transaction((items: FakeD1PreparedStatement[]) =>
			items.map((item) => item.runSync()),
		);
		return tx(statements);
	}

	async exec(sql: string): Promise<{ count: number; duration: number }> {
		this.db.exec(sql);
		return { count: 0, duration: 0 };
	}
}

export class FakeD1PreparedStatement {
	private readonly db: Database.Database;
	private readonly sql: string;
	private readonly params: SqlValue[];

	constructor(db: Database.Database, sql: string, params: SqlValue[]) {
		this.db = db;
		this.sql = sql;
		this.params = params;
	}

	bind(...params: SqlValue[]): FakeD1PreparedStatement {
		return new FakeD1PreparedStatement(this.db, this.sql, params);
	}

	async run() {
		return this.runSync();
	}

	runSync() {
		const info = this.db.prepare(this.sql).run(...this.params);
		return {
			success: true,
			meta: {
				changes: info.changes,
				last_row_id: Number(info.lastInsertRowid ?? 0),
			},
		};
	}

	async all<T = Record<string, unknown>>() {
		const results = this.db.prepare(this.sql).all(...this.params) as T[];
		return { success: true, results };
	}

	async first<T = Record<string, unknown>>(column?: string) {
		const row = this.db.prepare(this.sql).get(...this.params) as Record<string, unknown> | undefined;
		if (!row) {
			return null;
		}
		if (column) {
			return (row[column] as T | undefined) ?? null;
		}
		return row as T;
	}
}
