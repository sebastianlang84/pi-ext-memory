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
  computeDefaultStaleAfter,
  getCapForKindScope,
} from "../core/index.ts";
import { formatMemorySearchResultLine } from "./formatters.ts";
import { decorateCreateMemoryInput, deriveMemoryTurnContext } from "./retrieval.ts";
import { type AuditCandidate, buildHygieneLine, formatAuditResults, runMemoryAudit } from "./audit.ts";

const MEMORY_SAVE_KINDS = MEMORY_KINDS.filter(
  (kind): kind is Exclude<(typeof MEMORY_KINDS)[number], "handoff" | "todo"> =>
    kind !== "handoff" && kind !== "todo",
) as readonly Exclude<(typeof MEMORY_KINDS)[number], "handoff" | "todo">[];

export function registerMemoryTools(pi: Pick<ExtensionAPI, "registerTool">, getActiveStore: (cwd: string) => MemoryStore): void {
  pi.registerTool({
    name: "memory_search",
    label: "Memory Search",
    description: "Search memory content in the local pi-memory store using hybrid lexical + semantic retrieval and compact filters.",
    promptSnippet: "Search local durable memory when automatic retrieved context is insufficient and prior decisions, facts, or todos may matter.",
    promptGuidelines: [
      "Keep queries compact and concrete.",
      "Use filters to narrow the result set when kind, scope, project, repo, or tags are known.",
      "Prefer small limits to protect context quality.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Content search query" }),
      kind: Type.Optional(Type.Array(StringEnum(MEMORY_KINDS, { description: "Memory kind" }))),
      scope: Type.Optional(Type.Array(StringEnum(MEMORY_SCOPES, { description: "Memory scope" }))),
      tags: Type.Optional(Type.Array(Type.String({ description: "Tag" }))),
      projectId: Type.Optional(Type.String({ description: "Optional project identifier filter" })),
      repoPath: Type.Optional(Type.String({ description: "Optional repository path filter" })),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 20, description: "Max result count" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const activeStore = getActiveStore(ctx.cwd);

      const results = activeStore.searchMemories(params);

      return {
        content: [{ type: "text", text: formatMemorySearchResults(params.query, results, activeStore.dbPath) }],
        details: {
          dbPath: activeStore.dbPath,
          results,
        },
      };
    },
  });

  pi.registerTool({
    name: "memory_list",
    label: "Memory List",
    description: "List structured memories from the local pi-memory store using filters without full-text content search.",
    promptSnippet: "List structured memories when kind, scope, tags, project, repo, or status are known and no content query is needed.",
    promptGuidelines: [
      "Use memory_list for structured filtering, especially active todos with kind: [\"todo\"].",
      "Do not provide a content query; use memory_search when searching memory text.",
      "Default status is active and default ordering is newest updated first.",
    ],
    parameters: Type.Object({
      kind: StringEnum(MEMORY_KINDS, { description: "Memory kind" }),
      scope: StringEnum(MEMORY_SCOPES, { description: "Memory scope" }),
      tags: Type.Optional(Type.Array(Type.String({ description: "Tag" }))),
      sessionId: Type.Optional(Type.String({ description: "Optional session identifier filter" })),
      projectId: Type.Optional(Type.String({ description: "Optional project identifier filter" })),
      repoPath: Type.Optional(Type.String({ description: "Optional repository path filter" })),
      status: Type.Optional(StringEnum(MEMORY_STATUSES, { description: "Memory lifecycle status; defaults to active" })),
      orderBy: Type.Optional(StringEnum(MEMORY_LIST_ORDER_BY, { description: "Newest-first ordering field" })),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, default: 20 })),
      offset: Type.Optional(Type.Number({ minimum: 0, default: 0 })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const activeStore = getActiveStore(ctx.cwd);

      const result = activeStore.listForTool({
        kind: [params.kind as MemoryKind],
        scope: [params.scope as MemoryScope],
        tags: params.tags,
        sessionId: params.sessionId,
        projectId: params.projectId,
        repoPath: params.repoPath,
        status: params.status,
        orderBy: params.orderBy,
        limit: params.limit ?? 20,
        offset: params.offset ?? 0,
      });

      return {
        content: [{ type: "text", text: formatListResult(result, activeStore.dbPath) }],
        details: {
          dbPath: activeStore.dbPath,
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
      "Save durable facts, preferences, decisions, notes, or project status snapshots when the user explicitly wants something remembered or when a stable reusable fact should persist. Use kind=progress_snapshot for project status, current state, decisions, and next steps.",
    promptGuidelines: [
      "Use for durable facts, preferences, decisions, notes, and progress snapshots.",
      "Use kind=progress_snapshot when saving project status, current state, completed steps, next steps, or decisions — not memory_save_handoff.",
      "Do not use for actionable open work; use memory_save_todo for todos.",
      "Do not use for handoff state; use memory_save_handoff only when context will be lost and another agent must resume.",
      "Avoid low-information scratch notes.",
      "Always provide a compact but informative summary.",
    ],
    parameters: Type.Object({
      kind: StringEnum(MEMORY_SAVE_KINDS as unknown as [string, ...string[]], { description: "Memory kind — use progress_snapshot for project status, current state, done steps, and next steps" }),
      scope: StringEnum(MEMORY_SCOPES, { description: "Memory scope" }),
      title: Type.String({ description: "Short title for the memory" }),
      summary: Type.String({ description: "Compact summary with enough detail to be useful later" }),
      body: Type.Optional(Type.String({ description: "Optional longer details" })),
      tags: Type.Optional(Type.Array(Type.String({ description: "Tag" }))),
      importance: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      progress: Type.Optional(Type.Object({
        goal: Type.Optional(Type.String({ description: "Overall goal or task being tracked" })),
        currentState: Type.Optional(Type.String({ description: "Where things stand right now" })),
        done: Type.Optional(Type.Array(Type.String({ description: "Completed step" }))),
        nextSteps: Type.Optional(Type.Array(Type.String({ description: "Planned next step" }))),
        decisions: Type.Optional(Type.Array(Type.String({ description: "Decision made" }))),
        openQuestions: Type.Optional(Type.Array(Type.String({ description: "Open question" }))),
        changedFiles: Type.Optional(Type.Array(Type.String({ description: "Relevant file path" }))),
      }, { description: "Structured snapshot fields — use when kind=progress_snapshot" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const activeStore = getActiveStore(ctx.cwd);

      // Safety-net guards (schema already excludes these kinds, but belt-and-suspenders)
      if ((params.kind as string) === "handoff") {
        return {
          content: [{ type: "text", text: `Use memory_save_handoff for handoffs so the active session handoff is updated instead of duplicated.\ndb_path: ${activeStore.dbPath}` }],
          details: { dbPath: activeStore.dbPath },
        };
      }

      if ((params.kind as string) === "todo") {
        return {
          content: [{ type: "text", text: `Use memory_save_todo for actionable open tasks so they get the correct schema and priority/scope fields.\ndb_path: ${activeStore.dbPath}` }],
          details: { dbPath: activeStore.dbPath },
        };
      }

      const turnContext = deriveMemoryTurnContext(ctx.cwd, ctx.sessionManager.getSessionId());
      const memory = activeStore.createMemory({
        ...decorateCreateMemoryInput(params, turnContext),
        sourceAgent: "pi",
      });

      return {
        content: [{ type: "text", text: formatMemorySaved(memory, activeStore) }],
        details: {
          dbPath: activeStore.dbPath,
          memory,
        },
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
      "Use only when context will be lost and execution must be resumable by another agent or future session.",
      "Do not use for project status notes or progress snapshots — use memory_save with kind=progress_snapshot for those.",
      "Include goal, current state, and concrete next steps.",
      "Mention changed files, decisions, blockers, verification, and avoid-repeating notes when relevant.",
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
      const activeStore = getActiveStore(ctx.cwd);
      const turnContext = deriveMemoryTurnContext(ctx.cwd, ctx.sessionManager.getSessionId());
      const sessionId = turnContext.sessionId.trim();

      if (sessionId.length === 0) {
        return {
          content: [{ type: "text", text: `Cannot save handoff without a stable Pi session id.\ndb_path: ${activeStore.dbPath}` }],
          details: { dbPath: activeStore.dbPath },
        };
      }

      const handoffInput = buildHandoffMemoryInput(params, turnContext);
      const [existingHandoff] = activeStore.listAllInternal({
        kind: ["handoff"],
        scope: ["session"],
        sessionId,
        status: "active",
        orderBy: "updatedAt",
      }).slice(0, 1);

      const memory = existingHandoff
        ? activeStore.updateMemory({
            id: existingHandoff.id,
            title: handoffInput.title,
            summary: handoffInput.summary,
            body: handoffInput.body,
            tags: handoffInput.tags,
            importance: handoffInput.importance,
            confidence: handoffInput.confidence,
          })
        : activeStore.createMemory({ ...handoffInput, sourceAgent: "pi" });

      return {
        content: [{ type: "text", text: formatMemorySaved(memory, activeStore) }],
        details: {
          dbPath: activeStore.dbPath,
          memory,
        },
      };
    },
  });

  pi.registerTool({
    name: "memory_update",
    label: "Memory Update",
    description: "Correct, refine, pin, or close an existing memory.",
    promptSnippet: "Update an existing structured memory instead of creating duplicates when the memory should be corrected or refined.",
    promptGuidelines: [
      "Patch only the fields that actually changed.",
      "Prefer updating an existing memory over writing a weaker duplicate.",
      "Use only when the target memory id is known from memory_search, memory_list, or retrieved context.",
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
      pinned: Type.Optional(Type.Boolean({ description: "Whether the memory should stay pinned" })),
      scope: Type.Optional(StringEnum(MEMORY_SCOPES, { description: "Updated scope — use with caution, changes retrieval context" })),
      repoPath: Type.Optional(Type.String({ description: "Updated repoPath" })),
      projectId: Type.Optional(Type.String({ description: "Updated projectId" })),
      priority: Type.Optional(StringEnum(["P0", "P1", "P2"] as const, { description: "Todo priority — only applies when kind=todo" })),
      nextAction: Type.Optional(Type.String({ description: "Next concrete action — only applies when kind=todo" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const activeStore = getActiveStore(ctx.cwd);

      const existingMemory = activeStore.getMemory(params.id);
      if (!existingMemory) {
        return {
          content: [{ type: "text", text: `Memory ${params.id} was not found.\ndb_path: ${activeStore.dbPath}` }],
          details: { dbPath: activeStore.dbPath },
        };
      }
      if (existingMemory.kind === "handoff") {
        return {
          content: [{ type: "text", text: `Use memory_save_handoff or /memory-handoff archive for handoff lifecycle changes.\ndb_path: ${activeStore.dbPath}` }],
          details: { dbPath: activeStore.dbPath, memory: existingMemory },
        };
      }

      // Validate todo-specific fields
      if ((params.priority !== undefined || params.nextAction !== undefined) && existingMemory.kind !== "todo") {
        return {
          content: [{ type: "text", text: `priority and nextAction are only valid for kind=todo memories.\ndb_path: ${activeStore.dbPath}` }],
          details: { dbPath: activeStore.dbPath, memory: existingMemory },
        };
      }

      // Build updated params for todo-specific fields
      let updateParams = { ...params } as typeof params & { summary?: string; tags?: string[] };
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

      const memory = activeStore.updateMemory(updateParams);

      return {
        content: [{ type: "text", text: formatMemoryUpdated(memory, activeStore) }],
        details: {
          dbPath: activeStore.dbPath,
          memory,
        },
      };
    },
  });

  pi.registerTool({
    name: "memory_link",
    label: "Memory Link",
    description: "Link related memories in the local pi-memory store.",
    promptSnippet: "Link related memories when a useful relationship should be preserved explicitly.",
    promptGuidelines: [
      "Use simple V1 relations like related_to, supersedes, caused_by, implements, and blocks.",
      "Link existing memories instead of copying the same context into multiple records.",
      "Use memory_link only when the relation changes future retrieval or prevents duplicated context.",
    ],
    parameters: Type.Object({
      fromId: Type.String({ description: "Source memory id" }),
      toId: Type.String({ description: "Target memory id" }),
      relation: StringEnum(MEMORY_LINK_RELATIONS, { description: "Relationship type" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const activeStore = getActiveStore(ctx.cwd);

      const link = activeStore.linkMemories(params);

      return {
        content: [{ type: "text", text: formatMemoryLinked(link, activeStore.dbPath) }],
        details: {
          dbPath: activeStore.dbPath,
          link,
        },
      };
    },
  });

  pi.registerTool({
    name: "memory_save_todo",
    label: "Memory Save Todo",
    description: "Save an actionable open task that should persist across sessions.",
    promptSnippet: "Save an actionable open task that should persist across sessions. Use memory_update to update an existing todo.",
    promptGuidelines: [
      "Use for actionable open work, not passive facts or decisions.",
      "Include the next concrete action whenever possible.",
      "Use scope/project/repo to avoid global todo noise.",
      "Prefer updating an existing active todo over creating a duplicate.",
      "Do not compete with TODO.md: repo-canonical backlog belongs in TODO.md when appropriate.",
    ],
    parameters: Type.Object({
      title: Type.String({ description: "Short title for the todo" }),
      description: Type.Optional(Type.String({ description: "Longer description of the task" })),
      priority: Type.Optional(StringEnum(["P0", "P1", "P2"] as const, { description: "Priority: P0=critical, P1=important, P2=nice-to-have" })),
      status: Type.Optional(StringEnum(["open", "in_progress", "blocked"] as const, { description: "Current status of the todo" })),
      scope: Type.Optional(StringEnum(MEMORY_SCOPES, { description: "Memory scope" })),
      projectId: Type.Optional(Type.String({ description: "Optional project identifier" })),
      repoPath: Type.Optional(Type.String({ description: "Optional repository path" })),
      nextAction: Type.Optional(Type.String({ description: "The immediate next concrete action to take" })),
      tags: Type.Optional(Type.Array(Type.String({ description: "Tag" }))),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const activeStore = getActiveStore(ctx.cwd);
      const turnContext = deriveMemoryTurnContext(ctx.cwd, ctx.sessionManager.getSessionId());

      const tags = [...(params.tags ?? []), "todo"];
      if (params.priority) tags.push(params.priority);
      if (params.status && params.status !== "open") tags.push(params.status);

      const summary = buildTodoSummary(params);

      const memory = activeStore.createMemory({
        ...decorateCreateMemoryInput(
          {
            kind: "todo",
            scope: params.scope ?? "global",
            title: params.title,
            summary,
            body: params.description,
            tags,
            importance: params.priority === "P0" ? 0.95 : params.priority === "P1" ? 0.75 : 0.5,
            confidence: 1,
            projectId: params.projectId,
            repoPath: params.repoPath,
          },
          turnContext,
        ),
        sourceAgent: "pi",
      });

      return {
        content: [{ type: "text", text: formatMemorySaved(memory, activeStore) }],
        details: { dbPath: activeStore.dbPath, memory },
      };
    },
  });

  pi.registerTool({
    name: "memory_archive",
    label: "Memory Archive",
    description: "Archive a short-lived or superseded memory without hard-deleting it.",
    promptSnippet: "Archive obsolete memories instead of deleting them when they should stop influencing retrieval.",
    promptGuidelines: [
      "Prefer archive over delete in V1.",
      "Use a short reason when a future reader would benefit from the context.",
    ],
    parameters: Type.Object({
      id: Type.String({ description: "Memory id to archive" }),
      reason: Type.Optional(Type.String({ description: "Optional archive reason" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const activeStore = getActiveStore(ctx.cwd);

      const existingMemory = activeStore.getMemory(params.id);
      if (existingMemory?.kind === "handoff") {
        return {
          content: [{ type: "text", text: `Use /memory-handoff archive from the owning session to archive handoffs.\ndb_path: ${activeStore.dbPath}` }],
          details: { dbPath: activeStore.dbPath, memory: existingMemory },
        };
      }

      const memory = activeStore.archiveMemory(params);

      return {
        content: [{ type: "text", text: formatMemoryArchived(memory, activeStore.dbPath) }],
        details: {
          dbPath: activeStore.dbPath,
          memory,
        },
      };
    },
  });

  pi.registerTool({
    name: "memory_audit",
    label: "Memory Audit",
    description: "Audit memory hygiene: list stale todos and old handoffs that may need attention.",
    promptSnippet: "Run memory_audit to inspect stale todos and old handoffs. Returns candidates with id, title, reason, and suggested action.",
    promptGuidelines: [
      "Run when the session-start hygiene warning mentions stale items.",
      "Use optional scope or repoPath filters to narrow the audit.",
    ],
    parameters: Type.Object({
      scope: Type.Optional(Type.Array(StringEnum(MEMORY_SCOPES, { description: "Memory scope filter" }))),
      repoPath: Type.Optional(Type.String({ description: "Optional repository path filter" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const activeStore = getActiveStore(ctx.cwd);
      const { staleTodos, oldHandoffs } = runMemoryAudit(activeStore, params.scope, params.repoPath);
      activeStore.setMeta("lastAuditAt", new Date().toISOString());
      const output = formatAuditResults(staleTodos, oldHandoffs, activeStore.dbPath);
      return {
        content: [{ type: "text", text: output }],
        details: { dbPath: activeStore.dbPath, staleTodos, oldHandoffs },
      };
    },
  });

  pi.registerTool({
    name: "memory_list_active_todos",
    label: "Memory Active Todos",
    description: "List all active todos for the given scope. Bounded by active caps — no pagination needed.",
    promptSnippet: "Use to inspect the current todo working-set for a scope.",
    promptGuidelines: [
      "Use scope/project/repo to avoid global todo noise.",
      "Use memory_search for content-based todo search.",
    ],
    parameters: Type.Object({
      scope: StringEnum(MEMORY_SCOPES, { description: "Memory scope" }),
      repoPath: Type.Optional(Type.String({ description: "Optional repository path filter" })),
      projectId: Type.Optional(Type.String({ description: "Optional project identifier filter" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const activeStore = getActiveStore(ctx.cwd);
      const result = activeStore.listForTool({
        kind: ["todo"],
        scope: [params.scope as MemoryScope],
        status: "active",
        repoPath: params.repoPath,
        projectId: params.projectId,
        limit: 50,
        offset: 0,
      });
      return {
        content: [{ type: "text", text: formatActiveList("todos", result.items, result.totalCount, activeStore.dbPath) }],
        details: { dbPath: activeStore.dbPath, count: result.items.length, total_count: result.totalCount, items: result.items },
      };
    },
  });

  pi.registerTool({
    name: "memory_list_active_handoffs",
    label: "Memory Active Handoffs",
    description: "List all active handoffs for the given scope. Bounded by active caps — no pagination needed.",
    promptSnippet: "Use to inspect current session or repo handoff state.",
    promptGuidelines: [
      "Use memory_search for content-based handoff search.",
    ],
    parameters: Type.Object({
      scope: StringEnum(MEMORY_SCOPES, { description: "Memory scope" }),
      repoPath: Type.Optional(Type.String({ description: "Optional repository path filter" })),
      projectId: Type.Optional(Type.String({ description: "Optional project identifier filter" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const activeStore = getActiveStore(ctx.cwd);
      const result = activeStore.listForTool({
        kind: ["handoff"],
        scope: [params.scope as MemoryScope],
        status: "active",
        repoPath: params.repoPath,
        projectId: params.projectId,
        limit: 10,
        offset: 0,
      });
      return {
        content: [{ type: "text", text: formatActiveList("handoffs", result.items, result.totalCount, activeStore.dbPath) }],
        details: { dbPath: activeStore.dbPath, count: result.items.length, total_count: result.totalCount, items: result.items },
      };
    },
  });

  pi.registerTool({
    name: "memory_stats",
    label: "Memory Stats",
    description: "Summarize active/archived/done counts per kind and scope with cap warnings.",
    promptSnippet: "Use for a health overview of the memory store — counts, caps, and warnings.",
    promptGuidelines: [
      "Not for listing memory content — use memory_list or memory_search for that.",
    ],
    parameters: Type.Object({
      scope: StringEnum(MEMORY_SCOPES, { description: "Memory scope" }),
      repoPath: Type.Optional(Type.String({ description: "Optional repository path filter" })),
      projectId: Type.Optional(Type.String({ description: "Optional project identifier filter" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const activeStore = getActiveStore(ctx.cwd);
      const scope = params.scope as MemoryScope;
      const scopeFilter = { scope: [scope], repoPath: params.repoPath, projectId: params.projectId };

      const kindStatuses: Array<{ kind: string; statuses: string[] }> = [
        { kind: "todo", statuses: ["active", "done", "archived"] },
        { kind: "handoff", statuses: ["active", "archived"] },
        { kind: "decision", statuses: ["active", "archived", "superseded"] },
        { kind: "fact", statuses: ["active", "archived", "superseded"] },
        { kind: "episode", statuses: ["active", "archived"] },
        { kind: "progress_snapshot", statuses: ["active", "archived"] },
      ];

      const counts: Record<string, Record<string, number>> = {};
      for (const { kind, statuses } of kindStatuses) {
        counts[kind] = {};
        for (const status of statuses) {
          counts[kind][status] = activeStore.count({ kind: [kind as MemoryKind], status: status as never, ...scopeFilter });
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
        `db_path: ${activeStore.dbPath}`,
      ].join("\n");

      return {
        content: [{ type: "text", text: output }],
        details: { dbPath: activeStore.dbPath, scope, counts, warnings },
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
    `kind: ${memory.kind}`,
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
  return `${index}. [${memory.kind}/${memory.scope}/${memory.status}] ${memory.title} (${memory.id}) — ${memory.summary}${tags} updated=${memory.updatedAt}`;
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


