import { randomUUID } from "node:crypto";

import { findScopeIdentityIssues } from "./identity-policy.ts";

export const MEMORY_KINDS = ["todo", "handoff"] as const;
/** Kind values accepted as tool filters, including the "note" sentinel for kind IS NULL. */
export const MEMORY_KIND_FILTERS = ["todo", "handoff", "note"] as const;
export const NOTE_KIND_FILTER = "note";
export const MEMORY_SCOPES = ["global", "project", "repo", "session"] as const;
export const MEMORY_STATUSES = ["active", "archived"] as const;
export const MEMORY_LIST_ORDER_BY = ["updatedAt", "createdAt"] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number];
export type MemoryScope = (typeof MEMORY_SCOPES)[number];
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];
export type MemoryListOrderBy = (typeof MEMORY_LIST_ORDER_BY)[number];

export interface CreateMemoryInput {
  kind?: MemoryKind;
  scope: MemoryScope;
  title: string;
  summary: string;
  body?: string;
  tags?: string[];
  sourceAgent?: string;
  projectId?: string;
  repoPath?: string;
  branch?: string;
  importance?: number;
  confidence?: number;
  sessionId?: string;
  pinned?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Lifecycle fields a restore path (currently `/memory-import`) carries over from
 * an already-persisted record. Deliberately kept out of `CreateMemoryInput`:
 * ordinary writes — including every agent-facing tool — must not be able to
 * create a memory that is already archived or backdated. Omitted fields keep the
 * normal create defaults (`active`, timestamps = now).
 */
export interface RestoreMemoryLifecycle {
  status?: MemoryStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface UpdateMemoryInput {
  id: string;
  scope?: MemoryScope;
  repoPath?: string;
  projectId?: string;
  title?: string;
  summary?: string;
  body?: string | null;
  tags?: string[];
  importance?: number;
  confidence?: number;
  status?: MemoryStatus;
  pinned?: boolean;
}

export interface ArchiveMemoryInput {
  id: string;
  reason?: string;
}

export interface SearchMemoriesInput {
  query: string;
  kind?: MemoryKind[];
  scope?: MemoryScope[];
  tags?: string[];
  sessionId?: string;
  projectId?: string;
  repoPath?: string;
  /** Ranking-only anchors: boost matches from this repo/project without filtering to it. */
  preferRepoPath?: string;
  preferProjectId?: string;
  limit?: number;
}

export interface ListMemoriesInput {
  kind?: MemoryKind[];
  scope?: MemoryScope[];
  tags?: string[];
  sessionId?: string;
  projectId?: string;
  repoPath?: string;
  status?: MemoryStatus;
  limit?: number;
  orderBy?: MemoryListOrderBy;
}

export interface NormalizedListMemoriesInput {
  kind?: MemoryKind[];
  /** When true, also match notes (kind IS NULL). */
  matchNullKind?: boolean;
  scope?: MemoryScope[];
  tags: string[];
  sessionId?: string;
  projectId?: string;
  repoPath?: string;
  status: MemoryStatus;
  limit: number;
  offset?: number;
  orderBy: MemoryListOrderBy;
}

export interface NormalizedSearchMemoriesInput {
  query: string;
  matchQuery: string;
  relaxedMatchQuery: string;
  kind?: MemoryKind[];
  matchNullKind?: boolean;
  scope?: MemoryScope[];
  tags: string[];
  sessionId?: string;
  projectId?: string;
  repoPath?: string;
  preferRepoPath?: string;
  preferProjectId?: string;
  limit: number;
}

export interface NormalizedUpdateMemoryInput {
  id: string;
  scope?: MemoryScope;
  repoPath?: string;
  projectId?: string;
  title?: string;
  summary?: string;
  body?: string | null;
  tags?: string[];
  importance?: number;
  confidence?: number;
  status?: MemoryStatus;
  pinned?: boolean;
}

export interface MemoryRecord {
  id: string;
  kind: MemoryKind | null | undefined;
  scope: MemoryScope;
  sessionId?: string;
  title: string;
  summary: string;
  body?: string;
  tags: string[];
  sourceAgent?: string;
  projectId?: string;
  repoPath?: string;
  branch?: string;
  importance: number;
  confidence: number;
  status: MemoryStatus;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt?: string;
  metadata: Record<string, unknown>;
}

export interface MemorySearchResult {
  id: string;
  kind: MemoryKind | null | undefined;
  scope: MemoryScope;
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

export class MemoryValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues[0] ?? "Invalid memory input");
    this.name = "MemoryValidationError";
    this.issues = issues;
  }
}

export function normalizeCreateMemoryInput(
  input: CreateMemoryInput,
  restore: RestoreMemoryLifecycle = {},
): MemoryRecord {
  const issues: string[] = [];

  const kind = input.kind !== undefined ? normalizeEnum("kind", input.kind, MEMORY_KINDS, issues) : undefined;
  const scope = normalizeEnum("scope", input.scope, MEMORY_SCOPES, issues);
  const title = normalizeRequiredText("title", input.title, issues, 3);
  const summary = normalizeRequiredText("summary", input.summary, issues, 10);

  if (summary && isLowInformationSummary(summary)) {
    issues.push("summary must contain enough detail to be useful later");
  }

  const body = normalizeOptionalText(input.body);
  const sourceAgent = normalizeOptionalText(input.sourceAgent);
  const projectId = normalizeOptionalText(input.projectId);
  const repoPath = normalizeOptionalText(input.repoPath);
  const branch = normalizeOptionalText(input.branch);
  const sessionId = normalizeOptionalText(input.sessionId);
  const importance = normalizeScore("importance", input.importance, issues);
  const confidence = normalizeScore("confidence", input.confidence, issues);
  const tags = normalizeTags(input.tags, issues);
  const metadata = normalizeMetadata(input.metadata, issues);

  const status =
    restore.status === undefined ? "active" : normalizeEnum("status", restore.status, MEMORY_STATUSES, issues);
  const restoredCreatedAt = normalizeTimestamp("createdAt", restore.createdAt, issues);
  const restoredUpdatedAt = normalizeTimestamp("updatedAt", restore.updatedAt, issues);

  if (issues.length > 0 || !scope || !title || !summary || !status) {
    throw new MemoryValidationError(issues);
  }

  const timestamp = new Date().toISOString();
  const createdAt = restoredCreatedAt ?? timestamp;
  const updatedAt = restoredUpdatedAt ?? createdAt;

  return {
    id: randomUUID(),
    kind: kind ?? null,
    scope,
    sessionId,
    title,
    summary,
    body,
    tags,
    sourceAgent,
    projectId,
    repoPath,
    branch,
    importance,
    confidence,
    status,
    pinned: input.pinned === true,
    createdAt,
    updatedAt,
    metadata,
  };
}

export function normalizeUpdateMemoryInput(input: UpdateMemoryInput): NormalizedUpdateMemoryInput {
  const issues: string[] = [];
  const id = normalizeNonEmptyId("id", input.id, issues);

  let changedFieldCount = 0;

  const scope =
    input.scope === undefined ? undefined : normalizeEnum("scope", input.scope, MEMORY_SCOPES, issues, () => changedFieldCount++);
  const repoPath =
    input.repoPath === undefined
      ? undefined
      : (() => { changedFieldCount++; return normalizeOptionalText(input.repoPath); })();
  const projectId =
    input.projectId === undefined
      ? undefined
      : (() => { changedFieldCount++; return normalizeOptionalText(input.projectId); })();

  const title =
    input.title === undefined ? undefined : normalizeRequiredText("title", input.title, issues, 3, () => changedFieldCount++);
  const summary =
    input.summary === undefined
      ? undefined
      : normalizeRequiredText("summary", input.summary, issues, 10, () => changedFieldCount++);

  if (summary && isLowInformationSummary(summary)) {
    issues.push("summary must contain enough detail to be useful later");
  }

  const body =
    input.body === undefined ? undefined : normalizeNullableOptionalText(input.body, "body", issues, () => changedFieldCount++);
  const tags = input.tags === undefined ? undefined : normalizeTags(input.tags, issues, () => changedFieldCount++);
  const importance =
    input.importance === undefined ? undefined : normalizeScore("importance", input.importance, issues, () => changedFieldCount++);
  const confidence =
    input.confidence === undefined ? undefined : normalizeScore("confidence", input.confidence, issues, () => changedFieldCount++);
  const status =
    input.status === undefined ? undefined : normalizeEnum("status", input.status, MEMORY_STATUSES, issues, () => changedFieldCount++);
  const pinned =
    input.pinned === undefined ? undefined : normalizeBoolean("pinned", input.pinned, issues, () => changedFieldCount++);

  if (changedFieldCount === 0) {
    issues.push("at least one updatable field must be provided");
  }

  if (issues.length > 0 || !id) {
    throw new MemoryValidationError(issues);
  }

  return {
    id,
    scope,
    repoPath,
    projectId,
    title,
    summary,
    body,
    tags,
    importance,
    confidence,
    status,
    pinned,
  };
}

export function normalizeArchiveMemoryInput(input: ArchiveMemoryInput): { id: string; reason?: string } {
  const issues: string[] = [];
  const id = normalizeNonEmptyId("id", input.id, issues);
  const reason = normalizeOptionalText(input.reason);

  if (issues.length > 0 || !id) {
    throw new MemoryValidationError(issues);
  }

  return { id, reason };
}

export function normalizeListMemoriesInput(input: ListMemoriesInput): NormalizedListMemoriesInput {
  const issues: string[] = [];

  const { kind: kindInput, matchNullKind } = splitNoteKindFilter(input.kind);
  const kind = normalizeEnumList("kind", kindInput, MEMORY_KINDS, issues);
  const scope = normalizeEnumList("scope", input.scope, MEMORY_SCOPES, issues);
  const tags = normalizeTags(input.tags, issues);
  const sessionId = normalizeOptionalText(input.sessionId);
  const projectId = normalizeOptionalText(input.projectId);
  const repoPath = normalizeOptionalText(input.repoPath);
  const status = input.status === undefined ? "active" : normalizeEnum("status", input.status, MEMORY_STATUSES, issues);
  const limit = normalizeLimit(input.limit, issues);
  const orderBy = input.orderBy === undefined ? "updatedAt" : normalizeEnum("orderBy", input.orderBy, MEMORY_LIST_ORDER_BY, issues);

  issues.push(...findScopeIdentityIssues({ scope, sessionId, projectId, repoPath }));

  if (issues.length > 0 || !status || !orderBy) {
    throw new MemoryValidationError(issues);
  }

  return {
    kind,
    matchNullKind,
    scope,
    tags,
    sessionId,
    projectId,
    repoPath,
    status,
    limit,
    orderBy,
  };
}

export function normalizeSearchMemoriesInput(input: SearchMemoriesInput): NormalizedSearchMemoriesInput {
  const issues: string[] = [];

  const query = normalizeRequiredText("query", input.query, issues, 2);
  const { kind: kindInput, matchNullKind } = splitNoteKindFilter(input.kind);
  const kind = normalizeEnumList("kind", kindInput, MEMORY_KINDS, issues);
  const scope = normalizeEnumList("scope", input.scope, MEMORY_SCOPES, issues);
  const tags = normalizeTags(input.tags, issues);
  const sessionId = normalizeOptionalText(input.sessionId);
  const projectId = normalizeOptionalText(input.projectId);
  const repoPath = normalizeOptionalText(input.repoPath);
  const preferRepoPath = normalizeOptionalText(input.preferRepoPath);
  const preferProjectId = normalizeOptionalText(input.preferProjectId);
  const limit = normalizeLimit(input.limit, issues);
  const matchQuery = query ? buildFtsMatchQuery(query, issues, "AND") : undefined;
  const relaxedMatchQuery = query ? buildFtsMatchQuery(query, issues, "OR") : undefined;

  issues.push(...findScopeIdentityIssues({ scope, sessionId, projectId, repoPath }));

  if (issues.length > 0 || !query || !matchQuery || !relaxedMatchQuery) {
    throw new MemoryValidationError(issues);
  }

  return {
    query,
    matchQuery,
    relaxedMatchQuery,
    kind,
    matchNullKind,
    scope,
    tags,
    sessionId,
    projectId,
    repoPath,
    preferRepoPath,
    preferProjectId,
    limit,
  };
}

function normalizeEnum<T extends string>(
  fieldName: string,
  value: string,
  allowedValues: readonly T[],
  issues: string[],
  onChange?: () => void,
): T | undefined {
  if (typeof value !== "string" || !allowedValues.includes(value as T)) {
    issues.push(`${fieldName} must be one of: ${allowedValues.join(", ")}`);
    return undefined;
  }

  onChange?.();
  return value as T;
}

/**
 * Splits a raw kind filter into concrete kinds and the "note" sentinel
 * (kind IS NULL). Lets callers filter for plain notes, which are not part of
 * MEMORY_KINDS. Invalid non-note entries are left for normalizeEnumList to flag.
 */
export function splitNoteKindFilter(
  rawKind: readonly string[] | undefined,
): { kind?: string[]; matchNullKind: boolean } {
  if (!Array.isArray(rawKind)) return { kind: rawKind as string[] | undefined, matchNullKind: false };

  const matchNullKind = rawKind.includes(NOTE_KIND_FILTER);
  const kind = rawKind.filter((value) => value !== NOTE_KIND_FILTER);
  return { kind, matchNullKind };
}

function normalizeEnumList<T extends string>(
  fieldName: string,
  values: readonly T[] | undefined,
  allowedValues: readonly T[],
  issues: string[],
): T[] | undefined {
  if (values === undefined) return undefined;

  if (!Array.isArray(values)) {
    issues.push(`${fieldName} must be an array`);
    return undefined;
  }

  const normalizedValues: T[] = [];
  const seen = new Set<T>();

  for (const value of values) {
    if (typeof value !== "string" || !allowedValues.includes(value as T)) {
      issues.push(`${fieldName} entries must be one of: ${allowedValues.join(", ")}`);
      continue;
    }

    const normalizedValue = value as T;
    if (seen.has(normalizedValue)) continue;

    seen.add(normalizedValue);
    normalizedValues.push(normalizedValue);
  }

  return normalizedValues.length > 0 ? normalizedValues : undefined;
}

function normalizeRequiredText(
  fieldName: string,
  value: string,
  issues: string[],
  minLength: number,
  onChange?: () => void,
): string | undefined {
  if (typeof value !== "string") {
    issues.push(`${fieldName} must be a string`);
    return undefined;
  }

  const normalized = collapseWhitespace(value);
  if (normalized.length < minLength) {
    issues.push(`${fieldName} must be at least ${minLength} characters long`);
    return undefined;
  }

  onChange?.();
  return normalized;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;

  const normalized = collapseWhitespace(value);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeNullableOptionalText(
  value: string | null,
  fieldName: string,
  issues: string[],
  onChange?: () => void,
): string | null | undefined {
  if (value === null) {
    onChange?.();
    return null;
  }

  if (typeof value !== "string") {
    issues.push(`${fieldName} must be a string or null`);
    return undefined;
  }

  onChange?.();
  return normalizeOptionalText(value) ?? null;
}

function normalizeScore(fieldName: string, value: number | undefined, issues: string[], onChange?: () => void): number {
  if (value === undefined) return 0.5;

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    issues.push(`${fieldName} must be a number between 0 and 1`);
    return 0.5;
  }

  onChange?.();
  return value;
}

function normalizeBoolean(fieldName: string, value: boolean, issues: string[], onChange?: () => void): boolean | undefined {
  if (typeof value !== "boolean") {
    issues.push(`${fieldName} must be a boolean`);
    return undefined;
  }

  onChange?.();
  return value;
}

/**
 * Validates a restored lifecycle timestamp and returns it in canonical ISO form.
 * An unparseable value is reported instead of silently falling back to "now", so
 * a restore never quietly re-dates a memory.
 */
function normalizeTimestamp(fieldName: string, value: string | undefined, issues: string[]): string | undefined {
  if (value === undefined) return undefined;

  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(parsed)) {
    issues.push(`${fieldName} must be an ISO 8601 timestamp`);
    return undefined;
  }

  return new Date(parsed).toISOString();
}

function normalizeLimit(value: number | undefined, issues: string[]): number {
  if (value === undefined) return 100;

  if (!Number.isInteger(value) || value < 1) {
    issues.push("limit must be a positive integer");
    return 100;
  }

  return value;
}

function normalizeTags(tags: string[] | undefined, issues: string[], onChange?: () => void): string[] {
  if (tags === undefined) return [];
  if (!Array.isArray(tags)) {
    issues.push("tags must be an array of strings");
    return [];
  }

  const normalizedTags: string[] = [];
  const seen = new Set<string>();

  for (const tag of tags) {
    if (typeof tag !== "string") {
      issues.push("tags must be an array of strings");
      continue;
    }

    const normalized = collapseWhitespace(tag).toLowerCase();
    if (normalized.length === 0 || seen.has(normalized)) continue;

    seen.add(normalized);
    normalizedTags.push(normalized);
  }

  onChange?.();
  return normalizedTags;
}

function normalizeMetadata(
  metadata: Record<string, unknown> | undefined,
  issues: string[],
): Record<string, unknown> {
  if (metadata === undefined) return {};
  if (!isPlainObject(metadata)) {
    issues.push("metadata must be a plain object");
    return {};
  }

  try {
    return JSON.parse(JSON.stringify(metadata)) as Record<string, unknown>;
  } catch {
    issues.push("metadata must be JSON-serializable");
    return {};
  }
}

function normalizeNonEmptyId(fieldName: string, value: string, issues: string[]): string | undefined {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    issues.push(`${fieldName} must be a non-empty string`);
    return undefined;
  }

  return normalized;
}

function buildFtsMatchQuery(
  query: string,
  issues: string[],
  operator: "AND" | "OR",
): string | undefined {
  const baseTokens = Array.from(new Set(extractFtsTokens(query)));

  if (baseTokens.length === 0) {
    issues.push("query must contain searchable terms");
    return undefined;
  }

  // The relaxed (OR) fallback uses FTS5 prefix matching so morphological
  // variants match ("deploy" -> "deployment", "migration" -> "migrations").
  // The strict (AND) query stays exact to keep precise multi-term matches tight.
  const usePrefix = operator === "OR";

  // In relaxed mode also expand snake_case/kebab query tokens into their
  // subtokens ("spawn_sync" -> spawn, sync) so glued-identifier queries reach
  // the indexed `terms` subtokens. camelCase splitting is index-side only
  // (query tokens are already lowercased, so their camel boundaries are gone).
  let tokens = baseTokens;
  if (operator === "OR") {
    const expanded = new Set(baseTokens);
    for (const token of baseTokens) {
      for (const subtoken of splitIdentifierSubtokens(token)) {
        expanded.add(subtoken);
      }
    }
    tokens = Array.from(expanded);
  }

  return tokens
    .map((token) => (usePrefix && token.length >= 3 ? `${quoteFtsToken(token)}*` : quoteFtsToken(token)))
    .join(` ${operator} `);
}

/**
 * Split a raw token into identifier subtokens. Handles snake_case, kebab-case,
 * camelCase, PascalCase, and acronym boundaries (`FTSMatch` -> fts, match).
 * Returns lowercased subtokens (length >= 2) only when the token actually splits
 * into 2+ parts — a plain word yields `[]`, so callers add nothing for it.
 */
export function splitIdentifierSubtokens(token: string): string[] {
  const parts: string[] = [];
  for (const segment of token.split(/[_-]+/)) {
    if (!segment) continue;
    const camelSplit = segment
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .split(/\s+/);
    for (const piece of camelSplit) {
      if (piece) parts.push(piece.toLowerCase());
    }
  }

  const subtokens = parts.filter((part) => part.length >= 2);
  return subtokens.length >= 2 ? Array.from(new Set(subtokens)) : [];
}

/**
 * Derive the space-joined identifier subtokens for a memory's searchable content.
 * Indexed into the FTS `terms` column so code identifiers become reachable by
 * their parts (`buildFtsMatchQuery` -> "build fts match query"). Empty when the
 * content contains no splittable identifiers.
 */
export function deriveSearchTerms(content: MemorySearchTermsContent): string {
  const text = [content.title, content.summary, content.body ?? "", content.tags.join(" ")].join(" ");
  const rawTokens = text.match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? [];
  const subtokens = new Set<string>();
  for (const raw of rawTokens) {
    for (const subtoken of splitIdentifierSubtokens(raw)) {
      subtokens.add(subtoken);
    }
  }
  return Array.from(subtokens).join(" ");
}

export interface MemorySearchTermsContent {
  title: string;
  summary: string;
  body?: string;
  tags: string[];
}

function quoteFtsToken(token: string): string {
  return `"${token.replaceAll("\"", '""')}"`;
}

function extractFtsTokens(value: string): string[] {
  const tokens = value.match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? [];
  return tokens.map((token) => token.toLowerCase());
}

function isLowInformationSummary(summary: string): boolean {
  const tokens = summary.match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? [];
  const informativeTokens = tokens.filter((token) => token.length >= 3);
  const alphaNumericCount = (summary.match(/[\p{L}\p{N}]/gu) ?? []).length;

  return alphaNumericCount < 10 || (informativeTokens.length < 2 && summary.length < 20);
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
