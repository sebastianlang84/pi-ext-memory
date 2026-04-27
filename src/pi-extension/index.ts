import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";

import {
  createMemoryCore,
  MEMORY_KINDS,
  MEMORY_LINK_RELATIONS,
  MEMORY_SCOPES,
  MEMORY_STATUSES,
  type MemoryLinkRecord,
  type MemoryRecord,
  type MemorySearchResult,
  type MemoryStore,
} from "../core/index.ts";
import { resolveMemoryDbPath } from "./config.ts";
import {
  buildTurnMemoryMessage,
  decorateCreateMemoryInput,
  deriveMemoryTurnContext,
  retrieveMemoriesForTurn,
} from "./retrieval.ts";
import { formatMemorySearchResultLine } from "./formatters.ts";
import { registerMemoryCommands } from "./commands.ts";

export default function registerPiMemoryExtension(pi: ExtensionAPI) {
  const core = createMemoryCore();
  let store: MemoryStore | undefined;

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus(
      "pi-memory",
      "pi-memory v0.8.1 ready — retrieval hook, /memory-status, /memory-search, /memory-review, /memory-session-save, memory_search, memory_save, memory_update, memory_link, memory_archive",
    );
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const activeStore = getStoreForCwd(core, store, ctx.cwd);
    store = activeStore;

    const turnContext = deriveMemoryTurnContext(ctx.cwd, ctx.sessionManager.getSessionId());
    const { results, searchPlan } = retrieveMemoriesForTurn(activeStore, event.prompt, turnContext);
    const message = buildTurnMemoryMessage(event.prompt, results, turnContext, activeStore.dbPath, searchPlan);

    if (!message) {
      return;
    }

    return { message };
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    store?.close();
    store = undefined;
  });

  pi.registerTool({
    name: "memory_search",
    label: "Memory Search",
    description: "Search the local pi-memory store using hybrid lexical + semantic retrieval and compact filters.",
    promptSnippet: "Search local durable memory before guessing when prior decisions, facts, or todos may matter.",
    promptGuidelines: [
      "Keep queries compact and concrete.",
      "Use filters to narrow the result set when kind, scope, project, repo, or tags are known.",
      "Prefer small limits to protect context quality.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      kind: Type.Optional(Type.Array(StringEnum(MEMORY_KINDS, { description: "Memory kind" }))),
      scope: Type.Optional(Type.Array(StringEnum(MEMORY_SCOPES, { description: "Memory scope" }))),
      tags: Type.Optional(Type.Array(Type.String({ description: "Tag" }))),
      projectId: Type.Optional(Type.String({ description: "Optional project identifier filter" })),
      repoPath: Type.Optional(Type.String({ description: "Optional repository path filter" })),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 20, description: "Max result count" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const activeStore = getStoreForCwd(core, store, ctx.cwd);
      store = activeStore;

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
      const activeStore = getStoreForCwd(core, store, ctx.cwd);
      store = activeStore;

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
      const activeStore = getStoreForCwd(core, store, ctx.cwd);
      store = activeStore;

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
      const activeStore = getStoreForCwd(core, store, ctx.cwd);
      store = activeStore;

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
      const activeStore = getStoreForCwd(core, store, ctx.cwd);
      store = activeStore;

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

  registerMemoryCommands(pi, core);
}

function getStoreForCwd(
  core: ReturnType<typeof createMemoryCore>,
  currentStore: MemoryStore | undefined,
  _cwd: string,
): MemoryStore {
  const dbPath = resolveMemoryDbPath();

  if (currentStore?.dbPath === dbPath) {
    return currentStore;
  }

  currentStore?.close();
  return core.initializeStore({ dbPath });
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

