import type { MemoryKind, MemoryRecord, MemoryScope, NormalizedListMemoriesInput } from "./memories.ts";
import { MemoryValidationError } from "./memories.ts";


export const MEMORY_POLICY = {
  repo: {
    todo: { activeWarnAt: 30, activeHardMax: 50, staleAfterDays: 30 },
    handoff: { activeWarnAt: 7, activeHardMax: 10, expireAfterDays: 7 },
  },
  project: {
    todo: { activeWarnAt: 30, activeHardMax: 50, staleAfterDays: 30 },
    handoff: { activeWarnAt: 7, activeHardMax: 10, expireAfterDays: 7 },
  },
  global: {
    todo: { activeWarnAt: 10, activeHardMax: 20, staleAfterDays: 30 },
    handoff: { activeWarnAt: 3, activeHardMax: 5, expireAfterDays: 7 },
  },
} as const;

export interface CapPolicy {
  activeWarnAt: number;
  activeHardMax: number;
}

/**
 * Durable notes (kind === null) are the only memory category without a hard
 * cap, so they are the only way the store can grow without bound. Rather than
 * rejecting new notes (as todos/handoffs do), a repo's notes behave like human
 * memory: capacity is bounded and the weakest entries fade. When a repo exceeds
 * REPO_NOTE_ACTIVE_CAP active notes, the least-used/oldest non-pinned notes are
 * archived (marked `evicted`); evicted archives older than
 * EVICTED_NOTE_PURGE_AFTER_DAYS are then hard-deleted to bound disk use.
 */
export const REPO_NOTE_ACTIVE_CAP = 50;
export const EVICTED_NOTE_PURGE_AFTER_DAYS = 90;

/** True when the memory is a durable note (no kind) scoped to a specific repo. */
export function isRepoScopedNote(memory: Pick<MemoryRecord, "kind" | "scope" | "repoPath">): boolean {
  return (memory.kind === null || memory.kind === undefined) && memory.scope === "repo" && Boolean(memory.repoPath);
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

export function isActiveHandoff(memory: Pick<MemoryRecord, "kind" | "status">): boolean {
  return (memory.kind as string | null | undefined) === "handoff" && memory.status === "active";
}

export function classifyLifecycleAuditFinding(memory: MemoryRecord, now: Date = new Date()): LifecycleAuditFinding | null {
  const ageMs = now.getTime() - new Date(memory.updatedAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  if (memory.kind === "todo") {
    const effectiveScope = getEffectiveLifecycleScope(memory.scope);
    const threshold = MEMORY_POLICY[effectiveScope].todo.staleAfterDays;
    if (ageDays >= threshold) {
      return {
        type: "stale_todo",
        reason: `Todo has not been updated in ${Math.floor(ageDays)} days (threshold: ${threshold} days)`,
        suggestedAction: "Review and complete, update, or archive this todo",
      };
    }
  }

  if (memory.kind === "handoff") {
    const effectiveScope = getEffectiveLifecycleScope(memory.scope);
    const threshold = MEMORY_POLICY[effectiveScope].handoff.expireAfterDays;
    if (ageDays >= threshold) {
      return {
        type: "expired_handoff",
        reason: `Handoff has not been updated in ${Math.floor(ageDays)} days (threshold: ${threshold} days)`,
        suggestedAction: "Archive this handoff if it is no longer active",
      };
    }
  }

  return null;
}

export function checkActiveCap(kind: string | null, scope: string, activeCount: number): void {
  const cap = getCapForKindScope(kind as MemoryKind | null, scope as MemoryScope);
  if (!cap) return;
  if (activeCount >= cap.activeHardMax) {
    throw new MemoryValidationError([
      `active_${kind}_cap_exceeded: ${activeCount} active ${kind}s (hard cap: ${cap.activeHardMax}) for scope=${scope}. Archive or complete existing ${kind}s first.`,
    ]);
  }
}
