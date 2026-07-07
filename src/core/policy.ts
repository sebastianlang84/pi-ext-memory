import { readIntEnv } from "./env-config.ts";
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

export type LifecycleAuditFindingType = "stale_todo" | "expired_handoff" | "stale_note" | "legacy_read_only";

/** Notes (kind=null) are flagged for review when untouched this long (env-configurable). */
export const NOTE_STALE_AFTER_DAYS = readIntEnv(process.env, "PI_MEMORY_NOTE_STALE_DAYS", 180, { min: 1 });

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

/**
 * Returns true for a handoff that is active and — when `now` and lifecycle
 * fields are supplied — not yet expired. Without `now` this only checks
 * kind/status, preserving the cheap status-only predicate for callers that do
 * not carry a reference time. Passing `now` enforces the handoff expiry policy
 * so stale handoffs stop being surfaced as current context.
 */
export function isActiveHandoff(
  memory: Pick<MemoryRecord, "kind" | "status"> & Partial<Pick<MemoryRecord, "scope" | "updatedAt">>,
  now?: Date,
): boolean {
  if ((memory.kind as string | null | undefined) !== "handoff" || memory.status !== "active") {
    return false;
  }

  if (now === undefined || memory.scope === undefined || memory.updatedAt === undefined) {
    return true;
  }

  return !isHandoffExpired({ scope: memory.scope, updatedAt: memory.updatedAt }, now);
}

/**
 * Returns true when a handoff is older than its scope's `expireAfterDays`
 * policy window, measured from `updatedAt`.
 */
export function isHandoffExpired(memory: Pick<MemoryRecord, "scope" | "updatedAt">, now: Date = new Date()): boolean {
  const effectiveScope = getEffectiveLifecycleScope(memory.scope);
  const threshold = MEMORY_POLICY[effectiveScope].handoff.expireAfterDays;
  const ageDays = (now.getTime() - new Date(memory.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
  return ageDays >= threshold;
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

  if (!memory.kind) {
    // Notes carry no cap; flag them for review when neither accessed nor updated
    // within the note staleness window (using the most recent of the two).
    const lastTouchedMs = new Date(memory.lastAccessedAt ?? memory.updatedAt).getTime();
    const noteAgeDays = (now.getTime() - lastTouchedMs) / (1000 * 60 * 60 * 24);
    if (noteAgeDays >= NOTE_STALE_AFTER_DAYS) {
      return {
        type: "stale_note",
        reason: `Note not accessed or updated in ${Math.floor(noteAgeDays)} days (threshold: ${NOTE_STALE_AFTER_DAYS} days)`,
        suggestedAction: "Review and update this note, or archive it if no longer accurate",
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
