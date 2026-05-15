#!/usr/bin/env node
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import { collectRegisteredTools, estimateTokens, type RegisteredTool } from "./check-token-injection.ts";

export type ExpectedToolName =
  | "memory_search"
  | "memory_list"
  | "memory_save"
  | "memory_save_todo"
  | "memory_save_handoff"
  | "memory_update"
  | "memory_audit"
  | "memory_tag_catalog"
  | "memory_stats"
  | null;

export type PromptRoutingExpectation = {
  toolName: ExpectedToolName;
  args?: Record<string, unknown>;
  argIncludes?: Record<string, string[]>;
};

export type PromptRoutingEvalCase = {
  id: string;
  scenario: string;
  expectation: PromptRoutingExpectation;
};

export type PromptRoutingModelResponse = {
  toolName?: string | null;
  name?: string | null;
  tool?: string | null;
  arguments?: unknown;
  args?: unknown;
};

export type PromptRoutingEvalResult = {
  caseId: string;
  passed: boolean;
  expectedToolName: ExpectedToolName;
  actualToolName: string | null;
  issues: string[];
};

export const PROMPT_ROUTING_EVAL_CASES: PromptRoutingEvalCase[] = [
  {
    id: "search-existing-context",
    scenario: "Before editing docs, find durable memory about the tag catalog decision.",
    expectation: { toolName: "memory_search", argIncludes: { query: ["tag", "catalog"] } },
  },
  {
    id: "list-active-repo-todos",
    scenario: "List active repo todos so we can choose the next backlog item.",
    expectation: { toolName: "memory_list", args: { kind: "todo", status: "active" }, argIncludes: { scope: ["repo"] } },
  },
  {
    id: "save-durable-note",
    scenario: "Remember for future work that README files in this environment should not use YAML frontmatter.",
    expectation: { toolName: "memory_save", argIncludes: { summary: ["README", "YAML", "frontmatter"] } },
  },
  {
    id: "save-persistent-todo",
    scenario: "Create a persistent P1 todo to add prompt-routing eval coverage for memory tools.",
    expectation: { toolName: "memory_save_todo", args: { priority: "P1" }, argIncludes: { title: ["prompt", "routing", "eval"] } },
  },
  {
    id: "save-compaction-handoff",
    scenario: "Context is about to be compacted; save a handoff with the current state and next steps for the same agent.",
    expectation: { toolName: "memory_save_handoff", args: { handoffReason: "compaction" } },
  },
  {
    id: "archive-completed-memory",
    scenario: "Archive memory mem-123 because the work was completed.",
    expectation: { toolName: "memory_update", args: { id: "mem-123", status: "archived" }, argIncludes: { archiveReason: ["completed"] } },
  },
  {
    id: "audit-memory-hygiene",
    scenario: "Run a repo memory hygiene audit and show cleanup findings.",
    expectation: { toolName: "memory_audit", argIncludes: { scope: ["repo"] } },
  },
  {
    id: "tag-catalog-before-new-tag",
    scenario: "Before adding an unfamiliar tag, inspect the active repo tag catalog.",
    expectation: { toolName: "memory_tag_catalog", argIncludes: { scope: ["repo"] } },
  },
  {
    id: "store-health-capacity",
    scenario: "Check memory store health, capacity, and last-audit metadata for the repo.",
    expectation: { toolName: "memory_stats", argIncludes: { scope: ["repo"] } },
  },
  {
    id: "no-memory-for-code-search",
    scenario: "Find all TypeScript files that call registerTool in the current repository.",
    expectation: { toolName: null },
  },
  {
    id: "no-memory-for-current-diff",
    scenario: "Summarize the current git diff and suggest a commit message.",
    expectation: { toolName: null },
  },
];

function normalizeToolName(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return String(value);
  const normalized = value.trim();
  if (["", "none", "null", "no_tool", "no tool", "no-tool"].includes(normalized.toLowerCase())) return null;
  return normalized;
}

function responseArgs(response: PromptRoutingModelResponse): Record<string, unknown> {
  const value = response.arguments ?? response.args ?? {};
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function fieldValues(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap(fieldValues);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(fieldValues);
  return [String(value)];
}

function fieldIncludesAll(value: unknown, terms: string[]): boolean {
  const haystack = fieldValues(value).join(" ").toLowerCase();
  return terms.every((term) => haystack.includes(term.toLowerCase()));
}

function valueMatches(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    const actualValues = fieldValues(actual).map((value) => value.toLowerCase());
    return expected.every((entry) => actualValues.includes(String(entry).toLowerCase()));
  }

  if (typeof expected === "object" && expected !== null) {
    if (typeof actual !== "object" || actual === null || Array.isArray(actual)) return false;
    return Object.entries(expected as Record<string, unknown>).every(([key, value]) => valueMatches((actual as Record<string, unknown>)[key], value));
  }

  return fieldValues(actual).some((value) => value.toLowerCase() === String(expected).toLowerCase());
}

export function evaluatePromptRoutingResponse(
  testCase: PromptRoutingEvalCase,
  response: PromptRoutingModelResponse,
): PromptRoutingEvalResult {
  const actualToolName = normalizeToolName(response.toolName ?? response.name ?? response.tool);
  const issues: string[] = [];

  if (actualToolName !== testCase.expectation.toolName) {
    issues.push(`expected tool ${testCase.expectation.toolName ?? "<none>"}, got ${actualToolName ?? "<none>"}`);
  }

  if (testCase.expectation.toolName !== null) {
    const args = responseArgs(response);
    for (const [key, expected] of Object.entries(testCase.expectation.args ?? {})) {
      if (!valueMatches(args[key], expected)) {
        issues.push(`argument ${key} did not match expected ${JSON.stringify(expected)}; got ${JSON.stringify(args[key])}`);
      }
    }

    for (const [key, terms] of Object.entries(testCase.expectation.argIncludes ?? {})) {
      if (!fieldIncludesAll(args[key], terms)) {
        issues.push(`argument ${key} did not include ${terms.join(", ")}; got ${JSON.stringify(args[key])}`);
      }
    }
  }

  return {
    caseId: testCase.id,
    passed: issues.length === 0,
    expectedToolName: testCase.expectation.toolName,
    actualToolName,
    issues,
  };
}

function compactSchema(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(compactSchema);
  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (["type", "enum", "description", "minimum", "maximum", "default", "optional", "required", "additionalProperties"].includes(key)) {
      result[key] = child;
      continue;
    }
    if (key === "properties" && child && typeof child === "object" && !Array.isArray(child)) {
      result.properties = Object.fromEntries(
        Object.entries(child as Record<string, unknown>).map(([property, schema]) => [property, compactSchema(schema)]),
      );
      continue;
    }
    if (["items", "anyOf"].includes(key)) result[key] = compactSchema(child);
  }
  return result;
}

export function buildPromptRoutingEvalPrompt(testCase: PromptRoutingEvalCase, tools: RegisteredTool[]): string {
  const toolCatalog = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    promptSnippet: tool.promptSnippet,
    promptGuidelines: tool.promptGuidelines,
    parameters: compactSchema(tool.parameters),
  }));

  return [
    "Choose whether the scenario should call one pi-memory tool.",
    "Return JSON only, with this shape: {\"toolName\": string|null, \"arguments\": object}.",
    "If no memory tool should be used, return {\"toolName\": null, \"arguments\": {}}.",
    "Use only these available tools and their prompt-facing metadata:",
    JSON.stringify(toolCatalog),
    "Scenario:",
    testCase.scenario,
  ].join("\n");
}

async function runModelCommand(command: string, prompt: string): Promise<string> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, { shell: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise(stdout.trim());
      } else {
        reject(new Error(`model command exited ${code}: ${stderr.trim()}`));
      }
    });
    child.stdin.end(prompt);
  });
}

function parseModelResponse(raw: string): PromptRoutingModelResponse {
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const jsonText = fencedMatch?.[1] ?? trimmed;
  const parsed = JSON.parse(jsonText) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`model response was not a JSON object: ${raw}`);
  }
  return parsed as PromptRoutingModelResponse;
}

function validateEvalCases(cases: PromptRoutingEvalCase[]): string[] {
  const ids = new Set<string>();
  const issues: string[] = [];
  for (const testCase of cases) {
    if (ids.has(testCase.id)) issues.push(`duplicate case id: ${testCase.id}`);
    ids.add(testCase.id);
    if (!testCase.scenario.trim()) issues.push(`${testCase.id}: scenario is empty`);
  }
  return issues;
}

export function summarizePromptRoutingEvalSet(cases: PromptRoutingEvalCase[] = PROMPT_ROUTING_EVAL_CASES): string[] {
  const toolCounts = new Map<string, number>();
  for (const testCase of cases) {
    const key = testCase.expectation.toolName ?? "<none>";
    toolCounts.set(key, (toolCounts.get(key) ?? 0) + 1);
  }
  return [...toolCounts.entries()].map(([tool, count]) => `${tool}: ${count}`);
}

async function main(): Promise<void> {
  const requireCommand = process.argv.includes("--require-command");
  const listOnly = process.argv.includes("--list");
  const issues = validateEvalCases(PROMPT_ROUTING_EVAL_CASES);
  if (issues.length > 0) {
    console.error(["Invalid prompt-routing eval cases:", ...issues.map((issue) => `- ${issue}`)].join("\n"));
    process.exitCode = 1;
    return;
  }

  const command = process.env.PI_MEMORY_PROMPT_ROUTING_EVAL_COMMAND;
  const tools = await collectRegisteredTools();
  const samplePrompt = buildPromptRoutingEvalPrompt(PROMPT_ROUTING_EVAL_CASES[0]!, tools);

  console.log("pi-memory prompt-routing eval");
  console.log(`Cases: ${PROMPT_ROUTING_EVAL_CASES.length}`);
  console.log(`Coverage: ${summarizePromptRoutingEvalSet().join(", ")}`);
  console.log(`Estimated input per case: ~${estimateTokens(samplePrompt)} tokens plus model response.`);

  if (listOnly) {
    for (const testCase of PROMPT_ROUTING_EVAL_CASES) {
      console.log(`- ${testCase.id}: ${testCase.expectation.toolName ?? "<none>"}`);
    }
    return;
  }

  if (!command) {
    console.log("Model checks skipped: PI_MEMORY_PROMPT_ROUTING_EVAL_COMMAND is not set.");
    console.log("Set it to a command that reads the prompt on stdin and prints JSON {toolName, arguments}.");
    console.log("Example: PI_MEMORY_PROMPT_ROUTING_EVAL_COMMAND='your-model-cli --json' npm run eval:prompt-routing");
    if (requireCommand) process.exitCode = 1;
    return;
  }

  const results: PromptRoutingEvalResult[] = [];
  for (const testCase of PROMPT_ROUTING_EVAL_CASES) {
    try {
      const raw = await runModelCommand(command, buildPromptRoutingEvalPrompt(testCase, tools));
      results.push(evaluatePromptRoutingResponse(testCase, parseModelResponse(raw)));
    } catch (error) {
      results.push({
        caseId: testCase.id,
        passed: false,
        expectedToolName: testCase.expectation.toolName,
        actualToolName: null,
        issues: [error instanceof Error ? error.message : String(error)],
      });
    }
  }

  for (const result of results) {
    console.log(`${result.passed ? "PASS" : "FAIL"} ${result.caseId}: expected ${result.expectedToolName ?? "<none>"}, got ${result.actualToolName ?? "<none>"}`);
    for (const issue of result.issues) console.log(`  - ${issue}`);
  }

  const failures = results.filter((result) => !result.passed);
  console.log(`${results.length - failures.length}/${results.length} prompt-routing cases passed.`);
  if (failures.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
