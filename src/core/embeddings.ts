import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

import type { MemoryRecord } from "./memories.ts";

export type BuiltinEmbeddingProfile = "default" | "low-footprint";

export interface MemoryEmbeddingRecord {
  memoryId: string;
  model: string;
  dimensions: number;
  vector: number[];
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedMemoryEmbedding {
  model: string;
  dimensions: number;
  vector: number[];
  contentHash: string;
}

export interface MemoryEmbeddingAdapterStatus {
  strategy: string;
  defaultModel: string;
  fallbackModel: string;
  activeModel: string;
  dimensions: number;
}

export interface MemoryEmbeddingAdapter {
  getStatus(): MemoryEmbeddingAdapterStatus;
  generateEmbedding(memory: MemoryContentForEmbedding): GeneratedMemoryEmbedding;
}

export interface MemoryContentForEmbedding {
  title: string;
  summary: string;
  body?: string;
  tags: string[];
}

const BGE_M3_COMMAND_ENV = "PI_MEMORY_BGE_M3_COMMAND";
const BGE_M3_COMMAND_TIMEOUT_ENV = "PI_MEMORY_BGE_M3_TIMEOUT_MS";
const DEFAULT_BGE_M3_COMMAND_TIMEOUT_MS = 15_000;

export interface MemoryEmbeddingCommandConfig {
  /** Shell command string executed with `shell: true`; JSON input is written to stdin. */
  shellCommand: string;
  timeoutMs: number;
}

export interface MemoryEmbeddingConfig {
  bgeM3Command?: MemoryEmbeddingCommandConfig;
}

export const DEFAULT_EMBEDDING_MODEL = {
  model: "builtin-hash-384-v1",
  dimensions: 384,
} as const;

export const FALLBACK_EMBEDDING_MODEL = {
  model: "builtin-hash-64-v1",
  dimensions: 64,
} as const;

const BGE_M3_COMMAND_MODEL = {
  model: "local-bge-m3-command",
  dimensions: 1024,
} as const;

export function createDefaultMemoryEmbeddingAdapter(
  profile: BuiltinEmbeddingProfile = "default",
  config: MemoryEmbeddingConfig = resolveMemoryEmbeddingConfig(),
): MemoryEmbeddingAdapter {
  if (profile === "low-footprint") {
    return createDeterministicEmbeddingAdapter(FALLBACK_EMBEDDING_MODEL, FALLBACK_EMBEDDING_MODEL.model);
  }

  const configuredCommand = config.bgeM3Command;

  return {
    getStatus() {
      return {
        strategy: configuredCommand ? "local-command" : "deterministic-hash",
        defaultModel: BGE_M3_COMMAND_MODEL.model,
        fallbackModel: DEFAULT_EMBEDDING_MODEL.model,
        activeModel: configuredCommand ? BGE_M3_COMMAND_MODEL.model : DEFAULT_EMBEDDING_MODEL.model,
        dimensions: configuredCommand ? BGE_M3_COMMAND_MODEL.dimensions : DEFAULT_EMBEDDING_MODEL.dimensions,
      };
    },
    generateEmbedding(memory) {
      if (configuredCommand) {
        return generateCommandEmbedding(configuredCommand, memory);
      }

      return generateDeterministicEmbedding(memory, DEFAULT_EMBEDDING_MODEL);
    },
  };
}

export function resolveMemoryEmbeddingConfig(env: Record<string, string | undefined> = process.env): MemoryEmbeddingConfig {
  const shellCommand = env[BGE_M3_COMMAND_ENV]?.trim();
  if (!shellCommand) {
    return {};
  }

  return {
    bgeM3Command: {
      shellCommand,
      timeoutMs: resolveCommandTimeoutMs(env[BGE_M3_COMMAND_TIMEOUT_ENV]),
    },
  };
}

export function createMemoryContentForEmbedding(memory: Pick<MemoryRecord, "title" | "summary" | "body" | "tags">): MemoryContentForEmbedding {
  return {
    title: memory.title,
    summary: memory.summary,
    body: memory.body,
    tags: memory.tags,
  };
}

function createDeterministicEmbeddingAdapter(
  model: typeof DEFAULT_EMBEDDING_MODEL | typeof FALLBACK_EMBEDDING_MODEL,
  fallbackModel: string,
): MemoryEmbeddingAdapter {
  return {
    getStatus() {
      return {
        strategy: "deterministic-hash",
        defaultModel: model.model,
        fallbackModel,
        activeModel: model.model,
        dimensions: model.dimensions,
      };
    },
    generateEmbedding(memory) {
      return generateDeterministicEmbedding(memory, model);
    },
  };
}

function generateDeterministicEmbedding(
  memory: MemoryContentForEmbedding,
  model: typeof DEFAULT_EMBEDDING_MODEL | typeof FALLBACK_EMBEDDING_MODEL,
): GeneratedMemoryEmbedding {
  const content = serializeMemoryContent(memory);
  const contentHash = createSha256(serializeEmbeddingInput(memory));

  return {
    model: model.model,
    dimensions: model.dimensions,
    vector: createDeterministicVector(content, model.dimensions),
    contentHash,
  };
}

function generateCommandEmbedding(command: MemoryEmbeddingCommandConfig, memory: MemoryContentForEmbedding): GeneratedMemoryEmbedding {
  const input = serializeEmbeddingInput(memory);
  const result = spawnSync(command.shellCommand, {
    shell: true,
    input,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: command.timeoutMs,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Embedding command failed with exit code ${result.status}: ${result.stderr.trim()}`.trim());
  }

  const vector = extractEmbeddingVector(parseEmbeddingOutput(result.stdout));

  if (vector.length !== BGE_M3_COMMAND_MODEL.dimensions) {
    throw new Error(
      `BGE-M3 embedding command returned ${vector.length} dimensions; expected ${BGE_M3_COMMAND_MODEL.dimensions}.`,
    );
  }

  return {
    model: BGE_M3_COMMAND_MODEL.model,
    dimensions: vector.length,
    vector,
    contentHash: createSha256(input),
  };
}

function resolveCommandTimeoutMs(configuredValue: string | undefined): number {
  const configured = configuredValue?.trim();
  if (!configured) {
    return DEFAULT_BGE_M3_COMMAND_TIMEOUT_MS;
  }

  const timeoutMs = Number(configured);
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : DEFAULT_BGE_M3_COMMAND_TIMEOUT_MS;
}

function serializeEmbeddingInput(memory: MemoryContentForEmbedding): string {
  return JSON.stringify({ input: memory });
}

function serializeMemoryContent(memory: MemoryContentForEmbedding): string {
  return [memory.title, memory.summary, memory.body ?? "", memory.tags.join(" ")]
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join("\n");
}

function parseEmbeddingOutput(stdout: string): unknown {
  const trimmed = stdout.trim();

  if (trimmed.length === 0) {
    throw new Error("Embedding command returned empty stdout.");
  }

  return JSON.parse(trimmed) as unknown;
}

function extractEmbeddingVector(value: unknown): number[] {
  if (Array.isArray(value) && value.every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
    if (value.length === 0) {
      throw new Error("Embedding command returned an empty vector.");
    }

    return value;
  }

  if (isRecord(value)) {
    if ("embedding" in value) {
      return extractEmbeddingVector(value.embedding);
    }

    if ("embeddings" in value) {
      return extractEmbeddingVector(value.embeddings);
    }

    if (Array.isArray(value.data) && value.data.length > 0) {
      return extractEmbeddingVector(value.data[0]);
    }
  }

  if (Array.isArray(value) && value.length === 1) {
    return extractEmbeddingVector(value[0]);
  }

  throw new Error("Embedding command returned an unsupported JSON shape.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createDeterministicVector(content: string, dimensions: number): number[] {
  const vector: number[] = [];
  let counter = 0;

  while (vector.length < dimensions) {
    const digest = createHash("sha256")
      .update(content)
      .update("\0")
      .update(String(counter))
      .digest();

    for (let offset = 0; offset + 4 <= digest.length && vector.length < dimensions; offset += 4) {
      const normalized = digest.readUInt32BE(offset) / 0xffffffff;
      vector.push(normalized * 2 - 1);
    }

    counter += 1;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value ** 2, 0)) || 1;
  return vector.map((value) => Number((value / magnitude).toFixed(8)));
}

function createSha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
