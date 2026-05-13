import type { MemoryKind, MemoryRecord, MemoryScope, NormalizedListMemoriesInput } from "./memories.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export const MEMORY_POLICY = {
  repo: {
    todo: { activeWarnAt: 30, activeHardMax: 50, defaultStaleAfterDays: 30 },
    handoff: { activeWarnAt: 7, activeHardMax: 10, defaultTtlDays: 14 },
  },
  project: {
    todo: { activeWarnAt: 30, activeHardMax: 50, defaultStaleAfterDays: 30 },
    handoff: { activeWarnAt: 7, activeHardMax: 10, defaultTtlDays: 14 },
  },
  global: {
    todo: { activeWarnAt: 10, activeHardMax: 20, defaultStaleAfterDays: 30 },
    handoff: { activeWarnAt: 3, activeHardMax: 5, defaultTtlDays: 14 },
  },
} as const;

export interface CapPolicy {
  activeWarnAt: number;
  activeHardMax: number;
}

export type LifecycleAuditFindingType = "stale_todo" | "expired_handoff";

export interface LifecycleAuditFinding {
  type: LifecycleAuditFindingType;
  reason: string;
  suggestedAction: string;
}

export type ActiveCapCountFilter = Pick<NormalizedListMemoriesInput, "kind" | "scope" | "status"> & {
  repoPath?: string;
  projectId?: string;
};

export function getEffectiveLifecycleScope(scope: MemoryScope): Exclude<MemoryScope, "session"> {
  return scope === "session" ? "repo" : scope;
}

/**
 * Returns the cap policy for the given kind/scope combination, or null if no cap applies.
 * Caps only apply to "todo" and "handoff" kinds.
 * The "session" scope falls back to "repo" caps.
 */
export function getCapForKindScope(kind: MemoryKind | null | undefined, scope: MemoryScope): CapPolicy | null {
  const effectiveScope = getEffectiveLifecycleScope(scope);
  const scopePolicy = MEMORY_POLICY[effectiveScope];

  if (kind === "todo") {
    return { activeWarnAt: scopePolicy.todo.activeWarnAt, activeHardMax: scopePolicy.todo.activeHardMax };
  }

  if (kind === "handoff") {
    return { activeWarnAt: scopePolicy.handoff.activeWarnAt, activeHardMax: scopePolicy.handoff.activeHardMax };
  }

  return null;
}

/**
 * Returns an ISO-8601 timestamp for now + defaultStaleAfterDays (30d for todos).
 */
export function computeDefaultStaleAfter(scope: MemoryScope, now: Date = new Date()): string {
  const effectiveScope = getEffectiveLifecycleScope(scope);
  const days = MEMORY_POLICY[effectiveScope].todo.defaultStaleAfterDays;
  return new Date(now.getTime() + days * DAY_MS).toISOString();
}

/**
 * Returns an ISO-8601 timestamp for now + defaultTtlDays (14d for handoffs).
 */
export function computeDefaultExpiresAt(scope: MemoryScope, now: Date = new Date()): string {
  const effectiveScope = getEffectiveLifecycleScope(scope);
  const days = MEMORY_POLICY[effectiveScope].handoff.defaultTtlDays;
  return new Date(now.getTime() + days * DAY_MS).toISOString();
}

export function applyMemoryLifecycleDefaults(memory: MemoryRecord, now: Date = new Date()): MemoryRecord {
  if ((memory.kind as string | null | undefined) === "todo" && !memory.staleAfter) {
    return { ...memory, staleAfter: computeDefaultStaleAfter(memory.scope, now) };
  }

  if ((memory.kind as string | null | undefined) === "handoff" && !memory.expiresAt) {
    return { ...memory, expiresAt: computeDefaultExpiresAt(memory.scope, now) };
  }

  return memory;
}

export function buildActiveCapCountFilter(memory: Pick<MemoryRecord, "kind" | "scope" | "repoPath" | "projectId">): ActiveCapCountFilter | null {
  if (!memory.kind || !getCapForKindScope(memory.kind, memory.scope)) return null;

  return {
    kind: [memory.kind],
    scope: [memory.scope],
    status: "active",
    ...(memory.repoPath ? { repoPath: memory.repoPath } : {}),
    ...(memory.projectId ? { projectId: memory.projectId } : {}),
  };
}

export function isMemoryPastStaleAfter(memory: Pick<MemoryRecord, "staleAfter">, now: Date = new Date()): boolean {
  return isPastTimestamp(memory.staleAfter, now);
}

export function isMemoryExpired(memory: Pick<MemoryRecord, "expiresAt">, now: Date = new Date()): boolean {
  return isPastTimestamp(memory.expiresAt, now);
}

export function isTodoStale(memory: Pick<MemoryRecord, "kind" | "status" | "staleAfter">, now: Date = new Date()): boolean {
  return (memory.kind as string | null | undefined) === "todo" && memory.status === "active" && isMemoryPastStaleAfter(memory, now);
}

export function isHandoffExpired(memory: Pick<MemoryRecord, "kind" | "status" | "expiresAt">, now: Date = new Date()): boolean {
  return (memory.kind as string | null | undefined) === "handoff" && memory.status === "active" && isMemoryExpired(memory, now);
}

export function isActiveUnexpiredHandoff(memory: Pick<MemoryRecord, "kind" | "status" | "expiresAt">, now: Date = new Date()): boolean {
  if ((memory.kind as string | null | undefined) !== "handoff" || memory.status !== "active") return false;
  if (!memory.expiresAt) return true;

  const expiresAtMs = Date.parse(memory.expiresAt);
  if (Number.isNaN(expiresAtMs)) return false;
  return expiresAtMs > now.getTime();
}

export function classifyLifecycleAuditFinding(memory: MemoryRecord, now: Date = new Date()): LifecycleAuditFinding | null {
  if (isTodoStale(memory as Pick<MemoryRecord, "kind" | "status" | "staleAfter">, now)) {
    return {
      type: "stale_todo",
      reason: `Todo stale: stale_after=${memory.staleAfter ?? "not set"} passed`,
      suggestedAction: "Archive if done, or update status/tags to reflect current state",
    };
  }

  if (isHandoffExpired(memory as Pick<MemoryRecord, "kind" | "status" | "expiresAt">, now)) {
    return {
      type: "expired_handoff",
      reason: `Handoff expired: expires_at=${memory.expiresAt ?? "not set"} passed`,
      suggestedAction: "Archive if the task is complete or no longer relevant",
    };
  }

  return null;
}

function isPastTimestamp(value: string | undefined, now: Date): boolean {
  if (!value) return false;

  const timestampMs = Date.parse(value);
  if (Number.isNaN(timestampMs)) return false;
  return timestampMs < now.getTime();
}
