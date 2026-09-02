import { describe, expect, it, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { RaciChipPicker } from "./raci-chip-picker";

// Collapsed trigger: aria-expanded + aria-haspopup. Each expanded role chip's
// accessible name is just the role letter ("R"/"A"/"C"/"I"); the clear chip's
// accessible name matches /clear/i.
describe("RaciChipPicker", () => {
  it("collapsed shows only the trigger; clicking expands to all roles + clear", () => {
    render(<RaciChipPicker value="A" onChange={() => {}} ariaPrefix="x" lang="en-US" />);
    // collapsed: a role chip C is not yet shown
    expect(screen.queryByRole("button", { name: "C" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByRole("button", { name: "C" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /clear/i })).toBeTruthy();
  });

  it("picking a role fires onChange and collapses", () => {
    const onChange = vi.fn();
    render(<RaciChipPicker value="" onChange={onChange} ariaPrefix="x" lang="en-US" />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getByRole("button", { name: "C" }));
    expect(onChange).toHaveBeenCalledWith("C");
    expect(screen.queryByRole("button", { name: "R" })).toBeNull(); // collapsed again
  });

  it("clear fires onChange('') and collapses", () => {
    const onChange = vi.fn();
    render(<RaciChipPicker value="R" onChange={onChange} ariaPrefix="x" lang="en-US" />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  // ★★ SC 1.4.1: the selected chip is marked by a RING (a shape cue), not by
  // the brand fill alone — R measures 1.10-1.31:1 and I 2.70-2.84:1 against
  // --surface in the three dark schemes. Pinned in BOTH states: an on-state-only
  // assertion passes against a regression that rings every chip.
  // ★★★ ASSERT ON `classList` TOKENS, NEVER `className.toContain`. `CHIP_BASE`
  // carries `focus:ring-2`, and the string "focus:ring-2" CONTAINS "ring-2" —
  // so a substring assertion makes the negative half vacuously false for every
  // chip, and the positive half true even with the ring deleted.
  it("rings only the selected role chip, and the ring moves with the value", () => {
    const { rerender } = render(<RaciChipPicker value="R" onChange={() => {}} ariaPrefix="x" lang="en-US" />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const chip = (role: string) => screen.getByRole("button", { name: role });

    // ★★ `focus:ring-[var(--foreground)]` is in this list for a reason, not for
    // symmetry: CHIP_BASE carries `focus:ring-ui-green`, which sets the same
    // `--tw-ring-color` from a HIGHER-specificity selector, so without the
    // restatement the selected chip's neutral ring turned green for exactly as
    // long as it had focus — the whole time a keyboard user arrows through the
    // roles. jsdom has no cascade, so this pins presence only.
    for (const cls of [
      "ring-2",
      "ring-[var(--foreground)]",
      "focus:ring-[var(--foreground)]",
      "ring-offset-2",
      "ring-offset-[var(--surface)]",
    ]) {
      expect(chip("R").classList.contains(cls)).toBe(true);
    }
    for (const role of ["A", "C", "I"]) {
      expect(chip(role).classList.contains("ring-2")).toBe(false);
      expect(chip(role).classList.contains("focus:ring-[var(--foreground)]")).toBe(false);
    }

    // the ring MOVES — it is not merely present on a hardcoded chip
    rerender(<RaciChipPicker value="A" onChange={() => {}} ariaPrefix="x" lang="en-US" />);
    expect(chip("A").classList.contains("ring-2")).toBe(true);
    expect(chip("R").classList.contains("ring-2")).toBe(false);

    // ★ The 20px circle stays. A ToggleButton migration that would have turned
    // these into stadium pills was reverted by user decision; this pins the
    // geometry so it cannot creep back in.
    for (const role of ["R", "A", "C", "I"]) {
      for (const cls of ["h-5", "w-5", "rounded-full"]) {
        expect(chip(role).classList.contains(cls)).toBe(true);
      }
    }
  });

  // ★★★ §334. The popover is the shared `PopoverPanel`, never a hand-rolled
  // portal again. The hand-rolled one placed itself by an inline `left` taken
  // from the trigger's rect with NO viewport clamp of any kind: MEASURED in
  // Chromium it overflowed the RIGHT edge at every width sampled from 1280px
  // down to 520px — by ~9px at 1280 (an ordinary desktop, not an edge case) and
  // by ~76px at 520.
  //
  // ★★★ THE CLASS AND PARENT ASSERTIONS ARE NOT THE PIN FOR THE ADOPTION and
  // must not be read as one: the hand-rolled span already carried `rounded-md
  // border-line bg-surface` and was already portaled to `document.body`, so all
  // four PASS against the unfixed code. ★★ They are NOT decorative either, and
  // an earlier revision here dismissed them as "kept only to prove we are
  // looking at the panel". Those three classes are no longer in this file's own
  // `className` — the primitive supplies them — so they now pin its base
  // styling FROM THE CONSUMER SIDE and would catch it dropping one. Two
  // different jobs, both worth keeping. The STYLE PAIR is the adoption pin:
  // the hand-rolled panel set an inline `left` and no `right`, while
  // `PopoverPanel`'s `bottom-end` placement drives `right` (+ the post-paint
  // clamp that pulls the left edge back inside `VIEWPORT_MARGIN`) and never
  // writes `left`. Delete those two lines and this test is vacuous.
  it("renders its popover through PopoverPanel, not a hand-rolled portal", () => {
    render(<RaciChipPicker value="A" onChange={() => {}} ariaPrefix="x" lang="en-US" />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const panel = screen.getByRole("button", { name: "C" }).closest("span.fixed") as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.className).toContain("rounded-md");
    expect(panel.className).toContain("border-line");
    expect(panel.className).toContain("bg-surface");
    expect(panel.parentElement).toBe(document.body);
    // the pin: right-aligned by the primitive, never left-positioned by hand
    expect(panel.style.right).not.toBe("");
    expect(panel.style.left).toBe("");
  });

  // ★★★ §334, the keyboard half — and read the measurement, not the intuition
  // that preceded it. The hand-rolled portal did NOT "let Tab walk out into the
  // matrix": `createPortal` appends the panel as the LAST CHILD of `<body>`, so
  // tab order was divorced from visual position and Tab never walked IN either.
  // MEASURED in Chromium: focus stayed on the trigger after the click, the next
  // Tab went to the NEXT MATRIX ROW's trigger, and over a 40-press trace the
  // first press landing inside the popover was the 16th — after all 21 matrix
  // triggers had been walked. The five chips were effectively unreachable by the
  // forward Tab path.
  //
  // ★★ `autoFocus` is deliberately left at the primitive's DEFAULT (true).
  // `PopoverPanel` registers `kind: "modal"` and traps Tab, and that trap's
  // `!panel.contains(active)` branch fires for the ANCHOR too — so with
  // `autoFocus={false}` the trigger would sit outside the trapped region while
  // every Tab AND Shift+Tab yanked focus into it, leaving no way back. Starting
  // inside is the coherent state. Focusing a chip does not SELECT it: these are
  // `aria-pressed` toggles, and the primitive's documented exception to the
  // default is a destructive first control, which "R" is not.
  it("moves focus into the popover on open, instead of leaving it on the trigger", () => {
    render(<RaciChipPicker value="A" onChange={() => {}} ariaPrefix="x" lang="en-US" />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "R" }));
  });

  // ★★★ §334. RACI is NOT in `A11Y_VIEWS`, so no axe run will ever reach this
  // surface — and the three tests below are the only coverage the popover's
  // keyboard and naming contract will ever have. Do not delete one as redundant
  // with the primitive's own suite: `popover-panel.test.tsx` pins that the
  // PRIMITIVE behaves, never that this consumer is wired to it.
  //
  // ★★★ JSDOM CANNOT MOVE FOCUS ON Tab — it implements no sequential
  // navigation — so this test pins the two EDGE wraps and the pull-in, which is
  // all the trap actually executes. The interior steps are browser-native and
  // unreachable from here; asserting them would mean asserting on my own
  // `.focus()` calls, which proves nothing. A Chromium probe measured the full
  // cycle on this code (R->A->C->I->Clear->R for 40 presses without escaping);
  // if this test ever contradicts that, this test is wrong.
  it("wraps Tab at both edges so focus cannot leave the five chips", () => {
    render(<RaciChipPicker value="A" onChange={() => {}} ariaPrefix="x" lang="en-US" />);
    const trigger = screen.getByRole("button", { expanded: false });
    fireEvent.click(trigger);
    const first = screen.getByRole("button", { name: "R" });
    const last = screen.getByRole("button", { name: /clear/i });

    // forward Tab off the LAST chip wraps to the first, rather than escaping
    // into the matrix row behind the portal
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    // Shift+Tab off the FIRST chip wraps backwards to the last
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    // and a Tab arriving from OUTSIDE the panel is pulled in. This is the arm
    // that makes the chips reachable at all: the trigger is the ANCHOR, which
    // lives outside the portaled panel, so `panel.contains(active)` is false
    // for it and the trap's escape branch fires.
    trigger.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  // ★★★ §334. `ariaLabel` WITHOUT `role` is inert, and that is why this test
  // asserts the role and the name together rather than either alone. A bare
  // `<span>` maps to `role=generic`, and ARIA 1.2 prohibits naming a generic —
  // so the milestone-and-stakeholder context was computed, passed down, and
  // then dropped by AT. ★★ Nothing in CI could report it: axe's
  // `aria-prohibited-attr` puts a role-less span in `incomplete`, the a11y spec
  // filters `violations`, and RACI is not in `A11Y_VIEWS` anyway.
  // ★ `dialog` is the honest role, not a decoration to satisfy the rule: the
  // panel registers as a modal on the dismissal stack and really does trap Tab.
  // ★★ THE `aria-haspopup` ASSERTION IS NOT DECORATION EITHER, and it is the one
  // thing here no other test covers. The trigger shipped `aria-haspopup="true"`,
  // which ARIA defines as equivalent to `"menu"` — so it CONTRADICTED the panel
  // role this same test asserts, and this test passed either way. A mismatch is
  // invisible to every gate: axe has no rule comparing a trigger's haspopup
  // against the popup's actual role, and RACI is not in `A11Y_VIEWS`.
  // ★★ The NAME asserted below is the coordinates PLUS the purpose. `ariaPrefix`
  // alone only repeated what the trigger had just announced; asserting the full
  // string is what makes a silent revert to the bare prefix go red.
  it("points the trigger's aria-controls at the panel, which is a NAMED dialog", () => {
    render(<RaciChipPicker value="A" onChange={() => {}} ariaPrefix="M1 · Ada" lang="en-US" />);
    const trigger = screen.getByRole("button", { expanded: false });
    // closed: nothing to point at, so the attribute must be absent rather than
    // dangling at an id that is not in the document
    expect(trigger.getAttribute("aria-controls")).toBeNull();
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");

    fireEvent.click(trigger);
    const panel = screen.getByRole("dialog", { name: "M1 · Ada — Set RACI" });
    expect(panel.id).not.toBe("");
    expect(trigger.getAttribute("aria-controls")).toBe(panel.id);
  });

  // ★★★ §334. The Escape contract CHANGED with the adoption and had no test at
  // all before this one: the hand-rolled popover registered `kind: "layer"` and
  // dismissed with a bare `setOpen(false)`, leaving focus on `document.body` —
  // from which the next Tab restarts at the TOP of the document rather than
  // resuming at the chip the user opened. The primitive registers
  // `kind: "modal"` and restores focus to the anchor BEFORE closing, so there
  // is never a frame in which `activeElement` is `body`.
  // ★★ DO NOT restate the cost as the matrix being "arrow-dead" — that phrase
  // belongs to `popover-panel.tsx`'s own restore comment, where it is TRUE of
  // the rich-text toolbar's roving tabindex. It is FALSE here: the RACI matrix
  // has no arrow navigation and no roving tabindex at all. Reproduce —
  // `grep -n "Arrow\|role=\"grid\"\|tabIndex\|onKeyDown" src/app/raci-panel.tsx`
  // returns ONE hit, an Enter handler on the filter combobox input.
  //
  // ★★★ THIS TEST SURVIVES EITHER RESTORE MECHANISM BEING DELETED ALONE, AND
  // THAT IS NOT VACUITY — do not "fix" it by narrowing the assertion. MEASURED
  // by mutation: disabling `closeRestoringFocus`'s anchor focus leaves 9
  // passed, disabling the §297 unmount guard's `focusAnchor()` leaves 9 passed,
  // and disabling BOTH gives 1 failed / 8 passed. The primitive genuinely
  // restores twice over on this path — its own comment says the two "compose
  // and cannot double-fire", the first moving focus outside the panel so the
  // second's recorded containment answer reads false. What this pins is the
  // OBSERVABLE contract a user has (focus ends on the trigger, never `body`),
  // which is exactly what should survive one of two redundant mechanisms being
  // refactored away. A single-mutant survival here is a report about the
  // PRIMITIVE's redundancy, not evidence this test is asleep.
  it("closes on Escape and restores focus to the trigger", () => {
    render(<RaciChipPicker value="A" onChange={() => {}} ariaPrefix="x" lang="en-US" />);
    const trigger = screen.getByRole("button", { expanded: false });
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "R" }));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "C" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
