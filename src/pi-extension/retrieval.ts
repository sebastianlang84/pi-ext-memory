import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { readIntEnv } from "../core/env-config.ts";
import { applyRuntimeIdentityEnrichment } from "../core/identity-policy.ts";
import type {
  CreateMemoryInput,
  GeneratedMemoryEmbedding,
  MemorySearchResult,
  MemoryStore,
  SearchMemoriesInput,
  SearchMemoriesOptions,
} from "../core/index.ts";
import { findLatestHandoffForTurn, type LatestHandoffResult } from "./handoffs.ts";

const PROJECT_MARKER_FILES = [
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "deno.json",
  "deno.jsonc",
  "pom.xml",
  "Gemfile",
  "composer.json",
  "Package.swift",
  "mix.exs",
] as const;

const MEMORY_CONTEXT_CUSTOM_TYPE = "pi-memory-context";
const TURN_MEMORY_RESULT_LIMIT = readIntEnv(process.env, "PI_MEMORY_TURN_RESULT_LIMIT", 3, { min: 1, max: 10 });
const TURN_MEMORY_STAGE_LIMIT = 4;
const MAX_DISTILLED_QUERY_TOKENS = 12;

// Low-information tokens dropped from turn/manual queries so the strict AND
// query is not over-constrained and the relaxed OR query does not match on
// filler words. English + a few common German words (memories may be German).
const QUERY_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "is", "are", "was", "were",
  "be", "this", "that", "it", "as", "at", "by", "from", "how", "what", "why", "when", "where", "do",
  "does", "did", "i", "you", "we", "my", "your", "our", "can", "should", "would", "could", "please",
  "me", "us", "so", "not", "no", "yes", "any", "all", "into", "out", "up", "about", "then", "than",
  "der", "die", "das", "und", "oder", "für", "mit", "ist", "sind", "ein", "eine", "einen", "wie",
  "was", "warum", "bitte", "um", "zu", "den", "dem", "von", "auf", "im", "am", "des", "auch",
]);

/**
 * Reduce a raw prompt to its informative tokens for retrieval: drop stopwords
 * and cap the token count so the strict AND query can still match and the
 * relaxed OR query stays precise. Short queries are returned unchanged so
 * single-keyword lookups are never mangled.
 */
export function distillQuery(query: string): string {
  const raw = query.trim();
  const tokens = raw.match(/[\p{L}\p{N}][\p{L}\p{N}_.:/-]*/gu) ?? [];
  if (tokens.length <= 3) return raw;

  const informative = tokens.filter((token) => {
    const lower = token.toLowerCase();
    if (QUERY_STOPWORDS.has(lower)) return false;
    return lower.length >= 3 || /[._:/-]/.test(lower) || /\d/.test(lower);
  });

  const kept = (informative.length >= 2 ? informative : tokens).slice(0, MAX_DISTILLED_QUERY_TOKENS);
  return kept.join(" ");
}
const MEMORY_NO_HIT_GUIDANCE =
  "User wins over memory. Prior-work: vary queries + escalate repo→global + memory_list. Empty ≠ absent. Save/update notes/todos/handoffs only.";
// Shown after the first no-hit turn of a session — the full guidance has already
// been injected once, so later no-hit turns only need a compact reminder.
const MEMORY_NO_HIT_GUIDANCE_SHORT = "User wins; empty ≠ absent.";
const MEMORY_HIT_GUIDANCE = "Use memory_search for more.";

export interface RetrieveTurnMemoriesOptions {
  resultLimit?: number;
  stageLimit?: number;
}

export interface MemoryTurnContext {
  cwd: string;
  sessionId: string;
  projectId?: string;
  projectPath?: string;
  repoPath?: string;
}

export interface MemoryTurnMessageDetails {
  dbPath: string;
  query: string;
  sessionId: string;
  projectId?: string;
  projectPath?: string;
  repoPath?: string;
  latestHandoffId?: string;
  latestHandoffIsFallback?: boolean;
  resultIds: string[];
  searchPlan: SearchMemoriesInput[];
}

export interface TurnMemoryMessage {
  customType: string;
  content: string;
  display: false;
  details: MemoryTurnMessageDetails;
}

export function deriveMemoryTurnContext(cwd: string, sessionId: string): MemoryTurnContext {
  const resolvedCwd = resolve(cwd);
  const repoPath = findGitRoot(resolvedCwd);
  const projectPath = findProjectRoot(resolvedCwd, repoPath);
  const projectId = projectPath ? readProjectId(projectPath) : undefined;

  return {
    cwd: resolvedCwd,
    sessionId,
    projectId,
    projectPath,
    repoPath,
  };
}

export function decorateCreateMemoryInput(input: CreateMemoryInput, context: MemoryTurnContext): CreateMemoryInput {
  return applyRuntimeIdentityEnrichment(input, context);
}

export function buildTurnSearchPlan(
  query: string,
  context: MemoryTurnContext,
  options: Pick<RetrieveTurnMemoriesOptions, "stageLimit"> = {},
): SearchMemoriesInput[] {
  const normalizedQuery = distillQuery(query);
  if (normalizedQuery.length < 2) {
    return [];
  }

  const stageLimit = options.stageLimit ?? TURN_MEMORY_STAGE_LIMIT;
  const normalizedSessionId = context.sessionId.trim();
  const stages: SearchMemoriesInput[] = [];

  if (normalizedSessionId.length > 0) {
    stages.push({
      query: normalizedQuery,
      limit: stageLimit,
      scope: ["session"],
      sessionId: normalizedSessionId,
    });
  }

  if (context.projectId) {
    stages.push({
      query: normalizedQuery,
      limit: stageLimit,
      scope: ["project"],
      projectId: context.projectId,
    });
  }

  if (context.repoPath) {
    stages.push({
      query: normalizedQuery,
      limit: stageLimit,
      scope: ["repo"],
      repoPath: context.repoPath,
    });
  }

  stages.push({
    query: normalizedQuery,
    limit: stageLimit,
    scope: ["global"],
  });

  return dedupeSearchPlan(stages);
}

type StagedMemorySearchStore = Pick<MemoryStore, "searchMemories"> & {
  createSearchQueryEmbedding?: (query: string) => GeneratedMemoryEmbedding;
};

export function retrieveMemoriesForTurn(
  store: StagedMemorySearchStore,
  query: string,
  context: MemoryTurnContext,
  options: RetrieveTurnMemoriesOptions = {},
): { results: MemorySearchResult[]; searchPlan: SearchMemoriesInput[] } {
  const resultLimit = options.resultLimit ?? TURN_MEMORY_RESULT_LIMIT;
  const searchPlan = buildTurnSearchPlan(query, context, { stageLimit: options.stageLimit });
  if (searchPlan.length === 0) {
    return { results: [], searchPlan };
  }

  const dedupedResults = new Map<string, MemorySearchResult>();
  const queryEmbedding = store.createSearchQueryEmbedding?.(searchPlan[0]?.query ?? query);
  const searchOptions: SearchMemoriesOptions | undefined = queryEmbedding ? { queryEmbedding } : undefined;

  // Collect every stage's candidates, then rank across all stages by matchScore.
  // A strong repo/global match must not be displaced by a weak session/project
  // match that merely came from an earlier stage.
  for (const stage of searchPlan) {
    for (const result of store.searchMemories(stage, searchOptions)) {
      const existing = dedupedResults.get(result.id);
      if (!existing || result.matchScore > existing.matchScore) {
        dedupedResults.set(result.id, result);
      }
    }
  }

  const results = Array.from(dedupedResults.values())
    .sort((left, right) => right.matchScore - left.matchScore)
    .slice(0, resultLimit);

  return { results, searchPlan };
}

export function buildTurnMemoryMessage(
  query: string,
  results: MemorySearchResult[],
  context: MemoryTurnContext,
  dbPath: string,
  searchPlan: SearchMemoriesInput[],
  latestHandoff?: LatestHandoffResult,
  options: { compactNoHitGuidance?: boolean } = {},
): TurnMemoryMessage | null {
  if (query.trim().length < 2 && !latestHandoff) {
    return null;
  }

  return {
    customType: MEMORY_CONTEXT_CUSTOM_TYPE,
    content: formatTurnMemoryContext(query, results, latestHandoff, options.compactNoHitGuidance),
    display: false,
    details: {
      dbPath,
      query: query.trim(),
      sessionId: context.sessionId,
      projectId: context.projectId,
      projectPath: context.projectPath,
      repoPath: context.repoPath,
      latestHandoffId: latestHandoff?.memory.id,
      latestHandoffIsFallback: latestHandoff?.isFallback,
      resultIds: results.map((result) => result.id),
      searchPlan,
    },
  };
}

export function formatTurnMemoryContext(
  query: string,
  results: MemorySearchResult[],
  latestHandoff?: LatestHandoffResult,
  compactNoHitGuidance = false,
): string {
  const topResults = results.slice(0, TURN_MEMORY_RESULT_LIMIT);
  const contextLines = formatTurnContextLines(query, topResults, latestHandoff !== undefined, compactNoHitGuidance);
  const handoffLines = latestHandoff ? formatLatestHandoffLines(latestHandoff) : [];

  return [...handoffLines, ...contextLines].join("\n");
}

function formatTurnContextLines(
  query: string,
  topResults: MemorySearchResult[],
  hasHandoff: boolean,
  compactNoHitGuidance: boolean,
): string[] {
  const selfDescription = isMemoryIntrospectionQuery(query)
    ? "local SQLite memory extension for notes/todos/handoffs; "
    : "";

  if (topResults.length > 0) {
    const contextLabel = selfDescription
      ? `pi-memory context (${selfDescription.trim().replace(/;$/, "")})`
      : "pi-memory context";
    return [
      `${contextLabel}:`,
      ...topResults.map((result, index) => formatTurnMemoryLine(index + 1, result)),
      MEMORY_HIT_GUIDANCE,
    ];
  }

  const noHitLabel = hasHandoff ? "no additional stored context" : "no relevant stored context";
  const guidance = compactNoHitGuidance ? MEMORY_NO_HIT_GUIDANCE_SHORT : MEMORY_NO_HIT_GUIDANCE;
  return [`pi-memory: ${selfDescription}${noHitLabel}. ${guidance}`];
}

function isMemoryIntrospectionQuery(query: string): boolean {
  return /(?:\bpi-memory\b|\bmemory_(?:search|list|save(?:_todo|_handoff)?|update|audit|stats)\b|\/memory-(?:status|search|handoff|audit)\b)/i.test(
    query,
  );
}

export function formatLatestHandoffLines(latestHandoff: LatestHandoffResult): string[] {
  const { memory, isFallback } = latestHandoff;
  const metadata = [`${memory.scope}`, `updated=${memory.updatedAt.slice(0, 10)}`];

  return [
    `Latest active handoff${isFallback ? " (fallback; do not overwrite unless explicit)" : ""}:`,
    `- [${metadata.join(" | ")}] ${memory.title} — ${memory.summary}`,
    ...formatHandoffResumeLines(memory),
  ];
}

function formatHandoffResumeLines(memory: LatestHandoffResult["memory"]): string[] {
  const resumeInstruction = getHandoffMetadataString(memory, "resumeInstruction");
  const nextSteps = extractMarkdownListItems(memory.body, "Next steps", 2).map((item) => compactInlineText(item, 120));
  const blockers = extractMarkdownListItems(memory.body, "Blockers", 2).map((item) => compactInlineText(item, 120));

  return [
    ...(resumeInstruction ? [`Resume: ${compactInlineText(resumeInstruction, 180)}`] : []),
    ...(nextSteps.length > 0 ? [`Next: ${nextSteps.join("; ")}`] : []),
    ...(blockers.length > 0 ? [`Blockers: ${blockers.join("; ")}`] : []),
  ];
}

function getHandoffMetadataString(memory: LatestHandoffResult["memory"], key: string): string | undefined {
  const handoff = memory.metadata.handoff;
  if (!handoff || typeof handoff !== "object") return undefined;

  const value = (handoff as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function extractMarkdownListItems(body: string | undefined, heading: string, maxItems: number): string[] {
  if (!body) return [];

  const lines = body.split(/\r?\n/);
  const headingPattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "i");
  const items: string[] = [];
  let inSection = false;

  for (const line of lines) {
    if (/^##\s+/.test(line) && inSection) break;
    if (headingPattern.test(line)) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;

    const match = /^-\s+(.+)$/.exec(line.trim());
    if (match?.[1]) {
      items.push(match[1].trim());
      if (items.length >= maxItems) break;
    }
  }

  return items;
}

function compactInlineText(text: string, maxChars: number): string {
  const compacted = text.replace(/\s+/g, " ").trim();
  return compacted.length <= maxChars ? compacted : `${compacted.slice(0, maxChars - 1).trimEnd()}…`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatTurnMemoryLine(index: number, result: MemorySearchResult): string {
  const kindLabel = result.kind ?? "memory";
  const metadata = [`${kindLabel}/${result.scope}`];

  return `${index}. [${metadata.join(" | ")}] ${result.title} — ${result.summary}`;
}

function dedupeSearchPlan(stages: SearchMemoriesInput[]): SearchMemoriesInput[] {
  const seen = new Set<string>();
  const deduped: SearchMemoriesInput[] = [];

  for (const stage of stages) {
    const key = JSON.stringify(stage);
    if (seen.has(key)) continue;

    seen.add(key);
    deduped.push(stage);
  }

  return deduped;
}

function findGitRoot(startPath: string): string | undefined {
  return findClosestAncestor(startPath, (candidate) => existsSync(join(candidate, ".git")));
}

function findProjectRoot(startPath: string, repoPath?: string): string | undefined {
  return (
    findClosestAncestor(
      startPath,
      (candidate) => PROJECT_MARKER_FILES.some((marker) => existsSync(join(candidate, marker))),
      repoPath,
    ) ?? repoPath ?? startPath
  );
}

function findClosestAncestor(
  startPath: string,
  predicate: (candidate: string) => boolean,
  stopPath?: string,
): string | undefined {
  let currentPath = resolve(startPath);
  const normalizedStopPath = stopPath ? resolve(stopPath) : undefined;

  while (true) {
    if (predicate(currentPath)) {
      return currentPath;
    }

    if (normalizedStopPath && currentPath === normalizedStopPath) {
      return undefined;
    }

    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) {
      return undefined;
    }

    currentPath = parentPath;
  }
}

function readProjectId(projectPath: string): string {
  const packageJsonPath = join(projectPath, "package.json");

  if (existsSync(packageJsonPath)) {
    try {
      const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: unknown };
      if (typeof parsed.name === "string" && parsed.name.trim().length > 0) {
        return parsed.name.trim();
      }
    } catch {
      // Fall through to directory name fallback.
    }
  }

  return basename(projectPath);
}

export { findLatestHandoffForTurn, MEMORY_CONTEXT_CUSTOM_TYPE, TURN_MEMORY_RESULT_LIMIT };
export type { LatestHandoffResult } from "./handoffs.ts";
