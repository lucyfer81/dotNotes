PRAGMA foreign_keys = ON;

-- Folder tree for primary classification (single folder per note).
CREATE TABLE IF NOT EXISTS folders (
	id TEXT PRIMARY KEY,
	parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	slug TEXT NOT NULL,
	sort_order INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE(parent_id, name),
	UNIQUE(parent_id, slug)
);

-- Seed PARA root folders + Inbox.
INSERT OR IGNORE INTO folders (id, parent_id, name, slug, sort_order) VALUES
	('folder-00-inbox', NULL, '00-Inbox', '00-inbox', 0),
	('folder-10-projects', NULL, '10-Projects', '10-projects', 10),
	('folder-20-areas', NULL, '20-Areas', '20-areas', 20),
	('folder-30-resource', NULL, '30-Resource', '30-resource', 30),
	('folder-40-archive', NULL, '40-Archive', '40-archive', 40);

CREATE TABLE IF NOT EXISTS tags (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL COLLATE NOCASE UNIQUE,
	color TEXT NOT NULL DEFAULT '#64748b',
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notes (
	id TEXT PRIMARY KEY,
	slug TEXT NOT NULL UNIQUE,
	title TEXT NOT NULL,
	folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE RESTRICT,
	storage_type TEXT NOT NULL DEFAULT 'd1' CHECK (storage_type IN ('d1', 'r2')),
	body_text TEXT,
	body_r2_key TEXT,
	excerpt TEXT NOT NULL DEFAULT '',
	size_bytes INTEGER NOT NULL DEFAULT 0,
	word_count INTEGER NOT NULL DEFAULT 0,
	is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
	is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
	deleted_at TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CHECK (
		(storage_type = 'd1' AND body_text IS NOT NULL AND body_r2_key IS NULL) OR
		(storage_type = 'r2' AND body_text IS NULL AND body_r2_key IS NOT NULL)
	)
);

-- Full-text search index for notes (title/excerpt/body_text).
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
	title,
	excerpt,
	body_text,
	content='notes',
	content_rowid='rowid',
	tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS trg_notes_fts_insert
AFTER INSERT ON notes
FOR EACH ROW
BEGIN
	INSERT INTO notes_fts(rowid, title, excerpt, body_text)
	VALUES (NEW.rowid, NEW.title, NEW.excerpt, COALESCE(NEW.body_text, ''));
END;

CREATE TRIGGER IF NOT EXISTS trg_notes_fts_delete
AFTER DELETE ON notes
FOR EACH ROW
BEGIN
	INSERT INTO notes_fts(notes_fts, rowid, title, excerpt, body_text)
	VALUES ('delete', OLD.rowid, OLD.title, OLD.excerpt, COALESCE(OLD.body_text, ''));
END;

CREATE TRIGGER IF NOT EXISTS trg_notes_fts_update
AFTER UPDATE OF title, excerpt, body_text ON notes
FOR EACH ROW
BEGIN
	INSERT INTO notes_fts(notes_fts, rowid, title, excerpt, body_text)
	VALUES ('delete', OLD.rowid, OLD.title, OLD.excerpt, COALESCE(OLD.body_text, ''));
	INSERT INTO notes_fts(rowid, title, excerpt, body_text)
	VALUES (NEW.rowid, NEW.title, NEW.excerpt, COALESCE(NEW.body_text, ''));
END;

-- Ensure existing rows are indexed when schema is applied to a non-empty DB.
INSERT INTO notes_fts(notes_fts) VALUES ('rebuild');

-- Many-to-many tags for the second-level filter.
CREATE TABLE IF NOT EXISTS note_tags (
	note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
	tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (note_id, tag_id)
);

-- Stored note-to-note links, enables forward and backward links.
CREATE TABLE IF NOT EXISTS note_links (
	source_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
	target_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
	anchor_text TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (source_note_id, target_note_id),
	CHECK (source_note_id <> target_note_id)
);

-- Attachments and images stored in R2.
CREATE TABLE IF NOT EXISTS assets (
	id TEXT PRIMARY KEY,
	note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
	r2_key TEXT NOT NULL UNIQUE,
	file_name TEXT,
	mime_type TEXT NOT NULL,
	size_bytes INTEGER NOT NULL,
	width INTEGER,
	height INTEGER,
	sha256 TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Chunk metadata for Vectorize indexing.
CREATE TABLE IF NOT EXISTS note_chunks (
	id TEXT PRIMARY KEY,
	note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
	chunk_index INTEGER NOT NULL,
	chunk_text TEXT NOT NULL,
	token_count INTEGER NOT NULL DEFAULT 0,
	embedding_model TEXT,
	vector_id TEXT UNIQUE,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE (note_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS note_index_jobs (
	note_id TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
	action TEXT NOT NULL DEFAULT 'upsert' CHECK (action IN ('upsert', 'delete')),
	status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'success', 'failed')),
	attempt_count INTEGER NOT NULL DEFAULT 0,
	chunk_count INTEGER NOT NULL DEFAULT 0,
	last_error TEXT,
	next_retry_at TEXT,
	last_indexed_at TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_request_events (
	id TEXT PRIMARY KEY,
	path TEXT NOT NULL,
	method TEXT NOT NULL,
	status_code INTEGER NOT NULL,
	duration_ms INTEGER NOT NULL,
	is_error INTEGER NOT NULL DEFAULT 0 CHECK (is_error IN (0, 1)),
	is_search INTEGER NOT NULL DEFAULT 0 CHECK (is_search IN (0, 1)),
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rss_feeds (
	id TEXT PRIMARY KEY,
	url TEXT NOT NULL UNIQUE,
	title TEXT,
	enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
	last_fetched_at TEXT,
	last_error TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rss_items (
	id TEXT PRIMARY KEY,
	feed_id TEXT NOT NULL REFERENCES rss_feeds(id) ON DELETE CASCADE,
	source_id TEXT,
	dedupe_key TEXT NOT NULL,
	link TEXT,
	title TEXT,
	author TEXT,
	published_at TEXT,
	summary_raw TEXT NOT NULL DEFAULT '',
	summary_zh TEXT,
	status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'saved', 'ignored')),
	note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,
	reading_state TEXT NOT NULL DEFAULT 'idle' CHECK (reading_state IN ('idle', 'queued', 'processing', 'ready', 'failed')),
	reading_error TEXT,
	reading_attempt_count INTEGER NOT NULL DEFAULT 0,
	reading_requested_at TEXT,
	reading_started_at TEXT,
	reading_completed_at TEXT,
	fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE (feed_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_notes_folder_updated
	ON notes(folder_id, updated_at DESC)
	WHERE deleted_at IS NULL AND is_archived = 0;

CREATE INDEX IF NOT EXISTS idx_notes_deleted_at ON notes(deleted_at);
CREATE INDEX IF NOT EXISTS idx_note_tags_tag_note ON note_tags(tag_id, note_id);
CREATE INDEX IF NOT EXISTS idx_note_tags_note ON note_tags(note_id);
CREATE INDEX IF NOT EXISTS idx_note_links_target ON note_links(target_note_id);
CREATE INDEX IF NOT EXISTS idx_note_links_source ON note_links(source_note_id);
CREATE INDEX IF NOT EXISTS idx_assets_note ON assets(note_id);
CREATE INDEX IF NOT EXISTS idx_note_chunks_note ON note_chunks(note_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_note_index_jobs_status_retry
	ON note_index_jobs(status, next_retry_at, updated_at);
CREATE INDEX IF NOT EXISTS idx_api_request_events_created_at
	ON api_request_events(created_at);
CREATE INDEX IF NOT EXISTS idx_api_request_events_search_time
	ON api_request_events(is_search, created_at);
CREATE INDEX IF NOT EXISTS idx_rss_feeds_enabled_updated
	ON rss_feeds(enabled, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_rss_items_feed_published
	ON rss_items(feed_id, published_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rss_items_status_updated
	ON rss_items(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_rss_items_reading_queue
	ON rss_items(reading_state, reading_requested_at, updated_at);

CREATE TRIGGER IF NOT EXISTS trg_folders_updated_at
AFTER UPDATE ON folders
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
	UPDATE folders SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_notes_updated_at
AFTER UPDATE ON notes
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
	UPDATE notes SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_note_index_jobs_updated_at
AFTER UPDATE ON note_index_jobs
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
	UPDATE note_index_jobs SET updated_at = CURRENT_TIMESTAMP WHERE note_id = OLD.note_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_rss_feeds_updated_at
AFTER UPDATE ON rss_feeds
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
	UPDATE rss_feeds SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_rss_items_updated_at
AFTER UPDATE ON rss_items
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
	UPDATE rss_items SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

CREATE VIEW IF NOT EXISTS note_backlinks AS
SELECT
	target_note_id AS note_id,
	source_note_id AS linked_from_note_id,
	anchor_text,
	created_at
FROM note_links;
