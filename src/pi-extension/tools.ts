import { hostname } from "node:os";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "typebox";

import {
  MEMORY_KINDS,
  MEMORY_LINK_RELATIONS,
  MEMORY_LIST_ORDER_BY,
  MEMORY_SCOPES,
  MEMORY_STATUSES,
  type ListForToolResult,
  type MemoryKind,
  type MemoryLinkRecord,
  type MemoryRecord,
  type MemoryScope,
  type MemorySearchResult,
  type MemoryStore,
  computeDefaultExpiresAt,
  getCapForKindScope,
} from "../core/index.ts";
import { formatMemorySearchResultLine } from "./formatters.ts";
import { findLatestExactSessionHandoff, listRelevantActiveHandoffsForScope } from "./handoffs.ts";
import { decorateCreateMemoryInput, deriveMemoryTurnContext } from "./retrieval.ts";
import { type AuditCandidate, buildHygieneLine, formatAuditResults, runMemoryAudit } from "./audit.ts";
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
    description: "Search memory content in the local pi-memory store using hybrid lexical + semantic retrieval and compact filters.",
    promptSnippet: "Search local durable memory when automatic retrieved context is insufficient and prior decisions or todos may matter.",
    promptGuidelines: [
      "Use memory_search with compact, concrete queries.",
      "Use memory_search filters to narrow results when kind, scope, repo, session, tags, or a legacy projectId are known.",
      "Use small memory_search limits to protect context quality.",
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
    description: "List structured memories from the local pi-memory store using filters or a small active catalog, without full-text content search.",
    promptSnippet: "List structured memories when kind, scope, tags, repo/session identity, legacy projectId, or status are known and no content query is needed.",
    promptGuidelines: [
      "Use memory_list for normal structured filtering, including active todos with kind=todo and active handoffs with kind=handoff.",
      "Use memory_list with no kind/scope only for a small active catalog; add filters before paginating deeply.",
      "Do not pass content queries to memory_list; use memory_search when searching memory text.",
      "Use memory_list defaults intentionally: status is active and ordering is newest updated first.",
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
    description: "Create a structured memory in the local pi-memory store.",
    promptSnippet:
      "Save durable notes or context when the user explicitly wants something remembered or when a stable reusable note should persist.",
    promptGuidelines: [
      "Use memory_save for durable notes and context that should persist across sessions.",
      "Do not use memory_save for actionable open work; use memory_save_todo for todos.",
      "Do not use memory_save for handoff state; use memory_save_handoff only when context will be lost and another agent must resume.",
      "Avoid low-information memory_save scratch notes.",
      "Always give memory_save a compact but informative summary.",
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
    description: "Create or update the active structured handoff for the current Pi session.",
    promptSnippet:
      "Save or refresh a handoff only when the current context will be lost and another agent or future session must resume execution — context reset, compaction, or agent transfer.",
    promptGuidelines: [
      "Use memory_save_handoff only when context will be lost and execution must be resumable by another agent or future session.",
      "Do not use memory_save_handoff for repo/task status notes — use memory_save for those.",
      "Include goal, current state, and concrete next steps in memory_save_handoff.",
      "Mention changed files, decisions, blockers, verification, and avoid-repeating notes in memory_save_handoff when relevant.",
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
            expiresAt: handoffInput.expiresAt ?? computeDefaultExpiresAt("session"),
          })
        : store.createMemory({ ...handoffInput, sourceAgent: "pi" });

      return {
        content: [{ type: "text", text: formatMemorySaved(memory, store) }],
        details: { dbPath: store.dbPath, memory },
      };
    },
  });

  pi.registerTool({
    name: "memory_update",
    label: "Memory Update",
    description: "Correct, refine, pin, close, or archive an existing memory.",
    promptSnippet: "Update an existing structured memory instead of creating duplicates when the memory should be corrected, closed, or archived.",
    promptGuidelines: [
      "Use memory_update to patch only the fields that actually changed.",
      "Prefer memory_update over writing a weaker duplicate memory.",
      "Use memory_update(status=\"archived\", archiveReason=...) instead of memory_archive for normal archive flows.",
      "Use memory_update only when the target memory id is known from memory_search, memory_list, or retrieved context.",
    ],
    parameters: Type.Object({
      id: Type.String({ description: "Memory id to update" }),
      title: Type.Optional(Type.String({ description: "Updated short title" })),
      summary: Type.Optional(Type.String({ description: "Updated compact summary" })),
      body: Type.Optional(Type.Union([Type.String({ description: "Updated longer details" }), Type.Null()])),
      tags: Type.Optional(Type.Array(Type.String({ description: "Replacement tag list" }))),
      importance: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      expiresAt: Type.Optional(
        Type.Union([Type.String({ description: "Optional ISO-8601 expiry timestamp" }), Type.Null()]),
      ),
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
            content: [{ type: "text", text: `Use memory_save_handoff for handoff content changes; memory_update may only change handoff status/expiresAt.\ndb_path: ${store.dbPath}` }],
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
          params.expiresAt,
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
    name: "memory_link",
    label: "Memory Link",
    description: "Advanced/admin tool: link related memories in the local pi-memory store.",
    promptSnippet: "Use memory_link only for advanced relation maintenance when an explicit relation changes future retrieval or prevents duplicated context.",
    promptGuidelines: [
      "Use memory_link only as an advanced/admin tool, not for normal memory capture.",
      "Use memory_link with simple V1 relations like related_to, supersedes, caused_by, implements, and blocks.",
      "Use memory_link to connect existing memories instead of copying the same context into multiple records.",
      "Use memory_link only when the relation changes future retrieval or prevents duplicated context.",
    ],
    parameters: Type.Object({
      fromId: Type.String({ description: "Source memory id" }),
      toId: Type.String({ description: "Target memory id" }),
      relation: StringEnum(MEMORY_LINK_RELATIONS, { description: "Relationship type" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { store } = shell.forCwd(ctx.cwd, ctx.sessionManager.getSessionId());
      const link = store.linkMemories(params);
      return {
        content: [{ type: "text", text: formatMemoryLinked(link, store.dbPath) }],
        details: { dbPath: store.dbPath, link },
      };
    },
  });

  pi.registerTool({
    name: "memory_save_todo",
    label: "Memory Save Todo",
    description: "Save an actionable open task that should persist across sessions.",
    promptSnippet: "Save an actionable open task that should persist across sessions. Use memory_update to update an existing todo.",
    promptGuidelines: [
      "Use memory_save_todo for actionable open work, not passive notes or decisions.",
      "Include the next concrete action in memory_save_todo whenever possible.",
      "Use memory_save_todo with repo scope inside repositories to avoid global todo noise; project scope is legacy/advanced compatibility.",
      "Prefer memory_update for an existing active todo over creating a duplicate with memory_save_todo.",
      "Do not let memory_save_todo compete with TODO.md: repo-canonical backlog belongs in TODO.md when appropriate.",
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
    name: "memory_archive",
    label: "Memory Archive",
    description: "Compatibility wrapper: archive a short-lived or superseded memory without hard-deleting it.",
    promptSnippet: "Use memory_archive only for compatibility; prefer memory_update(status=\"archived\", archiveReason=...) for normal archive flows.",
    promptGuidelines: [
      "Use memory_archive only as a compatibility wrapper; prefer memory_update(status=\"archived\", archiveReason=...) when possible.",
      "Use memory_archive instead of deleting memories in V1.",
      "Use memory_archive with a short reason when a future reader would benefit from the context.",
    ],
    parameters: Type.Object({
      id: Type.String({ description: "Memory id to archive" }),
      reason: Type.Optional(Type.String({ description: "Optional archive reason" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { store } = shell.forCwd(ctx.cwd, ctx.sessionManager.getSessionId());
      const existingMemory = store.getMemory(params.id);
      if (!existingMemory) {
        return {
          content: [{ type: "text", text: `Memory ${params.id} was not found.\ndb_path: ${store.dbPath}` }],
          details: { dbPath: store.dbPath },
        };
      }
      const memory = store.archiveMemory(params);
      return {
        content: [{ type: "text", text: formatMemoryArchived(memory, store.dbPath) }],
        details: { dbPath: store.dbPath, memory },
      };
    },
  });

  pi.registerTool({
    name: "memory_audit",
    label: "Memory Audit",
    description: "Audit memory hygiene and show a read-only migration preview for legacy project-scoped records.",
    promptSnippet: "Run memory_audit to inspect stale todos, old handoffs, scope identity issues, and legacy project-scope migration preview candidates. Returns candidates with id, title, reason, and suggested action.",
    promptGuidelines: [
      "Run memory_audit when the session-start hygiene warning mentions stale items or after scope-identity changes.",
      "Use memory_audit to preview legacy project-scope records before any migration; the preview is read-only.",
      "Use memory_audit optional scope or repoPath filters to narrow the audit.",
    ],
    parameters: Type.Object({
      scope: Type.Optional(Type.Array(StringEnum(MEMORY_SCOPES, { description: "Memory scope filter; normal choices are global, repo, and session; project is legacy/advanced compatibility" }))),
      repoPath: Type.Optional(Type.String({ description: "Optional repository path filter" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { store, withLegacyNotice } = shell.forCwd(ctx.cwd, ctx.sessionManager.getSessionId());
      const { staleTodos, oldHandoffs, identityViolations, projectMigrationPreview } = runMemoryAudit(store, params.scope, params.repoPath);
      const output = withLegacyNotice(formatAuditResults(staleTodos, oldHandoffs, store.dbPath, identityViolations, projectMigrationPreview), params.scope as MemoryScope[] | undefined);
      return {
        content: [{ type: "text", text: output }],
        details: { dbPath: store.dbPath, staleTodos, oldHandoffs, identityViolations, projectMigrationPreview },
      };
    },
  });

  pi.registerTool({
    name: "memory_list_active_todos",
    label: "Memory Active Todos",
    description: "Compatibility wrapper: list active todos for one scope. Prefer memory_list(kind=\"todo\", status=\"active\") for normal use.",
    promptSnippet: "Use memory_list_active_todos only when a bounded compatibility wrapper is preferable to memory_list(kind=\"todo\", status=\"active\").",
    promptGuidelines: [
      "Prefer memory_list(kind=\"todo\", status=\"active\") over memory_list_active_todos for normal todo inspection.",
      "Use memory_list_active_todos with repo scope inside repositories only when the bounded no-pagination wrapper is useful; project scope is legacy/advanced compatibility.",
      "For content-based todo search, use memory_search instead of memory_list_active_todos.",
    ],
    parameters: Type.Object({
      scope: StringEnum(MEMORY_SCOPES, { description: "Memory scope; normal choices are global, repo, and session; project is legacy/advanced compatibility" }),
      repoPath: Type.Optional(Type.String({ description: "Optional repository path filter" })),
      projectId: Type.Optional(Type.String({ description: "Legacy/advanced project identifier filter; prefer repoPath for normal repo todos" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { store, identityErrorResponse, withLegacyNotice, resolveWriteIdentity, turnContext } = shell.forCwd(ctx.cwd, ctx.sessionManager.getSessionId());
      const identity = resolveWriteIdentity(
        { scope: params.scope as MemoryScope, projectId: params.projectId, repoPath: params.repoPath },
        turnContext,
        { requirePrimary: params.scope !== "global" },
      );
      if (identity.error) return identityErrorResponse(identity.error);
      const result = store.listForTool({
        kind: ["todo"],
        scope: [params.scope as MemoryScope],
        status: "active",
        sessionId: identity.sessionId,
        repoPath: identity.repoPath,
        projectId: identity.projectId,
        limit: 50,
        offset: 0,
      });
      return {
        content: [{ type: "text", text: withLegacyNotice(formatActiveList("todos", result.items, result.totalCount, store.dbPath), params.scope as MemoryScope) }],
        details: { dbPath: store.dbPath, count: result.items.length, total_count: result.totalCount, items: result.items },
      };
    },
  });

  pi.registerTool({
    name: "memory_list_active_handoffs",
    label: "Memory Active Handoffs",
    description: "Compatibility wrapper: list active handoffs relevant to one scope, including matching session handoffs for repo/legacy project lookups.",
    promptSnippet: "Use memory_list_active_handoffs only when its repo/session widening is needed; otherwise prefer memory_list(kind=\"handoff\", status=\"active\").",
    promptGuidelines: [
      "Prefer memory_list(kind=\"handoff\", status=\"active\") over memory_list_active_handoffs for normal handoff listing.",
      "Use memory_list_active_handoffs only when bounded active handoff inspection or repo/session widening is specifically needed.",
      "Use memory_list_active_handoffs with repoPath for repo handoff state; projectId is legacy/advanced compatibility.",
      "For content-based handoff search, use memory_search instead of memory_list_active_handoffs.",
    ],
    parameters: Type.Object({
      scope: StringEnum(MEMORY_SCOPES, { description: "Memory scope; normal choices are global, repo, and session; project is legacy/advanced compatibility" }),
      repoPath: Type.Optional(Type.String({ description: "Optional repository path filter" })),
      projectId: Type.Optional(Type.String({ description: "Legacy/advanced project identifier filter; prefer repoPath for normal repo handoffs" })),
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
      const result = listRelevantActiveHandoffsForScope(store, {
        scope,
        sessionId: identity.sessionId,
        repoPath: identity.repoPath,
        projectId: identity.projectId,
        limit: 10,
      });
      return {
        content: [{ type: "text", text: withLegacyNotice(formatActiveList("handoffs", result.items, result.totalCount, store.dbPath), scope) }],
        details: { dbPath: store.dbPath, count: result.items.length, total_count: result.totalCount, items: result.items },
      };
    },
  });

  pi.registerTool({
    name: "memory_stats",
    label: "Memory Stats",
    description: "Advanced/admin tool: summarize active/archived/done counts per kind and scope with cap warnings.",
    promptSnippet: "Use memory_stats only for memory-store health, caps, and warnings; use memory_list for normal listing.",
    promptGuidelines: [
      "Use memory_stats as an advanced/admin health overview, not for normal memory navigation.",
      "Use memory_stats for memory store health, not for listing memory content — use memory_list or memory_search for that.",
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
        { kind: "todo", statuses: ["active", "done", "archived"] },
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
        `db_path: ${store.dbPath}`,
      ].join("\n");

      return {
        content: [{ type: "text", text: withLegacyNotice(output, scope) }],
        details: { dbPath: store.dbPath, scope, counts, warnings },
      };
    },
  });
}

type TodoSaveParams = {
  title: string;
  description?: string;
  priority?: "P0" | "P1" | "P2";
  status?: "open" | "in_progress" | "blocked";
  nextAction?: string;
};

function buildTodoSummary(params: TodoSaveParams): string {
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

type HandoffTurnContext = ReturnType<typeof deriveMemoryTurnContext>;

function buildHandoffMemoryInput(params: HandoffSaveParams, context: HandoffTurnContext) {
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

function renderHandoffMarkdown(params: HandoffSaveParams, context: HandoffTurnContext, reason: string, title: string): string {
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

function appendMarkdownList(lines: string[], heading: string, values?: string[]): void {
  const cleaned = values?.map((value) => value.trim()).filter(Boolean) ?? [];
  if (cleaned.length === 0) return;

  lines.push("", `## ${heading}`, ...cleaned.map((value) => `- ${value}`));
}

function formatMemorySaved(memory: MemoryRecord, store: MemoryStore): string {
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
    `embedding_model: ${store.embeddingModel}`,
    `embedding_dimensions: ${store.embeddingDimensions}`,
    `db_path: ${store.dbPath}`,
  );

  return lines.join("\n");
}

function formatMemoryUpdated(memory: MemoryRecord, store: MemoryStore): string {
  const lines = [
    `Updated memory ${memory.id}.`,
    `status: ${memory.status}`,
    `pinned: ${memory.pinned ? "yes" : "no"}`,
    `title: ${memory.title}`,
    `summary: ${memory.summary}`,
    `tags: ${memory.tags.join(", ") || "none"}`,
    `updated_at: ${memory.updatedAt}`,
    `db_path: ${store.dbPath}`,
  ];

  if (memory.expiresAt) {
    lines.splice(lines.length - 1, 0, `expires_at: ${memory.expiresAt}`);
  }

  return lines.join("\n");
}

function formatMemoryLinked(link: MemoryLinkRecord, dbPath: string): string {
  return [
    `Linked memory ${link.fromId} -> ${link.toId}.`,
    `relation: ${link.relation}`,
    `link_id: ${link.id}`,
    `created_at: ${link.createdAt}`,
    `db_path: ${dbPath}`,
  ].join("\n");
}

function formatMemoryArchived(memory: MemoryRecord, dbPath: string): string {
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

function formatListResult(result: ListForToolResult, dbPath: string): string {
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

function formatMemoryListResults(memories: MemoryRecord[], dbPath: string): string {
  if (memories.length === 0) {
    return [`No memories matched the list filters.`, `db_path: ${dbPath}`].join("\n");
  }

  return [
    `Found ${memories.length} memor${memories.length === 1 ? "y" : "ies"}.`,
    ...memories.map((memory, index) => formatMemoryListResultLine(index + 1, memory)),
    `db_path: ${dbPath}`,
  ].join("\n");
}

function formatMemoryListResultLine(index: number, memory: MemoryRecord): string {
  const tags = memory.tags.length > 0 ? ` tags=${memory.tags.join(",")}` : "";
  const kindLabel = memory.kind ?? "memory";
  return `${index}. [${kindLabel}/${memory.scope}/${memory.status}] ${memory.title} (${memory.id}) — ${memory.summary}${tags} updated=${memory.updatedAt}`;
}

function formatActiveList(kind: string, items: MemoryRecord[], totalCount: number, dbPath: string): string {
  if (items.length === 0) {
    return [`No active ${kind}.`, `db_path: ${dbPath}`].join("\n");
  }
  return [
    `Active ${kind}: ${totalCount}`,
    ...items.map((memory, index) => formatMemoryListResultLine(index + 1, memory)),
    `db_path: ${dbPath}`,
  ].join("\n");
}

function formatMemorySearchResults(query: string, results: MemorySearchResult[], dbPath: string): string {
  if (results.length === 0) {
    return [`No memories matched \"${query}\".`, `db_path: ${dbPath}`].join("\n");
  }

  return [
    `Found ${results.length} memory result${results.length === 1 ? "" : "s"} for \"${query}\".`,
    ...results.map((result, index) => formatMemorySearchResultLine(index + 1, result)),
    `db_path: ${dbPath}`,
  ].join("\n");
}

// ─── Re-exports for consumers that import from tools.ts ─────────────────────

export type { AuditCandidate } from "./audit.ts";
export { buildHygieneLine, formatAuditResults, runMemoryAudit } from "./audit.ts";


