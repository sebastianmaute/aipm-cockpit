import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ToggleButton } from "./toggle-button";
import { t } from "./i18n";

describe("ToggleButton", () => {
  it("exposes aria-pressed tracking the pressed prop and the visible label as its name", () => {
    const { rerender } = render(
      <ToggleButton pressed={false} onToggle={() => {}}>Inline milestones</ToggleButton>,
    );
    const btn = screen.getByRole("button", { name: "Inline milestones" });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    expect(btn).toHaveAttribute("type", "button");
    rerender(<ToggleButton pressed onToggle={() => {}}>Inline milestones</ToggleButton>);
    expect(screen.getByRole("button", { name: "Inline milestones" })).toHaveAttribute("aria-pressed", "true");
  });

  it("fires onToggle on click", () => {
    const onToggle = vi.fn();
    render(<ToggleButton pressed={false} onToggle={onToggle}>X</ToggleButton>);
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("applies the accent tint only when pressed", () => {
    const { rerender } = render(
      <ToggleButton pressed={false} onToggle={() => {}} accent="pink">Critical path</ToggleButton>,
    );
    let btn = screen.getByRole("button");
    expect(btn.className).toContain("border-line");
    expect(btn.className).not.toContain("bg-ui-pink/10");
    rerender(<ToggleButton pressed onToggle={() => {}} accent="pink">Critical path</ToggleButton>);
    btn = screen.getByRole("button");
    expect(btn.className).toContain("bg-ui-pink/10");
    expect(btn.className).toContain("border-[var(--control-state-border-pink)]");
  });

  it("defaults to the dark-blue accent", () => {
    render(<ToggleButton pressed onToggle={() => {}}>On</ToggleButton>);
    expect(screen.getByRole("button").className).toContain("bg-ui-dark-blue/10");
  });

  // ★★ The pressed state must not ride colour ALONE (WCAG 1.4.1). Asserted on
  //    the data attribute rather than a class, so a restyle of the marker does
  //    not fail this while dropping the cue itself would.
  // ★★ MIGRATED, NOT WEAKENED: the space-reserving half of this test's original
  //    title moved behind the `reserveMarkerSpace` opt-out — the marker now
  //    collapses to zero width when off by default. The WCAG 1.4.1 claim above
  //    is untouched and is still what this test is FOR.
  it("marks the pressed state with a non-colour glyph, present in both states, collapsed when off", () => {
    const { container, rerender } = render(
      <ToggleButton pressed onToggle={() => {}}>Compact view</ToggleButton>,
    );
    const marker = () => container.querySelector("[data-pressed-marker]") as SVGElement;
    expect(marker()).toHaveAttribute("data-pressed-marker", "on");
    expect(marker().getAttribute("class") ?? "").not.toContain("invisible");
    expect(marker().getAttribute("class") ?? "").toContain("w-3.5");
    expect(marker().getAttribute("class") ?? "").not.toContain("-ml-1.5");

    rerender(<ToggleButton pressed={false} onToggle={() => {}}>Compact view</ToggleButton>);
    // Still in the DOM when off, and that is the load-bearing assertion here:
    // it is the non-colour cue, and five other test files query this attribute.
    // Only its WIDTH is conditional now — zero plus a negative margin that
    // cancels the button's gap, so it occupies no horizontal space.
    expect(marker()).toHaveAttribute("data-pressed-marker", "off");
    expect(marker().getAttribute("class") ?? "").toContain("w-0");
    expect(marker().getAttribute("class") ?? "").toContain("-ml-1.5");
    expect(marker().getAttribute("class") ?? "").not.toContain("invisible");
  });

  // ★ There was a second test here asserting the marker stays out of the
  //   accessible name. It was DELETED as vacuous, and the reason is worth
  //   keeping: `CheckIcon` renders a bare `<path>`, so it can contribute
  //   nothing to name-from-content in any state, and this component always
  //   passes an explicit `aria-hidden`, which lucide takes as the SOLE
  //   source of that attribute (it only adds its own default when no a11y
  //   prop is passed at all). No single-change mutation could fail it.
  //   Don't re-add that shape.
  // ★ `disabled` was declared long before anything passed it. It must stay a real
  //   disabled <button> — clicking must not reach onToggle.
  it("does not fire onToggle while disabled", () => {
    const onToggle = vi.fn();
    render(<ToggleButton pressed={false} onToggle={onToggle} disabled>Auto</ToggleButton>);
    const btn = screen.getByRole("button", { name: "Auto" });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onToggle).not.toHaveBeenCalled();
    // ★★ And it must LOOK inoperable. The whole point of the disabled styling is
    //    that this component accepted `disabled` for its entire life while
    //    rendering pixel-identically to a live toggle; without this assertion,
    //    deleting those two classes restores that exact defect with a green suite.
    expect(btn.className).toContain("disabled:opacity-60");
    expect(btn.className).toContain("disabled:cursor-not-allowed");
  });

  // ★★ The suffix ends "click to turn on". On a disabled control that is an
  //    instruction it cannot honour, and it reaches AT as the accessible
  //    description, so browse mode announced "unavailable … click to turn on".
  it("drops the on/off tooltip suffix while disabled, keeping the base title", () => {
    const { rerender } = render(
      <ToggleButton pressed={false} onToggle={() => {}} lang="en-US" title="Base" disabled>
        Auto
      </ToggleButton>,
    );
    expect(screen.getByRole("button", { name: "Auto" })).toHaveAttribute("title", "Base");

    rerender(
      <ToggleButton pressed={false} onToggle={() => {}} lang="en-US" title="Base">Auto</ToggleButton>,
    );
    const enabled = screen.getByRole("button", { name: "Auto" }).getAttribute("title") ?? "";
    expect(enabled).toContain("Base");
    expect(enabled).toContain(t("en-US", "toggleStateOff"));
  });

  // ★★ Disclosure vs toggle semantics (WAI-ARIA Disclosure pattern). The
  //    default MUST stay the stateful toggle so every pre-existing consumer is
  //    byte-identical — this is the guard against that regressing silently.
  it("defaults to variant=toggle: emits aria-pressed and no aria-expanded/aria-controls", () => {
    render(
      <ToggleButton pressed onToggle={() => {}} ariaLabel="Row">Row</ToggleButton>,
    );
    const btn = screen.getByRole("button", { name: "Row" });
    expect(btn).toHaveAttribute("aria-pressed", "true");
    expect(btn).not.toHaveAttribute("aria-expanded");
    expect(btn).not.toHaveAttribute("aria-controls");
  });

  it("variant=disclosure emits aria-expanded + aria-controls and never aria-pressed", () => {
    render(
      <ToggleButton
        pressed
        onToggle={() => {}}
        ariaLabel="Row"
        variant="disclosure"
        ariaControls="panel-1"
      >
        Row
      </ToggleButton>,
    );
    const btn = screen.getByRole("button", { name: "Row" });
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(btn).toHaveAttribute("aria-controls", "panel-1");
    expect(btn).not.toHaveAttribute("aria-pressed");
  });

  it("suppresses the on/off tooltip suffix for variant=disclosure", () => {
    render(
      <ToggleButton
        pressed={false}
        onToggle={() => {}}
        lang="en-US"
        title="Base"
        variant="disclosure"
        ariaControls="panel-1"
      >
        Row
      </ToggleButton>,
    );
    expect(screen.getByRole("button", { name: "Row" })).toHaveAttribute("title", "Base");
  });

  // ★★ `preventFocusSteal` exists for toggles that act on ANOTHER element's
  //    selection (the rich-text toolbar). It must stay OPT-IN: focus-on-click is
  //    the native button behaviour every other consumer relies on, so the
  //    default case is asserted here too — dropping the flag check and always
  //    preventing would pass the first assertion alone.
  it("only suppresses the mousedown default when preventFocusSteal is set", () => {
    const fire = (btn: HTMLElement) => {
      const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      btn.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    const { rerender } = render(
      <ToggleButton pressed={false} onToggle={() => {}} preventFocusSteal>Bold</ToggleButton>,
    );
    expect(fire(screen.getByRole("button", { name: "Bold" }))).toBe(true);

    rerender(<ToggleButton pressed={false} onToggle={() => {}}>Bold</ToggleButton>);
    expect(fire(screen.getByRole("button", { name: "Bold" }))).toBe(false);
  });

  // ★★★ `pressHandlers` HAD ZERO COVERAGE ANYWHERE. Every test that renders a
  //    mic mocks the bag away as `buttonHandlers: {}`, so deleting the spread
  //    from this component typechecked and left the whole unit suite green
  //    while push-to-talk dictation was dead on every surface — the consumer
  //    passes a deliberate no-op `onToggle`, so there is no click fallback to
  //    mask it. This is the mutant-killer for the PRIMITIVE half; the CONSUMER
  //    half (deleting `pressHandlers={ptt.buttonHandlers}`) is only reachable
  //    from dictation-mic.test.tsx and is pinned there.
  it("binds every member of the pressHandlers bag", () => {
    const handlers = {
      onPointerDown: vi.fn(),
      onPointerUp: vi.fn(),
      onPointerLeave: vi.fn(),
      onPointerCancel: vi.fn(),
      onKeyDown: vi.fn(),
      onKeyUp: vi.fn(),
    };
    render(
      <ToggleButton pressed={false} onToggle={() => {}} pressHandlers={handlers}>Hold</ToggleButton>,
    );
    const btn = screen.getByRole("button", { name: "Hold" });
    fireEvent.pointerDown(btn);
    fireEvent.pointerUp(btn);
    fireEvent.pointerLeave(btn);
    fireEvent.pointerCancel(btn);
    fireEvent.keyDown(btn, { key: " " });
    fireEvent.keyUp(btn, { key: " " });
    for (const [name, spy] of Object.entries(handlers)) {
      expect(spy, name).toHaveBeenCalledTimes(1);
    }
  });

  // ★★★ `type` IS THE ONE ATTRIBUTE THE SPREAD COULD STEAL. It used to be
  //    written BEFORE `{...pressHandlers}`, and JSX is later-wins. The `Pick<>`
  //    does not close it: TypeScript's excess-property check applies only to
  //    FRESH OBJECT LITERALS, so the bag below — a plain `const`, deliberately
  //    passed with NO cast, which is the whole point — is assignable and would
  //    have made this toggle submit its enclosing form.
  it("keeps type=button even when the pressHandlers bag carries a type", () => {
    const leakyBag = { onPointerDown: () => {}, type: "submit" };
    render(
      <ToggleButton pressed={false} onToggle={() => {}} pressHandlers={leakyBag}>Hold</ToggleButton>,
    );
    expect(screen.getByRole("button", { name: "Hold" })).toHaveAttribute("type", "button");
  });

  it("renders a leading icon and an override aria-label", () => {
    render(
      <ToggleButton pressed={false} onToggle={() => {}} ariaLabel="Detailed planning" icon={<svg data-testid="ic" aria-hidden />}>
        Detailed
      </ToggleButton>,
    );
    expect(screen.getByTestId("ic")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Detailed planning" })).toBeInTheDocument();
  });

  // SC 1.4.11 — the pressed border must be the DERIVED token, which
  // scheme-apply sets per active scheme AND mode. A raw accent measured
  // 1.03-1.22:1 against the unpressed --line in the three dark schemes.
  // ★ The absence assertions are the load-bearing half: they are what a
  //   reinstated `dark:border-ui-*` variant would trip, and such a variant
  //   would re-pin the raw accent in exactly the schemes that fail.
  it("the pressed border rides the derived state token, not a raw accent", () => {
    const { rerender } = render(
      <ToggleButton pressed onToggle={() => {}}>Inline milestones</ToggleButton>,
    );
    const btn = screen.getByRole("button", { name: "Inline milestones" });
    expect(btn.className).toContain("border-[var(--control-state-border)]");
    expect(btn.className).not.toContain("border-ui-dark-blue");

    rerender(
      <ToggleButton pressed onToggle={() => {}} accent="pink">Inline milestones</ToggleButton>,
    );
    expect(btn.className).toContain("border-[var(--control-state-border-pink)]");
    // ★★ NO TRAILING SPACE. It bought nothing (the derived token does not
    //    contain `border-ui-pink` either way) and made the assertion evadable:
    //    appending ` dark:border-ui-pink` to the END of PRESSED.pink leaves the
    //    class string ending there with no trailing space, so the padded form
    //    stayed GREEN while the raw accent was re-pinned in exactly the dark
    //    schemes this slice fixed.
    expect(btn.className).not.toContain("border-ui-pink");
  });

  // ★★★ THE TWO MATCHERS ARE NOT INTERCHANGEABLE, AND WHICH ONE IS RIGHT
  //    DEPENDS ON WHETHER YOU ARE ASSERTING PRESENCE OR ABSENCE:
  //    · `classList.contains` is EXACT-TOKEN — right for asserting PRESENCE of
  //      one exact class, WRONG for asserting absence of a class FAMILY,
  //      because `dark:border-ui-green` is a different token entirely and the
  //      check passes no matter what.
  //    · `toContain` is a SUBSTRING match — right for asserting ABSENCE of a
  //      family (it catches every variant-prefixed member), wrong for presence
  //      (a longer class merely containing the needle satisfies it).
  //    So the two PRESENCE assertions below stay on classList and the ABSENCE
  //    one is `not.toContain`. This test had classList for all three, which made
  //    its absence half FALSE BY CONSTRUCTION: appending ` dark:border-ui-green`
  //    to PRESSED.green — the exact regression it exists to catch — left it
  //    green. Verified safe first: no other class in the green pressed list
  //    (`border-[var(--control-state-border-green)]`, `bg-ui-green/10`,
  //    `hover:bg-ui-green/20`, `focus:ring-ui-green`, `dark:bg-ui-green/20`)
  //    contains `border-ui-green` as a substring, so this cannot be falsely red.
  //    ★ The `focus:ring-2` / `ring-2` trap that pushed the RACI picker and the
  //    mic onto classList is about PRESENCE — it is not an argument for using
  //    classList on an absence check.
  // ★★ Green is the accent where the derivation is NOT a no-op — raw
  //    --ui-green misses 3:1 against --line in all four LIGHT combos — so
  //    regressing this one class to the raw accent is a real contrast defect,
  //    not the theoretical guard the pink case is.
  it("the green accent rides the derived state token, not the raw accent", () => {
    render(
      <ToggleButton pressed onToggle={() => {}} accent="green">Hold to dictate</ToggleButton>,
    );
    const btn = screen.getByRole("button", { name: "Hold to dictate" });
    expect(btn.classList.contains("border-[var(--control-state-border-green)]")).toBe(true);
    expect(btn.className).not.toContain("border-ui-green");
    expect(btn.classList.contains("bg-ui-green/10")).toBe(true);
  });

  // ★★ BOTH branches are pinned deliberately. `size` defaults to "chip", and a
  //    default that silently drifted to the card geometry would move every
  //    toolbar toggle in the app while a card-only assertion stayed green.
  it("defaults to the chip geometry", () => {
    render(<ToggleButton pressed={false} onToggle={() => {}}>Chip</ToggleButton>);
    const cls = screen.getByRole("button", { name: "Chip" }).className;
    expect(cls).toContain("px-2.5");
    expect(cls).toContain("py-1.5");
    expect(cls).toContain("text-xs");
    expect(cls).toContain("items-center");
  });

  it("size=card renders the roomier full-width option-card geometry", () => {
    render(
      <ToggleButton pressed={false} onToggle={() => {}} size="card">Card</ToggleButton>,
    );
    const cls = screen.getByRole("button", { name: "Card" }).className;
    expect(cls).toContain("px-3");
    expect(cls).toContain("py-2");
    expect(cls).toContain("text-sm");
    expect(cls).toContain("items-start");
    expect(cls).not.toContain("px-2.5");
    expect(cls).not.toContain("text-xs");
    expect(cls).not.toContain("items-center");
  });

  // ★★ The card variant exists so a call site never reaches INTO the primitive.
  //    The wizard used to carry `[&>span]:w-full` to stretch this wrapper; if
  //    the primitive stops doing it, that hack comes back.
  it("size=card makes the children wrapper full-width, the default does not", () => {
    const { container, rerender } = render(
      <ToggleButton pressed={false} onToggle={() => {}} size="card">Card</ToggleButton>,
    );
    const wrapper = () => container.querySelector("button > span") as HTMLElement;
    expect(wrapper().className).toContain("w-full");

    rerender(<ToggleButton pressed={false} onToggle={() => {}}>Card</ToggleButton>);
    expect(wrapper().className).not.toContain("w-full");
  });

  // ★★★ THE MARKER'S WIDTH IS NOW CONDITIONAL, REVERSING THIS PRIMITIVE'S OLD
  //    GUARANTEE. It used to be `w-3.5 invisible` in BOTH states so the button
  //    kept ONE width; it now collapses to zero width when off and animates
  //    open. The animation answers the original objection only in part — the
  //    marker is the LAST child, rendered after the optional icon and after the
  //    label span, so it TRAILS both. That trailing position IS the reason only
  //    rightward neighbours move: the growth is at the right edge, leaving the
  //    label and the left edge fixed, so the control under the pointer stays
  //    put. A LEADING marker would have pushed the label rightward under the
  //    cursor — the bad case. Which is why the opt-out below exists.
  // ★★★ AND WHY IT IS NOT OPTIONAL FOR A MUTUALLY-EXCLUSIVE GROUP: the
  //    rightward-only argument holds for an INDEPENDENT toggle only. In a
  //    one-of-N group one click collapses the old selection and expands the new
  //    one, so everything after the old selection shifts LEFTWARD, the clicked
  //    chip included — the exact failure that argument claims to rule out. The
  //    one-of-N consumers therefore pass `reserveMarkerSpace`; their own test
  //    files pin it, since NOTHING IN THIS FILE CAN SEE A CONSUMER'S PROP —
  //    every test here renders the primitive directly, so a consumer losing its
  //    opt-out is invisible to a green run of this file, in either direction.
  // ★★ One-of-N is not the only reason to opt out (clamped resizable table
  //    cells and a right-anchored row are the others on this branch), so do not
  //    strip a consumer's opt-out on the grounds that it is not a group — the
  //    `toggle-button.tsx` comment enumerates which is which.
  // ★ The element stays RENDERED in both states for two independent reasons:
  //    the `data-pressed-marker` queries above (and in five other test files),
  //    and the WCAG 1.4.1 non-colour cue. Neither survives conditional
  //    rendering, so no "simplification" may drop it.
  it("collapses the pressed marker to zero width when off, by default", () => {
    const { container } = render(
      <ToggleButton pressed={false} onToggle={() => {}}>Grid</ToggleButton>,
    );
    const marker = container.querySelector("[data-pressed-marker='off']");
    expect(marker).not.toBeNull();
    // Zero width plus a negative margin that cancels the button's own gap-1.5,
    // so an off marker occupies no horizontal space at all.
    expect(marker?.getAttribute("class")).toContain("w-0");
    expect(marker?.getAttribute("class")).toContain("-ml-1.5");
    // `invisible` would hide the glyph outright and there would be nothing to
    // animate; the zero width clips it instead (an <svg> root hides overflow).
    expect(marker?.getAttribute("class")).not.toContain("invisible");
  });

  it("expands the pressed marker when on", () => {
    const { container } = render(
      <ToggleButton pressed onToggle={() => {}}>Grid</ToggleButton>,
    );
    const marker = container.querySelector("[data-pressed-marker='on']");
    expect(marker?.getAttribute("class")).toContain("w-3.5");
    expect(marker?.getAttribute("class")).not.toContain("-ml-1.5");
  });

  // ★★ The opt-out restores the OLD behaviour in BOTH states, so both are
  //    asserted: a version that only stopped collapsing the off marker (and
  //    left the glyph visible) would pass an on-state-only check.
  it("reserveMarkerSpace restores the constant-width behaviour in both states", () => {
    const { container, rerender } = render(
      <ToggleButton pressed={false} reserveMarkerSpace onToggle={() => {}}>Grid</ToggleButton>,
    );
    const off = container.querySelector("[data-pressed-marker='off']");
    expect(off?.getAttribute("class")).toContain("w-3.5");
    expect(off?.getAttribute("class")).toContain("invisible");
    expect(off?.getAttribute("class")).not.toContain("w-0");

    rerender(
      <ToggleButton pressed reserveMarkerSpace onToggle={() => {}}>Grid</ToggleButton>,
    );
    const on = container.querySelector("[data-pressed-marker='on']");
    expect(on?.getAttribute("class")).toContain("w-3.5");
    expect(on?.getAttribute("class")).not.toContain("invisible");
  });

  it("suppresses the transition under prefers-reduced-motion", () => {
    const { container } = render(
      <ToggleButton pressed={false} onToggle={() => {}}>Grid</ToggleButton>,
    );
    const marker = container.querySelector("[data-pressed-marker='off']");
    // Presence, not motion, is the WCAG 1.4.1 cue -- so snapping is correct and
    // loses nothing when the user has asked for less motion.
    expect(marker?.getAttribute("class")).toContain("motion-reduce:transition-none");
  });
});
