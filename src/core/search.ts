import { type DatabaseSync } from "node:sqlite";

import { type GeneratedMemoryEmbedding } from "./embeddings.ts";
import { parseNumberArray, parseStringArray } from "./mappers.ts";
import { type MemoryRecord, type MemorySearchResult, type NormalizedSearchMemoriesInput } from "./memories.ts";

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

export function searchMemoryResults(
  db: DatabaseSync,
  input: NormalizedSearchMemoriesInput,
  queryEmbedding: GeneratedMemoryEmbedding,
): MemorySearchResult[] {
  const candidateLimit = Math.max(input.limit * SEARCH_CANDIDATE_MULTIPLIER, SEARCH_MIN_CANDIDATES);
  const lexicalRows = searchLexicalMemoryRows(db, input, candidateLimit);
  const semanticRows = searchSemanticMemoryRows(db, input, queryEmbedding, candidateLimit);

  return rankHybridSearchResults(input, lexicalRows, semanticRows).slice(0, input.limit);
}

export function createQueryEmbeddingContent(query: string) {
  return {
    title: query,
    summary: query,
    tags: [],
  };
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

function createPlaceholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}
