import { type MemoryEmbeddingRecord } from "./embeddings.ts";
import { type MemoryRecord } from "./memories.ts";

export interface MemoryRow {
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

export interface MemoryEmbeddingRow {
  memory_id: string;
  model: string;
  dimensions: number;
  vector_json: string;
  content_hash: string;
  created_at: string;
  updated_at: string;
}

export interface SessionRow {
  id: string;
  project_id: string | null;
  repo_path: string | null;
  branch: string | null;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
  metadata_json: string;
}

export function mapMemoryRow(row: MemoryRow): MemoryRecord {
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

export function mapMemoryEmbeddingRow(row: MemoryEmbeddingRow): MemoryEmbeddingRecord {
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

export function mapSessionRow(row: SessionRow) {
  return {
    id: row.id,
    projectId: row.project_id ?? undefined,
    repoPath: row.repo_path ?? undefined,
    branch: row.branch ?? undefined,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    summary: row.summary ?? undefined,
    metadata: parseObject(row.metadata_json),
  };
}

export function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function parseNumberArray(value: string): number[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is number => typeof item === "number") : [];
  } catch {
    return [];
  }
}

export function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
