import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  createDefaultMemoryEmbeddingAdapter,
  createMemoryContentForEmbedding,
  type GeneratedMemoryEmbedding,
  type MemoryEmbeddingAdapter,
  type MemoryEmbeddingRecord,
} from "./embeddings.ts";
import {
  type ArchiveMemoryInput,
  type CreateMemoryInput,
  type LinkMemoriesInput,
  type MemoryLinkRecord,
  type MemoryRecord,
  type MemorySearchResult,
  type SearchMemoriesInput,
  type UpdateMemoryInput,
  normalizeArchiveMemoryInput,
  normalizeCreateMemoryInput,
  normalizeLinkMemoriesInput,
  normalizeSearchMemoriesInput,
  normalizeUpdateMemoryInput,
} from "./memories.ts";
import {
  type MemoryEmbeddingRow,
  type MemoryRow,
  type SessionRow,
  mapMemoryEmbeddingRow,
  mapMemoryRow,
  mapSessionRow,
} from "./mappers.ts";
import { LATEST_MEMORY_SCHEMA_VERSION, memoryMigrations } from "./migrations.ts";
import { createQueryEmbeddingContent, searchMemoryResults } from "./search.ts";

export interface InitializeMemoryStoreInput {
  dbPath: string;
  embeddingAdapter?: MemoryEmbeddingAdapter;
  preferLowFootprintEmbeddings?: boolean;
}

export interface MemoryStoreStatus {
  dbPath: string;
  schemaVersion: number;
  latestSchemaVersion: number;
  embeddingModel: string;
  fallbackEmbeddingModel: string;
  embeddingDimensions: number;
  embeddingStrategy: string;
}

export interface SessionRecord {
  id: string;
  projectId?: string;
  repoPath?: string;
  branch?: string;
  startedAt: string;
  endedAt?: string;
  summary?: string;
  metadata: Record<string, unknown>;
}

export interface SaveSessionSummaryInput {
  sessionId: string;
  summary: string;
  projectId?: string;
  repoPath?: string;
  branch?: string;
  startedAt?: string;
}

export interface SearchMemoriesOptions {
  queryEmbedding?: GeneratedMemoryEmbedding;
}

export interface MemoryStore extends MemoryStoreStatus {
  createMemory(input: CreateMemoryInput): MemoryRecord;
  updateMemory(input: UpdateMemoryInput): MemoryRecord;
  archiveMemory(input: ArchiveMemoryInput): MemoryRecord;
  getMemory(id: string): MemoryRecord | null;
  getMemoryEmbedding(id: string): MemoryEmbeddingRecord | null;
  getSession(sessionId: string): SessionRecord | null;
  saveSessionSummary(input: SaveSessionSummaryInput): SessionRecord;
  linkMemories(input: LinkMemoriesInput): MemoryLinkRecord;
  listMemoryLinks(memoryId: string): MemoryLinkRecord[];
  createSearchQueryEmbedding(query: string): GeneratedMemoryEmbedding;
  searchMemories(input: SearchMemoriesInput, options?: SearchMemoriesOptions): MemorySearchResult[];
  close(): void;
}

interface MemoryLinkRow {
  id: number;
  from_memory_id: string;
  to_memory_id: string;
  relation: MemoryLinkRecord["relation"];
  created_at: string;
}

export function initializeMemoryStore(input: InitializeMemoryStoreInput): MemoryStore {
  const dbPath = resolve(input.dbPath);
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  const embeddingAdapter =
    input.embeddingAdapter ??
    createDefaultMemoryEmbeddingAdapter(input.preferLowFootprintEmbeddings ? "low-footprint" : "default");

  try {
    configureDatabase(db);
    applyMigrations(db);

    const schemaVersion = getSchemaVersion(db);
    const embeddingStatus = embeddingAdapter.getStatus();
    let isClosed = false;

    return {
      dbPath,
      schemaVersion,
      latestSchemaVersion: LATEST_MEMORY_SCHEMA_VERSION,
      embeddingModel: embeddingStatus.activeModel,
      fallbackEmbeddingModel: embeddingStatus.fallbackModel,
      embeddingDimensions: embeddingStatus.dimensions,
      embeddingStrategy: embeddingStatus.strategy,
      createMemory(input) {
        assertStoreOpen(isClosed);

        const memory = normalizeCreateMemoryInput(input);
        const embedding = embeddingAdapter.generateEmbedding(createMemoryContentForEmbedding(memory));
        const timestamp = new Date().toISOString();

        db.exec("BEGIN IMMEDIATE;");

        try {
          if (memory.sessionId) {
            ensureSessionRow(db, memory);
          }

          db.prepare(`
            INSERT INTO memories (
              id,
              kind,
              scope,
              session_id,
              title,
              summary,
              body,
              tags_json,
              source_agent,
              project_id,
              repo_path,
              branch,
              importance,
              confidence,
              status,
              pinned,
              created_at,
              updated_at,
              expires_at,
              metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
          `).run(
            memory.id,
            memory.kind,
            memory.scope,
            memory.sessionId ?? null,
            memory.title,
            memory.summary,
            memory.body ?? null,
            JSON.stringify(memory.tags),
            memory.sourceAgent ?? null,
            memory.projectId ?? null,
            memory.repoPath ?? null,
            memory.branch ?? null,
            memory.importance,
            memory.confidence,
            memory.status,
            memory.pinned ? 1 : 0,
            memory.createdAt,
            memory.updatedAt,
            memory.expiresAt ?? null,
            JSON.stringify(memory.metadata),
          );

          writeMemoryEmbedding(db, memory.id, embedding, timestamp);
          db.exec("COMMIT;");
        } catch (error) {
          db.exec("ROLLBACK;");
          throw error;
        }

        const persistedMemory = readMemoryById(db, memory.id);
        if (!persistedMemory) {
          throw new Error(`Failed to read back persisted memory ${memory.id}`);
        }

        return persistedMemory;
      },
      updateMemory(input) {
        assertStoreOpen(isClosed);

        const patch = normalizeUpdateMemoryInput(input);
        const existingMemory = readMemoryById(db, patch.id);

        if (!existingMemory) {
          throw new Error(`Memory ${patch.id} was not found`);
        }

        const timestamp = new Date().toISOString();
        const updatedMemory: MemoryRecord = {
          ...existingMemory,
          title: patch.title ?? existingMemory.title,
          summary: patch.summary ?? existingMemory.summary,
          body: patch.body === undefined ? existingMemory.body : (patch.body ?? undefined),
          tags: patch.tags ?? existingMemory.tags,
          importance: patch.importance ?? existingMemory.importance,
          confidence: patch.confidence ?? existingMemory.confidence,
          status: patch.status ?? existingMemory.status,
          pinned: patch.pinned ?? existingMemory.pinned,
          updatedAt: timestamp,
          expiresAt: patch.expiresAt === undefined ? existingMemory.expiresAt : (patch.expiresAt ?? undefined),
        };

        const shouldRefreshEmbedding =
          patch.title !== undefined || patch.summary !== undefined || patch.body !== undefined || patch.tags !== undefined;
        const embedding = shouldRefreshEmbedding
          ? embeddingAdapter.generateEmbedding(createMemoryContentForEmbedding(updatedMemory))
          : undefined;

        db.exec("BEGIN IMMEDIATE;");

        try {
          if (updatedMemory.sessionId) {
            ensureSessionRow(db, updatedMemory);
          }

          writeMemoryRow(db, updatedMemory);

          if (embedding) {
            writeMemoryEmbedding(db, updatedMemory.id, embedding, timestamp);
          }

          db.exec("COMMIT;");
        } catch (error) {
          db.exec("ROLLBACK;");
          throw error;
        }

        const persistedMemory = readMemoryById(db, updatedMemory.id);
        if (!persistedMemory) {
          throw new Error(`Failed to read back updated memory ${updatedMemory.id}`);
        }

        return persistedMemory;
      },
      archiveMemory(input) {
        assertStoreOpen(isClosed);

        const { id, reason } = normalizeArchiveMemoryInput(input);
        const existingMemory = readMemoryById(db, id);

        if (!existingMemory) {
          throw new Error(`Memory ${id} was not found`);
        }

        const timestamp = new Date().toISOString();
        const updatedMemory: MemoryRecord = {
          ...existingMemory,
          status: "archived",
          updatedAt: timestamp,
          metadata: buildArchivedMetadata(existingMemory.metadata, reason, timestamp),
        };

        db.exec("BEGIN IMMEDIATE;");

        try {
          writeMemoryRow(db, updatedMemory);
          db.exec("COMMIT;");
        } catch (error) {
          db.exec("ROLLBACK;");
          throw error;
        }

        const persistedMemory = readMemoryById(db, updatedMemory.id);
        if (!persistedMemory) {
          throw new Error(`Failed to read back archived memory ${updatedMemory.id}`);
        }

        return persistedMemory;
      },
      getMemory(id) {
        assertStoreOpen(isClosed);

        const normalizedId = id.trim();
        if (normalizedId.length === 0) return null;

        return readMemoryById(db, normalizedId);
      },
      getMemoryEmbedding(id) {
        assertStoreOpen(isClosed);

        const normalizedId = id.trim();
        if (normalizedId.length === 0) return null;

        return readMemoryEmbeddingById(db, normalizedId);
      },
      getSession(sessionId) {
        assertStoreOpen(isClosed);

        const normalizedSessionId = sessionId.trim();
        if (normalizedSessionId.length === 0) return null;

        return readSessionById(db, normalizedSessionId);
      },
      saveSessionSummary(input) {
        assertStoreOpen(isClosed);

        const sessionId = input.sessionId.trim();
        const summary = input.summary.trim();
        const startedAt = input.startedAt?.trim() || new Date().toISOString();

        if (sessionId.length === 0) {
          throw new Error("Session id is required");
        }

        if (summary.length === 0) {
          throw new Error("Session summary is required");
        }

        db.exec("BEGIN IMMEDIATE;");

        try {
          ensureSessionRow(db, {
            sessionId,
            projectId: input.projectId,
            repoPath: input.repoPath,
            branch: input.branch,
            createdAt: startedAt,
          });

          db.prepare(`
            UPDATE sessions
            SET summary = ?
            WHERE id = ?;
          `).run(summary, sessionId);

          db.exec("COMMIT;");
        } catch (error) {
          db.exec("ROLLBACK;");
          throw error;
        }

        const session = readSessionById(db, sessionId);
        if (!session) {
          throw new Error(`Failed to read back persisted session ${sessionId}`);
        }

        return session;
      },
      linkMemories(input) {
        assertStoreOpen(isClosed);

        const normalizedInput = normalizeLinkMemoriesInput(input);

        if (!readMemoryById(db, normalizedInput.fromId)) {
          throw new Error(`Memory ${normalizedInput.fromId} was not found`);
        }

        if (!readMemoryById(db, normalizedInput.toId)) {
          throw new Error(`Memory ${normalizedInput.toId} was not found`);
        }

        const timestamp = new Date().toISOString();

        db.prepare(`
          INSERT INTO links (
            from_memory_id,
            to_memory_id,
            relation,
            created_at
          ) VALUES (?, ?, ?, ?)
          ON CONFLICT(from_memory_id, to_memory_id, relation) DO NOTHING;
        `).run(normalizedInput.fromId, normalizedInput.toId, normalizedInput.relation, timestamp);

        const link = readMemoryLink(db, normalizedInput.fromId, normalizedInput.toId, normalizedInput.relation);
        if (!link) {
          throw new Error(
            `Failed to read back persisted link ${normalizedInput.fromId} -> ${normalizedInput.toId} (${normalizedInput.relation})`,
          );
        }

        return link;
      },
      listMemoryLinks(memoryId) {
        assertStoreOpen(isClosed);

        const normalizedId = memoryId.trim();
        if (normalizedId.length === 0) return [];

        return readMemoryLinksForMemory(db, normalizedId);
      },
      createSearchQueryEmbedding(query) {
        assertStoreOpen(isClosed);

        const normalizedInput = normalizeSearchMemoriesInput({ query });
        return embeddingAdapter.generateEmbedding(createQueryEmbeddingContent(normalizedInput.query));
      },
      searchMemories(input, options) {
        assertStoreOpen(isClosed);

        const normalizedInput = normalizeSearchMemoriesInput(input);
        const queryEmbedding = options?.queryEmbedding ?? embeddingAdapter.generateEmbedding(createQueryEmbeddingContent(normalizedInput.query));

        return searchMemoryResults(db, normalizedInput, queryEmbedding);
      },
      close() {
        if (isClosed) return;
        isClosed = true;
        db.close();
      },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

function configureDatabase(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
}

function applyMigrations(db: DatabaseSync): void {
  const currentVersion = getSchemaVersion(db);
  const pendingMigrations = memoryMigrations.filter((migration) => migration.version > currentVersion);

  if (pendingMigrations.length === 0) return;

  db.exec("BEGIN IMMEDIATE;");

  try {
    for (const migration of pendingMigrations) {
      db.exec(migration.sql);
      db.exec(`PRAGMA user_version = ${migration.version};`);
    }

    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function getSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version;").get() as { user_version: number };
  return row.user_version;
}

function readMemoryById(db: DatabaseSync, id: string): MemoryRecord | null {
  const row = db
    .prepare(
      `SELECT
        id,
        kind,
        scope,
        session_id,
        title,
        summary,
        body,
        tags_json,
        source_agent,
        project_id,
        repo_path,
        branch,
        importance,
        confidence,
        status,
        pinned,
        created_at,
        updated_at,
        last_accessed_at,
        expires_at,
        metadata_json
      FROM memories
      WHERE id = ?;`,
    )
    .get(id) as MemoryRow | undefined;

  return row ? mapMemoryRow(row) : null;
}

function readMemoryEmbeddingById(db: DatabaseSync, id: string): MemoryEmbeddingRecord | null {
  const row = db
    .prepare(
      `SELECT
        memory_id,
        model,
        dimensions,
        vector_json,
        content_hash,
        created_at,
        updated_at
      FROM memory_embeddings
      WHERE memory_id = ?;`,
    )
    .get(id) as MemoryEmbeddingRow | undefined;

  return row ? mapMemoryEmbeddingRow(row) : null;
}

function readSessionById(db: DatabaseSync, sessionId: string): SessionRecord | null {
  const row = db
    .prepare(
      `SELECT
        id,
        project_id,
        repo_path,
        branch,
        started_at,
        ended_at,
        summary,
        metadata_json
      FROM sessions
      WHERE id = ?;`,
    )
    .get(sessionId) as SessionRow | undefined;

  return row ? mapSessionRow(row) : null;
}

function readMemoryLink(
  db: DatabaseSync,
  fromId: string,
  toId: string,
  relation: MemoryLinkRecord["relation"],
): MemoryLinkRecord | null {
  const row = db
    .prepare(
      `SELECT
        id,
        from_memory_id,
        to_memory_id,
        relation,
        created_at
      FROM links
      WHERE from_memory_id = ? AND to_memory_id = ? AND relation = ?;`,
    )
    .get(fromId, toId, relation) as MemoryLinkRow | undefined;

  return row ? mapMemoryLinkRow(row) : null;
}

function readMemoryLinksForMemory(db: DatabaseSync, memoryId: string): MemoryLinkRecord[] {
  const rows = db
    .prepare(
      `SELECT
        id,
        from_memory_id,
        to_memory_id,
        relation,
        created_at
      FROM links
      WHERE from_memory_id = ? OR to_memory_id = ?
      ORDER BY created_at DESC, id DESC;`,
    )
    .all(memoryId, memoryId) as MemoryLinkRow[];

  return rows.map(mapMemoryLinkRow);
}

function writeMemoryRow(db: DatabaseSync, memory: MemoryRecord): void {
  db.prepare(`
    UPDATE memories
    SET
      kind = ?,
      scope = ?,
      session_id = ?,
      title = ?,
      summary = ?,
      body = ?,
      tags_json = ?,
      source_agent = ?,
      project_id = ?,
      repo_path = ?,
      branch = ?,
      importance = ?,
      confidence = ?,
      status = ?,
      pinned = ?,
      updated_at = ?,
      expires_at = ?,
      metadata_json = ?
    WHERE id = ?;
  `).run(
    memory.kind,
    memory.scope,
    memory.sessionId ?? null,
    memory.title,
    memory.summary,
    memory.body ?? null,
    JSON.stringify(memory.tags),
    memory.sourceAgent ?? null,
    memory.projectId ?? null,
    memory.repoPath ?? null,
    memory.branch ?? null,
    memory.importance,
    memory.confidence,
    memory.status,
    memory.pinned ? 1 : 0,
    memory.updatedAt,
    memory.expiresAt ?? null,
    JSON.stringify(memory.metadata),
    memory.id,
  );
}

function ensureSessionRow(db: DatabaseSync, memory: Pick<MemoryRecord, "sessionId" | "projectId" | "repoPath" | "branch" | "createdAt">): void {
  if (!memory.sessionId) return;

  db.prepare(`
    INSERT INTO sessions (
      id,
      project_id,
      repo_path,
      branch,
      started_at,
      metadata_json
    ) VALUES (?, ?, ?, ?, ?, '{}')
    ON CONFLICT(id) DO UPDATE SET
      project_id = COALESCE(sessions.project_id, excluded.project_id),
      repo_path = COALESCE(sessions.repo_path, excluded.repo_path),
      branch = COALESCE(sessions.branch, excluded.branch);
  `).run(memory.sessionId, memory.projectId ?? null, memory.repoPath ?? null, memory.branch ?? null, memory.createdAt);
}

function writeMemoryEmbedding(
  db: DatabaseSync,
  memoryId: string,
  embedding: GeneratedMemoryEmbedding,
  timestamp: string,
): void {
  db.prepare(`
    INSERT INTO memory_embeddings (
      memory_id,
      model,
      dimensions,
      vector_json,
      content_hash,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(memory_id) DO UPDATE SET
      model = excluded.model,
      dimensions = excluded.dimensions,
      vector_json = excluded.vector_json,
      content_hash = excluded.content_hash,
      updated_at = excluded.updated_at;
  `).run(
    memoryId,
    embedding.model,
    embedding.dimensions,
    JSON.stringify(embedding.vector),
    embedding.contentHash,
    timestamp,
    timestamp,
  );
}

function mapMemoryLinkRow(row: MemoryLinkRow): MemoryLinkRecord {
  return {
    id: row.id,
    fromId: row.from_memory_id,
    toId: row.to_memory_id,
    relation: row.relation,
    createdAt: row.created_at,
  };
}

function buildArchivedMetadata(
  metadata: Record<string, unknown>,
  reason: string | undefined,
  archivedAt: string,
): Record<string, unknown> {
  const archived = {
    archivedAt,
    ...(reason ? { archivedReason: reason } : {}),
  };

  return {
    ...metadata,
    archive: {
      ...(typeof metadata.archive === "object" && metadata.archive !== null && !Array.isArray(metadata.archive)
        ? (metadata.archive as Record<string, unknown>)
        : {}),
      ...archived,
    },
  };
}

function assertStoreOpen(isClosed: boolean): void {
  if (isClosed) {
    throw new Error("Memory store is closed");
  }
}
