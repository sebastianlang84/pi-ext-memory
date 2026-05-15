import { type DatabaseSync } from "node:sqlite";

import { type GeneratedMemoryEmbedding } from "./embeddings.ts";
import { parseNumberArray, parseObject, parseStringArray } from "./mappers.ts";
import { type MemoryRecord, type MemorySearchResult, type NormalizedSearchMemoriesInput } from "./memories.ts";
import { DEFAULT_HYBRID_RETRIEVAL_POLICY } from "./retrieval-policy.ts";

interface MemorySearchBaseRow {
  id: string;
  kind: MemoryRecord["kind"];
  scope: MemoryRecord["scope"];
  title: string;
  summary: string;
  tags_json: string;
  metadata_json: string;
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
  exactMatchScore: number;
  canonicalKey?: string;
}

export function searchMemoryResults(
  db: DatabaseSync,
  input: NormalizedSearchMemoriesInput,
  queryEmbedding: GeneratedMemoryEmbedding,
): MemorySearchResult[] {
  const candidateLimit = Math.max(input.limit * DEFAULT_HYBRID_RETRIEVAL_POLICY.candidateMultiplier, DEFAULT_HYBRID_RETRIEVAL_POLICY.minCandidates);
  const lexicalRows = searchLexicalMemoryRows(db, input, candidateLimit);
  const semanticRows = searchSemanticMemoryRows(db, input, queryEmbedding, candidateLimit);
  const exactTagRows = searchExactTagMemoryRows(db, input, candidateLimit);
  const exactCanonicalRows = searchExactCanonicalKeyMemoryRows(db, input, candidateLimit);

  return rankHybridSearchResults(input, lexicalRows, semanticRows, exactTagRows, exactCanonicalRows).slice(0, input.limit);
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
  const strictRows = queryLexicalMemoryRows(db, input, input.matchQuery, limit);
  if (strictRows.length > 0) {
    return strictRows;
  }

  return queryLexicalMemoryRows(db, input, input.relaxedMatchQuery, limit);
}

function queryLexicalMemoryRows(
  db: DatabaseSync,
  input: NormalizedSearchMemoriesInput,
  matchQuery: string,
  limit: number,
): LexicalMemorySearchRow[] {
  const filters = buildMemorySearchFilters(input, "m");
  return db
    .prepare(`
      SELECT
        m.id,
        m.kind,
        m.scope,
        m.title,
        m.summary,
        m.tags_json,
        m.metadata_json,
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
    .all(...filters.params, matchQuery, limit) as LexicalMemorySearchRow[];
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
        m.metadata_json,
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
    .filter((row): row is SemanticMemorySearchRow => row !== undefined && row.semantic_score >= DEFAULT_HYBRID_RETRIEVAL_POLICY.minVectorSimilarity)
    .sort((left, right) => right.semantic_score - left.semantic_score)
    .slice(0, limit);
}

function searchExactTagMemoryRows(
  db: DatabaseSync,
  input: NormalizedSearchMemoriesInput,
  limit: number,
): MemorySearchBaseRow[] {
  const exactTerms = createExactQueryTerms(input.query);
  if (exactTerms.size === 0) return [];

  const filters = buildMemorySearchFilters(input, "m");
  const exactTermList = Array.from(exactTerms);
  return db
    .prepare(`
      SELECT
        m.id,
        m.kind,
        m.scope,
        m.title,
        m.summary,
        m.tags_json,
        m.metadata_json,
        m.project_id,
        m.repo_path,
        m.importance,
        m.confidence,
        m.created_at,
        m.updated_at
      FROM memories AS m
      WHERE ${[
        ...filters.clauses,
        `EXISTS (SELECT 1 FROM json_each(m.tags_json) AS exact_tag WHERE LOWER(CAST(exact_tag.value AS TEXT)) IN (${createPlaceholders(exactTermList.length)}))`,
      ].join(" AND ")}
      ORDER BY m.updated_at DESC
      LIMIT ?;
    `)
    .all(...filters.params, ...exactTermList, limit) as MemorySearchBaseRow[];
}

function searchExactCanonicalKeyMemoryRows(
  db: DatabaseSync,
  input: NormalizedSearchMemoriesInput,
  limit: number,
): MemorySearchBaseRow[] {
  const exactTerms = createExactQueryTerms(input.query);
  if (exactTerms.size === 0) return [];

  const filters = buildMemorySearchFilters(input, "m");
  const exactTermList = Array.from(exactTerms);
  return db
    .prepare(`
      SELECT
        m.id,
        m.kind,
        m.scope,
        m.title,
        m.summary,
        m.tags_json,
        m.metadata_json,
        m.project_id,
        m.repo_path,
        m.importance,
        m.confidence,
        m.created_at,
        m.updated_at
      FROM memories AS m
      WHERE ${[
        ...filters.clauses,
        `LOWER(CAST(json_extract(m.metadata_json, '$.canonicalKey') AS TEXT)) IN (${createPlaceholders(exactTermList.length)})`,
      ].join(" AND ")}
      ORDER BY m.updated_at DESC
      LIMIT ?;
    `)
    .all(...filters.params, ...exactTermList, limit) as MemorySearchBaseRow[];
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
  exactTagRows: MemorySearchBaseRow[],
  exactCanonicalRows: MemorySearchBaseRow[],
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

  exactTagRows.forEach((row) => {
    upsertRankedCandidate(candidates, row, {});
  });

  exactCanonicalRows.forEach((row) => {
    upsertRankedCandidate(candidates, row, {});
  });

  const exactTerms = createExactQueryTerms(input.query);
  const rankedCandidates = Array.from(candidates.values())
    .map((candidate) => {
      const scopeScore = calculateScopeScore(candidate, input);
      const recencyScore = calculateRecencyScore(candidate.updatedAt, referenceTime);
      const matchScore = calculateHybridMatchScore(candidate, scopeScore, recencyScore);
      const exactMatchScore = calculateExactMatchScore(candidate, exactTerms);

      return {
        ...candidate,
        scopeScore,
        recencyScore,
        matchScore,
        exactMatchScore,
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
    existing.canonicalKey ??= readCanonicalKey(row.metadata_json);
    return;
  }

  candidates.set(row.id, {
    id: row.id,
    kind: row.kind,
    scope: row.scope,
    title: row.title,
    summary: row.summary,
    tags: parseStringArray(row.tags_json),
    canonicalKey: readCanonicalKey(row.metadata_json),
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
    exactMatchScore: 0,
  });
}

function calculateExactMatchScore(
  candidate: Pick<RankedMemorySearchCandidate, "tags" | "canonicalKey">,
  exactTerms: Set<string>,
): number {
  if (exactTerms.size === 0) return 0;

  const canonicalScore = candidate.canonicalKey && exactTerms.has(candidate.canonicalKey) ? 2 : 0;
  const tagMatchCount = candidate.tags.filter((tag) => exactTerms.has(normalizeExactTerm(tag))).length;
  const tagScore = tagMatchCount > 0 ? 1 + Math.min(1, tagMatchCount / exactTerms.size) : 0;

  return Number((canonicalScore + tagScore).toFixed(6));
}

function readCanonicalKey(metadataJson: string): string | undefined {
  const canonicalKey = parseObject(metadataJson).canonicalKey;
  return typeof canonicalKey === "string" ? normalizeExactTerm(canonicalKey) : undefined;
}

function createExactQueryTerms(query: string): Set<string> {
  const terms = new Set<string>();
  const collapsedQuery = normalizeExactTerm(query);
  if (collapsedQuery.length > 0) {
    terms.add(collapsedQuery);
  }

  for (const token of query.match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? []) {
    terms.add(normalizeExactTerm(token));
  }

  for (const token of query.match(/[\p{L}\p{N}][\p{L}\p{N}_:-]*(?:\.[\p{L}\p{N}_:-]+)+/gu) ?? []) {
    terms.add(normalizeExactTerm(token));
  }

  terms.delete("");
  return terms;
}

function normalizeExactTerm(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function calculateRankPositionScore(index: number, total: number): number {
  if (total <= 1) return 1;
  return Number((((total - index) / total) || 0).toFixed(6));
}

function calculateScopeScore(
  candidate: Pick<RankedMemorySearchCandidate, "scope" | "projectId" | "repoPath">,
  input: NormalizedSearchMemoriesInput,
): number {
  let score = DEFAULT_HYBRID_RETRIEVAL_POLICY.baseScopeScores[candidate.scope];

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
    candidate.lexicalScore * DEFAULT_HYBRID_RETRIEVAL_POLICY.weights.lexical +
    candidate.semanticScore * DEFAULT_HYBRID_RETRIEVAL_POLICY.weights.semantic +
    scopeScore * DEFAULT_HYBRID_RETRIEVAL_POLICY.weights.scope +
    recencyScore * DEFAULT_HYBRID_RETRIEVAL_POLICY.weights.recency +
    candidate.importance * DEFAULT_HYBRID_RETRIEVAL_POLICY.weights.importance +
    candidate.confidence * DEFAULT_HYBRID_RETRIEVAL_POLICY.weights.confidence;

  return Number(score.toFixed(6));
}

function compareRankedCandidates(left: RankedMemorySearchCandidate, right: RankedMemorySearchCandidate): number {
  return (
    right.exactMatchScore - left.exactMatchScore ||
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
