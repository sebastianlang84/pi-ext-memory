import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createMemoryCore, initializeMemoryStore, type MemorySearchResult, type SearchMemoriesInput } from "../../src/core/index.ts";
import {
  formatMemoryReview,
  formatMemorySessionSaved,
  formatMemorySessionSaveUsage,
} from "../../src/pi-extension/formatters.ts";
import { registerMemoryCommands } from "../../src/pi-extension/commands.ts";

type CommandHandler = (args: string, ctx: MockCommandContext) => Promise<void>;
type EventHandler = (event: unknown, ctx: MockCommandContext) => Promise<void> | void;

type MockCommandContext = {
  cwd: string;
  hasUI: boolean;
  sessionManager: { getSessionId(): string };
  ui: {
    setWidget(name: string, lines: string[] | undefined): void;
    notify(message: string, level: string): void;
  };
};

function createResult(): MemorySearchResult {
  return {
    id: "memory-1",
    kind: "decision",
    scope: "project",
    title: "Keep writes manual-first",
    summary: "Use review helpers instead of autosaving every turn.",
    tags: ["policy"],
    projectId: "@acme/api",
    repoPath: "/repo",
    importance: 0.8,
    confidence: 0.9,
    createdAt: "2026-04-27T10:00:00.000Z",
    updatedAt: "2026-04-27T10:00:00.000Z",
    matchScore: 0.92,
    lexicalScore: 0.7,
    semanticScore: 0.65,
    scopeScore: 0.8,
    recencyScore: 0.9,
  };
}

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function createProjectContext() {
  const root = createTempDir("pi-memory-command-context-");
  const repoRoot = join(root, "workspace");
  const projectRoot = join(repoRoot, "packages", "api");
  const cwd = join(projectRoot, "src");

  mkdirSync(join(repoRoot, ".git"), { recursive: true });
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "root-workspace" }), "utf8");
  writeFileSync(join(projectRoot, "package.json"), JSON.stringify({ name: "@acme/api" }), "utf8");

  return { repoRoot, projectRoot, cwd };
}

function createMockPi() {
  const commands = new Map<string, CommandHandler>();
  const eventHandlers = new Map<string, EventHandler[]>();

  const pi = {
    on(eventName: string, handler: EventHandler) {
      const handlers = eventHandlers.get(eventName) ?? [];
      handlers.push(handler);
      eventHandlers.set(eventName, handlers);
    },
    registerTool() {
      return undefined;
    },
    registerCommand(name: string, command: { handler: CommandHandler }) {
      commands.set(name, command.handler);
    },
  };

  return { pi, commands, eventHandlers };
}

function createMockCommandContext(cwd: string, sessionId: string) {
  const widgets = new Map<string, string[] | undefined>();
  const notifications: Array<{ message: string; level: string }> = [];

  const ctx: MockCommandContext = {
    cwd,
    hasUI: true,
    sessionManager: { getSessionId: () => sessionId },
    ui: {
      setWidget(name, lines) {
        widgets.set(name, lines);
      },
      notify(message, level) {
        notifications.push({ message, level });
      },
    },
  };

  return { ctx, widgets, notifications };
}

test("formatMemoryReview shows read-only guidance, suggested actions, and relevant memories", () => {
  const searchPlan: SearchMemoriesInput[] = [
    { query: "review", limit: 6, scope: ["session"], sessionId: "session-123" },
    { query: "review", limit: 6, scope: ["project"], projectId: "@acme/api" },
  ];

  const output = formatMemoryReview(
    [createResult()],
    searchPlan,
    { sessionId: "session-123", projectId: "@acme/api", repoPath: "/repo" },
    "/db.sqlite",
    "Reviewed retrieval quality and kept the flow manual-first.",
  );

  assert.match(output, /Manual memory review \(read-only\)\./);
  assert.match(output, /suggested_actions:/);
  assert.match(output, /Use memory_update/);
  assert.match(output, /Use \/memory-session-save <summary>/);
  assert.match(output, /relevant_memories: 1/);
  assert.match(output, /Keep writes manual-first/);
});

test("formatMemorySessionSaveUsage shows explicit usage guidance", () => {
  const output = formatMemorySessionSaveUsage(12);

  assert.match(output, /^Usage: \/memory-session-save <summary>/);
  assert.match(output, /at least 12 characters/);
});

test("formatMemorySessionSaved renders the persisted session summary", () => {
  const output = formatMemorySessionSaved(
    {
      id: "session-123",
      summary: "Captured the manual review helper and explicit session summary flow.",
      projectId: "@acme/api",
      repoPath: "/repo",
    },
    "/db.sqlite",
  );

  assert.match(output, /Saved session summary for session-123\./);
  assert.match(output, /summary: Captured the manual review helper/);
  assert.match(output, /project_id: @acme\/api/);
  assert.match(output, /repo_path: \/repo/);
});

test("/memory-review handler registers and renders review details in the UI", async () => {
  const { cwd, repoRoot } = createProjectContext();
  const dbPath = join(createTempDir("pi-memory-command-db-"), "memory.sqlite");
  const store = initializeMemoryStore({ dbPath });

  try {
    store.createMemory({
      kind: "decision",
      scope: "session",
      title: "Keep writes manual-first for next steps",
      summary: "decisions facts preferences todos risks next steps: use review helpers before saving new durable memory.",
      sessionId: "session-review-123",
      projectId: "@acme/api",
      repoPath: repoRoot,
      sourceAgent: "test",
    });
    store.saveSessionSummary({
      sessionId: "session-review-123",
      summary: "Reviewed relevant memories before deciding what to persist.",
      projectId: "@acme/api",
      repoPath: repoRoot,
    });
  } finally {
    store.close();
  }

  const previousDbPath = process.env.PI_MEMORY_DB_PATH;
  process.env.PI_MEMORY_DB_PATH = dbPath;

  try {
    const { pi, commands } = createMockPi();
    registerMemoryCommands(pi as never, createMemoryCore());

    const handler = commands.get("memory-review");
    assert.ok(handler, "expected memory-review command to be registered");

    const { ctx, widgets, notifications } = createMockCommandContext(cwd, "session-review-123");
    await handler("", ctx);

    assert.deepEqual(notifications, [{ message: "pi-memory review updated", level: "info" }]);
    const widget = widgets.get("pi-memory-review")?.join("\n") ?? "";
    assert.match(widget, /Manual memory review \(read-only\)\./);
    assert.match(widget, /session_id: session-review-123/);
    assert.match(widget, /session_summary: Reviewed relevant memories before deciding what to persist\./);
    assert.match(widget, /Keep writes manual-first for next steps/);
  } finally {
    if (previousDbPath === undefined) {
      delete process.env.PI_MEMORY_DB_PATH;
    } else {
      process.env.PI_MEMORY_DB_PATH = previousDbPath;
    }
  }
});

test("/memory-session-save handler persists the current session and shows detailed UI confirmation", async () => {
  const { cwd, repoRoot } = createProjectContext();
  const dbPath = join(createTempDir("pi-memory-command-db-"), "memory.sqlite");
  const previousDbPath = process.env.PI_MEMORY_DB_PATH;
  process.env.PI_MEMORY_DB_PATH = dbPath;

  try {
    const { pi, commands, eventHandlers } = createMockPi();
    registerMemoryCommands(pi as never, createMemoryCore());

    const handler = commands.get("memory-session-save");
    assert.ok(handler, "expected memory-session-save command to be registered");

    const { ctx, widgets, notifications } = createMockCommandContext(cwd, "session-save-123");
    await handler("Captured the review outcome and explicit next steps for follow-up.", ctx);

    assert.deepEqual(notifications, [{ message: "pi-memory session summary saved", level: "info" }]);
    const widget = widgets.get("pi-memory-session-save")?.join("\n") ?? "";
    assert.match(widget, /Saved session summary for session-save-123\./);
    assert.match(widget, /summary: Captured the review outcome and explicit next steps for follow-up\./);
    assert.match(widget, /project_id: @acme\/api/);
    assert.match(widget, new RegExp(`repo_path: ${repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(widget, new RegExp(`db_path: ${dbPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

    const shutdownHandlers = eventHandlers.get("session_shutdown");
    assert.ok(shutdownHandlers?.length, "expected session_shutdown handler to be registered");
    await shutdownHandlers[0]({}, ctx);

    const persistedStore = initializeMemoryStore({ dbPath });
    try {
      const session = persistedStore.getSession("session-save-123");
      assert.equal(session?.summary, "Captured the review outcome and explicit next steps for follow-up.");
      assert.equal(session?.projectId, "@acme/api");
      assert.equal(session?.repoPath, repoRoot);
    } finally {
      persistedStore.close();
    }
  } finally {
    if (previousDbPath === undefined) {
      delete process.env.PI_MEMORY_DB_PATH;
    } else {
      process.env.PI_MEMORY_DB_PATH = previousDbPath;
    }
  }
});
