export { DEFAULT_EMBEDDING_MODEL, FALLBACK_EMBEDDING_MODEL, createDefaultMemoryEmbeddingAdapter } from "./embeddings.ts";
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
export type { InitializeMemoryStoreInput, MemoryStore, MemoryStoreStatus } from "./store.ts";
