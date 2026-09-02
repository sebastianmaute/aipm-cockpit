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
  // ★★★ THE CLASS AND PARENT ASSERTIONS ARE NOT THE PIN AND MUST NOT BE READ AS
  // ONE. The hand-rolled span already carried `rounded-md border-line
  // bg-surface` and was already portaled to `document.body`, so all four of them
  // PASS against the unfixed code — kept only to prove we are looking at the
  // panel and not at some other `.fixed` span. The STYLE PAIR is the whole pin:
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
});
