import type { MemoryKind, MemoryRecord, MemoryScope, NormalizedListMemoriesInput } from "./memories.ts";


export const MEMORY_POLICY = {
  repo: {
    todo: { activeWarnAt: 30, activeHardMax: 50 },
    handoff: { activeWarnAt: 7, activeHardMax: 10 },
  },
  project: {
    todo: { activeWarnAt: 30, activeHardMax: 50 },
    handoff: { activeWarnAt: 7, activeHardMax: 10 },
  },
  global: {
    todo: { activeWarnAt: 10, activeHardMax: 20 },
    handoff: { activeWarnAt: 3, activeHardMax: 5 },
  },
} as const;

export interface CapPolicy {
  activeWarnAt: number;
  activeHardMax: number;
}

export type LifecycleAuditFindingType = "stale_todo" | "expired_handoff" | "legacy_read_only";

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

export function applyMemoryLifecycleDefaults(memory: MemoryRecord, _now: Date = new Date()): MemoryRecord {
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

export function isActiveUnexpiredHandoff(memory: Pick<MemoryRecord, "kind" | "status">, _now: Date = new Date()): boolean {
  return (memory.kind as string | null | undefined) === "handoff" && memory.status === "active";
}

export function classifyLifecycleAuditFinding(_memory: MemoryRecord, _now: Date = new Date()): LifecycleAuditFinding | null {
  return null;
}
