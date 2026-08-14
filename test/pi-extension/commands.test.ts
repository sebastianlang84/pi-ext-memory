import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createMemoryCore, initializeMemoryStore, type MemoryRecord, type MemorySearchResult, type SearchMemoriesInput } from "../../src/core/index.ts";
import {
  formatMemorySessionSaved,
  formatMemorySessionSaveUsage,
} from "../../src/pi-extension/formatters.ts";
import { registerMemoryCommands } from "../../src/pi-extension/commands.ts";
import { formatLatestHandoffLines } from "../../src/pi-extension/retrieval.ts";
import type { MemoryRuntimeStore } from "../../src/pi-extension/runtime-store.ts";

type CommandHandler = (args: string, ctx: MockCommandContext) => Promise<void>;
type EventHandler = (event: unknown, ctx: MockCommandContext) => Promise<void> | void;

type MockCommandContext = {
  cwd: string;
  hasUI: boolean;
  sessionManager: { getSessionId(): string };
  ui: Record<string, never>;
};

function createResult(): MemorySearchResult {
  return {
    id: "memory-1",
    kind: "todo",
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
  const messages: Array<{ customType: string; content: string; display: string }> = [];

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
    sendMessage(msg: { customType: string; content: string; display: string }) {
      messages.push(msg);
    },
  };

  return { pi, commands, eventHandlers, messages };
}

function createMockCommandContext(cwd: string, sessionId: string) {
  const ctx: MockCommandContext = {
    cwd,
    hasUI: true,
    sessionManager: { getSessionId: () => sessionId },
    ui: {},
  };

  return { ctx };
}



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

test("commands shutdown closes the shared runtime store", async () => {
  let closeCount = 0;
  const runtimeStore: MemoryRuntimeStore = {
    getStoreForCwd() {
      throw new Error("shutdown should not open the runtime store");
    },
    close() {
      closeCount += 1;
    },
    activeDbPath: undefined,
  };
  const { pi, eventHandlers } = createMockPi();
  registerMemoryCommands(pi as never, createMemoryCore(), runtimeStore);
  const shutdownHandlers = eventHandlers.get("session_shutdown");
  assert.ok(shutdownHandlers?.length, "expected session_shutdown handler to be registered");

  const { ctx } = createMockCommandContext("/workspace", "session-shutdown-123");
  await shutdownHandlers[0]({}, ctx);

  assert.equal(closeCount, 1);
});

test("/memory-search without query shows current memory context", async () => {
  const { cwd, repoRoot } = createProjectContext();
  const dbPath = join(createTempDir("pi-memory-command-db-"), "memory.sqlite");
  const store = initializeMemoryStore({ dbPath });

  try {
    store.createMemory({
      kind: "todo",
      scope: "session",
      title: "Keep writes manual-first for next steps",
      summary: "decisions facts preferences todos handoffs risks next steps context: use review helpers before saving new durable memory.",
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
    const { pi, commands, messages } = createMockPi();
    registerMemoryCommands(pi as never, createMemoryCore());

    const handler = commands.get("memory-search");
    assert.ok(handler, "expected memory-search command to be registered");

    const { ctx } = createMockCommandContext(cwd, "session-review-123");
    await handler("", ctx);

    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.customType, "pi-memory-command-output");
    const output = messages[0]?.content ?? "";
    assert.match(output, /Current memory context \(read-only\)\. Use \/memory-search <query> for targeted search\./);
    assert.match(output, /session_id: session-review-123/);
    assert.match(output, /session_summary: Reviewed relevant memories before deciding what to persist\./);
    assert.match(output, /latest_handoff: none/);
    assert.match(output, /Keep writes manual-first for next steps/);
  } finally {
    if (previousDbPath === undefined) {
      delete process.env.PI_MEMORY_DB_PATH;
    } else {
      process.env.PI_MEMORY_DB_PATH = previousDbPath;
    }
  }
});

test("/memory-search without query shows the active handoff like the turn-start injection", async () => {
  const { cwd, repoRoot } = createProjectContext();
  const dbPath = join(createTempDir("pi-memory-context-handoff-db-"), "memory.sqlite");
  const setupStore = initializeMemoryStore({ dbPath });

  // The expectation is derived from the persisted record via the same formatter
  // the turn-start injection uses, because the store collapses whitespace in
  // bodies: stored markdown headings never survive as separate lines, so a
  // literal `Next:`/`Blockers:` expectation would assert something neither
  // surface emits. What this pins is that both surfaces render the same block.
  let stored: MemoryRecord | undefined;
  try {
    stored = setupStore.createMemory({
      kind: "handoff",
      scope: "session",
      sessionId: "session-context-handoff-123",
      projectId: "@acme/api",
      repoPath: repoRoot,
      title: "Context reset handoff",
      summary: "Resume the command UX work after context reset.",
      body: "## Next steps\n- Implement command UX\n\n## Blockers\n- Waiting on review",
      metadata: { handoff: { resumeInstruction: "Start with command UX" } },
      sourceAgent: "test",
    });
  } finally {
    setupStore.close();
  }
  assert.ok(stored, "expected the handoff memory to be persisted");

  const previousDbPath = process.env.PI_MEMORY_DB_PATH;
  process.env.PI_MEMORY_DB_PATH = dbPath;

  try {
    const { pi, commands, messages } = createMockPi();
    registerMemoryCommands(pi as never, createMemoryCore());

    const handler = commands.get("memory-search");
    assert.ok(handler, "expected memory-search command to be registered");

    const { ctx } = createMockCommandContext(cwd, "session-context-handoff-123");
    await handler("", ctx);

    assert.equal(messages.length, 1);
    const output = messages[0]?.content ?? "";
    assert.match(output, /Latest active handoff:/);
    assert.match(output, /Context reset handoff/);
    assert.match(output, /Resume: Start with command UX/);
    assert.doesNotMatch(output, /latest_handoff: none/);
    assert.ok(
      output.includes(formatLatestHandoffLines({ memory: stored, isFallback: false }).join("\n")),
      "expected the context view to render the same handoff block as the turn-start injection",
    );
  } finally {
    if (previousDbPath === undefined) {
      delete process.env.PI_MEMORY_DB_PATH;
    } else {
      process.env.PI_MEMORY_DB_PATH = previousDbPath;
    }
  }
});

test("/memory-handoff shows latest current-session handoff", async () => {
  const { cwd, repoRoot } = createProjectContext();
  const dbPath = join(createTempDir("pi-memory-handoff-command-db-"), "memory.sqlite");
  const setupStore = initializeMemoryStore({ dbPath });

  try {
    setupStore.createMemory({
      kind: "handoff",
      scope: "session",
      sessionId: "session-handoff-123",
      projectId: "@acme/api",
      repoPath: repoRoot,
      title: "Context reset handoff",
      summary: "Resume command test handoff.",
      body: "## Next steps\n- Continue after context reset",
      sourceAgent: "test",
    });
  } finally {
    setupStore.close();
  }

  const previousDbPath = process.env.PI_MEMORY_DB_PATH;
  process.env.PI_MEMORY_DB_PATH = dbPath;

  try {
    const { pi, commands, messages } = createMockPi();
    registerMemoryCommands(pi as never, createMemoryCore());

    const handler = commands.get("memory-handoff");
    assert.ok(handler, "expected memory-handoff command to be registered");

    const { ctx } = createMockCommandContext(cwd, "session-handoff-123");
    await handler("", ctx);

    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.customType, "pi-memory-command-output");
    const output = messages[0]?.content ?? "";
    assert.match(output, /Latest active handoff\./);
    assert.match(output, /Context reset handoff/);
    assert.match(output, /Continue after context reset/);
    assert.match(output, new RegExp(`repo_path: ${repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  } finally {
    if (previousDbPath === undefined) {
      delete process.env.PI_MEMORY_DB_PATH;
    } else {
      process.env.PI_MEMORY_DB_PATH = previousDbPath;
    }
  }
});

test("/memory-session-save handler persists the current session and writes confirmation to chat", async () => {
  const { cwd, repoRoot } = createProjectContext();
  const dbPath = join(createTempDir("pi-memory-command-db-"), "memory.sqlite");
  const previousDbPath = process.env.PI_MEMORY_DB_PATH;
  process.env.PI_MEMORY_DB_PATH = dbPath;

  try {
    const { pi, commands, eventHandlers, messages } = createMockPi();
    registerMemoryCommands(pi as never, createMemoryCore());

    const handler = commands.get("memory-session-save");
    assert.ok(handler, "expected memory-session-save command to be registered");

    const { ctx } = createMockCommandContext(cwd, "session-save-123");
    await handler("Captured the review outcome and explicit next steps for follow-up.", ctx);

    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.customType, "pi-memory-command-output");
    const output = messages[0]?.content ?? "";
    assert.match(output, /Saved session summary for session-save-123\./);
    assert.match(output, /summary: Captured the review outcome and explicit next steps for follow-up\./);
    assert.match(output, /project_id: @acme\/api/);
    assert.match(output, new RegExp(`repo_path: ${repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(output, new RegExp(`db_path: ${dbPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

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

test("/memory-session-save also persists a searchable session-summary memory", async () => {
  const { cwd, repoRoot } = createProjectContext();
  const dbPath = join(createTempDir("pi-memory-command-summary-"), "memory.sqlite");
  const previousDbPath = process.env.PI_MEMORY_DB_PATH;
  process.env.PI_MEMORY_DB_PATH = dbPath;

  try {
    const { pi, commands, eventHandlers } = createMockPi();
    registerMemoryCommands(pi as never, createMemoryCore());

    const handler = commands.get("memory-session-save");
    assert.ok(handler, "expected memory-session-save command to be registered");

    const { ctx } = createMockCommandContext(cwd, "session-summary-search-1");
    await handler("Investigated searchsummaryneedle and recorded the decision for later retrieval.", ctx);

    for (const shutdown of eventHandlers.get("session_shutdown") ?? []) {
      await shutdown({}, ctx);
    }

    const persistedStore = initializeMemoryStore({ dbPath });
    try {
      const results = persistedStore.searchMemories({ query: "searchsummaryneedle", scope: ["repo"], repoPath: repoRoot });
      assert.ok(results.length > 0, "expected the session summary to be discoverable via search");
      assert.ok(results.some((r) => r.tags.includes("session-summary")));
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

test("commands cover save -> search -> review -> session summary end to end", async () => {
  const { cwd, repoRoot } = createProjectContext();
  const dbPath = join(createTempDir("pi-memory-e2e-db-"), "memory.sqlite");
  const core = createMemoryCore();
  const setupStore = core.initializeStore({ dbPath });

  try {
    const savedMemory = setupStore.createMemory({
      kind: "todo",
      scope: "session",
      title: "Close v0.8.1 manually",
      summary: "decisions facts preferences todos handoffs risks next steps context: use explicit review and session summary commands to close the manual-first v0.8.1 flow.",
      tags: ["release", "policy"],
      sessionId: "session-e2e-123",
      projectId: "@acme/api",
      repoPath: repoRoot,
      sourceAgent: "test",
    });

    const searchResults = setupStore.searchMemories({
      query: "manual-first v0.8.1 flow",
      scope: ["session"],
      sessionId: "session-e2e-123",
      limit: 5,
    });

    assert.equal(searchResults[0]?.id, savedMemory.id);
  } finally {
    setupStore.close();
  }

  const previousDbPath = process.env.PI_MEMORY_DB_PATH;
  process.env.PI_MEMORY_DB_PATH = dbPath;

  try {
    const { pi, commands, eventHandlers, messages } = createMockPi();
    registerMemoryCommands(pi as never, core);

    const { ctx } = createMockCommandContext(cwd, "session-e2e-123");
    const memorySearch = commands.get("memory-search");
    const memorySessionSave = commands.get("memory-session-save");

    assert.ok(memorySearch, "expected memory-search command to be registered");
    assert.ok(memorySessionSave, "expected memory-session-save command to be registered");

    await memorySearch("", ctx);
    const reviewOutput = messages[0]?.content ?? "";
    assert.match(reviewOutput, /Current memory context \(read-only\)\. Use \/memory-search <query> for targeted search\./);
    assert.match(reviewOutput, /Close v0\.8\.1 manually/);

    await memorySessionSave("Closed v0.8.1 after save, search, review, and explicit session-summary verification.", ctx);
    const sessionOutput = messages[1]?.content ?? "";
    assert.match(sessionOutput, /Saved session summary for session-e2e-123\./);
    assert.match(sessionOutput, /Closed v0\.8\.1 after save, search, review/);

    assert.equal(messages.length, 2);
    assert.ok(messages.every((m) => m.customType === "pi-memory-command-output"));

    const shutdownHandlers = eventHandlers.get("session_shutdown") ?? [];
    for (const handler of shutdownHandlers) {
      await handler({}, ctx);
    }

    const persistedStore = initializeMemoryStore({ dbPath });
    try {
      const session = persistedStore.getSession("session-e2e-123");
      assert.equal(session?.summary, "Closed v0.8.1 after save, search, review, and explicit session-summary verification.");
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

// --- /memory-status ---

test("/memory-status writes status output to chat", async () => {
  const { pi, commands, messages } = createMockPi();
  registerMemoryCommands(pi as never, createMemoryCore());

  const handler = commands.get("memory-status");
  assert.ok(handler, "expected memory-status command to be registered");

  const { ctx } = createMockCommandContext("/workspace", "session-status-123");
  await handler("", ctx);

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.customType, "pi-memory-command-output");
  assert.match(messages[0]?.content ?? "", /^pi-memory status/);
  assert.match(messages[0]?.content ?? "", /version:/);
  assert.match(messages[0]?.content ?? "", /cwd: \/workspace/);
});

test("/memory-status writes to stdout when hasUI is false", async () => {
  const { pi, commands, messages } = createMockPi();
  registerMemoryCommands(pi as never, createMemoryCore());

  const handler = commands.get("memory-status");
  assert.ok(handler, "expected memory-status command to be registered");

  const chunks: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  };

  try {
    const ctx = { cwd: "/workspace", hasUI: false, sessionManager: { getSessionId: () => "s1" }, ui: {} } as never;
    await handler("", ctx);
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.equal(messages.length, 0, "sendMessage must not be called when hasUI is false");
  assert.ok(chunks.join("").includes("pi-memory status"), "expected stdout output");
});

// --- /memory-search error path ---

test("/memory-search without query shows context mode with usage hint", async () => {
  const { pi, commands, messages } = createMockPi();
  registerMemoryCommands(pi as never, createMemoryCore());

  const handler = commands.get("memory-search");
  assert.ok(handler, "expected memory-search command to be registered");

  const { ctx } = createMockCommandContext("/workspace", "session-search-err-123");
  await handler("", ctx);

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.customType, "pi-memory-command-output");
  assert.match(messages[0]?.content ?? "", /Current memory context \(read-only\)\. Use \/memory-search <query> for targeted search\./);
});

test("/memory-search with single-char query runs targeted search", async () => {
  const { pi, commands, messages } = createMockPi();
  registerMemoryCommands(pi as never, createMemoryCore());

  const handler = commands.get("memory-search");
  assert.ok(handler, "expected memory-search command to be registered");

  const { ctx } = createMockCommandContext("/workspace", "session-search-short-123");
  await handler("x", ctx);

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.customType, "pi-memory-command-output");
  // targeted search output — not context mode
  assert.match(messages[0]?.content ?? "", /Manual memory search for "x"/);
});

// --- /memory-handoff error paths ---

test("/memory-handoff with unknown action writes usage hint to chat", async () => {
  const { cwd } = createProjectContext();
  const { pi, commands, messages } = createMockPi();
  registerMemoryCommands(pi as never, createMemoryCore());

  const handler = commands.get("memory-handoff");
  assert.ok(handler, "expected memory-handoff command to be registered");

  const { ctx } = createMockCommandContext(cwd, "session-handoff-err-123");
  await handler("delete", ctx);

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.customType, "pi-memory-command-output");
  assert.match(messages[0]?.content ?? "", /Usage: \/memory-handoff \[show\|archive\]/);
});

test("/memory-handoff archive with no matching handoff writes error to chat", async () => {
  const { cwd } = createProjectContext();
  const dbPath = join(createTempDir("pi-memory-handoff-nohandoff-"), "memory.sqlite");
  const previousDbPath = process.env.PI_MEMORY_DB_PATH;
  process.env.PI_MEMORY_DB_PATH = dbPath;

  try {
    const { pi, commands, messages } = createMockPi();
    registerMemoryCommands(pi as never, createMemoryCore());

    const handler = commands.get("memory-handoff");
    assert.ok(handler, "expected memory-handoff command to be registered");

    const { ctx } = createMockCommandContext(cwd, "session-handoff-missing-123");
    await handler("archive", ctx);

    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.customType, "pi-memory-command-output");
    assert.match(messages[0]?.content ?? "", /No active handoff found/);
  } finally {
    if (previousDbPath === undefined) {
      delete process.env.PI_MEMORY_DB_PATH;
    } else {
      process.env.PI_MEMORY_DB_PATH = previousDbPath;
    }
  }
});

// --- /memory-session-save error path ---

test("/memory-session-save with short summary writes usage hint to chat", async () => {
  const { cwd } = createProjectContext();
  const { pi, commands, messages } = createMockPi();
  registerMemoryCommands(pi as never, createMemoryCore());

  const handler = commands.get("memory-session-save");
  assert.ok(handler, "expected memory-session-save command to be registered");

  const { ctx } = createMockCommandContext(cwd, "session-save-err-123");
  await handler("too short", ctx);

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.customType, "pi-memory-command-output");
  assert.match(messages[0]?.content ?? "", /Usage: \/memory-session-save/);
});
