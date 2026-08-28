import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RaidBadge } from "./task-raid-badge";
import { expectRowUniqueNames } from "../test/row-unique-names";
import type { RaidItem } from "./types";

const raidFix = (category: RaidItem["category"], id = 1): RaidItem =>
  ({ id, category, title: `RAID ${id}` }) as RaidItem;

// 2 R + 1 A, so the visible glyph string is "2R · 1A · 0I · 0D" and the count
// in the name is 3 — two DIFFERENT strings, which is the whole point of the
// containment check below.
const MIXED_REFS: RaidItem[] = [raidFix("R", 1), raidFix("R", 2), raidFix("A", 3)];

describe("RaidBadge", () => {
  // ★★★ WCAG 2.5.3 (label in name), and it is NOT the same criterion as the
  // 2.4.6 uniqueness test below. The badge's VISIBLE content is the compact
  // per-category glyph string (`raidReferencedByMix`), while its accessible
  // name was built from `raidReferencedBy` (a total count) plus the row token —
  // so a speech-input user reading "2R" off the screen had no way to address
  // this control, and a screen-reader user heard a name sharing no words with
  // what is on screen.
  //
  // ★★ NO GATE CAN CATCH THIS. axe ships `label-content-name-mismatch` and it
  // DOES carry `wcag21a`, one of the four tags `e2e/a11y.spec.ts` requests —
  // but it is ALSO tagged `experimental`, and axe's default `tagExclude` is
  // `experimental,deprecated`, so a tag-only run never executes it. Verify:
  //   node -e "const a=require('axe-core');const r=a.getRules().find(x=>x.ruleId==='label-content-name-mismatch');console.log(a._audit.tagExclude.join(','),'::',r.tags.join(','))"
  // This test is therefore the only detector that can exist for this control.
  //
  // ★★ CONTAINMENT, NOT PREFIX. 2.5.3 asks that the accessible name CONTAIN
  // the visible text, case-INSENSITIVELY and position-INDEPENDENTLY (axe's own
  // implementation ends in `includes`). Asserting a prefix would be STRICTER
  // than the SC and would flag conformant code elsewhere in this app.
  it("contains its visible glyph string inside its accessible name (WCAG 2.5.3)", () => {
    render(<RaidBadge taskId={7} refs={MIXED_REFS} lang="en-US" rowToken="Alpha" onJumpToRaid={vi.fn()} />);
    const btn = screen.getByRole("button");
    const visible = btn.textContent!.trim();
    // Guard against a vacuous pass: an empty visible string is contained in
    // every name, so assert the fixture actually rendered the glyph string.
    expect(visible).toBe("2R · 1A · 0I · 0D");
    expect(btn.getAttribute("aria-label")!.toLowerCase()).toContain(visible.toLowerCase());
  });

  it("keeps the count and the row token in the name after the visible text", () => {
    render(<RaidBadge taskId={7} refs={MIXED_REFS} lang="en-US" rowToken="Alpha" onJumpToRaid={vi.fn()} />);
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "2R · 1A · 0I · 0D – Referenced by 3 RAID item(s) – Alpha",
    );
    // ★ `title` deliberately stays the bare count: `aria-label` wins the NAME,
    // so `title` is only the accessible DESCRIPTION plus the hover tooltip.
    expect(screen.getByRole("button")).toHaveAttribute("title", "Referenced by 3 RAID item(s)");
  });

  // ★★ WCAG 2.4.6, the OTHER criterion. The badge's collision axis is the
  // REFERENCE COUNT, not the task name — two badges with equal counts and
  // equal category mixes render byte-identical visible text, so only the row
  // token can tell them apart. `requireCollisionSeed` is OFF because after the
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
    // The collision seed on THIS axis: both badges report the same count and
    // the same mix, so everything but the row token is byte-identical.
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "2R · 1A · 0I · 0D",
      "2R · 1A · 0I · 0D",
    ]);
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
      "2R · 1A · 0I · 0D – Referenced by 3 RAID item(s) – Alpha",
      "2R · 1A · 0I · 0D – Referenced by 3 RAID item(s) – Beta",
    ]);
  });
});
