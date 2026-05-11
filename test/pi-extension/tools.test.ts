import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  ArchiveMemoryInput,
  CreateMemoryInput,
  LinkMemoriesInput,
  ListMemoriesInput,
  ListForToolResult,
  MemoryLinkRecord,
  MemoryRecord,
  MemorySearchResult,
  NormalizedListMemoriesInput,
  SearchMemoriesInput,
  UpdateMemoryInput,
} from "../../src/core/index.ts";

type RegisteredTool = {
  name: string;
  parameters: unknown;
  execute: (...args: unknown[]) => Promise<{
    content: Array<{ type: string; text: string }>;
    details: Record<string, unknown>;
  }>;
};

async function importRegisterMemoryTools() {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "@mariozechner/pi-ai") {
        return { url: "mock:pi-ai", shortCircuit: true };
      }

      if (specifier === "typebox") {
        return { url: "mock:typebox", shortCircuit: true };
      }

      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url === "mock:pi-ai") {
        return {
          format: "module",
          shortCircuit: true,
          source: "export function StringEnum(values, options = {}) { return { ...options, enum: values }; }",
        };
      }

      if (url === "mock:typebox") {
        return {
          format: "module",
          shortCircuit: true,
          source: `
            export const Type = {
              Array: (items, options = {}) => ({ ...options, type: "array", items }),
              Boolean: (options = {}) => ({ ...options, type: "boolean" }),
              Null: (options = {}) => ({ ...options, type: "null" }),
              Number: (options = {}) => ({ ...options, type: "number" }),
              Object: (properties, options = {}) => ({ ...options, type: "object", properties }),
              Optional: (schema) => ({ ...schema, optional: true }),
              String: (options = {}) => ({ ...options, type: "string" }),
              Union: (anyOf, options = {}) => ({ ...options, anyOf }),
            };
          `,
        };
      }

      return nextLoad(url, context);
    },
  });

  return (await import("../../src/pi-extension/tools.ts")).registerMemoryTools;
}

function createMemory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "memory-1",
    kind: "decision",
    scope: "project",
    title: "Keep writes manual-first",
    summary: "Use explicit review and save tools for durable memory updates.",
    tags: ["policy"],
    projectId: "fixture-project",
    repoPath: "/tmp/pi-memory-fixture",
    importance: 0.8,
    confidence: 0.9,
    status: "active",
    pinned: false,
    createdAt: "2026-04-28T10:00:00.000Z",
    updatedAt: "2026-04-28T10:00:00.000Z",
    metadata: {},
    ...overrides,
  };
}

function createResult(overrides: Partial<MemorySearchResult> = {}): MemorySearchResult {
  const memory = createMemory();
  return {
    id: memory.id,
    kind: memory.kind,
    scope: memory.scope,
    title: memory.title,
    summary: memory.summary,
    tags: memory.tags,
    projectId: memory.projectId,
    repoPath: memory.repoPath,
    importance: memory.importance,
    confidence: memory.confidence,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
    matchScore: 0.92,
    lexicalScore: 0.7,
    semanticScore: 0.65,
    scopeScore: 0.8,
    recencyScore: 0.9,
    ...overrides,
  };
}

function toolByName(tools: RegisteredTool[], name: string): RegisteredTool {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `expected ${name} to be registered`);
  return tool;
}

async function createTempPiToolContext() {
  const projectId = "tools-temp-project";
  const cwd = await mkdtemp(join(tmpdir(), "pi-memory-tools-"));
  await writeFile(join(cwd, "package.json"), JSON.stringify({ name: projectId }), "utf8");
  await writeFile(join(cwd, ".git"), "gitdir: fixture\n", "utf8");

  return { cwd, projectId, sessionId: "session-123" };
}

function createMinimalStore(overrides: Partial<{
  getMemory: (id: string) => MemoryRecord | null;
  updateMemory: (input: UpdateMemoryInput) => MemoryRecord;
}> = {}) {
  const base = createMemory();
  return {
    dbPath: "/tmp/pi-memory-test.sqlite",
    embeddingModel: "builtin-hash-384-v1",
    embeddingDimensions: 384,
    getMemory(_id: string): MemoryRecord | null { return null; },
    updateMemory(_input: UpdateMemoryInput): MemoryRecord { return base; },
    searchMemories(_input: SearchMemoriesInput) { return []; },
    listMemories(_input: ListMemoriesInput) { return []; },
    listForTool(_filter: Partial<NormalizedListMemoriesInput> & { offset?: number }): ListForToolResult {
      return { items: [], totalCount: 0, hasMore: false, nextOffset: null };
    },
    listAllInternal() { return []; },
    count() { return 0; },
    createMemory(_input: CreateMemoryInput) { return base; },
    linkMemories(_input: LinkMemoriesInput): MemoryLinkRecord {
      return { id: 1, fromId: "a", toId: "b", relation: "related_to", createdAt: "" };
    },
    archiveMemory(_input: ArchiveMemoryInput) { return base; },
    ...overrides,
  };
}

test("registerMemoryTools registers expected tools and wires their executors", async (t) => {
  const tools: RegisteredTool[] = [];
  const requestedCwds: string[] = [];
  const calls: {
    search: SearchMemoriesInput[];
    list: ListMemoriesInput[];
    listForTool: Array<Partial<NormalizedListMemoriesInput> & { offset?: number }>;
    create: CreateMemoryInput[];
    get: string[];
    update: UpdateMemoryInput[];
    link: LinkMemoriesInput[];
    archive: ArchiveMemoryInput[];
  } = { search: [], list: [], listForTool: [], create: [], get: [], update: [], link: [], archive: [] };
  const projectContext = await createTempPiToolContext();
  t.after(async () => {
    await rm(projectContext.cwd, { recursive: true, force: true });
  });
  const result = createResult({ projectId: projectContext.projectId, repoPath: projectContext.cwd });
  const savedMemory = createMemory({
    id: "memory-saved",
    scope: "session",
    projectId: projectContext.projectId,
    repoPath: projectContext.cwd,
    sessionId: projectContext.sessionId,
    sourceAgent: "pi",
  });
  const updatedMemory = createMemory({ id: "memory-updated", title: "Updated title", pinned: true });
  const archivedMemory = createMemory({
    id: "memory-archived",
    status: "archived",
    metadata: { archive: { archivedReason: "superseded" } },
  });
  const link: MemoryLinkRecord = {
    id: 7,
    fromId: "memory-saved",
    toId: "memory-updated",
    relation: "supersedes",
    createdAt: "2026-04-28T11:00:00.000Z",
  };
  const store = {
    dbPath: "/tmp/pi-memory-test.sqlite",
    embeddingModel: "builtin-hash-384-v1",
    embeddingDimensions: 384,
    searchMemories(input: SearchMemoriesInput) {
      calls.search.push(input);
      return [result];
    },
    listMemories(input: ListMemoriesInput) {
      calls.list.push(input);
      return [savedMemory];
    },
    listForTool(filter: Partial<NormalizedListMemoriesInput> & { offset?: number }): ListForToolResult {
      calls.listForTool.push(filter);
      return { items: [savedMemory], totalCount: 1, hasMore: false, nextOffset: null };
    },
    listAllInternal(filter?: Partial<NormalizedListMemoriesInput>) {
      return [savedMemory];
    },
    count() {
      return 0;
    },
    createMemory(input: CreateMemoryInput) {
      calls.create.push(input);
      return savedMemory;
    },
    getMemory(id: string) {
      calls.get.push(id);
      // Return a valid non-handoff memory for memory_update; null for archive (id differs)
      if (id === "memory-saved") return savedMemory;
      return null;
    },
    updateMemory(input: UpdateMemoryInput) {
      calls.update.push(input);
      return updatedMemory;
    },
    linkMemories(input: LinkMemoriesInput) {
      calls.link.push(input);
      return link;
    },
    archiveMemory(input: ArchiveMemoryInput) {
      calls.archive.push(input);
      return archivedMemory;
    },
  };

  const registerMemoryTools = await importRegisterMemoryTools();

  registerMemoryTools(
    {
      registerTool(tool: RegisteredTool) {
        tools.push(tool);
      },
    } as never,
    (cwd) => {
      requestedCwds.push(cwd);
      return store as never;
    },
  );

  const expectedToolNames = ["memory_search", "memory_list", "memory_save", "memory_save_todo", "memory_save_handoff", "memory_update", "memory_link", "memory_archive", "memory_audit", "memory_list_active_todos", "memory_list_active_handoffs", "memory_stats"];
  assert.equal(tools.length, expectedToolNames.length);
  assert.deepEqual(new Set(tools.map((tool) => tool.name)), new Set(expectedToolNames));
  assert.ok(tools.every((tool) => tool.parameters), "expected all registered tools to expose parameters");

  const ctx = { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } };
  const signal = new AbortController().signal;
  const onUpdate = () => undefined;

  const searchOutput = await toolByName(tools, "memory_search").execute("call-search", { query: "manual policy", limit: 3 }, signal, onUpdate, ctx);
  const listOutput = await toolByName(tools, "memory_list").execute("call-list", { kind: "todo", scope: "project", limit: 3 }, signal, onUpdate, ctx);
  const saveOutput = await toolByName(tools, "memory_save").execute(
    "call-save",
    { kind: "decision", scope: "session", title: "Remember workflow", summary: "Keep durable writes explicit.", tags: ["policy"] },
    signal,
    onUpdate,
    ctx,
  );
  const todoOutput = await toolByName(tools, "memory_save_todo").execute(
    "call-todo",
    {
      title: "Implement memory_save_todo",
      description: "Add dedicated todo tool with priority and scope",
      priority: "P1",
      status: "in_progress",
      nextAction: "Write tests",
    },
    signal,
    onUpdate,
    ctx,
  );
  const handoffOutput = await toolByName(tools, "memory_save_handoff").execute(
    "call-handoff",
    {
      handoffReason: "context_reset",
      recipient: "next_agent",
      resumeInstruction: "Continue from tool registration test",
      goal: "Implement handoff support",
      currentState: "Tool registration is under test.",
      nextSteps: ["Verify handoff save wiring"],
      changedFiles: ["src/pi-extension/tools.ts"],
    },
    signal,
    onUpdate,
    ctx,
  );
  const updateOutput = await toolByName(tools, "memory_update").execute(
    "call-update",
    { id: "memory-saved", title: "Updated title", pinned: true },
    signal,
    onUpdate,
    ctx,
  );
  const linkOutput = await toolByName(tools, "memory_link").execute(
    "call-link",
    { fromId: "memory-saved", toId: "memory-updated", relation: "supersedes" },
    signal,
    onUpdate,
    ctx,
  );
  const archiveOutput = await toolByName(tools, "memory_archive").execute(
    "call-archive",
    { id: "memory-updated", reason: "superseded" },
    signal,
    onUpdate,
    ctx,
  );

  assert.deepEqual(requestedCwds, [ctx.cwd, ctx.cwd, ctx.cwd, ctx.cwd, ctx.cwd, ctx.cwd, ctx.cwd, ctx.cwd]);
  assert.deepEqual(calls.search, [{ query: "manual policy", limit: 3 }]);
  assert.deepEqual(calls.listForTool, [
    { kind: ["todo"], scope: ["project"], tags: undefined, sessionId: undefined, projectId: undefined, repoPath: undefined, status: undefined, orderBy: undefined, limit: 3, offset: 0 },
  ]);
  assert.deepEqual(calls.list, []);
  assert.deepEqual(calls.create, [
    {
      kind: "decision",
      scope: "session",
      title: "Remember workflow",
      summary: "Keep durable writes explicit.",
      tags: ["policy"],
      sourceAgent: "pi",
      projectId: projectContext.projectId,
      repoPath: projectContext.cwd,
      sessionId: projectContext.sessionId,
    },
    {
      kind: "todo",
      scope: "global",
      title: "Implement memory_save_todo",
      summary: "[P1] [in_progress] Add dedicated todo tool with priority and scope \u2192 Write tests",
      body: "Add dedicated todo tool with priority and scope",
      tags: ["todo", "P1", "in_progress"],
      importance: 0.75,
      confidence: 1,
      sourceAgent: "pi",
      projectId: undefined,
      repoPath: undefined,
    },
  ]);
  assert.deepEqual(calls.get, ["memory-saved", "memory-updated"]);
  assert.deepEqual(calls.update, [
    {
      id: "memory-saved",
      title: "Handoff: Implement handoff support",
      summary: "Tool registration is under test.",
      body: calls.update[0]?.body,
      tags: ["handoff", "context_reset", "next_agent"],
      importance: 0.9,
      confidence: 0.9,
    },
    { id: "memory-saved", title: "Updated title", pinned: true },
  ]);
  assert.deepEqual(calls.link, [{ fromId: "memory-saved", toId: "memory-updated", relation: "supersedes" }]);
  assert.deepEqual(calls.archive, [{ id: "memory-updated", reason: "superseded" }]);

  assert.match(searchOutput.content[0].text, /Found 1 memory result for "manual policy"\./);
  assert.match(searchOutput.content[0].text, /Keep writes manual-first/);
  assert.match(listOutput.content[0].text, /Found 1 of 1 memor/);
  assert.match(listOutput.content[0].text, /Keep writes manual-first/);
  assert.match(listOutput.content[0].text, /Use explicit review and save tools for durable memory updates/);
  assert.match(todoOutput.content[0].text, /Saved memory memory-saved\./);
  assert.ok(todoOutput.details !== undefined, "expected todo output to have details");
  assert.match(saveOutput.content[0].text, /Saved memory memory-saved\./);
  assert.match(saveOutput.content[0].text, /title: Keep writes manual-first/);
  assert.ok(saveOutput.content[0].text.includes(`project_id: ${projectContext.projectId}`));
  assert.ok(saveOutput.content[0].text.includes(`repo_path: ${projectContext.cwd}`));
  assert.ok(saveOutput.content[0].text.includes(`session_id: ${projectContext.sessionId}`));
  assert.match(handoffOutput.content[0].text, /Saved memory memory-updated\./);
  assert.match(updateOutput.content[0].text, /Updated memory memory-updated\./);
  assert.match(updateOutput.content[0].text, /pinned: yes/);
  assert.match(updateOutput.content[0].text, /title: Updated title/);
  assert.match(linkOutput.content[0].text, /Linked memory memory-saved -> memory-updated\./);
  assert.match(linkOutput.content[0].text, /relation: supersedes/);
  assert.match(archiveOutput.content[0].text, /Archived memory memory-archived\./);
  assert.match(archiveOutput.content[0].text, /status: archived/);
  assert.match(archiveOutput.content[0].text, /reason: superseded/);
  assert.deepEqual(searchOutput.details, { dbPath: store.dbPath, results: [result] });
  assert.deepEqual(listOutput.details, { dbPath: store.dbPath, total_count: 1, count: 1, has_more: false, next_offset: null, items: [savedMemory] });
  assert.deepEqual(saveOutput.details, { dbPath: store.dbPath, memory: savedMemory });
  assert.deepEqual(handoffOutput.details, { dbPath: store.dbPath, memory: updatedMemory });
  assert.deepEqual(updateOutput.details, { dbPath: store.dbPath, memory: updatedMemory });
  assert.deepEqual(linkOutput.details, { dbPath: store.dbPath, link });
  assert.deepEqual(archiveOutput.details, { dbPath: store.dbPath, memory: archivedMemory });
});

test("memory_update returns not-found for unknown id", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const store = createMinimalStore({ getMemory: (_id) => null });

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools(
    { registerTool(tool: RegisteredTool) { tools.push(tool); } } as never,
    () => store as never,
  );

  const ctx = { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } };
  const signal = new AbortController().signal;
  const output = await toolByName(tools, "memory_update").execute(
    "call-update",
    { id: "unknown-id", title: "Something" },
    signal,
    () => undefined,
    ctx,
  );

  assert.match(output.content[0].text, /was not found/);
});

test("memory_update rejects priority/nextAction on non-todo", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const factMemory = createMemory({ kind: "fact", id: "fact-1" });
  const store = createMinimalStore({ getMemory: (_id) => factMemory });

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools(
    { registerTool(tool: RegisteredTool) { tools.push(tool); } } as never,
    () => store as never,
  );

  const ctx = { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } };
  const signal = new AbortController().signal;
  const output = await toolByName(tools, "memory_update").execute(
    "call-update",
    { id: "fact-1", priority: "P1" },
    signal,
    () => undefined,
    ctx,
  );

  assert.match(output.content[0].text, /only valid for kind=todo/);
});

test("memory_update updates todo priority and rebuilds summary", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const todoMemory = createMemory({
    kind: "todo",
    id: "todo-1",
    summary: "[P2] Fix the thing \u2192 old action",
    tags: ["todo", "P2"],
  });
  const capturedUpdates: UpdateMemoryInput[] = [];
  const store = createMinimalStore({
    getMemory: (_id) => todoMemory,
    updateMemory: (input) => {
      capturedUpdates.push(input);
      return { ...todoMemory, ...input, tags: (input.tags ?? todoMemory.tags) as string[] };
    },
  });

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools(
    { registerTool(tool: RegisteredTool) { tools.push(tool); } } as never,
    () => store as never,
  );

  const ctx = { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } };
  const signal = new AbortController().signal;
  await toolByName(tools, "memory_update").execute(
    "call-update",
    { id: "todo-1", priority: "P1" },
    signal,
    () => undefined,
    ctx,
  );

  assert.equal(capturedUpdates.length, 1);
  const update = capturedUpdates[0]!;
  assert.ok(update.summary?.startsWith("[P1]"), `expected summary to start with [P1], got: ${update.summary}`);
  assert.ok(update.tags?.includes("P1"), `expected tags to include P1, got: ${JSON.stringify(update.tags)}`);
  assert.ok(!update.tags?.includes("P2"), `expected tags not to include P2, got: ${JSON.stringify(update.tags)}`);
});

test("memory_update with explicit summary + priority keeps prefix consistent", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const todoMemory = createMemory({
    kind: "todo",
    id: "todo-2",
    summary: "[P2] Fix the thing \u2192 old action",
    tags: ["todo", "P2"],
  });
  const capturedUpdates: UpdateMemoryInput[] = [];
  const store = createMinimalStore({
    getMemory: (_id) => todoMemory,
    updateMemory: (input) => {
      capturedUpdates.push(input);
      return { ...todoMemory, ...input, tags: (input.tags ?? todoMemory.tags) as string[] };
    },
  });

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools(
    { registerTool(tool: RegisteredTool) { tools.push(tool); } } as never,
    () => store as never,
  );

  const ctx = { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } };
  const signal = new AbortController().signal;
  await toolByName(tools, "memory_update").execute(
    "call-update",
    { id: "todo-2", priority: "P0", summary: "Completely new summary" },
    signal,
    () => undefined,
    ctx,
  );

  assert.equal(capturedUpdates.length, 1);
  const update = capturedUpdates[0]!;
  assert.ok(update.summary?.startsWith("[P0]"), `expected summary to start with [P0], got: ${update.summary}`);
  assert.ok(update.tags?.includes("P0"), `expected tags to include P0, got: ${JSON.stringify(update.tags)}`);
});
