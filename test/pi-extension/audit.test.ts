import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { initializeMemoryStore } from "../../src/core/index.ts";
import { formatAuditResults, runMemoryAuditFull } from "../../src/pi-extension/audit.ts";

function createTempDbPath(): { dbPath: string; tempRoot: string } {
  const tempRoot = mkdtempSync(join(tmpdir(), "pi-memory-audit-"));
  return { dbPath: join(tempRoot, "memory.sqlite"), tempRoot };
}

test("memory audit builds read-only migration preview for legacy project records", () => {
  const { dbPath, tempRoot } = createTempDbPath();
  const store = initializeMemoryStore({ dbPath });

  try {
    store.createMemory({
      kind: "decision",
      scope: "project",
      projectId: "legacy-project",
      repoPath: "/repo/a",
      title: "Repo-shaped legacy project",
      summary: "Legacy project record with repo metadata should preview as a repo migration candidate.",
    });
    store.createMemory({
      kind: "preference",
      scope: "project",
      projectId: "legacy-project",
      title: "Cross repo preference",
      summary: "Cross-repo tagged project memory can be reviewed as global.",
      tags: ["cross-repo"],
    });
    store.createMemory({
      kind: "fact",
      scope: "project",
      projectId: "legacy-project",
      title: "Project only fact",
      summary: "Project-only legacy memory stays discoverable until a human classifies it.",
    });
    store.createMemory({
      kind: "todo",
      scope: "project",
      projectId: "legacy-project",
      title: "Expired project todo",
      summary: "Expired project todo can be reviewed for archival.",
      staleAfter: "2000-01-01T00:00:00.000Z",
    });
    store.createMemory({
      kind: "fact",
      scope: "project",
      title: "Broken project fact",
      summary: "Missing project id needs manual review before migration.",
    });

    const summary = runMemoryAuditFull(store);

    assert.equal(summary.projectMigrationPreviewCount, 5);
    assert.deepEqual(
      summary.projectMigrationPreview.map((candidate) => [candidate.title, candidate.recommendation]).sort(),
      [
        ["Broken project fact", "needs-human-review"],
        ["Cross repo preference", "global"],
        ["Expired project todo", "archive"],
        ["Project only fact", "legacy-read-only"],
        ["Repo-shaped legacy project", "repo"],
      ],
    );
    assert.ok(summary.suggestedActions.some((action) => action.includes("Review project migration preview")));

    const output = formatAuditResults(summary.staleTodos, summary.oldHandoffs, dbPath, summary.identityViolations, summary.projectMigrationPreview);
    assert.match(output, /Project migration preview \(5, read-only\):/);
    assert.match(output, /\[repo\] Repo-shaped legacy project/);
    assert.match(output, /\[legacy-read-only\] Project only fact/);
    assert.match(output, /preview only, no write performed/);
  } finally {
    store.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("memory audit reports active scope identity violations", () => {
  const { dbPath, tempRoot } = createTempDbPath();
  const store = initializeMemoryStore({ dbPath });

  try {
    store.createMemory({
      kind: "fact",
      scope: "global",
      title: "Global with repo",
      summary: "Historical global record should not carry repository identity metadata.",
      repoPath: "/repo/a",
    });
    store.createMemory({
      kind: "decision",
      scope: "repo",
      title: "Repo without path",
      summary: "Historical repo record should expose missing repository primary identity.",
    });
    store.createMemory({
      kind: "progress_snapshot",
      scope: "project",
      title: "Project without id",
      summary: "Historical project record should expose missing project primary identity.",
    });
    store.createMemory({
      kind: "handoff",
      scope: "session",
      title: "Session without id",
      summary: "Historical session handoff should expose missing session primary identity.",
    });
    store.createMemory({
      kind: "fact",
      scope: "repo",
      title: "Repo with enrichment",
      summary: "Repo records may carry project metadata when runtime enrichment added it.",
      repoPath: "/repo/a",
      projectId: "runtime-project",
    });

    const summary = runMemoryAuditFull(store);

    assert.equal(summary.identityViolationsCount, 4);
    assert.deepEqual(
      summary.identityViolations.map((candidate) => candidate.title).sort(),
      ["Global with repo", "Project without id", "Repo without path", "Session without id"],
    );
    assert.ok(summary.warnings.some((warning) => warning.includes("scope identity issues")));

    const output = formatAuditResults(summary.staleTodos, summary.oldHandoffs, dbPath, summary.identityViolations);
    assert.match(output, /Identity violations \(4\):/);
    assert.match(output, /scope=repo is missing primary identity repoPath/);
    assert.doesNotMatch(output, /Repo with enrichment/);
  } finally {
    store.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
