export interface MemoryMigration {
  version: number;
  name: string;
  sql: string;
}

export const memoryMigrations: MemoryMigration[] = [
  {
    version: 1,
    name: "initial_schema",
    sql: `
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        scope TEXT NOT NULL,
        session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        body TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        source_agent TEXT,
        project_id TEXT,
        repo_path TEXT,
        branch TEXT,
        importance REAL NOT NULL DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),
        confidence REAL NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
        status TEXT NOT NULL DEFAULT 'active',
        pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_accessed_at TEXT,
        expires_at TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        to_memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        relation TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (from_memory_id, to_memory_id, relation),
        CHECK (from_memory_id <> to_memory_id)
      );

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        repo_path TEXT,
        branch TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        summary TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        external_id TEXT,
        path_or_url TEXT,
        title TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE INDEX idx_memories_kind_scope ON memories(kind, scope);
      CREATE INDEX idx_memories_project_id ON memories(project_id);
      CREATE INDEX idx_memories_repo_path ON memories(repo_path);
      CREATE INDEX idx_memories_session_id ON memories(session_id);
      CREATE INDEX idx_links_from_memory_id ON links(from_memory_id);
      CREATE INDEX idx_links_to_memory_id ON links(to_memory_id);
      CREATE INDEX idx_sessions_project_id ON sessions(project_id);
      CREATE INDEX idx_sessions_repo_path ON sessions(repo_path);
      CREATE INDEX idx_artifacts_type ON artifacts(type);
      CREATE INDEX idx_artifacts_external_id ON artifacts(external_id);
    `,
  },
  {
    version: 2,
    name: "memory_fts5_index",
    sql: `
      CREATE VIRTUAL TABLE memory_fts USING fts5(
        title,
        summary,
        body,
        tags,
        tokenize='unicode61 remove_diacritics 2'
      );

      INSERT INTO memory_fts(rowid, title, summary, body, tags)
      SELECT rowid, title, summary, coalesce(body, ''), coalesce(tags_json, '[]')
      FROM memories;

      CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memory_fts(rowid, title, summary, body, tags)
        VALUES (new.rowid, new.title, new.summary, coalesce(new.body, ''), coalesce(new.tags_json, '[]'));
      END;

      CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, title, summary, body, tags)
        VALUES ('delete', old.rowid, old.title, old.summary, coalesce(old.body, ''), coalesce(old.tags_json, '[]'));
      END;

      CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, title, summary, body, tags)
        VALUES ('delete', old.rowid, old.title, old.summary, coalesce(old.body, ''), coalesce(old.tags_json, '[]'));
        INSERT INTO memory_fts(rowid, title, summary, body, tags)
        VALUES (new.rowid, new.title, new.summary, coalesce(new.body, ''), coalesce(new.tags_json, '[]'));
      END;
    `,
  },
  {
    version: 3,
    name: "memory_embeddings",
    sql: `
      CREATE TABLE memory_embeddings (
        memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL CHECK (dimensions > 0),
        vector_json TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX idx_memory_embeddings_model ON memory_embeddings(model);
      CREATE INDEX idx_memory_embeddings_content_hash ON memory_embeddings(content_hash);
    `,
  },
  {
    version: 4,
    name: "fix_memory_fts_update_delete_triggers",
    sql: `
      DROP TRIGGER IF EXISTS memories_ad;
      DROP TRIGGER IF EXISTS memories_au;

      CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
        DELETE FROM memory_fts WHERE rowid = old.rowid;
      END;

      CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
        DELETE FROM memory_fts WHERE rowid = old.rowid;
        INSERT INTO memory_fts(rowid, title, summary, body, tags)
        VALUES (new.rowid, new.title, new.summary, coalesce(new.body, ''), coalesce(new.tags_json, '[]'));
      END;
    `,
  },
];

export const LATEST_MEMORY_SCHEMA_VERSION = memoryMigrations.at(-1)?.version ?? 0;
