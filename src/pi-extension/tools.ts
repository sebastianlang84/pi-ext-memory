import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "typebox";

import {
  MEMORY_KINDS,
  MEMORY_LIST_ORDER_BY,
  MEMORY_SCOPES,
  MEMORY_STATUSES,
  type MemoryKind,
  type MemoryScope,
  type MemoryStore,
  getCapForKindScope,
} from "../core/index.ts";
import {
  buildHandoffMemoryInput,
  buildTodoSummary,
  formatListResult,
  formatMemoryArchived,
  formatMemorySearchResults,
  formatMemorySaved,
  formatMemoryUpdated,
} from "./formatters.ts";
import { findLatestExactSessionHandoff } from "./handoffs.ts";
import { decorateCreateMemoryInput } from "./retrieval.ts";
import { formatAuditResults, runMemoryAudit } from "./audit.ts";
import { createToolShell } from "./tool-shell.ts";


function normalizeOptionalArray<T>(value?: T | T[]): T[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

export function registerMemoryTools(pi: Pick<ExtensionAPI, "registerTool">, getActiveStore: (cwd: string) => MemoryStore): void {
  const shell = createToolShell(getActiveStore);
  pi.registerTool({
    name: "memory_search",
    label: "Memory Search",
    description: "Search local memory content.",
    promptSnippet: "Search durable memory when automatic context is insufficient.",
    promptGuidelines: [
      "Use memory_search for compact content searches.",
      "Use memory_search filters only when they materially narrow results.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Content search query" }),
      kind: Type.Optional(Type.Array(StringEnum(MEMORY_KINDS, { description: "Memory kind" }), { description: "Memory kind" })),
      scope: Type.Optional(Type.Array(StringEnum(MEMORY_SCOPES, { description: "Memory scope; normal choices are global, repo, and session; project is legacy/advanced compatibility" }))),
      tags: Type.Optional(Type.Array(Type.String({ description: "Tag" }))),
      projectId: Type.Optional(Type.String({ description: "Legacy/advanced project identifier filter; prefer repoPath for normal repo memory" })),
      repoPath: Type.Optional(Type.String({ description: "Optional repository path filter" })),
      sessionId: Type.Optional(Type.String({ description: "Optional session identifier filter" })),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 20, description: "Max result count" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { store, identityErrorResponse, withLegacyNotice, resolveSearchIdentity, turnContext } = shell.forCwd(ctx.cwd, ctx.sessionManager.getSessionId());
      const identity = resolveSearchIdentity(params, turnContext);
      if (identity.error) return identityErrorResponse(identity.error);
      const results = store.searchMemories({
        ...params,
        sessionId: identity.sessionId,
        projectId: identity.projectId,
        repoPath: identity.repoPath,
      });
      return {
        content: [{ type: "text", text: withLegacyNotice(formatMemorySearchResults(params.query, results, store.dbPath), params.scope as MemoryScope[] | undefined) }],
        details: { dbPath: store.dbPath, results },
      };
    },
  });

  pi.registerTool({
    name: "memory_list",
    label: "Memory List",
    description: "List structured memories by filters.",
    promptSnippet: "List known structured memories, especially todos or handoffs.",
    promptGuidelines: [
      "Use memory_list for structured listing, especially active todos/handoffs.",
      "Use memory_list for structured fields; use memory_search for text/content search.",
    ],
    parameters: Type.Object({
      kind: Type.Optional(Type.Union([StringEnum(MEMORY_KINDS, { description: "Memory kind" }), Type.Array(StringEnum(MEMORY_KINDS, { description: "Memory kind" }))])),
      scope: Type.Optional(Type.Union([StringEnum(MEMORY_SCOPES, { description: "Memory scope; normal choices are global, repo, and session; project is legacy/advanced compatibility" }), Type.Array(StringEnum(MEMORY_SCOPES, { description: "Memory scope" }))])),
      tags: Type.Optional(Type.Array(Type.String({ description: "Tag" }))),
      sessionId: Type.Optional(Type.String({ description: "Optional session identifier filter" })),
      projectId: Type.Optional(Type.String({ description: "Legacy/advanced project identifier filter; prefer repoPath for normal repo memory" })),
      repoPath: Type.Optional(Type.String({ description: "Optional repository path filter" })),
      status: Type.Optional(StringEnum(MEMORY_STATUSES, { description: "Memory lifecycle status; defaults to active" })),
      orderBy: Type.Optional(StringEnum(MEMORY_LIST_ORDER_BY, { description: "Newest-first ordering field" })),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, default: 20 })),
      offset: Type.Optional(Type.Number({ minimum: 0, default: 0 })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { store, identityErrorResponse, withLegacyNotice, resolveSearchIdentity, turnContext } = shell.forCwd(ctx.cwd, ctx.sessionManager.getSessionId());
      const kindFilter = normalizeOptionalArray(params.kind as MemoryKind | MemoryKind[] | undefined);
      const scopeFilter = normalizeOptionalArray(params.scope as MemoryScope | MemoryScope[] | undefined);
      const identity = resolveSearchIdentity(
        { scope: scopeFilter, sessionId: params.sessionId, projectId: params.projectId, repoPath: params.repoPath },
        turnContext,
      );
      if (identity.error) return identityErrorResponse(identity.error);
      const result = store.listForTool({
        kind: kindFilter,
        scope: scopeFilter,
        tags: params.tags,
        sessionId: identity.sessionId,
        projectId: identity.projectId,
        repoPath: identity.repoPath,
        status: params.status,
        orderBy: params.orderBy,
        limit: params.limit ?? 20,
        offset: params.offset ?? 0,
      });
      return {
        content: [{ type: "text", text: withLegacyNotice(formatListResult(result, store.dbPath), scopeFilter) }],
        details: {
          dbPath: store.dbPath,
          total_count: result.totalCount,
          count: result.items.length,
          has_more: result.hasMore,
          next_offset: result.nextOffset,
          items: result.items,
        },
      };
    },
  });

  pi.registerTool({
    name: "memory_save",
    label: "Memory Save",
    description: "Save durable memory notes.",
    promptSnippet: "Save durable notes, facts, decisions, or reusable context.",
    promptGuidelines: [
      "Use memory_save only for durable notes/facts/decisions/context.",
      "Use memory_save_todo for actionable work and memory_save_handoff for handoffs, not memory_save.",
      "Avoid low-information memory_save saves; write compact summaries.",
    ],
    parameters: Type.Object({
      scope: Type.Optional(StringEnum(MEMORY_SCOPES, { description: "Memory scope; defaults to repo inside a Git repo, otherwise global; project is legacy/advanced compatibility" })),
      title: Type.String({ description: "Short title for the memory" }),
      summary: Type.String({ description: "Compact summary with enough detail to be useful later" }),
      body: Type.Optional(Type.String({ description: "Optional longer details" })),
      tags: Type.Optional(Type.Array(Type.String({ description: "Tag" }))),
      importance: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { store, identityErrorResponse, withLegacyNotice, resolveWriteIdentity, turnContext } = shell.forCwd(ctx.cwd, ctx.sessionManager.getSessionId());

      const requestedScope = (params.scope ?? (turnContext.repoPath ? "repo" : "global")) as MemoryScope;
      const rawIdentityParams = params as typeof params & { sessionId?: string; projectId?: string; repoPath?: string };
      const identity = resolveWriteIdentity(
        {
          scope: requestedScope,
          sessionId: rawIdentityParams.sessionId,
          projectId: rawIdentityParams.projectId,
          repoPath: rawIdentityParams.repoPath,
        },
        turnContext,
        { requirePrimary: requestedScope !== "global" },
      );
      if (identity.error) return identityErrorResponse(identity.error);
      const memory = store.createMemory({
        ...decorateCreateMemoryInput(
          {
            ...params,
            kind: undefined,
            scope: requestedScope,
            sessionId: identity.sessionId,
            projectId: identity.projectId,
            repoPath: identity.repoPath,
          },
          turnContext,
        ),
        sourceAgent: "pi",
      });
      return {
        content: [{ type: "text", text: withLegacyNotice(formatMemorySaved(memory, store), requestedScope) }],
        details: { dbPath: store.dbPath, memory },
      };
    },
  });

  pi.registerTool({
    name: "memory_save_handoff",
    label: "Memory Save Handoff",
    description: "Save or update a resumable session handoff.",
    promptSnippet: "Save handoff state for context loss, compaction, session end, or agent transfer.",
    promptGuidelines: [
      "Use memory_save_handoff only for genuine context loss or transfer.",
      "Include memory_save_handoff current state, next steps, blockers, and verification when relevant.",
    ],
    parameters: Type.Object({
      title: Type.Optional(Type.String({ description: "Short handoff title" })),
      handoffReason: StringEnum(["context_reset", "agent_transfer", "compaction", "session_end"] as const, {
        description: "Why the handoff is needed — must be a genuine context-loss or transfer scenario",
      }),
      recipient: Type.Optional(
        StringEnum(["same_agent", "next_agent", "human"] as const, {
          description: "Who will resume from this handoff",
        }),
      ),
      resumeInstruction: Type.String({ description: "One-line instruction for the resuming agent on where to start" }),
      goal: Type.String({ minLength: 1, description: "Current task goal" }),
      currentState: Type.String({ minLength: 1, description: "Where the task stands right now" }),
      nextSteps: Type.Array(Type.String({ minLength: 1, description: "Concrete next step" }), { minItems: 1 }),
      done: Type.Optional(Type.Array(Type.String({ description: "Completed step" }))),
      changedFiles: Type.Optional(Type.Array(Type.String({ description: "Changed or especially relevant file path" }))),
      decisions: Type.Optional(Type.Array(Type.String({ description: "Decision made during this task" }))),
      blockers: Type.Optional(Type.Array(Type.String({ description: "Blocker" }))),
      openQuestions: Type.Optional(Type.Array(Type.String({ description: "Open question" }))),
      verification: Type.Optional(Type.Array(Type.String({ description: "Verification already run or still missing" }))),
      risks: Type.Optional(Type.Array(Type.String({ description: "Risk or caveat" }))),
      avoidRepeating: Type.Optional(Type.Array(Type.String({ description: "Work the next agent should not repeat" }))),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { store, turnContext } = shell.forCwd(ctx.cwd, ctx.sessionManager.getSessionId());
      const sessionId = turnContext.sessionId.trim();

      if (sessionId.length === 0) {
        return {
          content: [{ type: "text", text: `Cannot save handoff without a stable Pi session id.\ndb_path: ${store.dbPath}` }],
          details: { dbPath: store.dbPath },
        };
      }

      const handoffInput = buildHandoffMemoryInput(params, turnContext);
      const existingHandoff = findLatestExactSessionHandoff(store, sessionId);

      const memory = existingHandoff
        ? store.updateMemory({
            id: existingHandoff.id,
            title: handoffInput.title,
            summary: handoffInput.summary,
            body: handoffInput.body,
            tags: handoffInput.tags,
            importance: handoffInput.importance,
            confidence: handoffInput.confidence,
          })
        : store.createMemory({ ...handoffInput, sourceAgent: "pi" });

      const activeHandoffCount = store.count({
        kind: ["handoff"],
        status: "active",
        ...(turnContext.repoPath ? { repoPath: turnContext.repoPath } : {}),
      });
      const handoffWarning = activeHandoffCount >= 3
        ? `\nwarning: ${activeHandoffCount} active handoffs for this repo — consider archiving old ones.`
        : "";

      return {
        content: [{ type: "text", text: formatMemorySaved(memory, store) + handoffWarning }],
        details: { dbPath: store.dbPath, memory },
      };
    },
  });

  pi.registerTool({
    name: "memory_update",
    label: "Memory Update",
    description: "Patch, close, or archive an existing memory.",
    promptSnippet: "Update known memories instead of creating duplicates.",
    promptGuidelines: [
      "Use memory_update only with a known memory id.",
      "Prefer memory_update over creating duplicate memories.",
    ],
    parameters: Type.Object({
      id: Type.String({ description: "Memory id to update" }),
      title: Type.Optional(Type.String({ description: "Updated short title" })),
      summary: Type.Optional(Type.String({ description: "Updated compact summary" })),
      body: Type.Optional(Type.Union([Type.String({ description: "Updated longer details" }), Type.Null()])),
      tags: Type.Optional(Type.Array(Type.String({ description: "Replacement tag list" }))),
      importance: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      status: Type.Optional(StringEnum(MEMORY_STATUSES, { description: "Memory lifecycle status" })),
      archiveReason: Type.Optional(Type.String({ description: "Reason for archiving; only valid with status=archived" })),
      pinned: Type.Optional(Type.Boolean({ description: "Whether the memory should stay pinned" })),
      scope: Type.Optional(StringEnum(MEMORY_SCOPES, { description: "Updated scope — use with caution; normal choices are global, repo, and session; project is legacy/advanced compatibility" })),
      repoPath: Type.Optional(Type.String({ description: "Updated repoPath" })),
      projectId: Type.Optional(Type.String({ description: "Updated legacy/advanced projectId" })),
      priority: Type.Optional(StringEnum(["P0", "P1", "P2"] as const, { description: "Todo priority — only applies when kind=todo" })),
      nextAction: Type.Optional(Type.String({ description: "Next concrete action — only applies when kind=todo" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { store, identityErrorResponse, withLegacyNotice, resolveWriteIdentity, turnContext } = shell.forCwd(ctx.cwd, ctx.sessionManager.getSessionId());

      const existingMemory = store.getMemory(params.id);
      if (!existingMemory) {
        return {
          content: [{ type: "text", text: `Memory ${params.id} was not found.\ndb_path: ${store.dbPath}` }],
          details: { dbPath: store.dbPath },
        };
      }
      if (existingMemory.kind === "handoff") {
        const handoffContentFields = [
          params.title,
          params.summary,
          params.body,
          params.tags,
          params.importance,
          params.confidence,
          params.pinned,
          params.scope,
          params.repoPath,
          params.projectId,
          params.priority,
          params.nextAction,
        ];
        if (handoffContentFields.some((value) => value !== undefined)) {
          return {
            content: [{ type: "text", text: `Use memory_save_handoff for handoff content changes; memory_update may only change handoff status.\ndb_path: ${store.dbPath}` }],
            details: { dbPath: store.dbPath, memory: existingMemory },
          };
        }
      }

      if (params.archiveReason !== undefined && params.status !== "archived") {
        return {
          content: [{ type: "text", text: `archiveReason is only valid with status=archived.\ndb_path: ${store.dbPath}` }],
          details: { dbPath: store.dbPath, memory: existingMemory },
        };
      }

      // Validate todo-specific fields
      if ((params.priority !== undefined || params.nextAction !== undefined) && existingMemory.kind !== "todo") {
        return {
          content: [{ type: "text", text: `priority and nextAction are only valid for kind=todo memories.\ndb_path: ${store.dbPath}` }],
          details: { dbPath: store.dbPath, memory: existingMemory },
        };
      }

      // Build updated params for todo-specific fields
      let updateParams = { ...params } as typeof params & { summary?: string; tags?: string[] };

      if (params.scope !== undefined || params.projectId !== undefined || params.repoPath !== undefined) {
        if (params.scope === "global" && (existingMemory.sessionId || existingMemory.projectId || existingMemory.repoPath)) {
          return {
            content: [{ type: "text", text: identityErrorResponse("memory_update cannot change an identified memory to scope=global because project/repo/session identifiers cannot be cleared by this tool.").content[0].text }],
            details: { dbPath: store.dbPath, memory: existingMemory },
          };
        }

        if (params.scope === "session" && !existingMemory.sessionId) {
          return {
            content: [{ type: "text", text: identityErrorResponse("memory_update cannot change a non-session memory to scope=session because sessionId cannot be patched by this tool.").content[0].text }],
            details: { dbPath: store.dbPath, memory: existingMemory },
          };
        }

        if (params.scope !== undefined && params.scope !== "session" && existingMemory.sessionId) {
          return {
            content: [{ type: "text", text: identityErrorResponse("memory_update cannot change a session memory to repo/project/global because sessionId cannot be cleared by this tool.").content[0].text }],
            details: { dbPath: store.dbPath, memory: existingMemory },
          };
        }

        const identity = resolveWriteIdentity(
          {
            scope: (params.scope ?? existingMemory.scope) as MemoryScope,
            projectId: params.projectId,
            repoPath: params.repoPath,
            sessionId: existingMemory.sessionId,
          },
          turnContext,
          { requirePrimary: params.scope === "repo" || params.scope === "project" },
        );
        if (identity.error) {
          return {
            content: [{ type: "text", text: identityErrorResponse(identity.error).content[0].text }],
            details: { dbPath: store.dbPath, memory: existingMemory },
          };
        }

        if (params.scope === "repo" && identity.repoPath) {
          updateParams = { ...updateParams, repoPath: identity.repoPath };
        }
        if (params.scope === "project" && identity.projectId) {
          updateParams = { ...updateParams, projectId: identity.projectId };
        }
      }
      if (existingMemory.kind === "todo" && (params.priority !== undefined || params.nextAction !== undefined)) {
        const baseSummary = existingMemory.summary
          .replace(/^\[P[012]\]\s*/, "")
          .replace(/\s*→\s*.+$/, "");
        const currentNextAction = existingMemory.summary.match(/→\s*(.+)$/)?.[1];
        const newPriority = params.priority ?? (existingMemory.tags.find((t) => t === "P0" || t === "P1" || t === "P2") as "P0" | "P1" | "P2" | undefined);
        const newNextAction = params.nextAction ?? currentNextAction;
        const updatedSummary = buildTodoSummary({ title: existingMemory.title, priority: newPriority, nextAction: newNextAction, description: baseSummary });

        // Replace priority tag
        const tagsWithoutPriority = (params.tags ?? existingMemory.tags).filter((t) => t !== "P0" && t !== "P1" && t !== "P2");
        const updatedTags = newPriority ? [...tagsWithoutPriority, newPriority] : tagsWithoutPriority;

        let effectiveSummary: string;
        if (updateParams.summary !== undefined) {
          // Caller provided explicit summary — ensure it has the correct priority prefix
          const strippedCallerSummary = updateParams.summary.replace(/^\[P[012]\]\s*/, "");
          effectiveSummary = newPriority ? `[${newPriority}] ${strippedCallerSummary}` : strippedCallerSummary;
        } else {
          effectiveSummary = updatedSummary;
        }
        updateParams = { ...updateParams, summary: effectiveSummary, tags: updatedTags };
      }

      if (params.status === "archived" && params.archiveReason !== undefined) {
        const archiveCombinedPatchFields = [
          params.title,
          params.summary,
          params.body,
          params.tags,
          params.importance,
          params.confidence,
          params.pinned,
          params.scope,
          params.repoPath,
          params.projectId,
          params.priority,
          params.nextAction,
        ];
        if (archiveCombinedPatchFields.some((value) => value !== undefined)) {
          return {
            content: [{ type: "text", text: `memory_update archiveReason cannot be combined with other field patches; archive first, then patch only if still needed.\ndb_path: ${store.dbPath}` }],
            details: { dbPath: store.dbPath, memory: existingMemory },
          };
        }
        const memory = store.archiveMemory({ id: params.id, reason: params.archiveReason });
        return {
          content: [{ type: "text", text: formatMemoryArchived(memory, store.dbPath) }],
          details: { dbPath: store.dbPath, memory },
        };
      }

      const { archiveReason: _archiveReason, ...coreUpdateParams } = updateParams;
      const memory = store.updateMemory(coreUpdateParams);
      return {
        content: [{ type: "text", text: withLegacyNotice(formatMemoryUpdated(memory, store), params.scope as MemoryScope | undefined) }],
        details: { dbPath: store.dbPath, memory },
      };
    },
  });

  pi.registerTool({
    name: "memory_save_todo",
    label: "Memory Save Todo",
    description: "Save a persistent actionable todo.",
    promptSnippet: "Save new persistent work items; update existing todos with memory_update.",
    promptGuidelines: [
      "Use memory_save_todo for persistent actionable work.",
      "Use memory_save_todo with nextAction when possible; update existing todos instead of duplicating.",
      "Keep repo-canonical backlog in TODO.md when applicable; use memory_save_todo only for cross-session agent memory.",
    ],
    parameters: Type.Object({
      title: Type.String({ description: "Short title for the todo" }),
      description: Type.Optional(Type.String({ description: "Longer description of the task" })),
      priority: Type.Optional(StringEnum(["P0", "P1", "P2"] as const, { description: "Priority: P0=critical, P1=important, P2=nice-to-have" })),
      status: Type.Optional(StringEnum(["open", "in_progress", "blocked"] as const, { description: "Current status of the todo" })),
      scope: Type.Optional(StringEnum(MEMORY_SCOPES, { description: "Memory scope; normal choices are global, repo, and session; project is legacy/advanced compatibility" })),
      projectId: Type.Optional(Type.String({ description: "Legacy/advanced project identifier; prefer repoPath for normal repo todos" })),
      repoPath: Type.Optional(Type.String({ description: "Optional repository path" })),
      nextAction: Type.Optional(Type.String({ description: "The immediate next concrete action to take" })),
      tags: Type.Optional(Type.Array(Type.String({ description: "Tag" }))),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { store, identityErrorResponse, withLegacyNotice, resolveWriteIdentity, turnContext } = shell.forCwd(ctx.cwd, ctx.sessionManager.getSessionId());
      const requestedScope = (params.scope ?? (turnContext.repoPath ? "repo" : "global")) as MemoryScope;
      const identity = resolveWriteIdentity(
        { scope: requestedScope, projectId: params.projectId, repoPath: params.repoPath },
        turnContext,
        { requirePrimary: requestedScope !== "global" },
      );
      if (identity.error) return identityErrorResponse(identity.error);

      const tags = [...(params.tags ?? []), "todo"];
      if (params.priority) tags.push(params.priority);
      if (params.status && params.status !== "open") tags.push(params.status);

      const summary = buildTodoSummary(params);

      const memory = store.createMemory({
        ...decorateCreateMemoryInput(
          {
            kind: "todo",
            scope: requestedScope,
            title: params.title,
            summary,
            body: params.description,
            tags,
            importance: params.priority === "P0" ? 0.95 : params.priority === "P1" ? 0.75 : 0.5,
            confidence: 1,
            projectId: identity.projectId,
            repoPath: identity.repoPath,
            sessionId: identity.sessionId,
          },
          turnContext,
        ),
        sourceAgent: "pi",
      });
      return {
        content: [{ type: "text", text: withLegacyNotice(formatMemorySaved(memory, store), requestedScope) }],
        details: { dbPath: store.dbPath, memory },
      };
    },
  });

  pi.registerTool({
    name: "memory_audit",
    label: "Memory Audit",
    description: "Audit memory hygiene.",
    promptSnippet: "Inspect memory hygiene and legacy scope migration candidates.",
    promptGuidelines: [
      "Use memory_audit for memory hygiene or legacy scope migration review.",
    ],
    parameters: Type.Object({
      scope: Type.Optional(Type.Array(StringEnum(MEMORY_SCOPES, { description: "Memory scope filter; normal choices are global, repo, and session; project is legacy/advanced compatibility" }))),
      repoPath: Type.Optional(Type.String({ description: "Optional repository path filter" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { store, withLegacyNotice } = shell.forCwd(ctx.cwd, ctx.sessionManager.getSessionId());
      const { staleTodos, oldHandoffs, identityViolations, projectMigrationPreview } = runMemoryAudit(store, params.scope, params.repoPath);
      const now = new Date().toISOString();
      const totalFindings = staleTodos.length + oldHandoffs.length + identityViolations.length + projectMigrationPreview.length;
      store.setMeta("lastAuditAt", now);
      store.setMeta("lastAuditSummary", `${totalFindings} finding(s): ${staleTodos.length} stale_todo, ${oldHandoffs.length} old_handoff, ${identityViolations.length} identity_violation, ${projectMigrationPreview.length} migration_preview`);
      const output = withLegacyNotice(formatAuditResults(staleTodos, oldHandoffs, store.dbPath, identityViolations, projectMigrationPreview), params.scope as MemoryScope[] | undefined);
      return {
        content: [{ type: "text", text: output }],
        details: { dbPath: store.dbPath, staleTodos, oldHandoffs, identityViolations, projectMigrationPreview },
      };
    },
  });

  pi.registerTool({
    name: "memory_stats",
    label: "Memory Stats",
    description: "Show memory-store health and caps.",
    promptSnippet: "Check memory-store health, counts, and cap warnings.",
    promptGuidelines: [
      "Use memory_stats only for memory-store health/capacity checks.",
    ],
    parameters: Type.Object({
      scope: StringEnum(MEMORY_SCOPES, { description: "Memory scope; normal choices are global, repo, and session; project is legacy/advanced compatibility" }),
      repoPath: Type.Optional(Type.String({ description: "Optional repository path filter" })),
      projectId: Type.Optional(Type.String({ description: "Legacy/advanced project identifier filter; prefer repoPath for normal repo stats" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { store, identityErrorResponse, withLegacyNotice, resolveWriteIdentity, turnContext } = shell.forCwd(ctx.cwd, ctx.sessionManager.getSessionId());
      const scope = params.scope as MemoryScope;
      const identity = resolveWriteIdentity(
        { scope, projectId: params.projectId, repoPath: params.repoPath },
        turnContext,
        { requirePrimary: scope !== "global" },
      );
      if (identity.error) return identityErrorResponse(identity.error);
      const scopeFilter = { scope: [scope], sessionId: identity.sessionId, repoPath: identity.repoPath, projectId: identity.projectId };

      const kindStatuses: Array<{ kind: string; statuses: string[] }> = [
        { kind: "todo", statuses: ["active", "archived"] },
        { kind: "handoff", statuses: ["active", "archived"] },
      ];

      const counts: Record<string, Record<string, number>> = {};
      for (const { kind, statuses } of kindStatuses) {
        counts[kind] = {};
        for (const status of statuses) {
          counts[kind][status] = store.count({ kind: [kind as MemoryKind], status: status as never, ...scopeFilter });
        }
      }

      const warnings: string[] = [];
      for (const kind of ["todo", "handoff"] as const) {
        const cap = getCapForKindScope(kind, scope);
        if (cap) {
          const active = counts[kind]?.active ?? 0;
          if (active >= cap.activeWarnAt) {
            warnings.push(`${kind} active: ${active} active, warn at ${cap.activeWarnAt}, hard cap ${cap.activeHardMax}`);
          }
        }
      }

      const todoActive = counts.todo?.active ?? 0;
      const todoCapPolicy = getCapForKindScope("todo", scope);
      const handoffActive = counts.handoff?.active ?? 0;
      const handoffCapPolicy = getCapForKindScope("handoff", scope);

      const output = [
        `Memory stats (scope=${scope}${params.repoPath ? ` repo=${params.repoPath}` : ""}${params.projectId ? ` project=${params.projectId}` : ""}):`,
        ...Object.entries(counts).map(([kind, statusCounts]) => {
          const parts = Object.entries(statusCounts).map(([s, n]) => `${s}=${n}`).join(" ");
          return `  ${kind}: ${parts}`;
        }),
        `caps:`,
        `  active_todos: ${todoActive}/${todoCapPolicy?.activeHardMax ?? "n/a"}`,
        `  active_handoffs: ${handoffActive}/${handoffCapPolicy?.activeHardMax ?? "n/a"}`,
        ...(warnings.length > 0 ? [`warnings:`, ...warnings.map((w) => `  ${w}`)] : []),
        `last_audit: ${store.getMeta("lastAuditAt") ?? "never"}`,
        `last_audit_summary: ${store.getMeta("lastAuditSummary") ?? "n/a"}`,
        `db_path: ${store.dbPath}`,
      ].join("\n");

      return {
        content: [{ type: "text", text: withLegacyNotice(output, scope) }],
        details: { dbPath: store.dbPath, scope, counts, warnings },
      };
    },
  });
}

