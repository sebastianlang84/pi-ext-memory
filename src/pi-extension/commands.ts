import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

import { type MemoryCore, type MemorySearchResult, type MemoryStore, type SearchMemoriesInput } from "../core/index.ts";
import { resolveMemoryDbPath } from "./config.ts";
import { deriveMemoryTurnContext, retrieveMemoriesForTurn } from "./retrieval.ts";
import {
  formatMemoryReview,
  formatMemorySearchResultLine,
  formatMemorySessionSaved,
  formatMemorySessionSaveUsage,
  formatSearchPlanStage,
} from "./formatters.ts";
import { formatMemoryStatus, getNextStatusWidgetLines } from "./status.ts";

const MANUAL_SEARCH_RESULT_LIMIT = 8;
const MANUAL_SEARCH_STAGE_LIMIT = 6;
const MEMORY_REVIEW_QUERY = "decisions facts preferences todos risks next steps";
const MEMORY_REVIEW_RESULT_LIMIT = 8;
const MIN_SESSION_SUMMARY_LENGTH = 12;

export function registerMemoryCommands(pi: Pick<ExtensionAPI, "on" | "registerCommand">, core: MemoryCore): void {
  let store: MemoryStore | undefined;
  let isStatusWidgetVisible = false;

  pi.on("session_shutdown", async (_event, ctx) => {
    if (ctx.hasUI) {
      ctx.ui.setWidget("pi-memory-status", undefined);
      ctx.ui.setWidget("pi-memory-search", undefined);
      ctx.ui.setWidget("pi-memory-review", undefined);
      ctx.ui.setWidget("pi-memory-session-save", undefined);
    }

    isStatusWidgetVisible = false;
    store?.close();
    store = undefined;
  });

  pi.registerCommand("memory-status", {
    description: "Show the current pi-memory bootstrap status",
    handler: async (_args, ctx) => {
      const status = core.getStatus();
      const output = formatMemoryStatus(status, ctx.cwd);

      if (ctx.hasUI) {
        const widgetLines = getNextStatusWidgetLines(isStatusWidgetVisible, status, ctx.cwd);
        isStatusWidgetVisible = widgetLines !== undefined;
        ctx.ui.setWidget("pi-memory-status", widgetLines);
        ctx.ui.notify(isStatusWidgetVisible ? "pi-memory status shown" : "pi-memory status cleared", "info");
        return;
      }

      process.stdout.write(`${output}\n`);
    },
  });

  pi.registerCommand("memory-search", {
    description: "Run a manual staged memory search for the current context",
    handler: async (args, ctx) => {
      const query = args.trim();
      if (query.length < 2) {
        writeCommandOutput("Usage: /memory-search <query>", ctx);
        return;
      }

      const activeStore = getStoreForCwd(core, store, ctx.cwd);
      store = activeStore;

      const turnContext = deriveMemoryTurnContext(ctx.cwd, ctx.sessionManager.getSessionId());
      const { results, searchPlan } = retrieveMemoriesForTurn(activeStore, query, turnContext, {
        resultLimit: MANUAL_SEARCH_RESULT_LIMIT,
        stageLimit: MANUAL_SEARCH_STAGE_LIMIT,
      });

      const output = formatManualMemorySearch(query, results, searchPlan, turnContext, activeStore.dbPath);

      if (ctx.hasUI) {
        ctx.ui.setWidget("pi-memory-search", output.split("\n"));
        ctx.ui.notify("pi-memory search updated", "info");
        return;
      }

      process.stdout.write(`${output}\n`);
    },
  });

  pi.registerCommand("memory-review", {
    description: "Show relevant existing memories and explicit suggested next actions without saving anything",
    handler: async (_args, ctx) => {
      const activeStore = getStoreForCwd(core, store, ctx.cwd);
      store = activeStore;

      const turnContext = deriveMemoryTurnContext(ctx.cwd, ctx.sessionManager.getSessionId());
      const session = activeStore.getSession(turnContext.sessionId);
      const { results, searchPlan } = retrieveMemoriesForTurn(activeStore, MEMORY_REVIEW_QUERY, turnContext, {
        resultLimit: MEMORY_REVIEW_RESULT_LIMIT,
        stageLimit: MANUAL_SEARCH_STAGE_LIMIT,
      });
      const output = formatMemoryReview(results, searchPlan, turnContext, activeStore.dbPath, session?.summary);

      if (ctx.hasUI) {
        ctx.ui.setWidget("pi-memory-review", output.split("\n"));
        ctx.ui.notify("pi-memory review updated", "info");
        return;
      }

      process.stdout.write(`${output}\n`);
    },
  });

  pi.registerCommand("memory-session-save", {
    description: "Persist a compact summary for the current Pi session",
    handler: async (args, ctx) => {
      const summary = args.trim();
      if (summary.length < MIN_SESSION_SUMMARY_LENGTH) {
        writeCommandOutput(formatMemorySessionSaveUsage(MIN_SESSION_SUMMARY_LENGTH), ctx);
        return;
      }

      const activeStore = getStoreForCwd(core, store, ctx.cwd);
      store = activeStore;

      const turnContext = deriveMemoryTurnContext(ctx.cwd, ctx.sessionManager.getSessionId());
      const session = activeStore.saveSessionSummary({
        sessionId: turnContext.sessionId,
        summary,
        projectId: turnContext.projectId,
        repoPath: turnContext.repoPath,
      });
      const output = formatMemorySessionSaved(session, activeStore.dbPath);

      if (ctx.hasUI) {
        ctx.ui.setWidget("pi-memory-session-save", output.split("\n"));
        ctx.ui.notify("pi-memory session summary saved", "info");
        return;
      }

      process.stdout.write(`${output}\n`);
    },
  });
}

function getStoreForCwd(core: MemoryCore, currentStore: MemoryStore | undefined, _cwd: string): MemoryStore {
  const dbPath = resolveMemoryDbPath();

  if (currentStore?.dbPath === dbPath) {
    return currentStore;
  }

  currentStore?.close();
  return core.initializeStore({ dbPath });
}

function writeCommandOutput(output: string, ctx: ExtensionCommandContext): void {
  if (ctx.hasUI) {
    ctx.ui.notify(output, "warning");
    return;
  }

  process.stdout.write(`${output}\n`);
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
