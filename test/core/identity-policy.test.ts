import assert from "node:assert/strict";
import test from "node:test";

import {
  applyRuntimeIdentityEnrichment,
  findScopeIdentityIssues,
  resolveMemoryIdentityForScope,
} from "../../src/core/index.ts";

test("identity policy reports core filter contradictions for each primary scope", () => {
  assert.deepEqual(
    findScopeIdentityIssues({ scope: ["global"], repoPath: "/repo" }),
    ["scope=global does not accept sessionId, projectId, or repoPath filters"],
  );
  assert.deepEqual(
    findScopeIdentityIssues({ scope: ["repo"], projectId: "project-a", repoPath: "/repo" }),
    ["scope=repo uses repoPath as its primary identity; remove sessionId and projectId from the filter"],
  );
  assert.deepEqual(
    findScopeIdentityIssues({ scope: ["project"], projectId: "project-a", repoPath: "/repo" }),
    ["scope=project uses projectId as its primary identity; remove sessionId and repoPath from the filter"],
  );
  assert.deepEqual(
    findScopeIdentityIssues({ scope: ["session"], sessionId: "session-a", repoPath: "/repo" }),
    ["scope=session uses sessionId as its primary identity; remove projectId and repoPath from the filter"],
  );
});

test("identity policy rejects ambiguous cross-scope identity filters", () => {
  assert.deepEqual(
    findScopeIdentityIssues({ projectId: "project-a", repoPath: "/repo" }),
    ["sessionId, projectId, and repoPath filters cannot be combined without a single compatible scope"],
  );
  assert.deepEqual(
    findScopeIdentityIssues({ scope: ["repo", "session"], sessionId: "session-a", repoPath: "/repo" }),
    ["sessionId, projectId, and repoPath filters cannot be combined across multiple scopes"],
  );
});

test("identity policy derives only the requested primary identity for tool calls", () => {
  const context = { sessionId: "session-a", projectId: "project-a", repoPath: "/repo" };

  assert.deepEqual(resolveMemoryIdentityForScope({ scope: "global" }, context), {});
  assert.deepEqual(resolveMemoryIdentityForScope({ scope: "repo" }, context, { requirePrimary: true }), { repoPath: "/repo" });
  assert.deepEqual(resolveMemoryIdentityForScope({ scope: "project" }, context, { requirePrimary: true }), { projectId: "project-a" });
  assert.deepEqual(resolveMemoryIdentityForScope({ scope: "session" }, context, { requirePrimary: true }), { sessionId: "session-a" });

  assert.deepEqual(
    resolveMemoryIdentityForScope({ scope: "repo", projectId: "manual-project" }, context),
    { error: "scope=repo uses repoPath as its primary identity. Remove sessionId and projectId; the runtime can keep metadata internally." },
  );
});

test("identity policy enriches create input with runtime metadata without weakening primary identity", () => {
  const context = { sessionId: "session-a", projectId: "project-a", repoPath: "/repo" };

  assert.deepEqual(
    applyRuntimeIdentityEnrichment(
      {
        kind: "todo",
        scope: "project",
        title: "Project decision",
        summary: "Project scoped memory should only derive project identity.",
      },
      context,
    ),
    {
      kind: "todo",
      scope: "project",
      title: "Project decision",
      summary: "Project scoped memory should only derive project identity.",
      projectId: "project-a",
    },
  );

  assert.deepEqual(
    applyRuntimeIdentityEnrichment(
      {
        kind: "todo",
        scope: "session",
        title: "Session todo",
        summary: "Session scoped memory keeps runtime project and repo metadata.",
        projectId: "manual-project",
      },
      context,
    ),
    {
      kind: "todo",
      scope: "session",
      title: "Session todo",
      summary: "Session scoped memory keeps runtime project and repo metadata.",
      projectId: "manual-project",
      repoPath: "/repo",
      sessionId: "session-a",
    },
  );
});
