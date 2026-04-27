import { createDefaultMemoryEmbeddingAdapter } from "./embeddings.ts";
import { LATEST_MEMORY_SCHEMA_VERSION } from "./migrations.ts";
import { initializeMemoryStore, type InitializeMemoryStoreInput, type MemoryStore } from "./store.ts";

const embeddingStatus = createDefaultMemoryEmbeddingAdapter().getStatus();

export interface MemoryCoreStatus {
  version: "v1.1.0";
  mode: "local-core";
  storage: "sqlite-session-summary-ready";
  latestSchemaVersion: number;
  embeddingStrategy: string;
  defaultEmbeddingModel: string;
  fallbackEmbeddingModel: string;
  activeEmbeddingModel: string;
  embeddingDimensions: number;
  availableCommands: string[];
  availableTools: string[];
  nextStep: string;
}

export interface MemoryCore {
  getStatus(): MemoryCoreStatus;
  initializeStore(input: InitializeMemoryStoreInput): MemoryStore;
}

export function createMemoryCore(): MemoryCore {
  return {
    getStatus() {
      return {
        version: "v1.1.0",
        mode: "local-core",
        storage: "sqlite-session-summary-ready",
        latestSchemaVersion: LATEST_MEMORY_SCHEMA_VERSION,
        embeddingStrategy: embeddingStatus.strategy,
        defaultEmbeddingModel: embeddingStatus.defaultModel,
        fallbackEmbeddingModel: embeddingStatus.fallbackModel,
        activeEmbeddingModel: embeddingStatus.activeModel,
        embeddingDimensions: embeddingStatus.dimensions,
        availableCommands: ["/memory-status", "/memory-search", "/memory-review", "/memory-session-save"],
        availableTools: ["memory_search", "memory_save", "memory_update", "memory_link", "memory_archive"],
        nextStep: "V1 release is complete; monitor local embedding quality and latency in normal use.",
      };
    },
    initializeStore(input) {
      return initializeMemoryStore(input);
    },
  };
}
