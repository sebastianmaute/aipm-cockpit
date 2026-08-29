import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { mergeFieldValue, mergeFieldPatch } from "./merge-field-value";

describe("mergeFieldValue", () => {
  // THE property that bounds this change's blast radius. When nothing raced —
  // the live value still equals the op's other end — the merge is a plain
  // revert, so every non-racing undo in the app behaves exactly as before.
  it("returns the target verbatim whenever nothing raced", () => {
    let nonTrivial = 0;
    const RUNS = 300;
    const value = fc.oneof(
      fc.integer(),
      fc.string(),
      fc.array(fc.string()),
      fc.dictionary(fc.string(), fc.integer()),
    );
    fc.assert(
      fc.property(value, value, (target, other) => {
        const live = structuredClone(other);
        const out = mergeFieldValue(target, other, live);
        if (JSON.stringify(target) !== JSON.stringify(other)) nonTrivial += 1;
        expect(JSON.stringify(out)).toBe(JSON.stringify(target));
      }),
      { numRuns: RUNS },
    );
    // Anti-vacuity as a FRACTION, never an absolute count: an absolute floor gets
    // easier to clear as numRuns rises, which makes the guard weaker the more you
    // run it.
    expect(nonTrivial / RUNS).toBeGreaterThan(0.5);
  });

  it("keeps a concurrent write to a key the op never touched", () => {
    const target = { m1: "A", m2: "C" };
    const other = { m1: "R", m2: "C" };
    const live = { m1: "R", m2: "C", m3: "I" };
    expect(mergeFieldValue(target, other, live)).toEqual({ m1: "A", m2: "C", m3: "I" });
  });

  it("reverts a key the op did touch even when the concurrent writer also moved it", () => {
    const target = { m1: "A" };
    const other = { m1: "R" };
    const live = { m1: "C" };
    expect(mergeFieldValue(target, other, live)).toEqual({ m1: "A" });
  });

  it("deletes a key the target does not carry", () => {
    const target = {};
    const other = { m1: "R" };
    const live = { m1: "R", m2: "I" };
    expect(mergeFieldValue(target, other, live)).toEqual({ m2: "I" });
  });

  it("removes what the op added and keeps a concurrent addition", () => {
    const target = ["a", "b"];
    const other = ["a", "b", "opAdded"];
    const live = ["a", "b", "opAdded", "userAdded"];
    expect(mergeFieldValue(target, other, live)).toEqual(["a", "b", "userAdded"]);
  });

  it("re-inserts what the op removed, in its original position", () => {
    const target = ["a", "b", "c"];
    const other = ["a", "c"];
    const live = ["a", "c", "userAdded"];
    expect(mergeFieldValue(target, other, live)).toEqual(["a", "b", "c", "userAdded"]);
  });

  it("re-inserts a leading member at the head", () => {
    const target = ["a", "b"];
    const other = ["b"];
    const live = ["b", "userAdded"];
    expect(mergeFieldValue(target, other, live)).toEqual(["a", "b", "userAdded"]);
  });

  it("falls back to the target when either end holds duplicates", () => {
    // Anchoring is ambiguous with duplicates, and a silent wrong answer is worse
    // than today's known-coarse whole-value revert.
    const target = ["a", "a", "b"];
    const other = ["a", "a"];
    const live = ["a", "a", "userAdded"];
    expect(mergeFieldValue(target, other, live)).toEqual(["a", "a", "b"]);
  });

  it("falls back to the target when the shapes disagree", () => {
    expect(mergeFieldValue({ a: 1 }, ["x"], ["y"])).toEqual({ a: 1 });
    expect(mergeFieldValue("scalar", "other", "live")).toBe("scalar");
    expect(mergeFieldValue({ a: 1 }, { a: 2 }, null)).toEqual({ a: 1 });
  });

  // ★★★ THESE TWO ARE THE DETERMINISTIC DETECTOR FOR THE NO-RACE SHORT-CIRCUIT,
  // and they exist because the property test above is NOT one. Deleting
  // `if (!differs(live, other)) return target;` was mutation-tested twice, by two
  // people, on the same code, with OPPOSITE results: killed once, survived once.
  // fast-check is unseeded, and the only shape that distinguishes the guarded
  // function from the mutant is a pure REORDER — same members, different order —
  // which `fc.assert` essentially never produces because it draws `target` and
  // `other` independently. Measured reachability under that generator space:
  // ~0.19% per draw, i.e. well under one expected hit across 300 runs.
  //
  // So the property test is a COIN FLIP on this mutant. A mutation scorecard that
  // records a lucky kill is worse than one that records a survival, because it
  // certifies a guard nothing reliably protects. These two cases are the ones the
  // module header's "including for a pure reorder" claim actually rests on.
  it("returns a reordered array verbatim when nothing raced", () => {
    expect(mergeFieldValue(["a", "b"], ["b", "a"], ["b", "a"])).toEqual(["a", "b"]);
  });

  it("returns a reordered record verbatim when nothing raced", () => {
    // Key ORDER, not content: `mergeRecord` seeds from `live` and appends
    // target-only keys, so without the short-circuit it would rebuild this in
    // live's key order. `toEqual` is order-insensitive for objects, so the
    // assertion is on `Object.keys` — the thing that actually differs.
    const out = mergeFieldValue({ b: 1, a: 2 }, { a: 2, b: 1 }, { a: 2, b: 1 });
    expect(Object.keys(out as Record<string, unknown>)).toEqual(["b", "a"]);
  });
});

describe("mergeFieldPatch", () => {
  it("merges every captured key and leaves the rest of the row alone", () => {
    // `raci` is annotated as the open map it represents, NOT left to inference:
    // a literal infers the narrow `{m1,m3}`, which makes `Partial<T>`'s raci still
    // REQUIRE m3, so the realistic §178 fixture below (the op's before-end carried
    // only m1; a concurrent writer added m3) would not typecheck.
    const live: { id: number; raci: Record<string, string>; title: string } = {
      id: 1,
      raci: { m1: "R", m3: "I" },
      title: "live title",
    };
    const out = mergeFieldPatch(live, { raci: { m1: "A" } }, { raci: { m1: "R" } });
    expect(out).toEqual({ id: 1, raci: { m1: "A", m3: "I" }, title: "live title" });
  });

  it("sets a captured key the target cleared to undefined, matching the old spread", () => {
    const live = { id: 1, completedDate: "2026-01-01", status: "Done" };
    const out = mergeFieldPatch(live, { completedDate: undefined }, { completedDate: "2026-01-01" });
    expect("completedDate" in out).toBe(true);
    expect(out.completedDate).toBeUndefined();
  });

  it("keeps a live value for a captured key both ends agree on", () => {
    // §180 completes a group, so a captured key can be IDENTICAL on both ends.
    // Reverting it would clobber a concurrent write to a field the op never wrote.
    const out = mergeFieldPatch(
      { id: 1, status: "To Do", completedDate: "concurrent" },
      { status: "Done", completedDate: undefined },
      { status: "To Do", completedDate: undefined },
    );
    expect(out.completedDate).toBe("concurrent");
  });
});
