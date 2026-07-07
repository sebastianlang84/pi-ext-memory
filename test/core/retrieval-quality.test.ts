import assert from "node:assert/strict";
import test from "node:test";

import { computeAdversarialFindings, computeRetrievalQuality } from "../../scripts/eval-retrieval-quality.ts";

// Regression guard on the deterministic retrieval-quality metrics. Bars are set
// below the current baseline (precision@1 100%, recall@3 87%, MRR 1.0, anchor
// 100%) so ranking regressions fail while normal tuning has headroom.
test("retrieval-quality metrics stay above the regression bar", () => {
  const metrics = computeRetrievalQuality();

  assert.ok(metrics.precisionAt1 >= 0.8, `precision@1 ${metrics.precisionAt1} below 0.8`);
  assert.ok(metrics.recallAt3 >= 0.6, `recall@3 ${metrics.recallAt3} below 0.6`);
  assert.ok(metrics.mrr >= 0.85, `MRR ${metrics.mrr} below 0.85`);
  assert.equal(metrics.anchorAccuracy, 1, "current-repo anchor / pinned ordering must hold");
});

// Falsifiable ledger of known retrieval gaps. Each case's actual reachability
// must match its documented `expectedFound`; this fails on a silent regression
// AND on a silent improvement, so closing a gap requires deliberately flipping
// the flag in the same change.
test("adversarial known-gap ledger matches documented behavior", () => {
  for (const finding of computeAdversarialFindings()) {
    assert.equal(
      finding.found,
      finding.expectedFound,
      `${finding.id} [${finding.gap}] reachability changed: got ${finding.found}, expected ${finding.expectedFound} — update the ledger`,
    );
  }
});
