# ADR 003 — Local BGE-M3 command adapter as the default embedding target

- Status: Accepted
- Date: 2026-04-27

## Context

The deterministic built-in embedding baseline was sufficient to bootstrap persisted vectors and hybrid retrieval, but it is not a true semantic model.

V0.8.2 needs a stronger default semantic path while keeping the project:
- local-first,
- dependency-light,
- portable,
- and installable as a normal Pi package without bundling a heavyweight model runtime.

## Decision

Use a local command adapter as the default embedding target:
- configuration: `PI_MEMORY_BGE_M3_COMMAND`
- target model label: `local-bge-m3-command`
- transport: synchronous JSON over stdin/stdout
- timeout: bounded by `PI_MEMORY_BGE_M3_TIMEOUT_MS`, defaulting to 15 seconds
- accepted stdout shapes: raw vector array, `{ embedding }`, `{ embeddings }`, and OpenAI-style `{ data: [{ embedding }] }`
- output validation: exactly 1024 finite numeric dimensions for BGE-M3

If no command is configured, the default path falls back to the built-in deterministic `builtin-hash-384-v1` profile.
The low-footprint profile remains `builtin-hash-64-v1`.

## Consequences

### Positive
- Real local semantic embeddings can be used without adding a new npm dependency.
- Package installation stays simple because the adapter boundary is still narrow.
- Operators can choose their own local BGE-M3 runner as long as it speaks the stdin/stdout JSON contract.

### Negative
- Local quality and latency now depend on an external command being installed and configured correctly.
- The default status may target BGE-M3 while the active runtime still falls back to deterministic embeddings until configured.

## Follow-up

- Monitor real-machine retrieval quality and latency in normal use after v1.0.
- Keep the deterministic fallback shipped unless real-machine evidence justifies standardizing a different lighter semantic fallback.
