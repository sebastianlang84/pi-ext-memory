import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { initializeMemoryStore } from "../../src/core/index.ts";
import type {
  ArchiveMemoryInput,
  CreateMemoryInput,
  ListMemoriesInput,
  ListForToolResult,
  MemoryRecord,
  MemorySearchResult,
  NormalizedListMemoriesInput,
  SearchMemoriesInput,
  UpdateMemoryInput,
} from "../../src/core/index.ts";

type RegisteredTool = {
  name: string;
  parameters: unknown;
  promptSnippet?: string;
  promptGuidelines?: string[];
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
    kind: "todo",
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
  listForTool: (filter: Partial<NormalizedListMemoriesInput> & { offset?: number }) => ListForToolResult;
  listAllInternal: (filter?: Partial<NormalizedListMemoriesInput>) => MemoryRecord[];
  setMeta: (key: string, value: string) => void;
  getMeta: (key: string) => string | null;
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
    archiveMemory(_input: ArchiveMemoryInput) { return base; },
    setMeta(_key: string, _value: string) { return; },
    getMeta(_key: string): string | null { return null; },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tool registration — one test per behavior
// ---------------------------------------------------------------------------

async function buildToolFixture() {
  const projectContext = await createTempPiToolContext();
  const result = createResult({ projectId: projectContext.projectId, repoPath: projectContext.cwd });
  const savedMemory = createMemory({
    id: "memory-saved",
    scope: "session",
    projectId: projectContext.projectId,
    repoPath: projectContext.cwd,
    sessionId: projectContext.sessionId,
    sourceAgent: "pi",
  });
  const existingHandoff = createMemory({
    id: "memory-saved",
    kind: "handoff",
    scope: "session",
    projectId: projectContext.projectId,
    repoPath: projectContext.cwd,
    sessionId: projectContext.sessionId,
    sourceAgent: "pi",
  });
  const updatedMemory = createMemory({ id: "memory-updated", title: "Updated title", pinned: true });
  const store = {
    dbPath: "/tmp/pi-memory-test.sqlite",
    embeddingModel: "builtin-hash-384-v1",
    embeddingDimensions: 384,
    searchMemories(_input: SearchMemoriesInput) { return [result]; },
    listMemories(_input: ListMemoriesInput) { return [savedMemory]; },
    listForTool(_filter: Partial<NormalizedListMemoriesInput> & { offset?: number }): ListForToolResult {
      return { items: [savedMemory], totalCount: 1, hasMore: false, nextOffset: null };
    },
    listAllInternal(filter?: Partial<NormalizedListMemoriesInput>) {
      return filter?.kind?.includes("handoff") ? [existingHandoff] : [savedMemory];
    },
    count() { return 0; },
    createMemory(_input: CreateMemoryInput) { return savedMemory; },
    getMemory(id: string) {
      if (id === "memory-saved") return savedMemory;
      if (id === "memory-updated") return updatedMemory;
      return null;
    },
    updateMemory(_input: UpdateMemoryInput) { return updatedMemory; },
    archiveMemory(_input: ArchiveMemoryInput) {
      return createMemory({ id: "memory-archived", status: "archived", metadata: { archive: { archivedReason: "superseded" } } });
    },
  };

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools(
    { registerTool(tool: RegisteredTool) { tools.push(tool); } } as never,
    () => store as never,
  );

  const ctx = { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } };
  const signal = new AbortController().signal;
  return { tools, store, ctx, signal, projectContext, result, savedMemory, updatedMemory };
}

test("registerMemoryTools registers all expected tool names", async (t) => {
  const { tools, projectContext } = await buildToolFixture();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const expectedToolNames = ["memory_search", "memory_list", "memory_save", "memory_save_todo", "memory_save_handoff", "memory_update", "memory_audit", "memory_tag_catalog", "memory_stats"];
  assert.equal(tools.length, expectedToolNames.length);
  assert.deepEqual(new Set(tools.map((tool) => tool.name)), new Set(expectedToolNames));
});

test("registerMemoryTools exposes parameters on every tool", async (t) => {
  const { tools, projectContext } = await buildToolFixture();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  assert.ok(tools.every((tool) => tool.parameters), "expected all registered tools to expose parameters");
});

test("registerMemoryTools provides promptSnippet and guidelines naming the tool", async (t) => {
  const { tools, projectContext } = await buildToolFixture();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  for (const tool of tools) {
    assert.ok(tool.promptSnippet, `${tool.name} should provide promptSnippet`);
    assert.ok(tool.promptGuidelines?.every((guideline) => guideline.includes(tool.name)), `${tool.name} guidelines should name the tool`);
  }
});

test("memory_search returns formatted result text and details", async (t) => {
  const { tools, store, ctx, signal, projectContext, result } = await buildToolFixture();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const output = await toolByName(tools, "memory_search").execute("call-search", { query: "manual policy", limit: 3 }, signal, () => undefined, ctx);

  assert.match(output.content[0].text, /Found 1 memory result for "manual policy"\./);
  assert.match(output.content[0].text, /Keep writes manual-first/);
  assert.deepEqual(output.details, { dbPath: store.dbPath, results: [result] });
});

test("memory_list shows legacy project notice and result summary", async (t) => {
  const { tools, store, ctx, signal, projectContext, savedMemory } = await buildToolFixture();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const output = await toolByName(tools, "memory_list").execute("call-list", { kind: "todo", scope: "project", limit: 3 }, signal, () => undefined, ctx);

  assert.match(output.content[0].text, /scope=project is legacy\/advanced compatibility/);
  assert.match(output.content[0].text, /Found 1 of 1 memor/);
  assert.match(output.content[0].text, /Keep writes manual-first/);
  assert.match(output.content[0].text, /Use explicit review and save tools for durable memory updates/);
  assert.deepEqual(output.details, { dbPath: store.dbPath, total_count: 1, count: 1, has_more: false, next_offset: null, items: [savedMemory] });
});

test("memory_save returns saved memory id and enriched identity fields in output", async (t) => {
  const { tools, store, ctx, signal, projectContext, savedMemory } = await buildToolFixture();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const output = await toolByName(tools, "memory_save").execute(
    "call-save",
    { kind: "todo", scope: "session", title: "Remember workflow", summary: "Keep durable writes explicit.", tags: ["policy"] },
    signal,
    () => undefined,
    ctx,
  );

  assert.match(output.content[0].text, /Saved memory memory-saved\./);
  assert.match(output.content[0].text, /title: Keep writes manual-first/);
  assert.ok(output.content[0].text.includes(`project_id: ${projectContext.projectId}`));
  assert.ok(output.content[0].text.includes(`repo_path: ${projectContext.cwd}`));
  assert.ok(output.content[0].text.includes(`session_id: ${projectContext.sessionId}`));
  assert.deepEqual(output.details, { dbPath: store.dbPath, memory: savedMemory });
});

test("memory_save_todo returns saved todo id and details", async (t) => {
  const { tools, ctx, signal, projectContext } = await buildToolFixture();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const output = await toolByName(tools, "memory_save_todo").execute(
    "call-todo",
    {
      title: "Implement memory_save_todo",
      description: "Add dedicated todo tool with priority and scope",
      priority: "P1",
      status: "in_progress",
      nextAction: "Write tests",
    },
    signal,
    () => undefined,
    ctx,
  );

  assert.match(output.content[0].text, /Saved memory memory-saved\./);
  assert.ok(output.details !== undefined, "expected todo output to have details");
});

test("memory_save_todo stores only caller content tags, not todo workflow fields", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const capturedCreates: CreateMemoryInput[] = [];
  const store = createMinimalStore({
    createMemory(input: CreateMemoryInput) {
      capturedCreates.push(input);
      return createMemory({ ...input, id: "todo-saved", tags: input.tags ?? [] });
    },
  });

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools({ registerTool(tool: RegisteredTool) { tools.push(tool); } } as never, () => store as never);

  const ctx = { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } };
  const signal = new AbortController().signal;
  await toolByName(tools, "memory_save_todo").execute(
    "call-todo-tags",
    {
      title: "Fix cache rollout",
      description: "Track the cache rollout follow-up.",
      priority: "P1",
      status: "blocked",
      nextAction: "Check staging logs",
      tags: ["Cache", "todo", "p1", "blocked", "Release"],
    },
    signal,
    () => undefined,
    ctx,
  );

  assert.equal(capturedCreates.length, 1);
  assert.deepEqual(capturedCreates[0]?.tags, ["Cache", "Release"]);
});

test("memory_save_handoff creates or updates a handoff and returns output", async (t) => {
  const { tools, store, ctx, signal, projectContext, updatedMemory } = await buildToolFixture();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const output = await toolByName(tools, "memory_save_handoff").execute(
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
    () => undefined,
    ctx,
  );

  assert.match(output.content[0].text, /Saved memory memory-updated\./);
  assert.deepEqual(output.details, { dbPath: store.dbPath, memory: updatedMemory });
});

test("memory_update patches a memory and returns updated fields in output", async (t) => {
  const { tools, store, ctx, signal, projectContext, updatedMemory } = await buildToolFixture();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const output = await toolByName(tools, "memory_update").execute(
    "call-update",
    { id: "memory-saved", title: "Updated title", pinned: true },
    signal,
    () => undefined,
    ctx,
  );

  assert.match(output.content[0].text, /Updated memory memory-updated\./);
  assert.match(output.content[0].text, /pinned: yes/);
  assert.match(output.content[0].text, /title: Updated title/);
  assert.deepEqual(output.details, { dbPath: store.dbPath, memory: updatedMemory });
});

test("memory_audit returns project migration preview and writes audit metadata", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const legacyProject = createMemory({
    id: "legacy-project-record",
    scope: "project",
    projectId: projectContext.projectId,
    repoPath: projectContext.cwd,
    title: "Legacy project record",
    tags: ["todo", "p1", "policy"],
  });
  const filters: Array<Partial<NormalizedListMemoriesInput> | undefined> = [];
  const metaWrites: Array<{ key: string; value: string }> = [];
  const store = createMinimalStore({
    listAllInternal(filter?: Partial<NormalizedListMemoriesInput>): MemoryRecord[] {
      filters.push(filter);
      return filter?.scope?.includes("project") || !filter?.scope ? [legacyProject] : [];
    },
    setMeta(key: string, value: string) {
      metaWrites.push({ key, value });
    },
  });

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools({ registerTool(tool: RegisteredTool) { tools.push(tool); } } as never, () => store as never);

  const output = await toolByName(tools, "memory_audit").execute(
    "call-audit",
    { scope: ["project"] },
    new AbortController().signal,
    () => undefined,
    { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } },
  );

  assert.match(output.content[0].text, /^notice: scope=project is legacy\/advanced compatibility/);
  assert.match(output.content[0].text, /Project migration preview \(1, read-only\):/);
  assert.match(output.content[0].text, /Legacy todo workflow tags \(1, advisory-only\):/);
  assert.match(output.content[0].text, /\[repo\] Legacy project record/);
  assert.deepEqual(output.details.legacyWorkflowTags, [
    {
      id: legacyProject.id,
      title: legacyProject.title,
      kind: legacyProject.kind,
      tags: legacyProject.tags,
      updatedAt: legacyProject.updatedAt,
      scope: legacyProject.scope,
      reason: "Active memory carries legacy todo workflow tags: todo, p1",
      suggestedAction: "Treat priority/status/todo as structured todo fields; manual review only; no automatic tag rewrite or archive",
    },
  ]);
  assert.deepEqual(output.details.projectMigrationPreview, [
    {
      id: legacyProject.id,
      title: legacyProject.title,
      kind: legacyProject.kind,
      tags: legacyProject.tags,
      updatedAt: legacyProject.updatedAt,
      scope: legacyProject.scope,
      projectId: legacyProject.projectId,
      repoPath: legacyProject.repoPath,
      sessionId: legacyProject.sessionId,
      recommendation: "repo",
      reason: "Legacy project record carries repoPath metadata, so repo scope is the likely normal replacement",
      suggestedAction: `After approval, consider scope=repo with repoPath=${projectContext.cwd}; keep projectId only as optional metadata if needed`,
    },
  ]);
  assert.ok(filters.every((filter) => filter?.projectId === undefined), "audit preview must not add projectId+repoPath filters");
  assert.equal(metaWrites.length, 2, "memory_audit must write lastAuditAt and lastAuditSummary");
  assert.equal(metaWrites[0]?.key, "lastAuditAt");
  assert.match(metaWrites[0]?.value ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(metaWrites[1]?.key, "lastAuditSummary");
  assert.match(metaWrites[1]?.value ?? "", /2 finding\(s\):/);
  assert.match(metaWrites[1]?.value ?? "", /1 legacy_workflow_tag/);
});

test("memory_tag_catalog derives tag counts without audit metadata writes", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const memories = [
    createMemory({ id: "cache-1", scope: "repo", repoPath: projectContext.cwd, kind: undefined, title: "Cache rollout", tags: ["cache", "release"], updatedAt: "2026-05-10T00:00:00.000Z" }),
    createMemory({ id: "cache-2", scope: "repo", repoPath: projectContext.cwd, kind: "todo", title: "Cache follow-up", tags: ["cache"], updatedAt: "2026-05-11T00:00:00.000Z" }),
    createMemory({ id: "docs-1", scope: "global", repoPath: undefined, kind: undefined, title: "Docs note", tags: ["docs"], updatedAt: "2026-05-12T00:00:00.000Z" }),
  ];
  const filters: Array<Partial<NormalizedListMemoriesInput> | undefined> = [];
  const metaWrites: Array<{ key: string; value: string }> = [];
  const store = createMinimalStore({
    listAllInternal(filter?: Partial<NormalizedListMemoriesInput>): MemoryRecord[] {
      filters.push(filter);
      return memories.filter((memory) =>
        (!filter?.status || memory.status === filter.status) &&
        (!filter?.scope || filter.scope.includes(memory.scope)) &&
        (!filter?.kind || (memory.kind !== undefined && memory.kind !== null && filter.kind.includes(memory.kind))) &&
        (!filter?.repoPath || memory.repoPath === filter.repoPath)
      );
    },
    setMeta(key: string, value: string) {
      metaWrites.push({ key, value });
    },
  });

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools({ registerTool(tool: RegisteredTool) { tools.push(tool); } } as never, () => store as never);

  const output = await toolByName(tools, "memory_tag_catalog").execute(
    "call-tag-catalog",
    { scope: ["repo"], repoPath: projectContext.cwd },
    new AbortController().signal,
    () => undefined,
    { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } },
  );

  assert.match(output.content[0].text, /Tag catalog: 2 tag/);
  assert.match(output.content[0].text, /cache — 2 memories/);
  assert.match(output.content[0].text, /release — 1 memory/);
  assert.deepEqual(output.details.tagCatalog, [
    {
      tag: "cache",
      count: 2,
      scopes: ["repo"],
      kinds: ["note", "todo"],
      examples: [
        { id: "cache-2", title: "Cache follow-up", scope: "repo", kind: "todo", updatedAt: "2026-05-11T00:00:00.000Z" },
        { id: "cache-1", title: "Cache rollout", scope: "repo", kind: "note", updatedAt: "2026-05-10T00:00:00.000Z" },
      ],
    },
    {
      tag: "release",
      count: 1,
      scopes: ["repo"],
      kinds: ["note"],
      examples: [
        { id: "cache-1", title: "Cache rollout", scope: "repo", kind: "note", updatedAt: "2026-05-10T00:00:00.000Z" },
      ],
    },
  ]);
  assert.deepEqual(filters, [{ status: "active", scope: ["repo"], repoPath: projectContext.cwd }]);
  assert.deepEqual(metaWrites, [], "memory_tag_catalog must be read-only and not write audit metadata");
});

test("memory_search adds empty-result hints for near canonical keys", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const canonicalMemory = createMemory({
    id: "git-identity-default",
    scope: "global",
    title: "Default Git identity",
    summary: "Use the default Git author when repository-local config is absent.",
    tags: ["git", "identity"],
    metadata: { canonicalKey: "git.identity.default" },
  });
  const store = createMinimalStore({
    searchMemories() { return []; },
    listAllInternal(filter?: Partial<NormalizedListMemoriesInput>): MemoryRecord[] {
      return filter?.status === "active" ? [canonicalMemory] : [];
    },
  });

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools({ registerTool(tool: RegisteredTool) { tools.push(tool); } } as never, () => store as never);

  const output = await toolByName(tools, "memory_search").execute(
    "call-search-near-canonical-key",
    { query: "git.identity.defalt", scope: ["global"] },
    new AbortController().signal,
    () => undefined,
    { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } },
  );

  assert.match(output.content[0].text, /No memories matched "git\.identity\.defalt"/);
  assert.match(output.content[0].text, /empty_result_hints:\n- near_canonical_key: git\.identity\.defalt -> git\.identity\.default/);
  assert.deepEqual(output.details.emptyResultHints, [
    { type: "near_canonical_key", input: "git.identity.defalt", suggestions: ["git.identity.default"] },
    { type: "broaden_search", message: "Retry with fewer keywords or a broader scope/kind when appropriate." },
  ]);
});

test("memory_search keeps generic empty-result hints when no canonical key is near", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const canonicalMemory = createMemory({
    id: "git-identity-default",
    scope: "global",
    title: "Default Git identity",
    metadata: { canonicalKey: "git.identity.default" },
  });
  const store = createMinimalStore({
    searchMemories() { return []; },
    listAllInternal(filter?: Partial<NormalizedListMemoriesInput>): MemoryRecord[] {
      return filter?.status === "active" ? [canonicalMemory] : [];
    },
  });

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools({ registerTool(tool: RegisteredTool) { tools.push(tool); } } as never, () => store as never);

  const output = await toolByName(tools, "memory_search").execute(
    "call-search-generic-empty-hint",
    { query: ".", scope: ["global"] },
    new AbortController().signal,
    () => undefined,
    { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } },
  );

  assert.match(output.content[0].text, /empty_result_hints:\n- broaden_search: Retry with fewer keywords or a broader scope\/kind when appropriate\./);
  assert.doesNotMatch(output.content[0].text, /near_canonical_key/);
  assert.deepEqual(output.details.emptyResultHints, [
    { type: "broaden_search", message: "Retry with fewer keywords or a broader scope/kind when appropriate." },
  ]);
});

test("memory_search suggests near tags when a tag filter has no matches", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const catalogMemory = createMemory({ id: "agent-context", scope: "repo", repoPath: projectContext.cwd, tags: ["agent-context"] });
  const store = createMinimalStore({
    searchMemories() { return []; },
    listAllInternal(filter?: Partial<NormalizedListMemoriesInput>): MemoryRecord[] {
      return filter?.repoPath === projectContext.cwd ? [catalogMemory] : [];
    },
  });

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools({ registerTool(tool: RegisteredTool) { tools.push(tool); } } as never, () => store as never);

  const output = await toolByName(tools, "memory_search").execute(
    "call-search-near-tag",
    { query: "context", scope: ["repo"], repoPath: projectContext.cwd, tags: ["agentic-context"] },
    new AbortController().signal,
    () => undefined,
    { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } },
  );

  assert.match(output.content[0].text, /No memories matched "context"/);
  assert.match(output.content[0].text, /near_tag_suggestions:\n- agentic-context: agent-context/);
  assert.deepEqual(output.details.nearTagSuggestions, [{ input: "agentic-context", suggestions: ["agent-context"] }]);
});

test("memory_save warns when new tags look like existing tags", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const catalogMemory = createMemory({ id: "agent-context", scope: "repo", repoPath: projectContext.cwd, tags: ["agent-context"] });
  const store = createMinimalStore({
    listAllInternal(filter?: Partial<NormalizedListMemoriesInput>): MemoryRecord[] {
      return filter?.repoPath === projectContext.cwd ? [catalogMemory] : [];
    },
    createMemory(input: CreateMemoryInput): MemoryRecord {
      return createMemory({ ...input, id: "saved-near-tag", tags: input.tags ?? [] });
    },
  });

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools({ registerTool(tool: RegisteredTool) { tools.push(tool); } } as never, () => store as never);

  const output = await toolByName(tools, "memory_save").execute(
    "call-save-near-tag",
    { title: "Agent context note", summary: "Remember the compact agent context rule.", tags: ["agentic-context"] },
    new AbortController().signal,
    () => undefined,
    { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } },
  );

  assert.match(output.content[0].text, /Saved memory saved-near-tag/);
  assert.match(output.content[0].text, /near_tag_suggestions:\n- agentic-context: agent-context/);
  assert.deepEqual(output.details.nearTagSuggestions, [{ input: "agentic-context", suggestions: ["agent-context"] }]);
});

test("memory_save_todo warns when content tags look like existing tags", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const catalogMemory = createMemory({ id: "agent-context", scope: "repo", repoPath: projectContext.cwd, tags: ["agent-context"] });
  const store = createMinimalStore({
    listAllInternal(filter?: Partial<NormalizedListMemoriesInput>): MemoryRecord[] {
      return filter?.repoPath === projectContext.cwd ? [catalogMemory] : [];
    },
    createMemory(input: CreateMemoryInput): MemoryRecord {
      return createMemory({ ...input, id: "todo-near-tag", kind: "todo", tags: input.tags ?? [] });
    },
  });

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools({ registerTool(tool: RegisteredTool) { tools.push(tool); } } as never, () => store as never);

  const output = await toolByName(tools, "memory_save_todo").execute(
    "call-save-todo-near-tag",
    { title: "Document agent context", description: "Capture durable agent context guidance.", tags: ["agentic-context", "todo", "p1"] },
    new AbortController().signal,
    () => undefined,
    { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } },
  );

  assert.match(output.content[0].text, /Saved memory todo-near-tag/);
  assert.match(output.content[0].text, /near_tag_suggestions:\n- agentic-context: agent-context/);
  assert.deepEqual(output.details.nearTagSuggestions, [{ input: "agentic-context", suggestions: ["agent-context"] }]);
});

test("memory_update warns when replacement tags look like existing tags", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const existingMemory = createMemory({ id: "memory-update-near-tag", scope: "repo", repoPath: projectContext.cwd, tags: ["policy"] });
  const catalogMemory = createMemory({ id: "agent-context", scope: "repo", repoPath: projectContext.cwd, tags: ["agent-context"] });
  const store = createMinimalStore({
    getMemory(id: string): MemoryRecord | null { return id === existingMemory.id ? existingMemory : null; },
    listAllInternal(filter?: Partial<NormalizedListMemoriesInput>): MemoryRecord[] {
      return filter?.repoPath === projectContext.cwd ? [catalogMemory, existingMemory] : [];
    },
    updateMemory(input: UpdateMemoryInput): MemoryRecord {
      return { ...existingMemory, ...input, tags: input.tags ?? existingMemory.tags } as MemoryRecord;
    },
  });

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools({ registerTool(tool: RegisteredTool) { tools.push(tool); } } as never, () => store as never);

  const output = await toolByName(tools, "memory_update").execute(
    "call-update-near-tag",
    { id: existingMemory.id, tags: ["agentic-context"] },
    new AbortController().signal,
    () => undefined,
    { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } },
  );

  assert.match(output.content[0].text, /Updated memory memory-update-near-tag/);
  assert.match(output.content[0].text, /near_tag_suggestions:\n- agentic-context: agent-context/);
  assert.deepEqual(output.details.nearTagSuggestions, [{ input: "agentic-context", suggestions: ["agent-context"] }]);
});

test("memory_save_handoff updates only the current session handoff", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const store = initializeMemoryStore({ dbPath: join(projectContext.cwd, "memory.sqlite") });
  t.after(() => { store.close(); });
  const fallback = store.createMemory({
    kind: "handoff",
    scope: "session",
    sessionId: "previous-session",
    projectId: projectContext.projectId,
    repoPath: projectContext.cwd,
    title: "Previous session handoff",
    summary: "Fallback handoff must not be overwritten by current session save.",
  });

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools({ registerTool(tool: RegisteredTool) { tools.push(tool); } } as never, () => store as never);
  const ctx = { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } };
  const signal = new AbortController().signal;
  const params = {
    handoffReason: "context_reset",
    resumeInstruction: "Continue current session work",
    goal: "Protect current handoff save",
    currentState: "First current-session save.",
    nextSteps: ["Save again to update current session only"],
  };

  const first = await toolByName(tools, "memory_save_handoff").execute("call-handoff-first", params, signal, () => undefined, ctx);
  const currentId = (first.details.memory as MemoryRecord).id;
  const second = await toolByName(tools, "memory_save_handoff").execute(
    "call-handoff-second",
    { ...params, currentState: "Second current-session save." },
    signal,
    () => undefined,
    ctx,
  );

  assert.equal((second.details.memory as MemoryRecord).id, currentId);
  assert.equal(store.getMemory(fallback.id)?.summary, "Fallback handoff must not be overwritten by current session save.");
  assert.equal(store.getMemory(currentId)?.summary, "Second current-session save.");
});

test("memory_save_handoff does not update an expired current-session handoff", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const store = initializeMemoryStore({ dbPath: join(projectContext.cwd, "memory.sqlite") });
  t.after(() => { store.close(); });
  const expired = store.createMemory({
    kind: "handoff",
    scope: "session",
    sessionId: projectContext.sessionId,
    projectId: projectContext.projectId,
    repoPath: projectContext.cwd,
    title: "Current handoff",
    summary: "Current handoff will be updated since expiresAt is removed.",
  });

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools({ registerTool(tool: RegisteredTool) { tools.push(tool); } } as never, () => store as never);

  const output = await toolByName(tools, "memory_save_handoff").execute(
    "call-handoff-expired",
    {
      handoffReason: "context_reset",
      resumeInstruction: "Continue with fresh handoff",
      goal: "Replace expired handoff",
      currentState: "Fresh current-session handoff.",
      nextSteps: ["Verify expired handoff was not overwritten"],
    },
    new AbortController().signal,
    () => undefined,
    { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } },
  );

  // expiresAt removed in slice5 — the existing handoff is always treated as active and updated
  const saved = output.details.memory as MemoryRecord;
  assert.equal(saved.id, expired.id);
  assert.equal(store.getMemory(saved.id)?.summary, "Fresh current-session handoff.");
});

test("memory_list supports optional kind/scope catalog mode", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const calls: Array<Partial<NormalizedListMemoriesInput> & { offset?: number }> = [];
  const store = createMinimalStore({
    listForTool(filter: Partial<NormalizedListMemoriesInput> & { offset?: number }): ListForToolResult {
      calls.push(filter);
      return { items: [], totalCount: 0, hasMore: false, nextOffset: null };
    },
  });

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools({ registerTool(tool: RegisteredTool) { tools.push(tool); } } as never, () => store as never);

  const output = await toolByName(tools, "memory_list").execute(
    "call-list-catalog",
    { limit: 5 },
    new AbortController().signal,
    () => undefined,
    { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } },
  );

  assert.deepEqual(calls, [
    { kind: undefined, scope: undefined, tags: undefined, sessionId: undefined, projectId: undefined, repoPath: undefined, status: undefined, orderBy: undefined, limit: 5, offset: 0 },
  ]);
  assert.match(output.content[0].text, /No memories matched the list filters/);
});

test("memory_list supports kind-only normal replacement flows", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const calls: Array<Partial<NormalizedListMemoriesInput> & { offset?: number }> = [];
  const store = createMinimalStore({
    listForTool(filter: Partial<NormalizedListMemoriesInput> & { offset?: number }): ListForToolResult {
      calls.push(filter);
      return { items: [], totalCount: 0, hasMore: false, nextOffset: null };
    },
  });

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools({ registerTool(tool: RegisteredTool) { tools.push(tool); } } as never, () => store as never);
  const ctx = { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } };
  const signal = new AbortController().signal;

  await toolByName(tools, "memory_list").execute(
    "call-list-todos",
    { kind: "todo", status: "active", limit: 20 },
    signal,
    () => undefined,
    ctx,
  );
  await toolByName(tools, "memory_list").execute(
    "call-list-handoffs",
    { kind: "handoff", status: "active", limit: 10 },
    signal,
    () => undefined,
    ctx,
  );

  assert.deepEqual(calls, [
    { kind: ["todo"], scope: undefined, tags: undefined, sessionId: undefined, projectId: undefined, repoPath: undefined, status: "active", orderBy: undefined, limit: 20, offset: 0 },
    { kind: ["handoff"], scope: undefined, tags: undefined, sessionId: undefined, projectId: undefined, repoPath: undefined, status: "active", orderBy: undefined, limit: 10, offset: 0 },
  ]);
});

test("memory_update archives with archiveReason through the normal update surface", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const memory = createMemory({ id: "memory-to-archive", kind: "todo" });
  const archived = createMemory({ ...memory, status: "archived", metadata: { archive: { archivedReason: "superseded" } } });
  const archiveCalls: ArchiveMemoryInput[] = [];
  const updateCalls: UpdateMemoryInput[] = [];
  const store = createMinimalStore({
    getMemory(id: string): MemoryRecord | null { return id === memory.id ? memory : null; },
    updateMemory(input: UpdateMemoryInput): MemoryRecord {
      updateCalls.push(input);
      return memory;
    },
  });
  store.archiveMemory = (input: ArchiveMemoryInput) => {
    archiveCalls.push(input);
    return archived;
  };

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools({ registerTool(tool: RegisteredTool) { tools.push(tool); } } as never, () => store as never);

  const output = await toolByName(tools, "memory_update").execute(
    "call-update-archive",
    { id: memory.id, status: "archived", archiveReason: "superseded" },
    new AbortController().signal,
    () => undefined,
    { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } },
  );

  assert.deepEqual(archiveCalls, [{ id: memory.id, reason: "superseded" }]);
  assert.deepEqual(updateCalls, []);
  assert.match(output.content[0].text, /Archived memory memory-to-archive\./);
});

test("memory_update rejects invalid archiveReason combinations", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const memory = createMemory({ id: "memory-to-check", kind: "todo" });
  const archiveCalls: ArchiveMemoryInput[] = [];
  const updateCalls: UpdateMemoryInput[] = [];
  const store = createMinimalStore({
    getMemory(id: string): MemoryRecord | null { return id === memory.id ? memory : null; },
    updateMemory(input: UpdateMemoryInput): MemoryRecord {
      updateCalls.push(input);
      return memory;
    },
  });
  store.archiveMemory = (input: ArchiveMemoryInput) => {
    archiveCalls.push(input);
    return memory;
  };

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools({ registerTool(tool: RegisteredTool) { tools.push(tool); } } as never, () => store as never);
  const ctx = { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } };
  const signal = new AbortController().signal;

  const missingStatus = await toolByName(tools, "memory_update").execute(
    "call-invalid-archive-reason",
    { id: memory.id, archiveReason: "superseded" },
    signal,
    () => undefined,
    ctx,
  );
  const combinedPatch = await toolByName(tools, "memory_update").execute(
    "call-combined-archive-reason",
    { id: memory.id, status: "archived", archiveReason: "superseded", title: "Edited" },
    signal,
    () => undefined,
    ctx,
  );

  assert.match(missingStatus.content[0].text, /archiveReason is only valid with status=archived/);
  assert.match(combinedPatch.content[0].text, /archiveReason cannot be combined with other field patches/);
  assert.deepEqual(archiveCalls, []);
  assert.deepEqual(updateCalls, []);
});

test("memory_update permits handoff lifecycle status updates but blocks content edits", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const handoff = createMemory({ id: "handoff-old", kind: "handoff", scope: "session", sessionId: "old-session" });
  const updated = createMemory({ ...handoff, status: "archived" });
  const calls: UpdateMemoryInput[] = [];
  const store = createMinimalStore({
    getMemory(id: string): MemoryRecord | null { return id === handoff.id ? handoff : null; },
    updateMemory(input: UpdateMemoryInput): MemoryRecord {
      calls.push(input);
      return updated;
    },
  });

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools({ registerTool(tool: RegisteredTool) { tools.push(tool); } } as never, () => store as never);
  const ctx = { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } };
  const signal = new AbortController().signal;

  const statusOutput = await toolByName(tools, "memory_update").execute(
    "call-supersede-handoff",
    { id: "handoff-old", status: "archived" },
    signal,
    () => undefined,
    ctx,
  );
  const contentOutput = await toolByName(tools, "memory_update").execute(
    "call-edit-handoff",
    { id: "handoff-old", title: "Edited handoff" },
    signal,
    () => undefined,
    ctx,
  );

  assert.deepEqual(calls, [{ id: "handoff-old", status: "archived" }]);
  assert.match(statusOutput.content[0].text, /Updated memory handoff-old\./);
  assert.match(contentOutput.content[0].text, /memory_update may only change handoff status/);
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

  const factMemory = createMemory({ kind: undefined as never, id: "fact-1" });
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
    tags: ["todo", "p2"],
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
  assert.ok(!update.tags?.includes("p1"), `expected tags not to include p1, got: ${JSON.stringify(update.tags)}`);
  assert.ok(!update.tags?.includes("p2"), `expected tags not to include p2, got: ${JSON.stringify(update.tags)}`);
  assert.deepEqual(update.tags, []);
});

test("memory_update nextAction preserves priority from summary when no priority tag exists", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const todoMemory = createMemory({
    kind: "todo",
    id: "todo-summary-priority",
    summary: "[P1] Fix the thing → old action",
    tags: ["todo"],
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
    { id: "todo-summary-priority", nextAction: "new action" },
    signal,
    () => undefined,
    ctx,
  );

  assert.equal(capturedUpdates.length, 1);
  const update = capturedUpdates[0]!;
  assert.equal(update.summary, "[P1] Fix the thing → new action");
  assert.deepEqual(update.tags, []);
});

test("memory_update strips workflow tags from explicit todo tag replacements", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const todoMemory = createMemory({
    kind: "todo",
    id: "todo-tags",
    summary: "Fix the thing",
    tags: ["cache"],
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
    "call-update-tags",
    { id: "todo-tags", tags: ["Cache", "todo", "p1", "blocked"] },
    signal,
    () => undefined,
    ctx,
  );

  assert.equal(capturedUpdates.length, 1);
  assert.deepEqual(capturedUpdates[0]?.tags, ["Cache"]);
});

test("memory_update with explicit summary + priority keeps prefix consistent", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const todoMemory = createMemory({
    kind: "todo",
    id: "todo-2",
    summary: "[P2] Fix the thing \u2192 old action",
    tags: ["todo", "p2"],
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
  assert.deepEqual(update.tags, []);
});

test("memory_save defaults to repo identity in a Git repo and rejects hidden contradictory ids", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const capturedCreates: CreateMemoryInput[] = [];
  const saved = createMemory({ id: "saved-default", scope: "repo", projectId: projectContext.projectId, repoPath: projectContext.cwd });
  const store = createMinimalStore({
    createMemory(input: CreateMemoryInput) {
      capturedCreates.push(input);
      return { ...saved, ...input, tags: input.tags ?? [] } as MemoryRecord;
    },
  });

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools({ registerTool(tool: RegisteredTool) { tools.push(tool); } } as never, () => store as never);
  const ctx = { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } };
  const signal = new AbortController().signal;

  const savedOutput = await toolByName(tools, "memory_save").execute(
    "call-save-default",
    { kind: "todo", title: "Default repo scope", summary: "Default memory save should infer repo scope in a Git repository." },
    signal,
    () => undefined,
    ctx,
  );
  const invalidOutput = await toolByName(tools, "memory_save").execute(
    "call-save-invalid",
    { kind: "todo", scope: "repo", title: "Bad repo scope", summary: "Contradictory hidden identifiers should be rejected.", projectId: "manual-project" },
    signal,
    () => undefined,
    ctx,
  );

  assert.equal(capturedCreates.length, 1);
  assert.equal(capturedCreates[0]?.scope, "repo");
  assert.equal(capturedCreates[0]?.repoPath, projectContext.cwd);
  assert.equal(capturedCreates[0]?.projectId, projectContext.projectId);
  assert.match(savedOutput.content[0].text, /Saved memory/);
  assert.match(invalidOutput.content[0].text, /Invalid memory scope identity/);
  assert.match(invalidOutput.content[0].text, /scope=repo uses repoPath/);
});

test("memory_save warns but accepts explicit legacy project scope", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const capturedCreates: CreateMemoryInput[] = [];
  const saved = createMemory({ id: "saved-project", scope: "project", projectId: projectContext.projectId });
  const store = createMinimalStore({
    createMemory(input: CreateMemoryInput) {
      capturedCreates.push(input);
      return { ...saved, ...input, tags: input.tags ?? [] } as MemoryRecord;
    },
  });

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools({ registerTool(tool: RegisteredTool) { tools.push(tool); } } as never, () => store as never);

  const output = await toolByName(tools, "memory_save").execute(
    "call-save-project",
    { kind: "todo", scope: "project", title: "Legacy project scope", summary: "Explicit project scope remains compatible." },
    new AbortController().signal,
    () => undefined,
    { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } },
  );

  assert.equal(capturedCreates.length, 1);
  assert.equal(capturedCreates[0]?.scope, "project");
  assert.equal(capturedCreates[0]?.projectId, projectContext.projectId);
  assert.match(output.content[0].text, /^notice: scope=project is legacy\/advanced compatibility/);
  assert.match(output.content[0].text, /Saved memory saved-project\./);
});

test("public tools consistently reject contradictory scope identity filters", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const capturedSearches: SearchMemoriesInput[] = [];
  const capturedCreates: CreateMemoryInput[] = [];
  const capturedCounts: Array<Record<string, unknown>> = [];
  const store = createMinimalStore({
    createMemory(input: CreateMemoryInput) {
      capturedCreates.push(input);
      return { ...createMemory({ id: "created", scope: input.scope, projectId: input.projectId, repoPath: input.repoPath, sessionId: input.sessionId }), tags: input.tags ?? [] };
    },
  });
  store.searchMemories = (input: SearchMemoriesInput) => {
    capturedSearches.push(input);
    return [];
  };
  store.count = (filter?: Record<string, unknown>) => {
    capturedCounts.push(filter ?? {});
    return 0;
  };

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools({ registerTool(tool: RegisteredTool) { tools.push(tool); } } as never, () => store as never);
  const ctx = { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } };
  const signal = new AbortController().signal;

  const invalidTodo = await toolByName(tools, "memory_save_todo").execute(
    "call-invalid-todo",
    { title: "Bad todo", scope: "repo", projectId: "manual-project" },
    signal,
    () => undefined,
    ctx,
  );
  const invalidList = await toolByName(tools, "memory_list").execute(
    "call-invalid-list",
    { scope: "session", repoPath: projectContext.cwd },
    signal,
    () => undefined,
    ctx,
  );
  const invalidStats = await toolByName(tools, "memory_stats").execute(
    "call-invalid-stats",
    { scope: "repo", projectId: "manual-project" },
    signal,
    () => undefined,
    ctx,
  );
  const invalidSearch = await toolByName(tools, "memory_search").execute(
    "call-invalid-search",
    { query: "identity", repoPath: projectContext.cwd, projectId: projectContext.projectId },
    signal,
    () => undefined,
    ctx,
  );

  assert.match(invalidTodo.content[0].text, /Invalid memory scope identity/);
  assert.match(invalidTodo.content[0].text, /scope=repo uses repoPath/);
  assert.match(invalidList.content[0].text, /scope=session uses sessionId/);
  assert.match(invalidStats.content[0].text, /scope=repo uses repoPath/);
  assert.match(invalidSearch.content[0].text, /cannot be combined without a single compatible scope/);

  await toolByName(tools, "memory_stats").execute("call-valid-stats", { scope: "repo" }, signal, () => undefined, ctx);
  await toolByName(tools, "memory_search").execute(
    "call-valid-search",
    { query: "identity", repoPath: projectContext.cwd },
    signal,
    () => undefined,
    ctx,
  );

  assert.ok(capturedCounts.some((filter) => Array.isArray(filter.scope) && filter.scope[0] === "repo" && filter.repoPath === projectContext.cwd));
  assert.deepEqual(capturedSearches.at(-1), { query: "identity", repoPath: projectContext.cwd, sessionId: undefined, projectId: undefined });
  assert.deepEqual(capturedCreates, []);
});

test("memory_update derives primary identity when changing to repo scope", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const projectMemory = createMemory({ id: "memory-project", scope: "project", projectId: projectContext.projectId, repoPath: undefined });
  const capturedUpdates: UpdateMemoryInput[] = [];
  const store = createMinimalStore({
    getMemory(id: string): MemoryRecord | null { return id === projectMemory.id ? projectMemory : null; },
    updateMemory(input: UpdateMemoryInput): MemoryRecord {
      capturedUpdates.push(input);
      return { ...projectMemory, ...input } as MemoryRecord;
    },
  });

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools({ registerTool(tool: RegisteredTool) { tools.push(tool); } } as never, () => store as never);

  const output = await toolByName(tools, "memory_update").execute(
    "call-update-scope",
    { id: projectMemory.id, scope: "repo" },
    new AbortController().signal,
    () => undefined,
    { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } },
  );

  assert.deepEqual(capturedUpdates, [{ id: projectMemory.id, scope: "repo", repoPath: projectContext.cwd }]);
  assert.match(output.content[0].text, /Updated memory/);
});

test("memory_update rejects scope changes that would leave stale session identity", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const sessionMemory = createMemory({ id: "memory-session", scope: "session", sessionId: "old-session" });
  const capturedUpdates: UpdateMemoryInput[] = [];
  const store = createMinimalStore({
    getMemory(id: string): MemoryRecord | null { return id === sessionMemory.id ? sessionMemory : null; },
    updateMemory(input: UpdateMemoryInput): MemoryRecord {
      capturedUpdates.push(input);
      return { ...sessionMemory, ...input } as MemoryRecord;
    },
  });

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools({ registerTool(tool: RegisteredTool) { tools.push(tool); } } as never, () => store as never);

  const output = await toolByName(tools, "memory_update").execute(
    "call-update-session-to-repo",
    { id: sessionMemory.id, scope: "repo" },
    new AbortController().signal,
    () => undefined,
    { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } },
  );

  assert.deepEqual(capturedUpdates, []);
  assert.match(output.content[0].text, /cannot change a session memory to repo\/project\/global/);
});

test("memory_save_handoff appends warning when active handoff count >= 3", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const savedHandoff = createMemory({
    id: "handoff-new",
    kind: "handoff",
    scope: "session",
    projectId: projectContext.projectId,
    repoPath: projectContext.cwd,
    sessionId: projectContext.sessionId,
    sourceAgent: "pi",
  });
  const store = createMinimalStore({
    listAllInternal() { return []; }, // no existing handoff for this session
    createMemory(_input: CreateMemoryInput) { return savedHandoff; },
    count() { return 3; },
  });

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools({ registerTool(tool: RegisteredTool) { tools.push(tool); } } as never, () => store as never);

  const output = await toolByName(tools, "memory_save_handoff").execute(
    "call-handoff-warn",
    {
      handoffReason: "context_reset",
      resumeInstruction: "Resume from warning test",
      goal: "Test handoff warning",
      currentState: "Running test.",
      nextSteps: ["Verify warning appears"],
    },
    new AbortController().signal,
    () => undefined,
    { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } },
  );

  assert.match(output.content[0].text, /warning: 3 active handoffs for this repo/);
  assert.match(output.content[0].text, /consider archiving old ones/);
});

test("memory_save_handoff omits warning when active handoff count < 3", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const savedHandoff = createMemory({
    id: "handoff-ok",
    kind: "handoff",
    scope: "session",
    projectId: projectContext.projectId,
    repoPath: projectContext.cwd,
    sessionId: projectContext.sessionId,
    sourceAgent: "pi",
  });
  const store = createMinimalStore({
    listAllInternal() { return []; },
    createMemory(_input: CreateMemoryInput) { return savedHandoff; },
    count() { return 2; },
  });

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools({ registerTool(tool: RegisteredTool) { tools.push(tool); } } as never, () => store as never);

  const output = await toolByName(tools, "memory_save_handoff").execute(
    "call-handoff-no-warn",
    {
      handoffReason: "session_end",
      resumeInstruction: "Resume from no-warning test",
      goal: "Test no handoff warning",
      currentState: "Running test.",
      nextSteps: ["Verify no warning"],
    },
    new AbortController().signal,
    () => undefined,
    { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } },
  );

  assert.doesNotMatch(output.content[0].text, /warning:.*active handoffs/);
});

test("memory_stats shows last_audit: never when memory_audit has not run", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const store = initializeMemoryStore({ dbPath: join(projectContext.cwd, "memory.sqlite") });
  t.after(() => { store.close(); });

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools({ registerTool(tool: RegisteredTool) { tools.push(tool); } } as never, () => store as never);
  const ctx = { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } };

  const output = await toolByName(tools, "memory_stats").execute(
    "call-stats-no-audit",
    { scope: "repo", repoPath: projectContext.cwd },
    new AbortController().signal,
    () => undefined,
    ctx,
  );

  assert.match(output.content[0].text, /last_audit: never/);
  assert.match(output.content[0].text, /last_audit_summary: n\/a/);
});

test("memory_stats shows last_audit and last_audit_summary after memory_audit runs", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const store = initializeMemoryStore({ dbPath: join(projectContext.cwd, "memory.sqlite") });
  t.after(() => { store.close(); });

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools({ registerTool(tool: RegisteredTool) { tools.push(tool); } } as never, () => store as never);
  const ctx = { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } };
  const signal = new AbortController().signal;

  await toolByName(tools, "memory_audit").execute("call-audit-meta", {}, signal, () => undefined, ctx);

  const statsOutput = await toolByName(tools, "memory_stats").execute(
    "call-stats-after-audit",
    { scope: "repo", repoPath: projectContext.cwd },
    signal,
    () => undefined,
    ctx,
  );

  assert.match(statsOutput.content[0].text, /last_audit: \d{4}-\d{2}-\d{2}T/);
  assert.match(statsOutput.content[0].text, /last_audit_summary: \d+ finding\(s\):/);
});

// ---------------------------------------------------------------------------
// P2-6: Missing tool-layer coverage
// ---------------------------------------------------------------------------

test("memory_save rejects low-information writes at the tool layer", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const store = initializeMemoryStore({ dbPath: join(projectContext.cwd, "memory.sqlite") });
  t.after(() => { store.close(); });

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools({ registerTool(tool: RegisteredTool) { tools.push(tool); } } as never, () => store as never);

  await assert.rejects(
    () => toolByName(tools, "memory_save").execute(
      "call-low-info",
      { title: "x", summary: "y" },
      new AbortController().signal,
      () => undefined,
      { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } },
    ),
    (err: Error) => {
      assert.ok(
        err.message.includes("title") || err.message.includes("summary") || err.message.includes("low") || err.message.includes("short"),
        `expected validation error about title/summary length, got: ${err.message}`,
      );
      return true;
    },
  );
});

test("memory_list returns pagination fields in details", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  const store = createMinimalStore({
    listForTool(_filter) {
      return { items: [], totalCount: 5, hasMore: true, nextOffset: 2 };
    },
  });

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools({ registerTool(tool: RegisteredTool) { tools.push(tool); } } as never, () => store as never);

  const output = await toolByName(tools, "memory_list").execute(
    "call-list-pagination",
    { limit: 2, offset: 0 },
    new AbortController().signal,
    () => undefined,
    { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } },
  );

  assert.equal(output.details.has_more, true);
  assert.equal(output.details.next_offset, 2);
  assert.equal(output.details.total_count, 5);
  assert.match(output.content[0].text, /No memories matched/);
});

test("memory_stats shows kind breakdown for todo and handoff", async (t) => {
  const projectContext = await createTempPiToolContext();
  t.after(async () => { await rm(projectContext.cwd, { recursive: true, force: true }); });

  let callCount = 0;
  const store = createMinimalStore({ getMeta: (_key) => null });
  store.count = (_filter?: Record<string, unknown>) => {
    callCount++;
    if (callCount === 1) return 3; // todo active
    if (callCount === 2) return 1; // todo archived
    if (callCount === 3) return 0; // handoff active
    return 2;                       // handoff archived
  };

  const tools: RegisteredTool[] = [];
  const registerMemoryTools = await importRegisterMemoryTools();
  registerMemoryTools({ registerTool(tool: RegisteredTool) { tools.push(tool); } } as never, () => store as never);

  const output = await toolByName(tools, "memory_stats").execute(
    "call-stats-breakdown",
    { scope: "global" },
    new AbortController().signal,
    () => undefined,
    { cwd: projectContext.cwd, sessionManager: { getSessionId: () => projectContext.sessionId } },
  );

  assert.match(output.content[0].text, /todo:/);
  assert.match(output.content[0].text, /handoff:/);
  assert.match(output.content[0].text, /active=3/);
  assert.match(output.content[0].text, /archived=1/);
});
