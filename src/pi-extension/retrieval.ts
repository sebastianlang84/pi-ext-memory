import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

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
const TURN_MEMORY_RESULT_LIMIT = 3;
const TURN_MEMORY_STAGE_LIMIT = 4;

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
  const normalizedQuery = query.trim();
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

  for (const stage of searchPlan) {
    const stageResults = store.searchMemories(stage, searchOptions);

    for (const result of stageResults) {
      if (!dedupedResults.has(result.id)) {
        dedupedResults.set(result.id, result);
      }

      if (dedupedResults.size >= resultLimit) {
        return {
          results: Array.from(dedupedResults.values()).slice(0, resultLimit),
          searchPlan,
        };
      }
    }
  }

  return {
    results: Array.from(dedupedResults.values()).slice(0, resultLimit),
    searchPlan,
  };
}

export function buildTurnMemoryMessage(
  query: string,
  results: MemorySearchResult[],
  context: MemoryTurnContext,
  dbPath: string,
  searchPlan: SearchMemoriesInput[],
  latestHandoff?: LatestHandoffResult,
): {
  customType: string;
  content: string;
  display: false;
  details: MemoryTurnMessageDetails;
} | null {
  if (query.trim().length < 2 && !latestHandoff) {
    return null;
  }

  return {
    customType: MEMORY_CONTEXT_CUSTOM_TYPE,
    content: formatTurnMemoryContext(results, latestHandoff),
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

export function formatTurnMemoryContext(results: MemorySearchResult[], latestHandoff?: LatestHandoffResult): string {
  const topResults = results.slice(0, TURN_MEMORY_RESULT_LIMIT);
  const contextLines =
    topResults.length > 0
      ? ["Relevant memory context:", ...topResults.map((result, index) => formatTurnMemoryLine(index + 1, result))]
      : ["Relevant memory context: none found."];

  const handoffLines = latestHandoff ? formatLatestHandoffLines(latestHandoff) : [];

  return [
    ...handoffLines,
    ...contextLines,
    "Memory triggers: use memory_search when prior decisions, durable preferences, project history, or workflow context materially affect the answer.",
    "Memory writes: save or update only durable, reusable corrections, decisions, facts, preferences, progress snapshots, or persistent todos.",
    "Memory precedence: prefer current user instructions when they conflict with older memory.",
  ].join("\n");
}

function formatLatestHandoffLines(latestHandoff: LatestHandoffResult): string[] {
  const { memory, isFallback } = latestHandoff;
  const metadata = [`${memory.scope}`, `updated=${memory.updatedAt}`];

  if (memory.sessionId) {
    metadata.push(`session=${memory.sessionId}`);
  }

  if (memory.projectId) {
    metadata.push(`project=${memory.projectId}`);
  }

  if (memory.repoPath) {
    metadata.push(`repo=${memory.repoPath}`);
  }

  return [
    `Latest active handoff${isFallback ? " (from another matching session/repo/project; do not overwrite unless explicit)" : ""}:`,
    `- [${metadata.join(" | ")}] ${memory.title} — ${memory.summary}`,
    ...(memory.body ? [memory.body] : []),
  ];
}

function formatTurnMemoryLine(index: number, result: MemorySearchResult): string {
  const metadata = [`${result.kind}/${result.scope}`];

  if (result.projectId) {
    metadata.push(`project=${result.projectId}`);
  }

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
