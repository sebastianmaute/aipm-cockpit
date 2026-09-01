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
  it("marks the pressed state with a non-colour glyph, hidden but space-reserving when off", () => {
    const { container, rerender } = render(
      <ToggleButton pressed onToggle={() => {}}>Compact view</ToggleButton>,
    );
    const marker = () => container.querySelector("[data-pressed-marker]") as SVGElement;
    expect(marker()).toHaveAttribute("data-pressed-marker", "on");
    expect(marker().getAttribute("class") ?? "").not.toContain("invisible");

    rerender(<ToggleButton pressed={false} onToggle={() => {}}>Compact view</ToggleButton>);
    // Still in the DOM — removing it would change the button's width on every
    // click and shift the neighbouring toolbar controls under the pointer.
    expect(marker()).toHaveAttribute("data-pressed-marker", "off");
    expect(marker().getAttribute("class") ?? "").toContain("invisible");
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
    expect(btn.className).not.toContain("border-ui-pink ");
  });

  // The third accent. Asserted on classList rather than the className STRING:
  // a substring match cannot distinguish `border-ui-green` from a longer class
  // that merely contains it, and the absence half is the load-bearing one here
  // exactly as it is above.
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
    expect(btn.classList.contains("border-ui-green")).toBe(false);
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
});
