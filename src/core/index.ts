export {
  DEFAULT_BGE_M3_COMMAND_TIMEOUT_MS,
  DEFAULT_EMBEDDING_MODEL,
  FALLBACK_EMBEDDING_MODEL,
  createDefaultMemoryEmbeddingAdapter,
  resolveMemoryEmbeddingConfig,
} from "./embeddings.ts";
export { LATEST_MEMORY_SCHEMA_VERSION } from "./migrations.ts";
export { createMemoryCore } from "./memory-core.ts";
export {
  MEMORY_KINDS,
  MEMORY_LINK_RELATIONS,
  MEMORY_SCOPES,
  MEMORY_STATUSES,
  MemoryValidationError,
  normalizeArchiveMemoryInput,
  normalizeCreateMemoryInput,
  normalizeLinkMemoriesInput,
  normalizeSearchMemoriesInput,
  normalizeUpdateMemoryInput,
} from "./memories.ts";
export { initializeMemoryStore } from "./store.ts";
export type {
  BuiltinEmbeddingProfile,
  GeneratedMemoryEmbedding,
  MemoryContentForEmbedding,
  MemoryEmbeddingAdapter,
  MemoryEmbeddingAdapterStatus,
  MemoryEmbeddingCommandConfig,
  MemoryEmbeddingConfig,
  MemoryEmbeddingRecord,
} from "./embeddings.ts";
export type {
  ArchiveMemoryInput,
  CreateMemoryInput,
  LinkMemoriesInput,
  MemoryKind,
  MemoryLinkRecord,
  MemoryLinkRelation,
  MemoryRecord,
  MemoryScope,
  MemorySearchResult,
  MemoryStatus,
  SearchMemoriesInput,
  UpdateMemoryInput,
} from "./memories.ts";
export type { MemoryCore, MemoryCoreStatus } from "./memory-core.ts";
export type {
  InitializeMemoryStoreInput,
  MemoryStore,
  MemoryStoreStatus,
  SaveSessionSummaryInput,
  SearchMemoriesOptions,
  SessionRecord,
} from "./store.ts";
