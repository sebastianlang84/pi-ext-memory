import { type MemoryScope, type MemoryStore } from "../core/index.ts";

// ─── Memory Audit ────────────────────────────────────────────────────────────

const STALE_TODO_IN_PROGRESS_DAYS = 14;
const STALE_TODO_OPEN_DAYS = 30;
const OLD_HANDOFF_DAYS = 7;

export interface AuditCandidate {
  id: string;
  title: string;
  kind: string;
  tags: string[];
  updatedAt: string;
  scope: string;
  reason: string;
  suggestedAction: string;
}

export function runMemoryAudit(
  store: MemoryStore,
  scopeFilter?: string[],
  repoPathFilter?: string,
): { staleTodos: AuditCandidate[]; oldHandoffs: AuditCandidate[] } {
  const now = Date.now();
  const inProgressCutoff = new Date(now - STALE_TODO_IN_PROGRESS_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const openCutoff = new Date(now - STALE_TODO_OPEN_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const handoffCutoff = new Date(now - OLD_HANDOFF_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const listInput = {
    status: "active" as const,
    limit: 200,
    ...(scopeFilter ? { scope: scopeFilter as MemoryScope[] } : {}),
    ...(repoPathFilter ? { repoPath: repoPathFilter } : {}),
  };

  const todos = store.listMemories({ ...listInput, kind: ["todo"] });
  const handoffs = store.listMemories({ ...listInput, kind: ["handoff"] });

  const staleTodos: AuditCandidate[] = todos
    .filter((m) => {
      const isInProgress = m.tags.includes("in_progress");
      const isOpen = !isInProgress;
      if (isInProgress && m.updatedAt < inProgressCutoff) return true;
      if (isOpen && m.updatedAt < openCutoff) return true;
      return false;
    })
    .map((m) => {
      const isInProgress = m.tags.includes("in_progress");
      const days = isInProgress ? STALE_TODO_IN_PROGRESS_DAYS : STALE_TODO_OPEN_DAYS;
      return {
        id: m.id,
        title: m.title,
        kind: m.kind,
        tags: m.tags,
        updatedAt: m.updatedAt,
        scope: m.scope,
        reason: `Todo ${isInProgress ? "(in_progress)" : "(open)"} not updated in >${days} days`,
        suggestedAction: "Archive if done, or update status/tags to reflect current state",
      };
    });

  const oldHandoffs: AuditCandidate[] = handoffs
    .filter((m) => m.updatedAt < handoffCutoff)
    .map((m) => ({
      id: m.id,
      title: m.title,
      kind: m.kind,
      tags: m.tags,
      updatedAt: m.updatedAt,
      scope: m.scope,
      reason: `Handoff not updated in >${OLD_HANDOFF_DAYS} days`,
      suggestedAction: "Archive if the task is complete or no longer relevant",
    }));

  return { staleTodos, oldHandoffs };
}

export function buildHygieneLine(staleTodoCount: number, oldHandoffCount: number): string | null {
  if (staleTodoCount === 0 && oldHandoffCount === 0) return null;
  return `⚠ Memory hygiene: ${staleTodoCount} stale todo${staleTodoCount !== 1 ? "s" : ""}, ${oldHandoffCount} old handoff${oldHandoffCount !== 1 ? "s" : ""}. Run memory_audit for details.`;
}

export function formatAuditResults(staleTodos: AuditCandidate[], oldHandoffs: AuditCandidate[], dbPath: string): string {
  const lines: string[] = [];
  const total = staleTodos.length + oldHandoffs.length;

  if (total === 0) {
    lines.push("Memory audit: no stale items found.", `db_path: ${dbPath}`);
    return lines.join("\n");
  }

  lines.push(`Memory audit: ${total} item${total !== 1 ? "s" : ""} need attention.`);

  if (staleTodos.length > 0) {
    lines.push("", `Stale todos (${staleTodos.length}):`);
    staleTodos.forEach((c, i) => {
      lines.push(
        `  ${i + 1}. [${c.scope}] ${c.title} (${c.id})`,
        `     tags: ${c.tags.join(", ") || "none"}`,
        `     updated_at: ${c.updatedAt}`,
        `     reason: ${c.reason}`,
        `     action: ${c.suggestedAction}`,
      );
    });
  }

  if (oldHandoffs.length > 0) {
    lines.push("", `Old handoffs (${oldHandoffs.length}):`);
    oldHandoffs.forEach((c, i) => {
      lines.push(
        `  ${i + 1}. [${c.scope}] ${c.title} (${c.id})`,
        `     tags: ${c.tags.join(", ") || "none"}`,
        `     updated_at: ${c.updatedAt}`,
        `     reason: ${c.reason}`,
        `     action: ${c.suggestedAction}`,
      );
    });
  }

  lines.push("", `db_path: ${dbPath}`);
  return lines.join("\n");
}
