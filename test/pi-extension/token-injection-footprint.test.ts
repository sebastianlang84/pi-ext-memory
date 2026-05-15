import assert from "node:assert/strict";
import test from "node:test";

import { collectTokenInjectionReport, findBudgetFailures } from "../../scripts/check-token-injection.ts";

test("registered memory tools keep static token injection compact", async () => {
  const report = await collectTokenInjectionReport();
  const failures = findBudgetFailures(report).filter((entry) => entry.name.startsWith("tool") || entry.name === "allToolStatic");

  assert.deepEqual(
    failures.map((entry) => `${entry.name}: ${entry.estimatedTokens}/${entry.budget}`),
    [],
  );
});

test("turn-start memory injections stay compact in representative cases", async () => {
  const report = await collectTokenInjectionReport();
  const failures = findBudgetFailures(report).filter((entry) => entry.name.startsWith("turn"));

  assert.deepEqual(
    failures.map((entry) => `${entry.name}: ${entry.estimatedTokens}/${entry.budget}`),
    [],
  );
});
