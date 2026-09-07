// src/app/sanitize-model-change-wiring.test.ts — which change call sites get the
// REPAIRING sanitizer and which get the verbatim one.
//
// ★★★ THE BEHAVIOUR IS PINNED ELSEWHERE; THIS FILE PINS THE WIRING, and nothing
// else can. `sanitize-records.test.ts` proves `sanitizeModelChangeItem` repairs
// and `sanitizeChangeItem` stores verbatim, but both functions accept the same
// argument and return the same type, so swapping one for the other at a CALL
// SITE leaves every behavioural assertion in this repo green. The seam is above
// the tests that exist: a create that silently went back to the verbatim
// sanitizer would store a model's `1.5` unrepaired, and a load that went to the
// repairing one would clamp a person's stored 2e9 to AMOUNT_MAX — the defect
// this whole split exists to stop — with a fully green suite either way.
//
// ★★ SOURCE-MATCHING BECAUSE THE ALTERNATIVE IS WORSE HERE. `createChange` is
// reachable only through the chat dispatcher, whose harness is a 3,600-line
// fixture in `use-chat-dispatcher.test.tsx`; duplicating it to assert one
// substitution would buy a behavioural test at the cost of a second copy of that
// harness, free to drift. The precedent is the same file's sibling —
// `sanitize-milestone-patch.test.ts`'s "nests the guard OUTSIDE withAiRichFields
// at all three call sites" — which reads this very source file for the same
// reason and with the same anti-vacuity discipline.
//
// ★★★ EVERY ASSERTION HERE CARRIES ITS POSITIVE CONTROL. An absence
// (`sanitizeChangeItem` must NOT appear in the proposal path) passes vacuously
// against a renamed helper, a moved function or a mistyped path, so each absence
// is stated beside the count that must still be found. That is the rule the
// precedent test states in its own comment, and it is the only thing separating
// this from a test that would pass over an empty string.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string): string => readFileSync(path, "utf8");

describe("which sanitizer each change write path is wired to", () => {
  it("gives the model CREATE the repairing sanitizer and the model UPDATE the verbatim one", () => {
    // ★★★ THE TWO HANDLERS SIT IN ONE FILE AND MUST NOT MATCH, which is why the
    //  counts are asserted as a PAIR rather than one at a time. `createChange`
    //  repairs (no stored value to protect, and its card promises nothing
    //  per-field); `updateChange` must keep running `dropUnacceptedChangeFields`
    //  in front of the plain sanitizer, because the AI edit preview refuses a
    //  fractional day count through the same predicate (§405) — repairing there
    //  would write a value under a card that said "unchanged".
    const src = read("src/app/use-register-tools.ts");
    expect(src.match(/\bsanitizeModelChangeItem\(/g) ?? []).toHaveLength(1);
    expect(src.match(/\bsanitizeChangeItem\(/g) ?? []).toHaveLength(1);
    // ★★ The guard is what makes the verbatim sanitizer safe on the update path,
    //  so its presence is part of THIS claim, not a separate one. Without it the
    //  plain sanitizer would write the model's refused value straight through —
    //  a NEW failure mode created by making the sanitizer verbatim, pinned
    //  behaviourally in `sanitize-change-patch.test.ts`.
    expect(src.match(/dropUnacceptedChangeFields\(/g) ?? []).not.toHaveLength(0);
  });

  it("gives the model-authored proposal seed the repairing sanitizer, and only that one", () => {
    // ★ `proposalToSeed` builds a seed from an AI proposal, so it is model input
    //  with no stored row behind it — the same population as a create.
    const src = read("src/app/ai-project-proposal.ts");
    expect(src.match(/\bsanitizeModelChangeItem\b/g) ?? []).toHaveLength(2); // the import + the call
    // ★★ THE ABSENCE, WITH ITS CONTROL DIRECTLY ABOVE. On its own this line
    //  passes against a deleted file, a moved function or a typo in the path;
    //  it means something only because the count above proves the same string
    //  was read and the repairing sanitizer really is there.
    expect(src.match(/\bsanitizeChangeItem\b/g) ?? []).toHaveLength(0);
  });

  it("leaves every STORED-DATA call site on the verbatim sanitizer", () => {
    // ★★★ THE HALF THAT PROTECTS USER DATA. These three files are the read side
    //  of five of the six write paths — `buildChangeFromObj` serves CSV,
    //  Markdown and both Turso layouts, `jsonToWorkspace` the JSON slot, and
    //  `templates.ts` the stored template seeds. A repairing sanitizer on any of
    //  them silently rewrites a number a person saved: 2_000_000_000 clamped to
    //  AMOUNT_MAX (1e9 is an ordinary figure in JPY, KRW or IDR), 1234.567
    //  rounded to 1234.57, 0.5 rounded to 1.
    // ★★ None of these three files is edited by this slice. They are asserted
    //  precisely because they were left alone: the split protects them only for
    //  as long as nobody "completes the pattern" by wiring the model sanitizer
    //  in here too.
    for (const path of [
      "src/app/csv-codecs-core.ts",
      "src/app/workspace.ts",
      "src/app/templates.ts",
    ]) {
      const src = read(path);
      expect(src.match(/\bsanitizeChangeItem\(/g) ?? []).not.toHaveLength(0);
      expect(src.match(/\bsanitizeModelChangeItem\b/g) ?? []).toHaveLength(0);
    }
  });
});
