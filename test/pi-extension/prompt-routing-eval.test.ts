import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

import {
  evaluatePromptRoutingResponse,
  PROMPT_ROUTING_EVAL_CASES,
  summarizePromptRoutingEvalSet,
} from "../../scripts/eval-prompt-routing.ts";

const execFile = promisify(execFileCallback);

test("prompt-routing eval set covers all memory tools plus negative cases", () => {
  const expected = new Set([
    "memory_search",
    "memory_list",
    "memory_save",
    "memory_save_todo",
    "memory_save_handoff",
    "memory_update",
    "memory_audit",
    "memory_tag_catalog",
    "memory_stats",
    "<none>",
  ]);

  const actual = new Set(summarizePromptRoutingEvalSet().map((entry) => entry.split(":")[0]));
  assert.deepEqual(actual, expected);
});

test("prompt-routing response evaluation accepts matching tool and key arguments", () => {
  const testCase = PROMPT_ROUTING_EVAL_CASES.find((entry) => entry.id === "archive-completed-memory");
  assert.ok(testCase);

  const result = evaluatePromptRoutingResponse(testCase, {
    toolName: "memory_update",
    arguments: {
      id: "mem-123",
      status: "archived",
      archiveReason: "completed during backlog cleanup",
    },
  });

  assert.equal(result.passed, true);
  assert.deepEqual(result.issues, []);
});

test("prompt-routing response evaluation rejects wrong tools", () => {
  const testCase = PROMPT_ROUTING_EVAL_CASES.find((entry) => entry.id === "tag-catalog-before-new-tag");
  assert.ok(testCase);

  const result = evaluatePromptRoutingResponse(testCase, {
    toolName: "memory_search",
    arguments: { query: "tags" },
  });

  assert.equal(result.passed, false);
  assert.match(result.issues.join("\n"), /expected tool memory_tag_catalog/);
});

test("prompt-routing response evaluation rejects missing key argument content", () => {
  const testCase = PROMPT_ROUTING_EVAL_CASES.find((entry) => entry.id === "search-existing-context");
  assert.ok(testCase);

  const result = evaluatePromptRoutingResponse(testCase, {
    toolName: "memory_search",
    arguments: { query: "context" },
  });

  assert.equal(result.passed, false);
  assert.match(result.issues.join("\n"), /argument query did not include tag, catalog/);
});

test("prompt-routing response evaluation accepts explicit no-tool answers", () => {
  const testCase = PROMPT_ROUTING_EVAL_CASES.find((entry) => entry.id === "no-memory-for-code-search");
  assert.ok(testCase);

  const result = evaluatePromptRoutingResponse(testCase, { toolName: "no_tool", arguments: {} });

  assert.equal(result.passed, true);
});

test("prompt-routing eval CLI lists cases without a model command", async () => {
  const { stdout } = await execFile(process.execPath, [
    "--disable-warning=ExperimentalWarning",
    "--experimental-strip-types",
    "scripts/eval-prompt-routing.ts",
    "--list",
  ]);

  assert.match(stdout, /pi-memory prompt-routing eval/);
  assert.match(stdout, /Cases: 11/);
  assert.match(stdout, /memory_search: 1/);
  assert.match(stdout, /no-memory-for-code-search: <none>/);
});
