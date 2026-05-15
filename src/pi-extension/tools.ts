import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "typebox";

import {
  MEMORY_KINDS,
  MEMORY_LIST_ORDER_BY,
  MEMORY_SCOPES,
  MEMORY_STATUSES,
  TODO_PRIORITIES,
  TODO_WORKFLOW_STATUSES,
  findTodoPriorityInSummary,
  findTodoPriorityTag,
  stripTodoWorkflowTags,
  type MemoryKind,
  type MemoryScope,
  type MemoryStatus,
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
import { buildTagCatalog, formatTagCatalog, suggestNearTags, type NearTagSuggestion } from "./tag-catalog.ts";
import { createToolShell } from "./tool-shell.ts";


function normalizeOptionalArray<T>(value?: T | T[]): T[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

function buildNearTagSuggestions(
  store: MemoryStore,
  requestedTags: string[] | undefined,
  filter: { scope?: MemoryScope[]; kind?: MemoryKind[]; sessionId?: string; projectId?: string; repoPath?: string } = {},
): NearTagSuggestion[] {
  if (!requestedTags || requestedTags.length === 0) return [];

  const memories = store.listAllInternal({ status: "active", ...filter });
  const tagCatalog = buildTagCatalog(memories, { limit: 200, maxExamplesPerTag: 0 });
  return suggestNearTags(requestedTags, tagCatalog);
}

export function registerMemoryTools(pi: Pick<ExtensionAPI, "registerTool">, getActiveStore: (cwd: string) => MemoryStore): void {
  const shell = createToolShell(getActiveStore);
  pi.registerTool({
    name: "memory_search",
    label: "Memory Search",
    description: "Search memory.",
    promptSnippet: "Search memory when automatic context is insufficient.",
    promptGuidelines: ["Use memory_search for compact text search; filter only when useful."],
    parameters: Type.Object({
      query: Type.String(),
      kind: Type.Optional(Type.Array(StringEnum(MEMORY_KINDS))),
      scope: Type.Optional(Type.Array(StringEnum(MEMORY_SCOPES, { description: "global/repo/session; project legacy" }))),
      tags: Type.Optional(Type.Array(Type.String())),
      projectId: Type.Optional(Type.String({ description: "Legacy project id; prefer repoPath" })),
      repoPath: Type.Optional(Type.String()),
      sessionId: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
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
      const nearTagSuggestions = results.length === 0
        ? buildNearTagSuggestions(store, params.tags, {
            scope: params.scope as MemoryScope[] | undefined,
            kind: params.kind as MemoryKind[] | undefined,
            sessionId: identity.sessionId,
            projectId: identity.projectId,
            repoPath: identity.repoPath,
          })
        : [];
      return {
        content: [{ type: "text", text: withLegacyNotice(formatMemorySearchResults(params.query, results, store.dbPath, nearTagSuggestions), params.scope as MemoryScope[] | undefined) }],
        details: nearTagSuggestions.length > 0 ? { dbPath: store.dbPath, results, nearTagSuggestions } : { dbPath: store.dbPath, results },
      };
    },
  });

  pi.registerTool({
    name: "memory_list",
    label: "Memory List",
    description: "List memories.",
    promptSnippet: "List structured memories, especially todos/handoffs.",
    promptGuidelines: ["Use memory_list for structured todo/handoff lists; use memory_search for text search."],
    parameters: Type.Object({
      kind: Type.Optional(Type.Union([StringEnum(MEMORY_KINDS), Type.Array(StringEnum(MEMORY_KINDS))])),
      scope: Type.Optional(Type.Union([StringEnum(MEMORY_SCOPES, { description: "global/repo/session; project legacy" }), Type.Array(StringEnum(MEMORY_SCOPES))])),
      tags: Type.Optional(Type.Array(Type.String())),
      sessionId: Type.Optional(Type.String()),
      projectId: Type.Optional(Type.String({ description: "Legacy project id; prefer repoPath" })),
      repoPath: Type.Optional(Type.String()),
      status: Type.Optional(StringEnum(MEMORY_STATUSES)),
      orderBy: Type.Optional(StringEnum(MEMORY_LIST_ORDER_BY)),
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
    description: "Save durable notes.",
    promptSnippet: "Save durable notes/facts/decisions/context.",
    promptGuidelines: ["Use memory_save only for durable notes/facts/decisions; use memory_save_todo/handoff for tasks/handoffs."],
    parameters: Type.Object({
      scope: Type.Optional(StringEnum(MEMORY_SCOPES, { description: "default repo in Git, else global; project legacy" })),
      title: Type.String(),
      summary: Type.String({ description: "Compact useful summary" }),
      body: Type.Optional(Type.String()),
      tags: Type.Optional(Type.Array(Type.String())),
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
      const nearTagSuggestions = buildNearTagSuggestions(store, params.tags, {
        scope: [requestedScope],
        sessionId: identity.sessionId,
        projectId: identity.projectId,
        repoPath: identity.repoPath,
      });
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
        content: [{ type: "text", text: withLegacyNotice(formatMemorySaved(memory, store, nearTagSuggestions), requestedScope) }],
        details: nearTagSuggestions.length > 0 ? { dbPath: store.dbPath, memory, nearTagSuggestions } : { dbPath: store.dbPath, memory },
      };
    },
  });

  pi.registerTool({
    name: "memory_save_handoff",
    label: "Memory Save Handoff",
    description: "Save/update session handoff.",
    promptSnippet: "Save handoff for context loss, compaction, session end, or transfer.",
    promptGuidelines: ["Use memory_save_handoff only for real context loss/transfer; include state, next steps, blockers, verification."],
    parameters: Type.Object({
      title: Type.Optional(Type.String()),
      handoffReason: StringEnum(["context_reset", "agent_transfer", "compaction", "session_end"] as const),
      recipient: Type.Optional(StringEnum(["same_agent", "next_agent", "human"] as const)),
      resumeInstruction: Type.String({ description: "Where to resume" }),
      goal: Type.String({ minLength: 1 }),
      currentState: Type.String({ minLength: 1 }),
      nextSteps: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
      done: Type.Optional(Type.Array(Type.String())),
      changedFiles: Type.Optional(Type.Array(Type.String())),
      decisions: Type.Optional(Type.Array(Type.String())),
      blockers: Type.Optional(Type.Array(Type.String())),
      openQuestions: Type.Optional(Type.Array(Type.String())),
      verification: Type.Optional(Type.Array(Type.String())),
      risks: Type.Optional(Type.Array(Type.String())),
      avoidRepeating: Type.Optional(Type.Array(Type.String())),
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
    description: "Patch/archive memory.",
    promptSnippet: "Update known memories instead of duplicating them.",
    promptGuidelines: ["Use memory_update with a known id; prefer it over duplicate saves."],
    parameters: Type.Object({
      id: Type.String(),
      title: Type.Optional(Type.String()),
      summary: Type.Optional(Type.String()),
      body: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      tags: Type.Optional(Type.Array(Type.String())),
      importance: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      status: Type.Optional(StringEnum(MEMORY_STATUSES)),
      archiveReason: Type.Optional(Type.String({ description: "Only with status=archived" })),
      pinned: Type.Optional(Type.Boolean()),
      scope: Type.Optional(StringEnum(MEMORY_SCOPES, { description: "global/repo/session; project legacy" })),
      repoPath: Type.Optional(Type.String()),
      projectId: Type.Optional(Type.String({ description: "Legacy project id" })),
      priority: Type.Optional(StringEnum(TODO_PRIORITIES, { description: "todo only" })),
      nextAction: Type.Optional(Type.String({ description: "todo only" })),
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
      if (existingMemory.kind === "todo" && updateParams.tags !== undefined) {
        updateParams = { ...updateParams, tags: stripTodoWorkflowTags(updateParams.tags) };
      }

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
        const newPriority = params.priority ?? findTodoPriorityTag(existingMemory.tags) ?? findTodoPriorityInSummary(existingMemory.summary);
        const newNextAction = params.nextAction ?? currentNextAction;
        const updatedSummary = buildTodoSummary({ title: existingMemory.title, priority: newPriority, nextAction: newNextAction, description: baseSummary });

        // Remove legacy workflow tags. Todo priority/status are structured fields/rendered summary, not content tags.
        const updatedTags = stripTodoWorkflowTags(updateParams.tags ?? existingMemory.tags);

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

      const nearTagSuggestions = buildNearTagSuggestions(store, params.tags !== undefined ? updateParams.tags : undefined, {
        scope: [(params.scope ?? existingMemory.scope) as MemoryScope],
        sessionId: existingMemory.sessionId,
        projectId: updateParams.projectId ?? existingMemory.projectId,
        repoPath: updateParams.repoPath ?? existingMemory.repoPath,
      });
      const { archiveReason: _archiveReason, ...coreUpdateParams } = updateParams;
      const memory = store.updateMemory(coreUpdateParams);
      return {
        content: [{ type: "text", text: withLegacyNotice(formatMemoryUpdated(memory, store, nearTagSuggestions), params.scope as MemoryScope | undefined) }],
        details: nearTagSuggestions.length > 0 ? { dbPath: store.dbPath, memory, nearTagSuggestions } : { dbPath: store.dbPath, memory },
      };
    },
  });

  pi.registerTool({
    name: "memory_save_todo",
    label: "Memory Save Todo",
    description: "Save persistent todo.",
    promptSnippet: "Save persistent work; update existing todos with memory_update.",
    promptGuidelines: ["Use memory_save_todo for persistent actionable work; keep repo backlog in TODO.md when applicable."],
    parameters: Type.Object({
      title: Type.String(),
      description: Type.Optional(Type.String()),
      priority: Type.Optional(StringEnum(TODO_PRIORITIES, { description: "P0 critical, P1 important, P2 nice" })),
      status: Type.Optional(StringEnum(TODO_WORKFLOW_STATUSES)),
      scope: Type.Optional(StringEnum(MEMORY_SCOPES, { description: "global/repo/session; project legacy" })),
      projectId: Type.Optional(Type.String({ description: "Legacy project id; prefer repoPath" })),
      repoPath: Type.Optional(Type.String()),
      nextAction: Type.Optional(Type.String()),
      tags: Type.Optional(Type.Array(Type.String())),
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

      const tags = stripTodoWorkflowTags(params.tags ?? []);
      const nearTagSuggestions = buildNearTagSuggestions(store, tags, {
        scope: [requestedScope],
        sessionId: identity.sessionId,
        projectId: identity.projectId,
        repoPath: identity.repoPath,
      });

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
        content: [{ type: "text", text: withLegacyNotice(formatMemorySaved(memory, store, nearTagSuggestions), requestedScope) }],
        details: nearTagSuggestions.length > 0 ? { dbPath: store.dbPath, memory, nearTagSuggestions } : { dbPath: store.dbPath, memory },
      };
    },
  });

  pi.registerTool({
    name: "memory_audit",
    label: "Memory Audit",
    description: "Audit memory hygiene.",
    promptSnippet: "Inspect hygiene and legacy-scope migration.",
    promptGuidelines: ["Use memory_audit for hygiene or legacy-scope review."],
    parameters: Type.Object({
      scope: Type.Optional(Type.Array(StringEnum(MEMORY_SCOPES, { description: "global/repo/session; project legacy" }))),
      repoPath: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { store, withLegacyNotice } = shell.forCwd(ctx.cwd, ctx.sessionManager.getSessionId());
      const { staleTodos, oldHandoffs, identityViolations, legacyWorkflowTags, projectMigrationPreview } = runMemoryAudit(store, params.scope, params.repoPath);
      const now = new Date().toISOString();
      const totalFindings = staleTodos.length + oldHandoffs.length + identityViolations.length + legacyWorkflowTags.length + projectMigrationPreview.length;
      store.setMeta("lastAuditAt", now);
      store.setMeta("lastAuditSummary", `${totalFindings} finding(s): ${staleTodos.length} stale_todo, ${oldHandoffs.length} old_handoff, ${identityViolations.length} identity_violation, ${legacyWorkflowTags.length} legacy_workflow_tag, ${projectMigrationPreview.length} migration_preview`);
      const output = withLegacyNotice(formatAuditResults(staleTodos, oldHandoffs, store.dbPath, identityViolations, projectMigrationPreview, legacyWorkflowTags), params.scope as MemoryScope[] | undefined);
      return {
        content: [{ type: "text", text: output }],
        details: { dbPath: store.dbPath, staleTodos, oldHandoffs, identityViolations, legacyWorkflowTags, projectMigrationPreview },
      };
    },
  });

  pi.registerTool({
    name: "memory_tag_catalog",
    label: "Memory Tag Catalog",
    description: "List active tags.",
    promptSnippet: "Inspect tags before adding new ones.",
    promptGuidelines: ["Use memory_tag_catalog before unfamiliar tags."],
    parameters: Type.Object({
      scope: Type.Optional(Type.Array(StringEnum(MEMORY_SCOPES))),
      kind: Type.Optional(Type.Array(StringEnum(MEMORY_KINDS))),
      repoPath: Type.Optional(Type.String()),
      status: Type.Optional(StringEnum(MEMORY_STATUSES)),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, default: 50 })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { store, withLegacyNotice } = shell.forCwd(ctx.cwd, ctx.sessionManager.getSessionId());
      const scopeFilter = params.scope as MemoryScope[] | undefined;
      const kindFilter = params.kind as MemoryKind[] | undefined;
      const status = (params.status ?? "active") as MemoryStatus;
      const memories = store.listAllInternal({
        status,
        ...(scopeFilter ? { scope: scopeFilter } : {}),
        ...(kindFilter ? { kind: kindFilter } : {}),
        ...(params.repoPath ? { repoPath: params.repoPath } : {}),
      });
      const tagCatalog = buildTagCatalog(memories, { limit: params.limit ?? 50 });
      return {
        content: [{ type: "text", text: withLegacyNotice(formatTagCatalog(tagCatalog, store.dbPath), scopeFilter) }],
        details: { dbPath: store.dbPath, tagCatalog, total_count: tagCatalog.length },
      };
    },
  });

  pi.registerTool({
    name: "memory_stats",
    label: "Memory Stats",
    description: "Show store health/caps.",
    promptSnippet: "Check memory-store health and caps.",
    promptGuidelines: ["Use memory_stats only for store health/capacity."],
    parameters: Type.Object({
      scope: StringEnum(MEMORY_SCOPES, { description: "global/repo/session; project legacy" }),
      repoPath: Type.Optional(Type.String()),
      projectId: Type.Optional(Type.String({ description: "Legacy project id; prefer repoPath" })),
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

