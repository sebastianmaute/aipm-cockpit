import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { expectRowUniqueNames } from "./row-unique-names";

function Rows({ names, role = "button" }: { names: string[]; role?: string }) {
  return (
    <ul data-testid="rows">
      {names.map((n, i) => (
        <li key={i}>
          {role === "button" ? (
            <button type="button" aria-label={n}>
              x
            </button>
          ) : (
            <input type="checkbox" aria-label={n} readOnly checked={false} />
          )}
        </li>
      ))}
    </ul>
  );
}

describe("expectRowUniqueNames", () => {
  it("passes when every control has a distinct name", () => {
    render(<Rows names={["Delete – Alpha", "Delete – Beta"]} />);
    expect(() => expectRowUniqueNames({ minControls: 2 })).not.toThrow();
  });

  it("FAILS when two controls share a name", () => {
    // ★ The mutation proof. Without this the helper could be a no-op and every
    // adopting test would pass vacuously.
    render(<Rows names={["Delete – Alpha", "Delete – Alpha"]} />);
    expect(() => expectRowUniqueNames({ minControls: 2 })).toThrow(/Delete – Alpha/);
  });

  it("THROWS rather than passing when the scope renders too few controls", () => {
    // ★ What this floor actually buys: an empty or near-empty scope — a query
    // typo, a panel that rendered nothing — cannot read as a pass. It counts
    // CONTROLS, not rows, so it does NOT make a one-row fixture unreachable;
    // `requireCollisionSeed` below is the guard that does that.
    render(<Rows names={["Delete – Alpha"]} />);
    expect(() => expectRowUniqueNames({ minControls: 2 })).toThrow(/minControls/);
  });

  it("scopes to a container when one is given", () => {
    // ★ The outside button DELIBERATELY duplicates a name inside the scope, so
    // an unscoped run collides. Its earlier name was "Outside": all three names
    // were then distinct and this test passed identically with scoping deleted.
    // Measured, not reasoned — mutating `controlNames` to `const q = screen;`
    // left all six tests in this file green.
    render(
      <div>
        <button type="button" aria-label="Delete – Alpha">
          x
        </button>
        <Rows names={["Delete – Alpha", "Delete – Beta"]} />
      </div>,
    );
    const scope = screen.getByTestId("rows");
    expect(() => expectRowUniqueNames({ minControls: 2, scope })).not.toThrow();
    // The anti-vacuity control: same DOM, no scope, must FAIL.
    expect(() => expectRowUniqueNames({ minControls: 3 })).toThrow(/Delete – Alpha/);
  });

  it("checks roles beyond button when asked", () => {
    render(<Rows names={["Pick – Alpha", "Pick – Alpha"]} role="checkbox" />);
    expect(() => expectRowUniqueNames({ minControls: 2, roles: ["checkbox"] })).toThrow(/Pick – Alpha/);
  });

  it("does not see a checkbox collision when only buttons are checked", () => {
    // ★ Anti-vacuity control for the test above: proves `roles` is load-bearing
    // and the previous case did not pass for an unrelated reason.
    render(<Rows names={["Pick – Alpha", "Pick – Alpha"]} role="checkbox" />);
    expect(() => expectRowUniqueNames({ minControls: 2, roles: ["checkbox"] })).toThrow();
    expect(() => expectRowUniqueNames({ minControls: 1, roles: ["button"] })).toThrow(/minControls/);
  });

  describe("requireCollisionSeed", () => {
    it("THROWS when the fixture seeded no two rows sharing a display name", () => {
      // ★★ THE POINT OF THE WHOLE OPTION. A distinct-name fixture cannot fail
      // against defective code — correct code has nothing to disambiguate — so
      // a test claiming to cover a collision must be stopped, not passed.
      // Deleting the guard makes THIS case pass, which is what makes it a real
      // detector rather than a decoration.
      render(<Rows names={["Delete – Alpha", "Delete – Beta"]} />);
      expect(() => expectRowUniqueNames({ minControls: 2, requireCollisionSeed: true })).toThrow(
        /requireCollisionSeed/,
      );
    });

    it("THROWS on a one-row fixture no matter how many controls it renders", () => {
      // ★★ The exact hole the floor never closed: ONE row, four controls, floor
      // of 2 — satisfied, and previously a pass.
      render(<Rows names={["Download – Alpha", "Rename – Alpha", "Duplicate – Alpha", "Delete – Alpha"]} />);
      expect(() => expectRowUniqueNames({ minControls: 2 })).not.toThrow();
      expect(() => expectRowUniqueNames({ minControls: 2, requireCollisionSeed: true })).toThrow(
        /requireCollisionSeed/,
      );
    });

    it("passes when two rows share a display name and were qualified with (N)", () => {
      // ★ The real shape `buildRowTokens` emits: the names differ ONLY by the
      // occurrence suffix the guard strips. Goes red if that strip stops
      // working, so it pins `OCCURRENCE_SUFFIX` rather than merely exercising it.
      render(<Rows names={["Delete – Q3 report (1)", "Delete – Q3 report (2)"]} />);
      expect(() =>
        expectRowUniqueNames({ minControls: 2, requireCollisionSeed: true }),
      ).not.toThrow();
    });

    it("does NOT accept a disambiguator other than the (N) occurrence suffix", () => {
      // ★★ The `documents-deleted-section.tsx` shape: two rows DO share a title,
      // but they are qualified with ` · #id`, which the anchored strip leaves
      // alone. The guard refuses to certify what it cannot actually see rather
      // than guessing at every disambiguator in the app — which is why that
      // call site is deliberately opted OUT.
      render(<Rows names={["Restore – Same title · #1", "Restore – Same title · #2"]} />);
      expect(() => expectRowUniqueNames({ minControls: 2, requireCollisionSeed: true })).toThrow(
        /requireCollisionSeed/,
      );
    });

    it("still reports a real collision when the seed guard is on", () => {
      // ★ Anti-vacuity: the guard must not short-circuit the assertion it protects.
      render(<Rows names={["Delete – Alpha", "Delete – Alpha"]} />);
      expect(() => expectRowUniqueNames({ minControls: 2, requireCollisionSeed: true })).toThrow(
        /WCAG 2.4.6/,
      );
    });
  });
});
