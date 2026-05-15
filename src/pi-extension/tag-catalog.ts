import type { MemoryKind, MemoryRecord, MemoryScope, MemoryStatus } from "../core/index.ts";

export interface TagCatalogExample {
  id: string;
  title: string;
  scope: string;
  kind: string;
  updatedAt: string;
}

export interface TagCatalogEntry {
  tag: string;
  count: number;
  scopes: string[];
  kinds: string[];
  examples: TagCatalogExample[];
}

export interface NearTagSuggestion {
  input: string;
  suggestions: string[];
}

export interface BuildTagCatalogOptions {
  maxExamplesPerTag?: number;
  limit?: number;
}

export interface TagCatalogFilter {
  status: MemoryStatus;
  scope?: MemoryScope[];
  kind?: MemoryKind[];
  repoPath?: string;
}

interface MutableTagCatalogEntry {
  tag: string;
  count: number;
  scopes: Set<string>;
  kinds: Set<string>;
  examples: TagCatalogExample[];
}

export function buildTagCatalog(memories: MemoryRecord[], options: BuildTagCatalogOptions = {}): TagCatalogEntry[] {
  const maxExamplesPerTag = options.maxExamplesPerTag ?? 2;
  const limit = options.limit ?? 50;
  const byTag = new Map<string, MutableTagCatalogEntry>();

  const sortedMemories = [...memories].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  for (const memory of sortedMemories) {
    for (const tag of memory.tags) {
      const entry = byTag.get(tag) ?? {
        tag,
        count: 0,
        scopes: new Set<string>(),
        kinds: new Set<string>(),
        examples: [],
      };

      entry.count += 1;
      entry.scopes.add(memory.scope);
      entry.kinds.add(formatKind(memory.kind));
      if (entry.examples.length < maxExamplesPerTag) {
        entry.examples.push({
          id: memory.id,
          title: memory.title,
          scope: memory.scope,
          kind: formatKind(memory.kind),
          updatedAt: memory.updatedAt,
        });
      }

      byTag.set(tag, entry);
    }
  }

  return Array.from(byTag.values())
    .map((entry) => ({
      tag: entry.tag,
      count: entry.count,
      scopes: Array.from(entry.scopes).sort(),
      kinds: Array.from(entry.kinds).sort(),
      examples: entry.examples,
    }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, limit);
}

export function suggestNearTags(
  requestedTags: string[] | undefined,
  catalog: TagCatalogEntry[],
  options: { maxSuggestionsPerTag?: number } = {},
): NearTagSuggestion[] {
  const maxSuggestionsPerTag = options.maxSuggestionsPerTag ?? 3;
  const catalogTags = new Set(catalog.map((entry) => entry.tag));
  const normalizedRequestedTags = normalizeRequestedTags(requestedTags);

  return normalizedRequestedTags.flatMap((input) => {
    if (catalogTags.has(input)) return [];

    const suggestions = catalog
      .map((entry) => ({ entry, score: scoreNearTag(input, entry.tag) }))
      .filter((candidate) => candidate.score >= 0.5)
      .sort((a, b) => b.score - a.score || b.entry.count - a.entry.count || a.entry.tag.localeCompare(b.entry.tag))
      .slice(0, maxSuggestionsPerTag)
      .map((candidate) => candidate.entry.tag);

    return suggestions.length > 0 ? [{ input, suggestions }] : [];
  });
}

export function formatNearTagSuggestionLines(suggestions: NearTagSuggestion[]): string[] {
  if (suggestions.length === 0) return [];

  return [
    "near_tag_suggestions:",
    ...suggestions.map((suggestion) => `- ${suggestion.input}: ${suggestion.suggestions.join(", ")}`),
  ];
}

export function formatTagCatalog(catalog: TagCatalogEntry[], dbPath: string): string {
  const lines: string[] = [];

  if (catalog.length === 0) {
    lines.push("Tag catalog: no active tags matched the filters.", `db_path: ${dbPath}`);
    return lines.join("\n");
  }

  lines.push(`Tag catalog: ${catalog.length} tag${catalog.length !== 1 ? "s" : ""} found.`);

  catalog.forEach((entry, index) => {
    const examples = entry.examples.map((example) => example.title).join("; ") || "none";
    lines.push(
      `${index + 1}. ${entry.tag} — ${entry.count} memor${entry.count !== 1 ? "ies" : "y"}`,
      `   scopes: ${entry.scopes.join(", ") || "none"}; kinds: ${entry.kinds.join(", ") || "none"}`,
      `   examples: ${examples}`,
    );
  });

  lines.push(`db_path: ${dbPath}`);
  return lines.join("\n");
}

function formatKind(kind: MemoryRecord["kind"]): string {
  return kind ?? "note";
}

function normalizeRequestedTags(tags: string[] | undefined): string[] {
  const normalizedTags: string[] = [];
  const seen = new Set<string>();

  for (const tag of tags ?? []) {
    if (typeof tag !== "string") continue;
    const normalized = tag.trim().replace(/\s+/g, " ").toLowerCase();
    if (normalized.length === 0 || seen.has(normalized)) continue;
    seen.add(normalized);
    normalizedTags.push(normalized);
  }

  return normalizedTags;
}

function scoreNearTag(requestedTag: string, existingTag: string): number {
  if (requestedTag === existingTag) return 1;
  if (existingTag.startsWith(requestedTag) || requestedTag.startsWith(existingTag)) return 0.9;
  if (existingTag.includes(requestedTag) || requestedTag.includes(existingTag)) return 0.8;

  const tokenScore = scoreTokenOverlap(tokenizeTag(requestedTag), tokenizeTag(existingTag));
  const editSimilarity = scoreEditSimilarity(requestedTag, existingTag);

  return Math.max(tokenScore, editSimilarity);
}

function tokenizeTag(tag: string): string[] {
  return tag.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function scoreTokenOverlap(requestedTokens: string[], existingTokens: string[]): number {
  if (requestedTokens.length === 0 || existingTokens.length === 0) return 0;

  const existingTokenSet = new Set(existingTokens);
  const overlap = requestedTokens.filter((token) => existingTokenSet.has(token)).length;
  if (overlap === 0) return 0;

  return 0.45 + (overlap / Math.max(requestedTokens.length, existingTokens.length)) * 0.3;
}

function scoreEditSimilarity(left: string, right: string): number {
  const longestLength = Math.max(left.length, right.length);
  if (longestLength === 0) return 1;

  const distance = levenshteinDistance(left, right);
  const similarity = 1 - distance / longestLength;
  return similarity >= 0.72 ? similarity : 0;
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
    }

    for (let index = 0; index < previous.length; index++) {
      previous[index] = current[index] ?? 0;
    }
  }

  return previous[right.length] ?? 0;
}
