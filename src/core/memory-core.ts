import { createDefaultMemoryEmbeddingAdapter } from "./embeddings.ts";
import { LATEST_MEMORY_SCHEMA_VERSION } from "./migrations.ts";
import { initializeMemoryStore, type InitializeMemoryStoreInput, type MemoryStore } from "./store.ts";

const embeddingStatus = createDefaultMemoryEmbeddingAdapter().getStatus();

export interface MemoryCoreStatus {
  version: "v0.8";
  mode: "local-core";
  storage: "sqlite-update-link-archive-ready";
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
        version: "v0.8",
        mode: "local-core",
        storage: "sqlite-update-link-archive-ready",
        latestSchemaVersion: LATEST_MEMORY_SCHEMA_VERSION,
        embeddingStrategy: embeddingStatus.strategy,
        defaultEmbeddingModel: embeddingStatus.defaultModel,
        fallbackEmbeddingModel: embeddingStatus.fallbackModel,
        activeEmbeddingModel: embeddingStatus.activeModel,
        embeddingDimensions: embeddingStatus.dimensions,
        availableCommands: ["/memory-status", "/memory-search"],
        availableTools: ["memory_search", "memory_save", "memory_update", "memory_link", "memory_archive"],
        nextStep: "Implement /memory-review, /memory-session-save, and compact session summaries in v0.8.1.",
      };
    },
    initializeStore(input) {
      return initializeMemoryStore(input);
    },
  };
}
