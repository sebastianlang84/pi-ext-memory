---
role: Prompt-injection/autoresearch evidence review
contains: Baseline evidence for whether local autoresearch tooling should be used to optimize pi-memory prompt injection
not-contains: Product requirements, release history, or implementation design for prompt/schema changes
write-when: Prompt-injection tooling or prompt-routing evidence is re-run with new cases or prompt variants
---

# Prompt Injection Autoresearch Baseline — 2026-05-16

## Question

Should local autoresearch tooling be used now to optimize pi-memory prompt injection for lower token cost without degrading agent behavior?

## Method

- Measured the current pi-memory prompt/token footprint with the dependency-free local check in this repo.
- Inspected the existing local research harness in `~/dev/wasti-research`, especially `programs/memory-tool-prompts/` and `harnesses/pi-tool-call-eval/`.
- Ran the memory-tool prompt baseline against the current pi-memory extension using a throwaway `PI_MEMORY_DB_PATH` so save/todo/handoff cases did not touch the real memory store.
- Kept the generated trace under `wasti-research/traces/`, which is gitignored.

## Evidence checked

### Token footprint

Command:

```bash
npm run check:token-injection
```

Result:

| Metric | Result |
| --- | --- |
| Tool prompt metadata | `285/320` estimated tokens |
| Tool schema text | `493/560` estimated tokens |
| All static tool text | `778/900` estimated tokens |
| Turn-start no-hit | `38/45` estimated tokens |
| Turn-start hit fixture | `105/120` estimated tokens |
| Turn-start handoff fixture | `86/100` estimated tokens |
| Turn-start combined fixture | `152/170` estimated tokens |

All token-injection counts were within regression limits.

### Prompt-routing behavior

Program:

```text
~/dev/wasti-research/programs/memory-tool-prompts
```

Trace filename in the local, gitignored `traces/` directory:

```text
memory-tool-prompts-baseline-20260516-140911.json
```

Score command:

```bash
cd ~/dev/wasti-research
npm run score:tool-calls -- programs/memory-tool-prompts/cases.json traces/memory-tool-prompts-baseline-20260516-140911.json
```

Result:

| Metric | Result |
| --- | --- |
| Cases | `5` |
| Pass | `5` |
| Fail | `0` |
| Unsafe | `0` |
| Pass rate | `1.0` |
| Must-call recall | `1.0` |
| Forbidden-call rate | `0` |
| Order accuracy | `1.0` |
| Unsafe rate | `0` |

Observed behavior matched the fixed cases:

- `memory_search` was used for prior repo-decision recall.
- Plain local README reading avoided `memory_search` and memory writes.
- Explicit durable preference used `memory_save`.
- Persistent actionable work used `memory_save_todo`.
- Context-loss handoff used `memory_save_handoff`.

## Conclusion

Do not change pi-memory prompt snippets, prompt guidelines, schemas, or turn-start injection now. The current prompt surface is both within token budgets and behaviorally correct for the available local `wasti-research` memory-tool prompt cases.

Use `~/dev/wasti-research` again only when evaluating a concrete prompt/schema/turn-start variant. For any future run that includes write tools, set `PI_MEMORY_DB_PATH` to a throwaway SQLite path.

## Verification

- `npm run check:token-injection`
- `cd ~/dev/wasti-research && npm test`
- `cd ~/dev/wasti-research && npm run score:tool-calls -- programs/memory-tool-prompts/cases.json traces/memory-tool-prompts-baseline-20260516-140911.json`
