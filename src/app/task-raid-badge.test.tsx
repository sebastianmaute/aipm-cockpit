import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RaidBadge } from "./task-raid-badge";
import { expectRowUniqueNames } from "../test/row-unique-names";
import type { RaidItem } from "./types";

const raidFix = (category: RaidItem["category"], id = 1): RaidItem =>
  ({ id, category, title: `RAID ${id}` }) as RaidItem;

// 2 R + 1 A, so the visible text is the short count "3 RAID" while the
// breakdown on `title` is "2R · 1A · 0I · 0D" — two DIFFERENT strings, which is
// the whole point of the containment check below.
const MIXED_REFS: RaidItem[] = [raidFix("R", 1), raidFix("R", 2), raidFix("A", 3)];

describe("RaidBadge", () => {
  // ★★★ WCAG 2.5.3 (label in name). The badge's VISIBLE content is the short
  // count ("3 RAID"); the accessible name LEADS with that same string, then
  // adds the spelled-out count and the row token. Leading with the visible text
  // makes containment hold by construction rather than by coincidence — a
  // translation that reorders the sentence cannot break it.
  //
  // ★★ CONTAINMENT, NOT PREFIX. 2.5.3 asks that the name CONTAIN the visible
  // text, case-INSENSITIVELY and position-INDEPENDENTLY (axe's own
  // implementation ends in `includes`). Front position here is the Understanding
  // note's best practice, not the criterion. Do not enforce prefixing elsewhere
  // on the strength of this test.
  //
  // ★★ SO THIS TEST DOES NOT PIN THE HEAD POSITION, and reading it as if it did
  // is the trap. MEASURED, not reasoned: with the name rebuilt to lead with the
  // MIX instead ("2R · 1A · 0I · 0D – Referenced by 3 RAID item(s) – Alpha"),
  // this test still PASSES — the visible "3 RAID" is a substring of the
  // spelled-out "Referenced by 3 RAID item(s)" sitting in the middle, so
  // containment survives by coincidence. That mutant is caught by the
  // exact-name pin below, which is what holds the ordering. Both assertions are
  // load-bearing.
  //
  // ★★ NO GATE CAN CATCH THIS. axe ships `label-content-name-mismatch` and it
  // DOES carry `wcag21a`, one of the four tags `e2e/a11y.spec.ts` requests —
  // but it is ALSO tagged `experimental`, and axe's default `tagExclude` is
  // `experimental,deprecated`, so a tag-only run never executes it. Verify:
  //   node -e "const a=require('axe-core');const r=a.getRules().find(x=>x.ruleId==='label-content-name-mismatch');console.log(a._audit.tagExclude.join(','),'::',r.tags.join(','))"
  // This test is therefore the only detector that can exist for this control.
  it("contains its visible count text inside its accessible name (WCAG 2.5.3)", () => {
    render(<RaidBadge taskId={7} refs={MIXED_REFS} lang="en-US" rowToken="Alpha" onJumpToRaid={vi.fn()} />);
    const btn = screen.getByRole("button");
    const visible = btn.textContent!.trim();
    // Guard against a vacuous pass: an empty visible string is contained in
    // every name, so assert the fixture actually rendered the count.
    expect(visible).toBe("3 RAID");
    expect(btn.getAttribute("aria-label")!.toLowerCase()).toContain(visible.toLowerCase());
  });

  it("keeps the count and the row token in the name after the visible text", () => {
    render(<RaidBadge taskId={7} refs={MIXED_REFS} lang="en-US" rowToken="Alpha" onJumpToRaid={vi.fn()} />);
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "3 RAID – Referenced by 3 RAID item(s) – Alpha",
    );
    // ★ `title` carries the per-category BREAKDOWN: `aria-label` wins the NAME,
    // so `title` is only the accessible DESCRIPTION plus the hover tooltip —
    // and it is the one place a sighted mouse user can still read the R/A/I/D
    // split now that the visible text is a total.
    expect(screen.getByRole("button")).toHaveAttribute("title", "2R · 1A · 0I · 0D");
  });

  // ★★ WCAG 2.4.6, the OTHER criterion. The badge's collision axis is the
  // REFERENCE COUNT, not the task name — two badges with equal counts render
  // byte-identical visible text, so only the row token can tell them apart. `requireCollisionSeed` is OFF because after the
  // fix these two names correctly share nothing once the "(N)" suffix is
  // stripped (the rows are distinctly named); the equal-count seed is asserted
  // directly instead.
  it("keeps two equal-count badges distinct via the row token (WCAG 2.4.6)", () => {
    const { container } = render(
      <>
        <RaidBadge taskId={1} refs={MIXED_REFS} lang="en-US" rowToken="Alpha" onJumpToRaid={vi.fn()} />
        <RaidBadge taskId={2} refs={MIXED_REFS} lang="en-US" rowToken="Beta" onJumpToRaid={vi.fn()} />
      </>,
    );
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    // The collision seed on THIS axis: both badges report the same count, so
    // everything but the row token is byte-identical.
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["3 RAID", "3 RAID"]);
    // ★★ THE SCAN RUNS BEFORE THE EXACT-NAME PIN, DELIBERATELY. A mutant that
    // drops `rowToken` from the name breaks BOTH assertions, and vitest aborts
    // at the first — so with the pin first the uniqueness scan would never
    // execute under the only mutant that can falsify it, and "this assertion
    // bites" would be unproven. Measured: with the pin first, M5 (drop the row
    // token) failed on the pin alone.
    // MEASURED floor, not guessed (set to 999, read the length of the printed
    // `Rendered: [...]` list): two badges, no other controls.
    expectRowUniqueNames({ minControls: 2, scope: container, roles: ["button"] });
    expect(names).toEqual([
      "3 RAID – Referenced by 3 RAID item(s) – Alpha",
      "3 RAID – Referenced by 3 RAID item(s) – Beta",
    ]);
  });

  // The badge lives in the task table's narrow, user-resizable ID column. The
  // visible text is a short count now rather than the four-part glyph string
  // that used to break across four lines, but it still carries a space, so
  // without this it breaks in two and inflates the row.
  it("never wraps", () => {
    render(<RaidBadge taskId={7} refs={MIXED_REFS} lang="en-US" rowToken="Alpha" onJumpToRaid={vi.fn()} />);
    expect(screen.getByRole("button").className).toContain("whitespace-nowrap");
  });
});
