import type { MemorySearchResult, SearchMemoriesInput, SessionRecord } from "../core/index.ts";

export function formatMemorySessionSaveUsage(minSummaryLength: number): string {
  return `Usage: /memory-session-save <summary>\nProvide an explicit session summary with at least ${minSummaryLength} characters.`;
}

export function formatMemorySessionSaved(
  session: Pick<SessionRecord, "id" | "summary" | "projectId" | "repoPath">,
  dbPath: string,
): string {
  return [
    `Saved session summary for ${session.id}.`,
    `summary: ${session.summary ?? "none"}`,
    `project_id: ${session.projectId ?? "none"}`,
    `repo_path: ${session.repoPath ?? "none"}`,
    `db_path: ${dbPath}`,
  ].join("\n");
}

export function formatMemoryReview(
  results: MemorySearchResult[],
  searchPlan: SearchMemoriesInput[],
  context: { sessionId: string; projectId?: string; repoPath?: string },
  dbPath: string,
  sessionSummary?: string,
): string {
  const lines = [
    "Manual memory review (read-only).",
    `search_plan: ${searchPlan.map(formatSearchPlanStage).join(" -> ") || "none"}`,
    `session_id: ${context.sessionId}`,
    `project_id: ${context.projectId ?? "none"}`,
    `repo_path: ${context.repoPath ?? "none"}`,
    `session_summary: ${sessionSummary ?? "none"}`,
    "suggested_actions:",
    "- Review matching memories before saving anything new.",
    "- Use memory_update if an existing memory is stale, incomplete, closed, or should be archived.",
    "- Use memory_link only for advanced relation maintenance when overlap matters for future retrieval.",
    "- Use /memory-session-save <summary> to persist a compact session recap explicitly.",
  ];

  if (results.length === 0) {
    lines.push("relevant_memories: none", `db_path: ${dbPath}`);
    return lines.join("\n");
  }

  lines.push(
    `relevant_memories: ${results.length}`,
    ...results.map((result, index) => formatMemorySearchResultLine(index + 1, result)),
    `db_path: ${dbPath}`,
  );

  return lines.join("\n");
}

export function formatSearchPlanStage(stage: SearchMemoriesInput): string {
  if (stage.scope?.includes("session")) {
    return `session(${stage.sessionId ?? "unknown"})`;
  }

  if (stage.scope?.includes("project")) {
    return `project(${stage.projectId ?? "unknown"})`;
  }

  if (stage.scope?.includes("repo")) {
    return `repo(${stage.repoPath ?? "unknown"})`;
  }

  if (stage.scope?.includes("global")) {
    return "global";
  }

  return "unscoped";
}

export function formatMemorySearchResultLine(index: number, result: MemorySearchResult): string {
  const kindLabel = result.kind ?? "memory";
  const metadata: string[] = [`${kindLabel}/${result.scope}`];

  if (result.tags.length > 0) {
    metadata.push(`tags=${result.tags.join(",")}`);
  }

  metadata.push(`score=${result.matchScore.toFixed(3)}`);

  if (result.lexicalScore > 0) {
    metadata.push(`lex=${result.lexicalScore.toFixed(3)}`);
  }

  if (result.semanticScore > 0) {
    metadata.push(`sem=${result.semanticScore.toFixed(3)}`);
  }

  return `${index}. [${metadata.join(" | ")}] ${result.title} — ${result.summary}`;
}
