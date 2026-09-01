import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { TourOverlay } from "./tour-overlay";
import { TOUR_STEPS } from "./app-tour";
import { resetDismissalStack } from "./dismissal-stack";
import { t } from "./i18n";

const handlers = () => ({ onBack: vi.fn(), onNext: vi.fn(), onSkip: vi.fn(), onDone: vi.fn(), onShowMe: vi.fn() });

/** The overlay now joins the dismissal stack (via `useFocusTrap`), and the
 *  stack is MODULE state shared across every test in the run. A leaked entry
 *  from an earlier test would sit above this one's token and make
 *  `isTopmostOfKind` decline, silently disarming the Tab assertions below. */
beforeEach(() => resetDismissalStack());

/** Dispatch Tab from whatever currently HOLDS focus — never from a
 *  hand-focused control. The state under test is the one the overlay puts
 *  itself in on open (the `tabIndex={-1}` card focused for AT), and focusing a
 *  button first would replace it with a state the trap already handled. */
function pressTab(shiftKey = false): KeyboardEvent {
  const from = document.activeElement as HTMLElement;
  const e = new KeyboardEvent("keydown", {
    key: "Tab",
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    from.dispatchEvent(e);
  });
  return e;
}

/** Step 5 ("dashboard") is the widest card: it carries a `view` and sits past
 *  index 0, so it renders all FOUR controls — Skip · Show me · Back · Next, in
 *  that DOM order. `first` (Skip) and `last` (Next) are therefore distinct
 *  buttons with two others between them, so neither wrap assertion below can
 *  pass by the two edges collapsing onto one control. */
const WIDE_STEP = 5;

describe("TourOverlay", () => {
  it("renders the current modal step title/body + dialog", () => {
    render(<TourOverlay lang="en-US" steps={TOUR_STEPS} index={0} {...handlers()} />);
    expect(screen.getByText(t("en-US", "tourStepWelcomeTitle"))).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("Next/Back/Skip call handlers; last step shows Done", () => {
    const h = handlers();
    const { rerender } = render(<TourOverlay lang="en-US" steps={TOUR_STEPS} index={0} {...h} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "tourNext") }));
    expect(h.onNext).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "tourSkip") }));
    expect(h.onSkip).toHaveBeenCalled();
    rerender(<TourOverlay lang="en-US" steps={TOUR_STEPS} index={TOUR_STEPS.length - 1} {...h} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "tourDone") }));
    expect(h.onDone).toHaveBeenCalled();
  });
  it("Escape triggers skip", () => {
    const h = handlers();
    render(<TourOverlay lang="en-US" steps={TOUR_STEPS} index={0} {...h} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(h.onSkip).toHaveBeenCalled();
  });
  it("Shift+Tab from the focused card wraps to the LAST in-card control (§8)", () => {
    // ★★★ THE §8 ASSERTION. The card is `tabIndex={-1}`, so it is absent from
    // the trap's own focusables — the state the overlay is in on the FIRST
    // keypress, which is the only one that matters. Before the trap, this
    // Shift+Tab walked backwards out of the card into the app behind the
    // dimmed backdrop, on a surface announcing `aria-modal="true"`.
    render(<TourOverlay lang="en-US" steps={TOUR_STEPS} index={WIDE_STEP} {...handlers()} />);
    // Pin WIDE_STEP's premise rather than only asserting it in prose: if the
    // catalog changes and this step drops to two controls, `first` and `last`
    // collapse onto Skip and Next and BOTH wrap assertions still pass — the
    // tests would go vacuous with nothing red to say so.
    expect(screen.getAllByRole("button")).toHaveLength(4);
    const e = pressTab(true);
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: t("en-US", "tourNext") }),
    );
  });
  it("Tab from the focused card wraps to the FIRST in-card control", () => {
    render(<TourOverlay lang="en-US" steps={TOUR_STEPS} index={WIDE_STEP} {...handlers()} />);
    expect(screen.getAllByRole("button")).toHaveLength(4);
    const e = pressTab();
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: t("en-US", "tourSkip") }),
    );
  });
  it("a spotlight step with a MISSING anchor falls back to a centered modal (no crash)", () => {
    const h = handlers();
    render(<TourOverlay lang="en-US" steps={TOUR_STEPS} index={2} {...h} />); // tasks = spotlight, anchor not in DOM
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "tourStepTasksTitle"))).toBeInTheDocument();
  });
});
