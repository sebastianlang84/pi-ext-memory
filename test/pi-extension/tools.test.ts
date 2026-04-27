import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

import type {
  ArchiveMemoryInput,
  CreateMemoryInput,
  LinkMemoriesInput,
  MemoryLinkRecord,
  MemoryRecord,
  MemorySearchResult,
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
    projectId: "pi-memory",
    repoPath: process.cwd(),
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

test("registerMemoryTools registers expected tools and wires their executors", async () => {
  const tools: RegisteredTool[] = [];
  const requestedCwds: string[] = [];
  const calls: {
    search: SearchMemoriesInput[];
    create: CreateMemoryInput[];
    update: UpdateMemoryInput[];
    link: LinkMemoriesInput[];
    archive: ArchiveMemoryInput[];
  } = { search: [], create: [], update: [], link: [], archive: [] };
  const result = createResult();
  const savedMemory = createMemory({ id: "memory-saved", scope: "session", sessionId: "session-123", sourceAgent: "pi" });
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
    createMemory(input: CreateMemoryInput) {
      calls.create.push(input);
      return savedMemory;
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

  const expectedToolNames = ["memory_search", "memory_save", "memory_update", "memory_link", "memory_archive"];
  assert.equal(tools.length, expectedToolNames.length);
  assert.deepEqual(new Set(tools.map((tool) => tool.name)), new Set(expectedToolNames));
  assert.ok(tools.every((tool) => tool.parameters), "expected all registered tools to expose parameters");

  const ctx = { cwd: process.cwd(), sessionManager: { getSessionId: () => "session-123" } };
  const signal = new AbortController().signal;
  const onUpdate = () => undefined;

  const searchOutput = await toolByName(tools, "memory_search").execute("call-search", { query: "manual policy", limit: 3 }, signal, onUpdate, ctx);
  const saveOutput = await toolByName(tools, "memory_save").execute(
    "call-save",
    { kind: "decision", scope: "session", title: "Remember workflow", summary: "Keep durable writes explicit.", tags: ["policy"] },
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

  assert.deepEqual(requestedCwds, [ctx.cwd, ctx.cwd, ctx.cwd, ctx.cwd, ctx.cwd]);
  assert.deepEqual(calls.search, [{ query: "manual policy", limit: 3 }]);
  assert.deepEqual(calls.create, [
    {
      kind: "decision",
      scope: "session",
      title: "Remember workflow",
      summary: "Keep durable writes explicit.",
      tags: ["policy"],
      sourceAgent: "pi",
      projectId: "pi-memory",
      repoPath: process.cwd(),
      sessionId: "session-123",
    },
  ]);
  assert.deepEqual(calls.update, [{ id: "memory-saved", title: "Updated title", pinned: true }]);
  assert.deepEqual(calls.link, [{ fromId: "memory-saved", toId: "memory-updated", relation: "supersedes" }]);
  assert.deepEqual(calls.archive, [{ id: "memory-updated", reason: "superseded" }]);

  assert.match(searchOutput.content[0].text, /Found 1 memory result for "manual policy"\./);
  assert.match(searchOutput.content[0].text, /Keep writes manual-first/);
  assert.deepEqual(searchOutput.details, { dbPath: store.dbPath, results: [result] });
  assert.deepEqual(saveOutput.details, { dbPath: store.dbPath, memory: savedMemory });
  assert.deepEqual(updateOutput.details, { dbPath: store.dbPath, memory: updatedMemory });
  assert.deepEqual(linkOutput.details, { dbPath: store.dbPath, link });
  assert.deepEqual(archiveOutput.details, { dbPath: store.dbPath, memory: archivedMemory });
});
