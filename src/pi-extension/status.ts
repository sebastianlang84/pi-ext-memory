import type { MemoryCoreStatus } from "../core/index.ts";

export function formatMemoryStatus(status: MemoryCoreStatus, cwd: string): string {
  return [
    "pi-memory status",
    `version: ${status.version}`,
    `cwd: ${cwd}`,
    `core_mode: ${status.mode}`,
    `storage: ${status.storage}`,
    `latest_schema_version: ${status.latestSchemaVersion}`,
    `embedding_strategy: ${status.embeddingStrategy}`,
    `embedding_model_default: ${status.defaultEmbeddingModel}`,
    `embedding_model_fallback: ${status.fallbackEmbeddingModel}`,
    `embedding_model_active: ${status.activeEmbeddingModel}`,
    `embedding_dimensions: ${status.embeddingDimensions}`,
    `commands: ${status.availableCommands.join(", ") || "none"}`,
    `tools: ${status.availableTools.join(", ") || "none"}`,
    `next_step: ${status.nextStep}`,
  ].join("\n");
}

export function formatStatusWidgetLines(status: MemoryCoreStatus, cwd: string): string[] {
  return formatMemoryStatus(status, cwd).split("\n");
}

export function getNextStatusWidgetLines(
  isVisible: boolean,
  status: MemoryCoreStatus,
  cwd: string,
): string[] | undefined {
  if (isVisible) {
    return undefined;
  }

  return formatStatusWidgetLines(status, cwd);
}
