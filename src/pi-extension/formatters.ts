import { hostname } from "node:os";

import type { ListForToolResult, MemoryRecord, MemoryScope, MemorySearchResult, MemoryStore, SearchMemoriesInput, SessionRecord, TodoPriority, TodoWorkflowStatus } from "../core/index.ts";
import { isLegacyProjectScopeSelected, LEGACY_PROJECT_SCOPE_NOTICE } from "../core/index.ts";
import { decorateCreateMemoryInput, deriveMemoryTurnContext } from "./retrieval.ts";
import { formatNearTagSuggestionLines, type NearTagSuggestion } from "./tag-catalog.ts";

export type EmptySearchHint =
  | { type: "near_canonical_key"; input: string; suggestions: string[] }
  | { type: "broaden_search"; message: string };

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

// ─── Formatter functions moved from tools.ts ───────────────────────────────

type TodoSaveParams = {
  title: string;
  description?: string;
  priority?: TodoPriority;
  status?: TodoWorkflowStatus;
  nextAction?: string;
};

export function buildTodoSummary(params: TodoSaveParams): string {
  const parts: string[] = [];
  if (params.priority) parts.push(`[${params.priority}]`);
  if (params.status && params.status !== "open") parts.push(`[${params.status}]`);
  parts.push(params.description?.trim() || params.title.trim());
  if (params.nextAction) parts.push(`→ ${params.nextAction.trim()}`);
  return parts.join(" ");
}

type HandoffSaveParams = {
  title?: string;
  handoffReason: "context_reset" | "agent_transfer" | "compaction" | "session_end";
  recipient?: "same_agent" | "next_agent" | "human";
  resumeInstruction: string;
  goal: string;
  currentState: string;
  nextSteps: string[];
  done?: string[];
  changedFiles?: string[];
  decisions?: string[];
  blockers?: string[];
  openQuestions?: string[];
  verification?: string[];
  risks?: string[];
  avoidRepeating?: string[];
};

export type HandoffTurnContext = ReturnType<typeof deriveMemoryTurnContext>;

export function buildHandoffMemoryInput(params: HandoffSaveParams, context: HandoffTurnContext) {
  const reason = params.handoffReason;
  const title = params.title?.trim() || `Handoff: ${params.goal.trim().slice(0, 80)}`;
  const body = renderHandoffMarkdown(params, context, reason, title);

  return decorateCreateMemoryInput(
    {
      kind: "handoff",
      scope: "session",
      title,
      summary: params.currentState.trim(),
      body,
      tags: ["handoff", reason, ...(params.recipient ? [params.recipient] : [])],
      importance: 0.9,
      confidence: 0.9,
      metadata: {
        handoff: {
          reason,
          recipient: params.recipient ?? "next_agent",
          resumeInstruction: params.resumeInstruction,
          pid: process.pid,
          hostname: hostname(),
          cwd: context.cwd,
          savedAt: new Date().toISOString(),
        },
      },
    },
    context,
  );
}

export function renderHandoffMarkdown(params: HandoffSaveParams, context: HandoffTurnContext, reason: string, title: string): string {
  const lines = [
    `# ${title}`,
    "",
    `Reason: ${reason}`,
    `Recipient: ${params.recipient ?? "next_agent"}`,
    `Resume: ${params.resumeInstruction.trim()}`,
    `Session: ${context.sessionId}`,
    `Project: ${context.projectId ?? "none"}`,
    `Repo: ${context.repoPath ?? "none"}`,
    `CWD: ${context.cwd}`,
    `PID: ${process.pid}`,
    `Host: ${hostname()}`,
    "",
    "## Goal",
    params.goal.trim(),
    "",
    "## Current state",
    params.currentState.trim(),
  ];

  appendMarkdownList(lines, "Done", params.done);
  appendMarkdownList(lines, "Changed files", params.changedFiles);
  appendMarkdownList(lines, "Decisions", params.decisions);
  appendMarkdownList(lines, "Blockers", params.blockers);
  appendMarkdownList(lines, "Open questions", params.openQuestions);
  appendMarkdownList(lines, "Next steps", params.nextSteps);
  appendMarkdownList(lines, "Verification", params.verification);
  appendMarkdownList(lines, "Risks", params.risks);
  appendMarkdownList(lines, "Avoid repeating", params.avoidRepeating);

  return lines.join("\n");
}

export function appendMarkdownList(lines: string[], heading: string, values?: string[]): void {
  const cleaned = values?.map((value) => value.trim()).filter(Boolean) ?? [];
  if (cleaned.length === 0) return;

  lines.push("", `## ${heading}`, ...cleaned.map((value) => `- ${value}`));
}

export function formatMemorySaved(memory: MemoryRecord, store: MemoryStore, nearTagSuggestions: NearTagSuggestion[] = []): string {
  const lines = [
    `Saved memory ${memory.id}.`,
    `kind: ${memory.kind ?? "unset"}`,
    `scope: ${memory.scope}`,
    `title: ${memory.title}`,
    `summary: ${memory.summary}`,
    `tags: ${memory.tags.join(", ") || "none"}`,
  ];

  if (memory.sessionId) {
    lines.push(`session_id: ${memory.sessionId}`);
  }

  if (memory.projectId) {
    lines.push(`project_id: ${memory.projectId}`);
  }

  if (memory.repoPath) {
    lines.push(`repo_path: ${memory.repoPath}`);
  }

  lines.push(
    ...formatNearTagSuggestionLines(nearTagSuggestions),
    `embedding_model: ${store.embeddingModel}`,
    `embedding_dimensions: ${store.embeddingDimensions}`,
    `db_path: ${store.dbPath}`,
  );

  return lines.join("\n");
}

export function formatMemoryUpdated(memory: MemoryRecord, store: MemoryStore, nearTagSuggestions: NearTagSuggestion[] = []): string {
  const lines = [
    `Updated memory ${memory.id}.`,
    `status: ${memory.status}`,
    `pinned: ${memory.pinned ? "yes" : "no"}`,
    `title: ${memory.title}`,
    `summary: ${memory.summary}`,
    `tags: ${memory.tags.join(", ") || "none"}`,
    `updated_at: ${memory.updatedAt}`,
    ...formatNearTagSuggestionLines(nearTagSuggestions),
    `db_path: ${store.dbPath}`,
  ];

  return lines.join("\n");
}

export function formatMemoryArchived(memory: MemoryRecord, dbPath: string): string {
  const archiveMetadata =
    typeof memory.metadata.archive === "object" && memory.metadata.archive !== null && !Array.isArray(memory.metadata.archive)
      ? (memory.metadata.archive as Record<string, unknown>)
      : undefined;

  const lines = [
    `Archived memory ${memory.id}.`,
    `status: ${memory.status}`,
    `title: ${memory.title}`,
    `updated_at: ${memory.updatedAt}`,
  ];

  if (typeof archiveMetadata?.archivedReason === "string") {
    lines.push(`reason: ${archiveMetadata.archivedReason}`);
  }

  lines.push(`db_path: ${dbPath}`);
  return lines.join("\n");
}

export function formatListResult(result: ListForToolResult, dbPath: string): string {
  const { items, totalCount, hasMore, nextOffset } = result;
  if (items.length === 0) {
    return [`No memories matched the list filters.`, `total_count: ${totalCount}`, `db_path: ${dbPath}`].join("\n");
  }

  const lines = [
    `Found ${items.length} of ${totalCount} memor${totalCount === 1 ? "y" : "ies"}.`,
    ...items.map((memory, index) => formatMemoryListResultLine(index + 1, memory)),
  ];

  if (hasMore) {
    lines.push(`has_more: true — use offset=${nextOffset} to continue`);
  }

  lines.push(`db_path: ${dbPath}`);
  return lines.join("\n");
}

export function formatMemoryListResultLine(index: number, memory: MemoryRecord): string {
  const tags = memory.tags.length > 0 ? ` tags=${memory.tags.join(",")}` : "";
  const kindLabel = memory.kind ?? "memory";
  return `${index}. [${kindLabel}/${memory.scope}/${memory.status}] ${memory.title} (${memory.id}) — ${memory.summary}${tags} updated=${memory.updatedAt}`;
}

export function formatMemorySearchResults(
  query: string,
  results: MemorySearchResult[],
  dbPath: string,
  nearTagSuggestions: NearTagSuggestion[] = [],
  emptySearchHints: EmptySearchHint[] = [],
): string {
  if (results.length === 0) {
    return [
      `No memories matched \"${query}\".`,
      ...formatNearTagSuggestionLines(nearTagSuggestions),
      ...formatEmptySearchHintLines(emptySearchHints),
      `db_path: ${dbPath}`,
    ].join("\n");
  }

  return [
    `Found ${results.length} memory result${results.length === 1 ? "" : "s"} for \"${query}\".`,
    ...results.map((result, index) => formatMemorySearchResultLine(index + 1, result)),
    `db_path: ${dbPath}`,
  ].join("\n");
}

export function formatEmptySearchHintLines(hints: EmptySearchHint[]): string[] {
  if (hints.length === 0) return [];

  return [
    "empty_result_hints:",
    ...hints.map((hint) => {
      if (hint.type === "near_canonical_key") {
        return `- near_canonical_key: ${hint.input} -> ${hint.suggestions.join(", ")}`;
      }

      return `- broaden_search: ${hint.message}`;
    }),
  ];
}

// ─── End moved functions ─────────────────────────────────────────────────────

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

export function formatWithLegacyProjectScopeNotice(text: string, scope?: MemoryScope | MemoryScope[]): string {
  return isLegacyProjectScopeSelected(scope) ? `${LEGACY_PROJECT_SCOPE_NOTICE}\n${text}` : text;
}

export function formatIdentityError(error: string, dbPath: string): string {
  return `Invalid memory scope identity: ${error}\ndb_path: ${dbPath}`;
}
