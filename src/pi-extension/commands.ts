import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

import { type CreateMemoryInput, type MemoryCore, type MemoryRecord, type MemorySearchResult, type MemoryStore, type SearchMemoriesInput } from "../core/index.ts";
import { formatAuditResults, runMemoryAudit } from "./audit.ts";
import { findLatestExactSessionHandoff } from "./handoffs.ts";
import {
  deriveMemoryTurnContext,
  findLatestHandoffForTurn,
  formatLatestHandoffLines,
  retrieveMemoriesForTurn,
  type LatestHandoffResult,
} from "./retrieval.ts";
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
        // No query — context mode: show what the agent currently sees. The
        // turn-start injection always leads with the active handoff, so this
        // view has to resolve it the same way to stay a faithful mirror.
        const session = activeStore.getSession(turnContext.sessionId);
        const latestHandoff = findLatestHandoffForTurn(activeStore, turnContext);
        const { results, searchPlan } = retrieveMemoriesForTurn(activeStore, CONTEXT_QUERY, turnContext, {
          resultLimit: MANUAL_SEARCH_RESULT_LIMIT,
          stageLimit: MANUAL_SEARCH_STAGE_LIMIT,
        });
        sendOutput(
          pi,
          formatContextSearch(results, searchPlan, turnContext, activeStore.dbPath, latestHandoff, session?.summary),
          ctx,
        );
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
      persistSessionSummaryMemory(activeStore, turnContext, summary);
      sendOutput(pi, formatMemorySessionSaved(session, activeStore.dbPath), ctx);
    },
  });

  pi.registerCommand("memory-export", {
    description: "Export all memories (active + archived) to a JSON file for backup or migration",
    handler: async (args, ctx) => {
      const activeStore = runtimeStore.getStoreForCwd(ctx.cwd);
      const target = args.trim();
      if (target.length === 0) {
        sendOutput(pi, "Usage: /memory-export <file.json>\nWrites all memories to the given path.", ctx);
        return;
      }

      const memories = [
        ...activeStore.listAllInternal({ status: "active" }),
        ...activeStore.listAllInternal({ status: "archived" }),
      ];
      const payload = {
        format: "pi-memory-export",
        version: 1,
        dbPath: activeStore.dbPath,
        count: memories.length,
        memories,
      };

      const outPath = resolve(target);
      try {
        writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
      } catch (error) {
        sendOutput(pi, `Export failed: ${(error as Error).message}`, ctx);
        return;
      }
      sendOutput(pi, `Exported ${memories.length} memor${memories.length !== 1 ? "ies" : "y"} to ${outPath}.`, ctx);
    },
  });

  pi.registerCommand("memory-import", {
    description: "Import memories from a /memory-export JSON file (keeps status and timestamps; assigns fresh ids)",
    handler: async (args, ctx) => {
      const activeStore = runtimeStore.getStoreForCwd(ctx.cwd);
      const target = args.trim();
      if (target.length === 0) {
        sendOutput(pi, "Usage: /memory-import <file.json>\nRe-creates memories from an export (fresh ids; archived stay archived; duplicates are skipped).", ctx);
        return;
      }

      let parsed: { memories?: unknown };
      try {
        parsed = JSON.parse(readFileSync(resolve(target), "utf8")) as { memories?: unknown };
      } catch (error) {
        sendOutput(pi, `Import failed: ${(error as Error).message}`, ctx);
        return;
      }

      const memories = Array.isArray(parsed.memories) ? (parsed.memories as MemoryRecord[]) : [];
      // Re-running a backup is the normal operator action here, so the counters have
      // to report what this run wrote — not what the file contained. Recognise a
      // record that is already stored before writing it, and keep the ids created so
      // far: createMemory collapses an exact duplicate by *returning* the pre-existing
      // row instead of throwing, so an already-known id also means nothing was
      // written. Without both, every duplicate lands in `imported` and a repeat import
      // claims a full import on a run that changed nothing.
      const existing = [
        ...activeStore.listAllInternal({ status: "active" }),
        ...activeStore.listAllInternal({ status: "archived" }),
      ];
      const storedKeys = new Set(existing.map(importDuplicateKey));
      const knownIds = new Set(existing.map((memory) => memory.id));
      let imported = 0;
      let archived = 0;
      let skipped = 0;
      for (const memory of memories) {
        try {
          if (storedKeys.has(importDuplicateKey(memory))) {
            skipped += 1;
            continue;
          }

          const input: CreateMemoryInput = {
            kind: memory.kind ?? undefined,
            scope: memory.scope,
            title: memory.title,
            summary: memory.summary,
            body: memory.body,
            tags: memory.tags,
            importance: memory.importance,
            confidence: memory.confidence,
            projectId: memory.projectId,
            repoPath: memory.repoPath,
            sessionId: memory.sessionId,
            pinned: memory.pinned,
            metadata: memory.metadata,
            sourceAgent: memory.sourceAgent,
          };
          // Restore the exported lifecycle instead of letting every record land
          // as a fresh active memory: archived entries must stay out of turn-start
          // injection, active caps, and audit staleness.
          const restored = activeStore.createMemory(input, {
            status: memory.status,
            createdAt: memory.createdAt,
            updatedAt: memory.updatedAt,
          });
          storedKeys.add(importDuplicateKey(restored));
          if (knownIds.has(restored.id)) {
            skipped += 1;
            continue;
          }
          knownIds.add(restored.id);
          imported += 1;
          if (restored.status === "archived") archived += 1;
        } catch {
          skipped += 1;
        }
      }
      sendOutput(
        pi,
        `Imported ${imported} memor${imported !== 1 ? "ies" : "y"} from ${resolve(target)} (${archived} archived, ${skipped} skipped).`,
        ctx,
      );
    },
  });

  pi.registerCommand("memory-audit", {
    description: "Audit memory hygiene, legacy workflow tags, and legacy project-scope migration candidates without writing changes",
    handler: async (_args, ctx) => {
      const activeStore = runtimeStore.getStoreForCwd(ctx.cwd);

      const { staleTodos, oldHandoffs, staleNotes, identityViolations, legacyWorkflowTags, projectMigrationPreview } = runMemoryAudit(activeStore);
      sendOutput(pi, formatAuditResults(staleTodos, oldHandoffs, activeStore.dbPath, identityViolations, projectMigrationPreview, legacyWorkflowTags, staleNotes), ctx);
    },
  });
}

/**
 * Identity under which /memory-import recognises a record it already holds.
 * Mirrors the store's exact-duplicate predicate — kind, scope, status and the
 * scope keys plus title and summary — and its whitespace normalization, so an
 * exported record matches the row a previous import created from it. Body, tags
 * and scores are deliberately excluded, exactly as in the store's own check.
 */
function importDuplicateKey(memory: Partial<MemoryRecord>): string {
  const text = (value: string | null | undefined): string =>
    typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

  return JSON.stringify([
    memory.kind ?? null,
    memory.scope ?? null,
    memory.status ?? "active",
    text(memory.repoPath),
    text(memory.projectId),
    text(memory.sessionId),
    text(memory.title),
    text(memory.summary),
  ]);
}

const SESSION_SUMMARY_TAG = "session-summary";

/**
 * Persist the session summary as an ordinary searchable memory (in addition to
 * the sessions table) so past summaries surface through memory_search and
 * turn-start retrieval. Deduped per session via metadata.sessionId so repeated
 * /memory-session-save calls update one memory instead of accumulating.
 */
function persistSessionSummaryMemory(
  store: MemoryStore,
  context: ReturnType<typeof deriveMemoryTurnContext>,
  summary: string,
): void {
  const scope = context.repoPath ? "repo" : "global";
  const existing = store
    .listAllInternal({
      status: "active",
      scope: [scope],
      tags: [SESSION_SUMMARY_TAG],
      ...(context.repoPath ? { repoPath: context.repoPath } : {}),
    })
    .find((memory) => memory.metadata?.sessionId === context.sessionId);

  try {
    if (existing) {
      store.updateMemory({ id: existing.id, summary });
      return;
    }

    store.createMemory({
      scope,
      title: `Session summary ${context.sessionId.slice(0, 8)}`,
      summary,
      tags: [SESSION_SUMMARY_TAG],
      repoPath: context.repoPath,
      projectId: context.projectId,
      metadata: { sessionId: context.sessionId },
      sourceAgent: "pi",
    });
  } catch {
    // Mirroring the summary into a searchable memory is best-effort; the
    // authoritative copy already lives in the sessions table.
  }
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
  latestHandoff: LatestHandoffResult | undefined,
  sessionSummary?: string,
): string {
  const lines = [
    "Current memory context (read-only). Use /memory-search <query> for targeted search.",
    `search_plan: ${searchPlan.map(formatSearchPlanStage).join(" -> ") || "none"}`,
    `session_id: ${context.sessionId}`,
    `project_id: ${context.projectId ?? "none"}`,
    `repo_path: ${context.repoPath ?? "none"}`,
    `session_summary: ${sessionSummary ?? "none"}`,
    ...(latestHandoff ? formatLatestHandoffLines(latestHandoff) : ["latest_handoff: none"]),
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
