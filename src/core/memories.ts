import { randomUUID } from "node:crypto";

import { findScopeIdentityIssues } from "./identity-policy.ts";

export const MEMORY_KINDS = ["todo", "handoff"] as const;
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
  expiresAt?: string;
  staleAfter?: string;
  metadata?: Record<string, unknown>;
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
  expiresAt?: string | null;
  staleAfter?: string | null;
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
  kind?: MemoryKind[];
  scope?: MemoryScope[];
  tags: string[];
  sessionId?: string;
  projectId?: string;
  repoPath?: string;
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
  expiresAt?: string | null;
  staleAfter?: string | null;
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
  expiresAt?: string;
  staleAfter?: string;
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

export function normalizeCreateMemoryInput(input: CreateMemoryInput): MemoryRecord {
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
  const expiresAt = normalizeOptionalTimestamp(input.expiresAt, "expiresAt", issues);
  const staleAfter = normalizeOptionalTimestamp(input.staleAfter, "staleAfter", issues);
  const importance = normalizeScore("importance", input.importance, issues);
  const confidence = normalizeScore("confidence", input.confidence, issues);
  const tags = normalizeTags(input.tags, issues);
  const metadata = normalizeMetadata(input.metadata, issues);

  if (issues.length > 0 || !scope || !title || !summary) {
    throw new MemoryValidationError(issues);
  }

  const timestamp = new Date().toISOString();

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
    status: "active",
    pinned: input.pinned === true,
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt,
    staleAfter,
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
  const expiresAt =
    input.expiresAt === undefined
      ? undefined
      : normalizeNullableOptionalTimestamp(input.expiresAt, "expiresAt", issues, () => changedFieldCount++);
  const staleAfter =
    input.staleAfter === undefined
      ? undefined
      : normalizeNullableOptionalTimestamp(input.staleAfter, "staleAfter", issues, () => changedFieldCount++);
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
    expiresAt,
    staleAfter,
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

  const kind = normalizeEnumList("kind", input.kind, MEMORY_KINDS, issues);
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
  const kind = normalizeEnumList("kind", input.kind, MEMORY_KINDS, issues);
  const scope = normalizeEnumList("scope", input.scope, MEMORY_SCOPES, issues);
  const tags = normalizeTags(input.tags, issues);
  const sessionId = normalizeOptionalText(input.sessionId);
  const projectId = normalizeOptionalText(input.projectId);
  const repoPath = normalizeOptionalText(input.repoPath);
  const limit = normalizeLimit(input.limit, issues);
  const matchQuery = query ? buildFtsMatchQuery(query, issues) : undefined;

  issues.push(...findScopeIdentityIssues({ scope, sessionId, projectId, repoPath }));

  if (issues.length > 0 || !query || !matchQuery) {
    throw new MemoryValidationError(issues);
  }

  return {
    query,
    matchQuery,
    kind,
    scope,
    tags,
    sessionId,
    projectId,
    repoPath,
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

function normalizeOptionalTimestamp(
  value: string | undefined,
  fieldName: string,
  issues: string[],
): string | undefined {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return undefined;

  if (Number.isNaN(Date.parse(normalized))) {
    issues.push(`${fieldName} must be a valid ISO-8601 timestamp`);
    return undefined;
  }

  return normalized;
}

function normalizeNullableOptionalTimestamp(
  value: string | null,
  fieldName: string,
  issues: string[],
  onChange?: () => void,
): string | null | undefined {
  if (value === null) {
    onChange?.();
    return null;
  }

  const normalized = normalizeOptionalTimestamp(value, fieldName, issues);
  if (normalized !== undefined) {
    onChange?.();
  }
  return normalized;
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

function buildFtsMatchQuery(query: string, issues: string[]): string | undefined {
  const tokens = query.match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? [];
  const normalizedTokens = Array.from(new Set(tokens.map((token) => token.toLowerCase())));

  if (normalizedTokens.length === 0) {
    issues.push("query must contain searchable terms");
    return undefined;
  }

  return normalizedTokens.map((token) => `"${token.replaceAll("\"", '""')}"`).join(" AND ");
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
