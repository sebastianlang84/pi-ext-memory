import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

import { type MemoryCore, type MemoryRecord, type MemorySearchResult, type SearchMemoriesInput } from "../core/index.ts";
import { formatAuditResults, runMemoryAudit } from "./audit.ts";
import { findLatestExactSessionHandoff } from "./handoffs.ts";
import { deriveMemoryTurnContext, findLatestHandoffForTurn, retrieveMemoriesForTurn } from "./retrieval.ts";
import {
  formatMemorySearchResultLine,
  formatMemorySessionSaved,
  formatMemorySessionSaveUsage,
  formatSearchPlanStage,
} from "./formatters.ts";
import { createMemoryRuntimeStore, type MemoryRuntimeStore } from "./runtime-store.ts";
import { formatMemoryStatus } from "./status.ts";

const MANUAL_SEARCH_RESULT_LIMIT = 8;
const MANUAL_SEARCH_STAGE_LIMIT = 6;
const CONTEXT_QUERY = "todos handoffs risks next steps context";
const MIN_SESSION_SUMMARY_LENGTH = 12;

export function registerMemoryCommands(
  pi: Pick<ExtensionAPI, "on" | "registerCommand" | "sendMessage">,
  core: MemoryCore,
  runtimeStore: MemoryRuntimeStore = createMemoryRuntimeStore(core),
): void {
  pi.on("session_shutdown", async () => {
    runtimeStore.close();
  });

  pi.registerCommand("memory-status", {
    description: "Show the current pi-memory bootstrap status",
    handler: async (_args, ctx) => {
      const status = core.getStatus();
      sendOutput(pi, formatMemoryStatus(status, ctx.cwd), ctx);
    },
  });

  pi.registerCommand("memory-search", {
    description: "Search memories. With a query: targeted search. Without a query: shows current context (todos, handoffs, next steps).",
    handler: async (args, ctx) => {
      const query = args.trim();
      const activeStore = runtimeStore.getStoreForCwd(ctx.cwd);
      const turnContext = deriveMemoryTurnContext(ctx.cwd, ctx.sessionManager.getSessionId());

      if (query.length === 0) {
        // No query — context mode: show what the agent currently sees
        const session = activeStore.getSession(turnContext.sessionId);
        const { results, searchPlan } = retrieveMemoriesForTurn(activeStore, CONTEXT_QUERY, turnContext, {
          resultLimit: MANUAL_SEARCH_RESULT_LIMIT,
          stageLimit: MANUAL_SEARCH_STAGE_LIMIT,
        });
        sendOutput(pi, formatContextSearch(results, searchPlan, turnContext, activeStore.dbPath, session?.summary), ctx);
        return;
      }

      const { results, searchPlan } = retrieveMemoriesForTurn(activeStore, query, turnContext, {
        resultLimit: MANUAL_SEARCH_RESULT_LIMIT,
        stageLimit: MANUAL_SEARCH_STAGE_LIMIT,
      });
      sendOutput(pi, formatManualMemorySearch(query, results, searchPlan, turnContext, activeStore.dbPath), ctx);
    },
  });

  pi.registerCommand("memory-handoff", {
    description: "Show or archive the active handoff for the current Pi session",
    handler: async (args, ctx) => {
      const action = args.trim() || "show";
      const activeStore = runtimeStore.getStoreForCwd(ctx.cwd);

      const turnContext = deriveMemoryTurnContext(ctx.cwd, ctx.sessionManager.getSessionId());

      if (action === "archive") {
        const sessionId = turnContext.sessionId.trim();
        if (sessionId.length === 0) {
          sendOutput(pi, "Cannot archive handoff without a stable Pi session id.", ctx);
          return;
        }

        const current = findLatestExactSessionHandoff(activeStore, sessionId);
        if (!current) {
          sendOutput(pi, "No active handoff found for the current session.", ctx);
          return;
        }

        const archived = activeStore.archiveMemory({ id: current.id, reason: "handoff archived from /memory-handoff" });
        sendOutput(pi, formatMemoryHandoffArchived(archived, activeStore.dbPath), ctx);
        return;
      }

      if (action !== "show") {
        sendOutput(pi, "Usage: /memory-handoff [show|archive]\nUse memory_save_handoff to create or update a handoff.", ctx);
        return;
      }

      const latestHandoff = findLatestHandoffForTurn(activeStore, turnContext);
      sendOutput(pi, formatMemoryHandoff(latestHandoff?.memory, activeStore.dbPath, latestHandoff?.isFallback ?? false), ctx);
    },
  });

  pi.registerCommand("memory-session-save", {
    description: "Persist a compact summary for the current Pi session",
    handler: async (args, ctx) => {
      const summary = args.trim();
      if (summary.length < MIN_SESSION_SUMMARY_LENGTH) {
        sendOutput(pi, formatMemorySessionSaveUsage(MIN_SESSION_SUMMARY_LENGTH), ctx);
        return;
      }

      const activeStore = runtimeStore.getStoreForCwd(ctx.cwd);

      const turnContext = deriveMemoryTurnContext(ctx.cwd, ctx.sessionManager.getSessionId());
      const session = activeStore.saveSessionSummary({
        sessionId: turnContext.sessionId,
        summary,
        projectId: turnContext.projectId,
        repoPath: turnContext.repoPath,
      });
      sendOutput(pi, formatMemorySessionSaved(session, activeStore.dbPath), ctx);
    },
  });

  pi.registerCommand("memory-audit", {
    description: "Audit memory hygiene, legacy workflow tags, and legacy project-scope migration candidates without writing changes",
    handler: async (_args, ctx) => {
      const activeStore = runtimeStore.getStoreForCwd(ctx.cwd);

      const { staleTodos, oldHandoffs, identityViolations, legacyWorkflowTags, projectMigrationPreview } = runMemoryAudit(activeStore);
      sendOutput(pi, formatAuditResults(staleTodos, oldHandoffs, activeStore.dbPath, identityViolations, projectMigrationPreview, legacyWorkflowTags), ctx);
    },
  });
}

function formatMemoryHandoff(memory: MemoryRecord | undefined, dbPath: string, isFallback: boolean): string {
  if (!memory) {
    return [
      "No active handoff found for this session/repo/project.",
      "Use memory_save_handoff before context reset, compaction, wrap-up, or agent transfer.",
      `db_path: ${dbPath}`,
    ].join("\n");
  }

  return [
    `Latest active handoff${isFallback ? " (fallback from another matching session/repo/project)" : ""}.`,
    `id: ${memory.id}`,
    `title: ${memory.title}`,
    `summary: ${memory.summary}`,
    `scope: ${memory.scope}`,
    `session_id: ${memory.sessionId ?? "none"}`,
    `project_id: ${memory.projectId ?? "none"}`,
    `repo_path: ${memory.repoPath ?? "none"}`,
    `updated_at: ${memory.updatedAt}`,
    memory.body ?? "body: none",
    `db_path: ${dbPath}`,
  ].join("\n");
}

function formatMemoryHandoffArchived(memory: MemoryRecord, dbPath: string): string {
  return [`Archived handoff ${memory.id}.`, `title: ${memory.title}`, `updated_at: ${memory.updatedAt}`, `db_path: ${dbPath}`].join("\n");
}

function sendOutput(
  pi: Pick<ExtensionAPI, "sendMessage">,
  output: string,
  ctx: ExtensionCommandContext,
): void {
  if (ctx.hasUI) {
    pi.sendMessage({ customType: "pi-memory-command-output", content: output, display: output });
    return;
  }
  process.stdout.write(`${output}\n`);
}

function formatContextSearch(
  results: MemorySearchResult[],
  searchPlan: SearchMemoriesInput[],
  context: { sessionId: string; projectId?: string; repoPath?: string },
  dbPath: string,
  sessionSummary?: string,
): string {
  const lines = [
    "Current memory context (read-only). Use /memory-search <query> for targeted search.",
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

function formatManualMemorySearch(
  query: string,
  results: MemorySearchResult[],
  searchPlan: SearchMemoriesInput[],
  context: { sessionId: string; projectId?: string; repoPath?: string },
  dbPath: string,
): string {
  const lines = [
    `Manual memory search for "${query}".`,
    `search_plan: ${searchPlan.map(formatSearchPlanStage).join(" -> ") || "none"}`,
    `session_id: ${context.sessionId}`,
    `project_id: ${context.projectId ?? "none"}`,
    `repo_path: ${context.repoPath ?? "none"}`,
  ];

  if (results.length === 0) {
    lines.push("results: none", `db_path: ${dbPath}`);
    return lines.join("\n");
  }

  lines.push(
    `results: ${results.length}`,
    ...results.map((result, index) => formatMemorySearchResultLine(index + 1, result)),
    `db_path: ${dbPath}`,
  );

  return lines.join("\n");
}
