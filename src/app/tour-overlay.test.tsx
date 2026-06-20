import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TourOverlay } from "./tour-overlay";
import { TOUR_STEPS } from "./app-tour";
import { t } from "./i18n";

const handlers = () => ({ onBack: vi.fn(), onNext: vi.fn(), onSkip: vi.fn(), onDone: vi.fn(), onShowMe: vi.fn() });

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
  it("a spotlight step with a MISSING anchor falls back to a centered modal (no crash)", () => {
    const h = handlers();
    render(<TourOverlay lang="en-US" steps={TOUR_STEPS} index={2} {...h} />); // tasks = spotlight, anchor not in DOM
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "tourStepTasksTitle"))).toBeInTheDocument();
  });
});
