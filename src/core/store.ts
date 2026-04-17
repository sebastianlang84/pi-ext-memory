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
  type NormalizedSearchMemoriesInput,
  type SearchMemoriesInput,
  type UpdateMemoryInput,
  normalizeArchiveMemoryInput,
  normalizeCreateMemoryInput,
  normalizeLinkMemoriesInput,
  normalizeSearchMemoriesInput,
  normalizeUpdateMemoryInput,
} from "./memories.ts";
import { LATEST_MEMORY_SCHEMA_VERSION, memoryMigrations } from "./migrations.ts";

const SEARCH_CANDIDATE_MULTIPLIER = 5;
const SEARCH_MIN_CANDIDATES = 10;
const MIN_VECTOR_SIMILARITY = 0.15;

const HYBRID_RANKING_WEIGHTS = {
  lexical: 0.35,
  semantic: 0.35,
  scope: 0.1,
  recency: 0.08,
  importance: 0.07,
  confidence: 0.05,
} as const;

const BASE_SCOPE_SCORES: Record<MemoryRecord["scope"], number> = {
  global: 0.55,
  project: 0.8,
  repo: 0.72,
  session: 0.48,
};

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

export interface MemoryStore extends MemoryStoreStatus {
  createMemory(input: CreateMemoryInput): MemoryRecord;
  updateMemory(input: UpdateMemoryInput): MemoryRecord;
  archiveMemory(input: ArchiveMemoryInput): MemoryRecord;
  getMemory(id: string): MemoryRecord | null;
  getMemoryEmbedding(id: string): MemoryEmbeddingRecord | null;
  linkMemories(input: LinkMemoriesInput): MemoryLinkRecord;
  listMemoryLinks(memoryId: string): MemoryLinkRecord[];
  searchMemories(input: SearchMemoriesInput): MemorySearchResult[];
  close(): void;
}

interface MemoryRow {
  id: string;
  kind: MemoryRecord["kind"];
  scope: MemoryRecord["scope"];
  session_id: string | null;
  title: string;
  summary: string;
  body: string | null;
  tags_json: string;
  source_agent: string | null;
  project_id: string | null;
  repo_path: string | null;
  branch: string | null;
  importance: number;
  confidence: number;
  status: MemoryRecord["status"];
  pinned: number;
  created_at: string;
  updated_at: string;
  last_accessed_at: string | null;
  expires_at: string | null;
  metadata_json: string;
}

interface MemoryEmbeddingRow {
  memory_id: string;
  model: string;
  dimensions: number;
  vector_json: string;
  content_hash: string;
  created_at: string;
  updated_at: string;
}

interface MemoryLinkRow {
  id: number;
  from_memory_id: string;
  to_memory_id: string;
  relation: MemoryLinkRecord["relation"];
  created_at: string;
}

interface MemorySearchBaseRow {
  id: string;
  kind: MemoryRecord["kind"];
  scope: MemoryRecord["scope"];
  title: string;
  summary: string;
  tags_json: string;
  project_id: string | null;
  repo_path: string | null;
  importance: number;
  confidence: number;
  created_at: string;
  updated_at: string;
}

interface LexicalMemorySearchRow extends MemorySearchBaseRow {
  lexical_match_score: number;
}

interface VectorMemoryCandidateRow extends MemorySearchBaseRow {
  vector_json: string;
}

interface SemanticMemorySearchRow extends MemorySearchBaseRow {
  semantic_score: number;
}

interface RankedMemorySearchCandidate {
  id: string;
  kind: MemoryRecord["kind"];
  scope: MemoryRecord["scope"];
  title: string;
  summary: string;
  tags: string[];
  projectId?: string;
  repoPath?: string;
  importance: number;
  confidence: number;
  createdAt: string;
  updatedAt: string;
  matchScore: number;
  lexicalScore: number;
  semanticScore: number;
  scopeScore: number;
  recencyScore: number;
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
      searchMemories(input) {
        assertStoreOpen(isClosed);

        const normalizedInput = normalizeSearchMemoriesInput(input);
        const candidateLimit = Math.max(normalizedInput.limit * SEARCH_CANDIDATE_MULTIPLIER, SEARCH_MIN_CANDIDATES);
        const lexicalRows = searchLexicalMemoryRows(db, normalizedInput, candidateLimit);
        const queryEmbedding = embeddingAdapter.generateEmbedding(createQueryEmbeddingContent(normalizedInput.query));
        const semanticRows = searchSemanticMemoryRows(db, normalizedInput, queryEmbedding, candidateLimit);

        return rankHybridSearchResults(normalizedInput, lexicalRows, semanticRows).slice(0, normalizedInput.limit);
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

function searchLexicalMemoryRows(
  db: DatabaseSync,
  input: NormalizedSearchMemoriesInput,
  limit: number,
): LexicalMemorySearchRow[] {
  const filters = buildMemorySearchFilters(input, "m");
  const rows = db
    .prepare(`
      SELECT
        m.id,
        m.kind,
        m.scope,
        m.title,
        m.summary,
        m.tags_json,
        m.project_id,
        m.repo_path,
        m.importance,
        m.confidence,
        m.created_at,
        m.updated_at,
        bm25(memory_fts, 10.0, 5.0, 1.0, 1.0) AS lexical_match_score
      FROM memory_fts
      JOIN memories AS m ON m.rowid = memory_fts.rowid
      WHERE ${[...filters.clauses, "memory_fts MATCH ?"].join(" AND ")}
      ORDER BY lexical_match_score ASC, m.updated_at DESC
      LIMIT ?;
    `)
    .all(...filters.params, input.matchQuery, limit) as LexicalMemorySearchRow[];

  return rows;
}

function searchSemanticMemoryRows(
  db: DatabaseSync,
  input: NormalizedSearchMemoriesInput,
  queryEmbedding: GeneratedMemoryEmbedding,
  limit: number,
): SemanticMemorySearchRow[] {
  const filters = buildMemorySearchFilters(input, "m");
  const rows = db
    .prepare(`
      SELECT
        m.id,
        m.kind,
        m.scope,
        m.title,
        m.summary,
        m.tags_json,
        m.project_id,
        m.repo_path,
        m.importance,
        m.confidence,
        m.created_at,
        m.updated_at,
        e.vector_json
      FROM memories AS m
      JOIN memory_embeddings AS e ON e.memory_id = m.id
      WHERE ${filters.clauses.join(" AND ")} AND e.model = ? AND e.dimensions = ?;
    `)
    .all(...filters.params, queryEmbedding.model, queryEmbedding.dimensions) as VectorMemoryCandidateRow[];

  return rows
    .map((row) => {
      const similarity = calculateCosineSimilarity(queryEmbedding.vector, parseNumberArray(row.vector_json));
      return similarity === undefined ? undefined : { ...row, semantic_score: similarity };
    })
    .filter((row): row is SemanticMemorySearchRow => row !== undefined && row.semantic_score >= MIN_VECTOR_SIMILARITY)
    .sort((left, right) => right.semantic_score - left.semantic_score)
    .slice(0, limit);
}

function buildMemorySearchFilters(
  input: NormalizedSearchMemoriesInput,
  alias: string,
): { clauses: string[]; params: Array<string | number> } {
  const clauses = [`${alias}.status = 'active'`];
  const params: Array<string | number> = [];

  if (input.kind && input.kind.length > 0) {
    clauses.push(`${alias}.kind IN (${createPlaceholders(input.kind.length)})`);
    params.push(...input.kind);
  }

  if (input.scope && input.scope.length > 0) {
    clauses.push(`${alias}.scope IN (${createPlaceholders(input.scope.length)})`);
    params.push(...input.scope);
  }

  if (input.sessionId) {
    clauses.push(`${alias}.session_id = ?`);
    params.push(input.sessionId);
  }

  if (input.projectId) {
    clauses.push(`${alias}.project_id = ?`);
    params.push(input.projectId);
  }

  if (input.repoPath) {
    clauses.push(`${alias}.repo_path = ?`);
    params.push(input.repoPath);
  }

  if (input.tags.length > 0) {
    clauses.push(
      `EXISTS (SELECT 1 FROM json_each(${alias}.tags_json) AS tag WHERE tag.value IN (${createPlaceholders(input.tags.length)}))`,
    );
    params.push(...input.tags);
  }

  return { clauses, params };
}

function rankHybridSearchResults(
  input: NormalizedSearchMemoriesInput,
  lexicalRows: LexicalMemorySearchRow[],
  semanticRows: SemanticMemorySearchRow[],
): MemorySearchResult[] {
  const candidates = new Map<string, RankedMemorySearchCandidate>();
  const referenceTime = Date.now();

  lexicalRows.forEach((row, index) => {
    const lexicalScore = calculateRankPositionScore(index, lexicalRows.length);
    upsertRankedCandidate(candidates, row, { lexicalScore });
  });

  semanticRows.forEach((row) => {
    upsertRankedCandidate(candidates, row, { semanticScore: row.semantic_score });
  });

  const rankedCandidates = Array.from(candidates.values())
    .map((candidate) => {
      const scopeScore = calculateScopeScore(candidate, input);
      const recencyScore = calculateRecencyScore(candidate.updatedAt, referenceTime);
      const matchScore = calculateHybridMatchScore(candidate, scopeScore, recencyScore);

      return {
        ...candidate,
        scopeScore,
        recencyScore,
        matchScore,
      };
    })
    .sort(compareRankedCandidates);

  return dedupeRankedCandidates(rankedCandidates);
}

function upsertRankedCandidate(
  candidates: Map<string, RankedMemorySearchCandidate>,
  row: MemorySearchBaseRow,
  input: Partial<Pick<RankedMemorySearchCandidate, "lexicalScore" | "semanticScore">>,
): void {
  const existing = candidates.get(row.id);

  if (existing) {
    existing.lexicalScore = Math.max(existing.lexicalScore, input.lexicalScore ?? 0);
    existing.semanticScore = Math.max(existing.semanticScore, input.semanticScore ?? 0);
    return;
  }

  candidates.set(row.id, {
    id: row.id,
    kind: row.kind,
    scope: row.scope,
    title: row.title,
    summary: row.summary,
    tags: parseStringArray(row.tags_json),
    projectId: row.project_id ?? undefined,
    repoPath: row.repo_path ?? undefined,
    importance: row.importance,
    confidence: row.confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    matchScore: 0,
    lexicalScore: input.lexicalScore ?? 0,
    semanticScore: input.semanticScore ?? 0,
    scopeScore: 0,
    recencyScore: 0,
  });
}

function calculateRankPositionScore(index: number, total: number): number {
  if (total <= 1) return 1;
  return Number((((total - index) / total) || 0).toFixed(6));
}

function calculateScopeScore(
  candidate: Pick<RankedMemorySearchCandidate, "scope" | "projectId" | "repoPath">,
  input: NormalizedSearchMemoriesInput,
): number {
  let score = BASE_SCOPE_SCORES[candidate.scope];

  if (input.scope?.includes(candidate.scope)) {
    score += 0.15;
  }

  if (input.projectId && candidate.projectId === input.projectId) {
    score += candidate.scope === "project" ? 0.2 : 0.1;
  }

  if (input.repoPath && candidate.repoPath === input.repoPath) {
    score += candidate.scope === "repo" ? 0.2 : 0.1;
  }

  return Math.min(1, Number(score.toFixed(6)));
}

function calculateRecencyScore(updatedAt: string, referenceTime: number): number {
  const updatedAtMs = Date.parse(updatedAt);
  if (Number.isNaN(updatedAtMs)) return 0;

  const ageMs = Math.max(0, referenceTime - updatedAtMs);
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const score = 1 / (1 + ageDays / 30);
  return Number(score.toFixed(6));
}

function calculateHybridMatchScore(
  candidate: Pick<RankedMemorySearchCandidate, "lexicalScore" | "semanticScore" | "importance" | "confidence">,
  scopeScore: number,
  recencyScore: number,
): number {
  const score =
    candidate.lexicalScore * HYBRID_RANKING_WEIGHTS.lexical +
    candidate.semanticScore * HYBRID_RANKING_WEIGHTS.semantic +
    scopeScore * HYBRID_RANKING_WEIGHTS.scope +
    recencyScore * HYBRID_RANKING_WEIGHTS.recency +
    candidate.importance * HYBRID_RANKING_WEIGHTS.importance +
    candidate.confidence * HYBRID_RANKING_WEIGHTS.confidence;

  return Number(score.toFixed(6));
}

function compareRankedCandidates(left: RankedMemorySearchCandidate, right: RankedMemorySearchCandidate): number {
  return (
    right.matchScore - left.matchScore ||
    right.semanticScore - left.semanticScore ||
    right.lexicalScore - left.lexicalScore ||
    right.importance - left.importance ||
    right.confidence - left.confidence ||
    right.updatedAt.localeCompare(left.updatedAt) ||
    right.createdAt.localeCompare(left.createdAt) ||
    left.title.localeCompare(right.title)
  );
}

function dedupeRankedCandidates(candidates: RankedMemorySearchCandidate[]): MemorySearchResult[] {
  const deduped: RankedMemorySearchCandidate[] = [];

  for (const candidate of candidates) {
    if (deduped.some((existing) => areNearDuplicateCandidates(existing, candidate))) {
      continue;
    }

    deduped.push(candidate);
  }

  return deduped.map((candidate) => ({
    id: candidate.id,
    kind: candidate.kind,
    scope: candidate.scope,
    title: candidate.title,
    summary: candidate.summary,
    tags: candidate.tags,
    projectId: candidate.projectId,
    repoPath: candidate.repoPath,
    importance: candidate.importance,
    confidence: candidate.confidence,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    matchScore: candidate.matchScore,
    lexicalScore: candidate.lexicalScore,
    semanticScore: candidate.semanticScore,
    scopeScore: candidate.scopeScore,
    recencyScore: candidate.recencyScore,
  }));
}

function areNearDuplicateCandidates(
  left: Pick<RankedMemorySearchCandidate, "title" | "summary">,
  right: Pick<RankedMemorySearchCandidate, "title" | "summary">,
): boolean {
  const normalizedLeftTitle = normalizeLooseText(left.title);
  const normalizedRightTitle = normalizeLooseText(right.title);
  const normalizedLeftSummary = normalizeLooseText(left.summary);
  const normalizedRightSummary = normalizeLooseText(right.summary);

  if (normalizedLeftTitle === normalizedRightTitle && normalizedLeftSummary === normalizedRightSummary) {
    return true;
  }

  const titleSimilarity = calculateTokenSetSimilarity(createLooseTokenSet(left.title), createLooseTokenSet(right.title));
  const summarySimilarity = calculateTokenSetSimilarity(
    createLooseTokenSet(left.summary),
    createLooseTokenSet(right.summary),
  );
  const combinedSimilarity = calculateTokenSetSimilarity(
    createLooseTokenSet(`${left.title}\n${left.summary}`),
    createLooseTokenSet(`${right.title}\n${right.summary}`),
  );

  return combinedSimilarity >= 0.92 || (titleSimilarity >= 0.85 && summarySimilarity >= 0.85);
}

function calculateTokenSetSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;

  let intersectionCount = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersectionCount += 1;
    }
  }

  const unionCount = new Set([...left, ...right]).size;
  return unionCount === 0 ? 0 : intersectionCount / unionCount;
}

function createLooseTokenSet(value: string): Set<string> {
  const tokens = normalizeLooseText(value).match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(tokens.filter((token) => token.length >= 2));
}

function normalizeLooseText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function calculateCosineSimilarity(left: number[], right: number[]): number | undefined {
  if (left.length === 0 || left.length !== right.length) {
    return undefined;
  }

  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];

    dotProduct += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return undefined;
  }

  const similarity = dotProduct / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
  return Number(similarity.toFixed(6));
}

function createQueryEmbeddingContent(query: string) {
  return {
    title: query,
    summary: query,
    tags: [],
  };
}

function mapMemoryRow(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    kind: row.kind,
    scope: row.scope,
    sessionId: row.session_id ?? undefined,
    title: row.title,
    summary: row.summary,
    body: row.body ?? undefined,
    tags: parseStringArray(row.tags_json),
    sourceAgent: row.source_agent ?? undefined,
    projectId: row.project_id ?? undefined,
    repoPath: row.repo_path ?? undefined,
    branch: row.branch ?? undefined,
    importance: row.importance,
    confidence: row.confidence,
    status: row.status,
    pinned: row.pinned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAccessedAt: row.last_accessed_at ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    metadata: parseObject(row.metadata_json),
  };
}

function mapMemoryEmbeddingRow(row: MemoryEmbeddingRow): MemoryEmbeddingRecord {
  return {
    memoryId: row.memory_id,
    model: row.model,
    dimensions: row.dimensions,
    vector: parseNumberArray(row.vector_json),
    contentHash: row.content_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseNumberArray(value: string): number[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is number => typeof item === "number") : [];
  } catch {
    return [];
  }
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function createPlaceholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function assertStoreOpen(isClosed: boolean): void {
  if (isClosed) {
    throw new Error("Memory store is closed");
  }
}
