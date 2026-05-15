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
