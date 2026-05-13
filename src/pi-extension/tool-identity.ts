import {
  findScopeIdentityIssues,
  isLegacyProjectScopeSelected,
  LEGACY_PROJECT_SCOPE_NOTICE,
  resolveMemoryIdentityForScope,
} from "../core/identity-policy.ts";
import type { MemoryScope } from "../core/index.ts";
import type { MemoryTurnContext } from "./retrieval.ts";

export type ToolIdentityParams = {
  scope: MemoryScope;
  sessionId?: string;
  projectId?: string;
  repoPath?: string;
};

export type ToolIdentityResult = {
  sessionId?: string;
  projectId?: string;
  repoPath?: string;
  error?: string;
};

export { LEGACY_PROJECT_SCOPE_NOTICE };

export function formatWithLegacyProjectScopeNotice(text: string, scope?: MemoryScope | MemoryScope[]): string {
  return isLegacyProjectScopeSelected(scope) ? `${LEGACY_PROJECT_SCOPE_NOTICE}\n${text}` : text;
}

export function resolveToolIdentity(
  params: ToolIdentityParams,
  context: MemoryTurnContext,
  options: { requirePrimary?: boolean } = {},
): ToolIdentityResult {
  return resolveMemoryIdentityForScope(params, context, options);
}

export function resolveSingleScopeSearchIdentity(
  params: { scope?: MemoryScope[]; sessionId?: string; projectId?: string; repoPath?: string },
  context: MemoryTurnContext,
): ToolIdentityResult {
  if (!params.scope || params.scope.length === 0) {
    const [error] = findScopeIdentityIssues(params, { style: "tool" });
    if (error) return { error: `${error}.` };
    return { sessionId: params.sessionId, projectId: params.projectId, repoPath: params.repoPath };
  }

  if (params.scope.length !== 1) {
    const [error] = findScopeIdentityIssues(params, { style: "tool" });
    if (error) return { error: `${error}.` };
    return { sessionId: params.sessionId, projectId: params.projectId, repoPath: params.repoPath };
  }

  return resolveToolIdentity({ scope: params.scope[0]!, sessionId: params.sessionId, projectId: params.projectId, repoPath: params.repoPath }, context, { requirePrimary: true });
}

export function formatIdentityError(error: string, dbPath: string): string {
  return `Invalid memory scope identity: ${error}\ndb_path: ${dbPath}`;
}
