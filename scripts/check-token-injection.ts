#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { registerHooks } from "node:module";

const TOKEN_ESTIMATE_NOTE = "estimated tokens use ceil(normalized chars / 4); no tokenizer dependency";

export const TOKEN_INJECTION_BUDGETS = {
  toolPromptMetadata: 320,
  toolSchema: 560,
  allToolStatic: 900,
  turnNoHit: 45,
  turnHitFixture: 120,
  turnHandoffFixture: 100,
  turnCombinedFixture: 170,
} as const;

type BudgetName = keyof typeof TOKEN_INJECTION_BUDGETS;

type RegisteredTool = {
  name: string;
  description?: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters?: unknown;
};

type TextPiece = {
  source: string;
  text: string;
};

export type TokenInjectionMetric = {
  name: BudgetName;
  label: string;
  estimatedTokens: number;
  chars: number;
  budget: number;
};

export type ToolTokenInjectionMetric = {
  name: string;
  promptEstimatedTokens: number;
  schemaEstimatedTokens: number;
  totalEstimatedTokens: number;
  chars: number;
};

export type TokenInjectionReport = {
  note: string;
  metrics: TokenInjectionMetric[];
  tools: ToolTokenInjectionMetric[];
};

let mocksInstalled = false;

function installPromptSurfaceMocks(): void {
  if (mocksInstalled) return;
  mocksInstalled = true;

  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "@mariozechner/pi-ai") {
        return { url: "mock:pi-memory-token-pi-ai", shortCircuit: true };
      }

      if (specifier === "typebox") {
        return { url: "mock:pi-memory-token-typebox", shortCircuit: true };
      }

      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url === "mock:pi-memory-token-pi-ai") {
        return {
          format: "module",
          shortCircuit: true,
          source: "export function StringEnum(values, options = {}) { return { ...options, type: 'string', enum: values }; }",
        };
      }

      if (url === "mock:pi-memory-token-typebox") {
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
}

function normalizePromptText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function estimateTokens(text: string): number {
  const normalized = normalizePromptText(text);
  return normalized.length === 0 ? 0 : Math.ceil(normalized.length / 4);
}

function summarizePieces(pieces: TextPiece[]): { estimatedTokens: number; chars: number; text: string } {
  const text = pieces.map((piece) => piece.text).join("\n");
  const normalized = normalizePromptText(text);
  return {
    estimatedTokens: estimateTokens(text),
    chars: normalized.length,
    text: normalized,
  };
}

async function collectRegisteredTools(): Promise<RegisteredTool[]> {
  installPromptSurfaceMocks();
  const tools: RegisteredTool[] = [];
  const { registerMemoryTools } = await import("../src/pi-extension/tools.ts");

  registerMemoryTools(
    { registerTool(tool: RegisteredTool) { tools.push(tool); } } as never,
    () => {
      throw new Error("token-injection report only inspects tool metadata; execute() is not available");
    },
  );

  return tools;
}

function toolPromptPieces(tool: RegisteredTool): TextPiece[] {
  return [
    ...(tool.promptSnippet ? [{ source: `${tool.name}.promptSnippet`, text: tool.promptSnippet }] : []),
    ...(tool.promptGuidelines ?? []).map((guideline, index) => ({
      source: `${tool.name}.promptGuidelines[${index}]`,
      text: guideline,
    })),
  ];
}

function toolSchemaPieces(tool: RegisteredTool): TextPiece[] {
  return [
    { source: `${tool.name}.name`, text: tool.name },
    ...(tool.description ? [{ source: `${tool.name}.description`, text: tool.description }] : []),
    ...schemaPromptPieces(tool.parameters, `${tool.name}.parameters`),
  ];
}

function schemaPromptPieces(value: unknown, source: string): TextPiece[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => schemaPromptPieces(item, `${source}[${index}]`));
  }

  const record = value as Record<string, unknown>;
  const pieces: TextPiece[] = [];

  for (const [key, child] of Object.entries(record)) {
    if (key === "properties" && child && typeof child === "object" && !Array.isArray(child)) {
      for (const [propertyName, propertySchema] of Object.entries(child as Record<string, unknown>)) {
        pieces.push({ source: `${source}.${propertyName}.name`, text: propertyName });
        pieces.push(...schemaPromptPieces(propertySchema, `${source}.${propertyName}`));
      }
      continue;
    }

    if (typeof child === "string") {
      // `type` values are structural JSON Schema keywords, not prompt-facing prose.
      if (key !== "type") {
        pieces.push({ source: `${source}.${key}`, text: child });
      }
      continue;
    }

    if (Array.isArray(child)) {
      if (key === "type") continue;
      for (const [index, item] of child.entries()) {
        if (typeof item === "string") {
          pieces.push({ source: `${source}.${key}[${index}]`, text: item });
        } else {
          pieces.push(...schemaPromptPieces(item, `${source}.${key}[${index}]`));
        }
      }
      continue;
    }

    pieces.push(...schemaPromptPieces(child, `${source}.${key}`));
  }

  return pieces;
}

function metric(name: BudgetName, label: string, pieces: TextPiece[]): TokenInjectionMetric {
  const summary = summarizePieces(pieces);
  return {
    name,
    label,
    estimatedTokens: summary.estimatedTokens,
    chars: summary.chars,
    budget: TOKEN_INJECTION_BUDGETS[name],
  };
}

export async function collectTokenInjectionReport(): Promise<TokenInjectionReport> {
  const [{ formatTurnMemoryContext }, tools] = await Promise.all([
    import("../src/pi-extension/retrieval.ts"),
    collectRegisteredTools(),
  ]);

  const turnFormatter = formatTurnMemoryContext as (query: string, results: unknown[], latestHandoff?: unknown) => string;
  const resultFixture = (index: number) => ({
    id: `memory-${index}`,
    kind: index === 1 ? "todo" : undefined,
    scope: index === 3 ? "global" : "repo",
    title: `Representative memory ${index}`,
    summary: `Compact fixture summary ${index} for token budget regression checks.`,
    tags: ["agent-context"],
    importance: 0.7,
    confidence: 0.8,
    createdAt: "2026-05-15T00:00:00.000Z",
    updatedAt: "2026-05-15T00:00:00.000Z",
    matchScore: 0.9,
    lexicalScore: 0.7,
    semanticScore: 0.6,
    scopeScore: 0.8,
    recencyScore: 0.5,
  });
  const latestHandoff = {
    memory: {
      id: "handoff-1",
      kind: "handoff",
      scope: "session",
      title: "Representative handoff",
      summary: "Resume the current token budget check from the report script.",
      body: "Next steps:\n- Run npm run check:token-injection.\n- Keep prompt text compact.",
      tags: [],
      sessionId: "session-token-budget",
      projectId: "pi-memory",
      repoPath: "/repo/pi-memory",
      importance: 0.7,
      confidence: 0.8,
      status: "active",
      pinned: false,
      createdAt: "2026-05-15T00:00:00.000Z",
      updatedAt: "2026-05-15T00:00:00.000Z",
      metadata: {},
    },
    isFallback: true,
  };

  const promptPieces = tools.flatMap(toolPromptPieces);
  const schemaPieces = tools.flatMap(toolSchemaPieces);
  const allToolPieces = [...promptPieces, ...schemaPieces];
  const turnResults = [resultFixture(1), resultFixture(2), resultFixture(3)];
  const turnPieces = {
    turnNoHit: [{ source: "turn.no_hit", text: turnFormatter("needle", [], undefined) }],
    turnHitFixture: [{ source: "turn.hit_fixture", text: turnFormatter("needle", turnResults, undefined) }],
    turnHandoffFixture: [{ source: "turn.handoff_fixture", text: turnFormatter("needle", [], latestHandoff) }],
    turnCombinedFixture: [{ source: "turn.combined_fixture", text: turnFormatter("needle", turnResults, latestHandoff) }],
  } satisfies Record<"turnNoHit" | "turnHitFixture" | "turnHandoffFixture" | "turnCombinedFixture", TextPiece[]>;

  return {
    note: TOKEN_ESTIMATE_NOTE,
    metrics: [
      metric("toolPromptMetadata", "Tool promptSnippet + promptGuidelines", promptPieces),
      metric("toolSchema", "Tool names, descriptions, parameter names/descriptions/enums", schemaPieces),
      metric("allToolStatic", "All static registered tool prompt-facing text", allToolPieces),
      metric("turnNoHit", "Turn-start no-hit guidance", turnPieces.turnNoHit),
      metric("turnHitFixture", "Turn-start hit fixture with three memories", turnPieces.turnHitFixture),
      metric("turnHandoffFixture", "Turn-start handoff fixture", turnPieces.turnHandoffFixture),
      metric("turnCombinedFixture", "Turn-start combined handoff + three-memory fixture", turnPieces.turnCombinedFixture),
    ],
    tools: tools.map((tool) => {
      const promptSummary = summarizePieces(toolPromptPieces(tool));
      const schemaSummary = summarizePieces(toolSchemaPieces(tool));
      return {
        name: tool.name,
        promptEstimatedTokens: promptSummary.estimatedTokens,
        schemaEstimatedTokens: schemaSummary.estimatedTokens,
        totalEstimatedTokens: promptSummary.estimatedTokens + schemaSummary.estimatedTokens,
        chars: promptSummary.chars + schemaSummary.chars,
      };
    }),
  };
}

export function findBudgetFailures(report: TokenInjectionReport): TokenInjectionMetric[] {
  return report.metrics.filter((entry) => entry.estimatedTokens > entry.budget);
}

export function formatTokenInjectionReport(report: TokenInjectionReport): string {
  const lines = [
    "pi-memory token injection report",
    `Note: ${report.note}.`,
    "",
    "Regression limits:",
    ...report.metrics.map((entry) => {
      const status = entry.estimatedTokens <= entry.budget ? "OK" : "OVER";
      return `- ${status} ${entry.name}: ${entry.estimatedTokens}/${entry.budget} est. tokens (${entry.chars} chars) — ${entry.label}`;
    }),
    "",
    "Registered tool totals:",
    ...report.tools.map((tool) => `- ${tool.name}: ${tool.totalEstimatedTokens} est. tokens (${tool.promptEstimatedTokens} prompt + ${tool.schemaEstimatedTokens} schema; ${tool.chars} chars)`),
  ];

  const failures = findBudgetFailures(report);
  if (failures.length > 0) {
    lines.push("", `FAIL: ${failures.length} token-injection regression limit(s) exceeded.`);
  } else {
    lines.push("", "OK: all token-injection counts are within regression limits.");
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const report = await collectTokenInjectionReport();
  console.log(formatTokenInjectionReport(report));
  if (findBudgetFailures(report).length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
