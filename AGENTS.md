---
role: Normative agent behavior, process rules, and bootstrap sequence
contains: Role norms, guardrails, gates, document-role overview, routing table
not-contains: Project state, implementation details, how-tos, or durable memory
write-when: A behavior rule, gate, guardrail, or document-role summary changes
---

## 1) Your Role & Behaviour
- You're a coding agent.
- Be honest about uncertainty, limitations, and mistakes.
- Be concise and precise.
- One technical goal per task unless the user explicitly expands scope.
- Prefer small, reviewable diffs over broad refactors.
- Keep the core product local-first, simple, and portable.
- Treat code/config as source of truth; use docs to capture decisions, plans, and durable memory.

## 2) Rules
- At session start: retrieve repo memories, then read `TODO.md`.
- No secrets in repo/commits/docs.
- Do not silently guess architecture, performance, or platform constraints.
- Follow Semantic Versioning 2.0.0 repo-wide.
- At the start of every task, check that the current branch is appropriate for the work.
- Do not weaken local-first or portability goals without explicit approval.
- Do not introduce heavy infra, remote dependencies, or background services into V1 without an explicit decision.
- Keep retrieval/memory quality ahead of feature count.
- Keep repository documentation in English; avoid mixed-language or Denglish prose.
- Dirty worktree with unrelated changes: stop and ask before commit or revert.

## 3) Bootstrap Sequence
On session start: **retrieve repo memories, then read `TODO.md`**. Load deeper docs only when relevant.

## 4) Document Roles

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

## 5) Routing
- Stable truth -> memory store (repo scope)
- Active work -> `TODO.md`
- Product intent/scope -> `docs/product/*`
- User-facing behavior/config -> `docs/user/*`
- Developer-facing architecture/API/test notes -> `docs/developer/*`
- Durable decisions -> `docs/adr/*`
- Detailed plans -> `docs/plans/*`
- Repo-local skills -> `.agents/skills/*`

## 6) Gates (mandatory per task)

### Gate A: Preflight
Before the first write, briefly state:
- Goal
- Scope (in/out)
- Open assumptions, ambiguities, or missing facts that could change the approach

### Gate B: Read-only Diagnose
- Read/check first.
- Verify the relevant facts in files, docs, config, or tool output before writing.
- If facts remain unclear and risk is non-trivial: stop and ask.

### Gate C: Implementation
- Implement only after diagnosis.
- Keep changes minimal and scoped.
- If a meaningful blocker surfaces mid-task: stop and ask.

### Gate D: Verification
- Verify after every change.
- Without verification, the task is not complete.
- Review `TODO.md`, `README.md`, and `CHANGELOG.md` when affected.
- Bump `version` in `package.json` per Semantic Versioning 2.0.0 and add a `CHANGELOG.md` entry for every commit.
- Create a commit unless the user explicitly says otherwise.
