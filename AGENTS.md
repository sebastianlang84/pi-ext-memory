## 1) Rules
- Do not edit `AGENTS.md` without explicit user approval.
- Keep the product local-first, dependency-light, portable, and simple; stop and ask before adding remote dependencies, background services, heavy infrastructure, or portability-reducing changes.
- New features must have a clear, observable benefit, preferably covered by explicit tests; otherwise treat them as bloat.
- Keep retrieval/memory quality ahead of feature count.
- Do not silently guess architecture, performance, or platform constraints; stop and ask when they affect the approach.
- Keep repository documentation in English; avoid mixed-language or Denglish prose.

## 2) Document Roles

| File | Role | Write when |
| --- | --- | --- |
| `TODO.md` | Active open work only | Work or priorities change |
| `CHANGELOG.md` | Outward-facing change history | User/operator-relevant changes land |
| `README.md` | Project guide and navigation | Setup or repo orientation changes |
| `docs/product/*` | Product intent, scope, requirements, risks, and success criteria | Product scope, requirements, or major direction changes |
| `docs/user/*` | User-facing commands, tools, workflows, and configuration | User-visible behavior, commands, tools, or configuration changes |
| `docs/developer/*` | Developer-facing architecture, module boundaries, schemas, APIs, tests, and local development notes | Internal architecture, API, schema, or development workflow changes |
| `docs/adr/*` | Durable decisions | A durable decision is made |
| `docs/plans/*` | Detailed execution plans | A task needs a breakdown beyond `TODO.md` |
| `.agents/skills/*` | Optional repo-local skills | A reusable repo-local skill is curated |
