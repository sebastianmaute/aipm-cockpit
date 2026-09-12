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

  // ★ Every toggle here is labelled with a bare noun ("Dependencies",
  //   "Holidays", "Day grid") that names a layer, never its effect. Three of the
  //   eight already carried a `title` saying what the layer DOES; these five did
  //   not, and the split was by author, not by importance.
  // ★★ The expected text is HARDCODED, not read back through `t(…)`. Asserting
  //   `title` contains `t(lang, "ganttShowGridHint")` would pass against a
  //   missing key (t echoes the key, and the attribute would echo it too) —
  //   i.e. the assertion would compare the bug to itself.
  // ★ `toContain`, not equality: `ToggleButton` composes
  //   `title · <on/off state>` in the primitive, so the attribute is a superset.
  it("titles each layer toggle with the consequence its label omits", () => {
    render(<GanttViewMenu {...props} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "ganttViewMenu") }));
    const cases: [Parameters<typeof t>[1], string][] = [
      ["ganttShowDependencies", "Draw arrows between dependent tasks"],
      ["ganttShowHolidays", "Shade non-working days across the chart"],
      ["ganttShowAbsences", "Shade each assignee's absences on their own row"],
      ["ganttShowGrid", "Draw a dotted rule for every day"],
      ["ganttShowMilestones", "Show milestone markers on the chart"],
    ];
    for (const [labelKey, hint] of cases) {
      const button = screen.getByRole("button", { name: t("en-US", labelKey) });
      expect(button.getAttribute("title") ?? "").toContain(hint);
    }
  });

  // ★★ `ToggleButton` COLLAPSES its pressed marker to zero width when off by
  //    default and animates it open, so a toggle in this dense vertical list
  //    would reflow the menu under the pointer mid-click. Every item therefore
  //    passes `reserveMarkerSpace`. The COUNT is hardcoded on purpose: it is the
  //    only thing that catches a NEW toggle arriving without the prop.
  // ★★★ EVERY TOGGLE MUST BE SEEDED **OFF**, and at `DEFAULT_PREFS` this test is
  //     blind to six of the eight call sites. A PRESSED marker renders `w-3.5`
  //     whether or not the prop is passed — only the OFF state distinguishes
  //     `w-3.5` from `w-0 -ml-1.5`. `DEFAULT_PREFS` has just two toggles off
  //     (`showGrid`, and `milestonePlacement: "below"`), so the other six
  //     satisfied the loop for the wrong reason. Measured, not reasoned: with
  //     `DEFAULT_PREFS` a mutant deleting `reserveMarkerSpace` from the holidays
  //     toggle SURVIVED (8 passed); seeded off, the same mutant fails here. Do
  //     not "simplify" this back to `{...props}`.
  it("reserves the marker width on every view toggle so the menu never reflows", () => {
    render(
      <GanttViewMenu
        {...props}
        prefs={{
          ...DEFAULT_PREFS,
          showDependencies: false,
          showHolidays: false,
          showAbsences: false,
          showGrid: false,
          showCriticalPath: false,
          showBaseline: false,
          showMilestones: false,
          milestonePlacement: "below",
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "ganttViewMenu") }));
    const markers = Array.from(document.querySelectorAll("[data-pressed-marker]"));
    // Anti-vacuity: a loop over an empty list passes trivially, which is how an
    // "all of them" assertion silently covers nothing. `props` sets hasBaseline
    // and hasMilestones true, and BOTH milestone toggles are gated on that PROP
    // rather than on `prefs.showMilestones`, so all eight render even off.
    expect(markers.length).toBe(8);
    // Every marker must be in the OFF state, or the assertion below is back to
    // proving nothing for that row.
    for (const m of markers) {
      expect(m.getAttribute("data-pressed-marker")).toBe("off");
      expect(m.getAttribute("class")).toContain("w-3.5");
      expect(m.getAttribute("class")).not.toContain("w-0");
    }
  });
});
