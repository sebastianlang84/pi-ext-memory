import { createDefaultMemoryEmbeddingAdapter } from "./embeddings.ts";
import { LATEST_MEMORY_SCHEMA_VERSION } from "./migrations.ts";
import { initializeMemoryStore, type InitializeMemoryStoreInput, type MemoryStore } from "./store.ts";

const embeddingStatus = createDefaultMemoryEmbeddingAdapter().getStatus();

export interface MemoryCoreStatus {
  version: "v2.0.2";
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
        version: "v2.0.2",
        mode: "local-core",
        storage: "sqlite-session-summary-ready",
        latestSchemaVersion: LATEST_MEMORY_SCHEMA_VERSION,
        embeddingStrategy: embeddingStatus.strategy,
        defaultEmbeddingModel: embeddingStatus.defaultModel,
        fallbackEmbeddingModel: embeddingStatus.fallbackModel,
        activeEmbeddingModel: embeddingStatus.activeModel,
        embeddingDimensions: embeddingStatus.dimensions,
        availableCommands: ["/memory-status", "/memory-search", "/memory-review", "/memory-handoff", "/memory-session-save", "/memory-audit"],
        availableTools: ["memory_search", "memory_list", "memory_save", "memory_save_todo", "memory_save_handoff", "memory_update", "memory_link", "memory_archive", "memory_audit"],
        nextStep: "V2.0.2 uses the namespaced Pi state path and auto-copies the legacy default DB on first default-path startup.",
      };
    },
    initializeStore(input) {
      return initializeMemoryStore(input);
    },
  };
}
