import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SLICE_POLICY } from "./workspace-slice-policy";

/** Every array-typed member of the `Workspace` type, read from the source so a
 *  new slice cannot be added without this test seeing it.
 *  ★★ Parsed from the TYPE, not from a runtime object: an emptyWorkspace()
 *  literal omits optional slices, so a runtime walk would silently miss exactly
 *  the additive slices this exists to catch. */
function workspaceArraySlices(): string[] {
  const src = readFileSync("src/app/workspace.ts", "utf8");
  const block = src.match(/export type Workspace = \{[\s\S]*?\n\};/);
  if (!block) throw new Error("could not locate the Workspace type — this test cannot do its job");
  const found = [...block[0].matchAll(/^\s{2}(\w+)\??:\s*(?:readonly \w+\[\]|ReadonlyArray<)/gm)].map((m) => m[1]);
  // ★★ VACUITY GUARD. A drifted regex that matches nothing would otherwise report
  //    "no slice missing" over an empty list — a scanner that reads nothing passes
  //    everything. The floor is calibrated against the MEASURED 20 (2026-08-29) and
  //    is deliberately above what EITHER half of the alternation yields on its own:
  //    `ReadonlyArray<` alone matches 12, `readonly X[]` alone matches 8, so losing
  //    either branch fires this rather than silently narrowing the scan.
  if (found.length < 15) throw new Error(`parsed only ${found.length} array slices — the regex has drifted`);
  return found;
}

describe("every Workspace array slice carries a recorded save-guard decision", () => {
  it("has no slice missing from the policy", () => {
    const missing = workspaceArraySlices().filter((s) => !(s in SLICE_POLICY));
    expect(
      missing,
      `New Workspace slice(s) with no recorded decision: ${missing.join(", ")}. ` +
        "Add each to SLICE_POLICY in workspace-slice-policy.ts — counted, or excluded WITH its reason — " +
        "and pin it in is-workspace-empty.test.ts in both directions.",
    ).toEqual([]);
  });

  it("has no policy entry for a slice that no longer exists", () => {
    const live = new Set(workspaceArraySlices());
    const stale = Object.keys(SLICE_POLICY).filter((k) => !live.has(k));
    expect(stale, `SLICE_POLICY names slice(s) the type no longer has: ${stale.join(", ")}`).toEqual([]);
  });

  it("gives every excluded slice a non-empty reason", () => {
    const unreasoned = Object.entries(SLICE_POLICY)
      .filter(([, p]) => !p.counted && p.reason.trim().length < 20)
      .map(([k]) => k);
    expect(unreasoned, `Excluded without a real reason: ${unreasoned.join(", ")}`).toEqual([]);
  });
});
