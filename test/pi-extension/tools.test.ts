import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

import type { MemorySearchResult, SearchMemoriesInput } from "../../src/core/index.ts";

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

function createResult(): MemorySearchResult {
  return {
    id: "memory-1",
    kind: "decision",
    scope: "project",
    title: "Keep writes manual-first",
    summary: "Use explicit review and save tools for durable memory updates.",
    tags: ["policy"],
    projectId: "@acme/api",
    repoPath: "/repo",
    importance: 0.8,
    confidence: 0.9,
    createdAt: "2026-04-28T10:00:00.000Z",
    updatedAt: "2026-04-28T10:00:00.000Z",
    matchScore: 0.92,
    lexicalScore: 0.7,
    semanticScore: 0.65,
    scopeScore: 0.8,
    recencyScore: 0.9,
  };
}

test("registerMemoryTools registers the expected tools and wires memory_search execution", async () => {
  const tools: RegisteredTool[] = [];
  const calls: SearchMemoriesInput[] = [];
  const result = createResult();
  const store = {
    dbPath: "/tmp/pi-memory-test.sqlite",
    searchMemories(input: SearchMemoriesInput) {
      calls.push(input);
      return [result];
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
      assert.equal(cwd, "/repo");
      return store as never;
    },
  );

  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["memory_search", "memory_save", "memory_update", "memory_link", "memory_archive"],
  );
  assert.ok(tools.every((tool) => tool.parameters), "expected all registered tools to expose parameters");

  const searchTool = tools.find((tool) => tool.name === "memory_search");
  assert.ok(searchTool, "expected memory_search to be registered");

  const output = await searchTool.execute(
    "call-1",
    { query: "manual policy", limit: 3 },
    new AbortController().signal,
    () => undefined,
    { cwd: "/repo", sessionManager: { getSessionId: () => "session-123" } },
  );

  assert.deepEqual(calls, [{ query: "manual policy", limit: 3 }]);
  assert.match(output.content[0].text, /Found 1 memory result for "manual policy"\./);
  assert.match(output.content[0].text, /Keep writes manual-first/);
  assert.equal(output.details.dbPath, "/tmp/pi-memory-test.sqlite");
  assert.deepEqual(output.details.results, [result]);
});
