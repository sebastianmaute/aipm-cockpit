import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GanttViewMenu } from "./gantt-view-menu";
import { DEFAULT_PREFS } from "./gantt-engine";
import { t } from "./i18n";

const noop = () => {};
const props = {
  lang: "en-US" as const,
  prefs: DEFAULT_PREFS,
  hasBaseline: true,
  hasMilestones: true,
  toggleCriticalPath: noop,
  toggleBaseline: noop,
  toggleMilestonePlacement: noop,
  toggleHolidays: noop,
  toggleAbsences: noop,
  toggleDependencies: noop,
  toggleMilestones: noop,
  toggleGrid: noop,
};

describe("GanttViewMenu", () => {
  it("keeps the toggles out of the DOM until it is opened", () => {
    render(<GanttViewMenu {...props} />);
    expect(screen.queryByRole("button", { name: t("en-US", "ganttShowGrid") })).toBeNull();
  });

  it("opens and fires the matching toggle", () => {
    const toggleGrid = vi.fn();
    render(<GanttViewMenu {...props} toggleGrid={toggleGrid} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "ganttViewMenu") }));
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "ganttShowGrid") }));
    expect(toggleGrid).toHaveBeenCalledTimes(1);
  });

  it("reports each toggle's state through aria-pressed", () => {
    render(<GanttViewMenu {...props} prefs={{ ...DEFAULT_PREFS, showGrid: false, showHolidays: true }} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "ganttViewMenu") }));
    expect(screen.getByRole("button", { name: t("en-US", "ganttShowGrid") })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: t("en-US", "ganttShowHolidays") })).toHaveAttribute("aria-pressed", "true");
  });

  it("omits the baseline toggle when there is no baseline data", () => {
    render(<GanttViewMenu {...props} hasBaseline={false} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "ganttViewMenu") }));
    expect(screen.queryByRole("button", { name: t("en-US", "ganttBaseline") })).toBeNull();
  });

  // ★ Guards the previous case against passing vacuously: with baseline data the
  //   SAME query must resolve, so a menu that rendered nothing at all would fail
  //   here rather than "confirming" the gate.
  it("shows the baseline toggle when there IS baseline data", () => {
    render(<GanttViewMenu {...props} hasBaseline />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "ganttViewMenu") }));
    expect(screen.getByRole("button", { name: t("en-US", "ganttBaseline") })).not.toBeNull();
  });

  // ★ Same vacuity guard for the milestone gate: both the milestone-row toggle
  //   and the inline-placement control are milestone-only.
  it("gates both milestone controls on there being milestones", () => {
    const { rerender } = render(<GanttViewMenu {...props} hasMilestones={false} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "ganttViewMenu") }));
    expect(screen.queryByRole("button", { name: t("en-US", "ganttShowMilestones") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("en-US", "ganttMilestonesInline") })).toBeNull();

    rerender(<GanttViewMenu {...props} hasMilestones />);
    expect(screen.getByRole("button", { name: t("en-US", "ganttShowMilestones") })).not.toBeNull();
    expect(screen.getByRole("button", { name: t("en-US", "ganttMilestonesInline") })).not.toBeNull();
  });
});
