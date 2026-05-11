import { createDefaultMemoryEmbeddingAdapter } from "./embeddings.ts";
import { LATEST_MEMORY_SCHEMA_VERSION } from "./migrations.ts";
import { initializeMemoryStore, type InitializeMemoryStoreInput, type MemoryStore } from "./store.ts";

const embeddingStatus = createDefaultMemoryEmbeddingAdapter().getStatus();

export interface MemoryCoreStatus {
  version: "v1.3.0";
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
        version: "v1.3.0",
        mode: "local-core",
        storage: "sqlite-session-summary-ready",
        latestSchemaVersion: LATEST_MEMORY_SCHEMA_VERSION,
        embeddingStrategy: embeddingStatus.strategy,
        defaultEmbeddingModel: embeddingStatus.defaultModel,
        fallbackEmbeddingModel: embeddingStatus.fallbackModel,
        activeEmbeddingModel: embeddingStatus.activeModel,
        embeddingDimensions: embeddingStatus.dimensions,
        availableCommands: ["/memory-status", "/memory-search", "/memory-review", "/memory-handoff", "/memory-session-save"],
        availableTools: ["memory_search", "memory_list", "memory_save", "memory_save_handoff", "memory_update", "memory_link", "memory_archive"],
        nextStep: "V1 release is complete; use memory_list for structured listing and monitor local embedding quality in normal use.",
      };
    },
    initializeStore(input) {
      return initializeMemoryStore(input);
    },
  };
}
