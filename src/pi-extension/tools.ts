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
  type MemoryLinkRecord,
  type MemoryRecord,
  type MemorySearchResult,
  type MemoryStore,
} from "../core/index.ts";
import { formatMemorySearchResultLine } from "./formatters.ts";
import { decorateCreateMemoryInput, deriveMemoryTurnContext } from "./retrieval.ts";

export function registerMemoryTools(pi: Pick<ExtensionAPI, "registerTool">, getActiveStore: (cwd: string) => MemoryStore): void {
  pi.registerTool({
    name: "memory_search",
    label: "Memory Search",
    description: "Search memory content in the local pi-memory store using hybrid lexical + semantic retrieval and compact filters.",
    promptSnippet: "Search local durable memory before guessing when prior decisions, facts, or todos may matter.",
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
      kind: Type.Optional(Type.Array(StringEnum(MEMORY_KINDS, { description: "Memory kind" }))),
      scope: Type.Optional(Type.Array(StringEnum(MEMORY_SCOPES, { description: "Memory scope" }))),
      tags: Type.Optional(Type.Array(Type.String({ description: "Tag" }))),
      sessionId: Type.Optional(Type.String({ description: "Optional session identifier filter" })),
      projectId: Type.Optional(Type.String({ description: "Optional project identifier filter" })),
      repoPath: Type.Optional(Type.String({ description: "Optional repository path filter" })),
      status: Type.Optional(StringEnum(MEMORY_STATUSES, { description: "Memory lifecycle status; defaults to active" })),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 20, description: "Max result count" })),
      orderBy: Type.Optional(StringEnum(MEMORY_LIST_ORDER_BY, { description: "Newest-first ordering field" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const activeStore = getActiveStore(ctx.cwd);

      const memories = activeStore.listMemories(params);

      return {
        content: [{ type: "text", text: formatMemoryListResults(memories, activeStore.dbPath) }],
        details: {
          dbPath: activeStore.dbPath,
          memories,
        },
      };
    },
  });

  pi.registerTool({
    name: "memory_save",
    label: "Memory Save",
    description: "Create a structured memory in the local pi-memory store.",
    promptSnippet:
      "Save a durable structured memory when the user explicitly wants something remembered or when a stable decision/fact/todo should be preserved.",
    promptGuidelines: [
      "Use this tool for explicit durable memory writes, not for low-information scratch notes.",
      "Always provide a compact but informative summary.",
    ],
    parameters: Type.Object({
      kind: StringEnum(MEMORY_KINDS, { description: "Memory kind" }),
      scope: StringEnum(MEMORY_SCOPES, { description: "Memory scope" }),
      title: Type.String({ description: "Short title for the memory" }),
      summary: Type.String({ description: "Compact summary with enough detail to be useful later" }),
      body: Type.Optional(Type.String({ description: "Optional longer details" })),
      tags: Type.Optional(Type.Array(Type.String({ description: "Tag" }))),
      importance: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const activeStore = getActiveStore(ctx.cwd);

      if (params.kind === "handoff") {
        return {
          content: [{ type: "text", text: `Use memory_handoff_save for handoffs so the active session handoff is updated instead of duplicated.\ndb_path: ${activeStore.dbPath}` }],
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
    name: "memory_handoff_save",
    label: "Memory Handoff Save",
    description: "Create or update the active structured handoff for the current Pi session.",
    promptSnippet:
      "Save a compact handoff before context reset, compaction, wrap-up, or agent transfer so the next agent can resume safely.",
    promptGuidelines: [
      "Use this for mid-task handoff state, not general long-term facts.",
      "Include goal, current state, and concrete next steps.",
      "Mention changed files, decisions, blockers, verification, and avoid-repeating notes when relevant.",
    ],
    parameters: Type.Object({
      title: Type.Optional(Type.String({ description: "Short handoff title" })),
      reason: Type.Optional(
        StringEnum(["manual", "before_context_reset", "wrap_up", "task_pause", "task_complete", "blocker"] as const, {
          description: "Why the handoff is being saved",
        }),
      ),
      goal: Type.String({ description: "Current task goal" }),
      currentState: Type.String({ description: "Where the task stands right now" }),
      nextSteps: Type.Array(Type.String({ description: "Concrete next step" })),
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
      const [existingHandoff] = activeStore.listMemories({
        kind: ["handoff"],
        scope: ["session"],
        sessionId,
        status: "active",
        orderBy: "updatedAt",
        limit: 1,
      });

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
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const activeStore = getActiveStore(ctx.cwd);

      const existingMemory = activeStore.getMemory(params.id);
      if (existingMemory?.kind === "handoff") {
        return {
          content: [{ type: "text", text: `Use memory_handoff_save or /memory-handoff archive for handoff lifecycle changes.\ndb_path: ${activeStore.dbPath}` }],
          details: { dbPath: activeStore.dbPath, memory: existingMemory },
        };
      }

      const memory = activeStore.updateMemory(params);

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
}

type HandoffSaveParams = {
  title?: string;
  reason?: string;
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
  const reason = params.reason?.trim() || "manual";
  const title = params.title?.trim() || `Handoff: ${params.goal.trim().slice(0, 80)}`;
  const body = renderHandoffMarkdown(params, context, reason);

  return decorateCreateMemoryInput(
    {
      kind: "handoff",
      scope: "session",
      title,
      summary: params.currentState.trim(),
      body,
      tags: ["handoff", reason],
      importance: 0.9,
      confidence: 0.9,
      metadata: {
        handoff: {
          reason,
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

function renderHandoffMarkdown(params: HandoffSaveParams, context: HandoffTurnContext, reason: string): string {
  const lines = [
    `# ${params.title?.trim() || "Handoff"}`,
    "",
    `Reason: ${reason}`,
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
