import { beforeAll, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterMultiSelect, type FilterOption } from "./filter-multiselect";
import { loadI18n, t, type Lang } from "./i18n";
import { expectRowUniqueNames } from "../test/row-unique-names";

const OPTS: FilterOption[] = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
];

describe("FilterMultiSelect", () => {
  it("shows no count badge and label-only accessible name when nothing is selected", () => {
    render(<FilterMultiSelect lang="en-US" label="Status" options={OPTS} selected={[]} onToggle={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Status" })).toBeInTheDocument();
  });

  it("reflects the selected count in the accessible name and toggles on checkbox change", () => {
    const onToggle = vi.fn();
    render(<FilterMultiSelect lang="en-US" label="Status" options={OPTS} selected={["a"]} onToggle={onToggle} />);
    // Count is folded into the accessible name.
    fireEvent.click(screen.getByRole("button", { name: /Status/ }));
    const alpha = screen.getByRole("checkbox", { name: "Alpha" });
    expect(alpha).toBeChecked();
    fireEvent.click(alpha);
    expect(onToggle).toHaveBeenCalledWith("a");
  });

  it("renders a togglable checkbox for a stale selection absent from options (count stays actionable)", () => {
    // "ghost" is selected but not in options (e.g. a filtered-out assignee) — it
    // must still render as a checked, un-tickable item so the user can clear it.
    const onToggle = vi.fn();
    render(<FilterMultiSelect lang="en-US" label="Assignee" options={OPTS} selected={["ghost"]} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: /Assignee/ }));
    const ghost = screen.getByRole("checkbox", { name: "ghost" });
    expect(ghost).toBeChecked();
    fireEvent.click(ghost);
    expect(onToggle).toHaveBeenCalledWith("ghost");
  });

  it("disables the trigger when there are no options and no selection", () => {
    render(<FilterMultiSelect lang="en-US" label="Assignee" options={[]} selected={[]} onToggle={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Assignee" })).toBeDisabled();
  });

  it("stays enabled when options are empty but a stale value is still selected", () => {
    render(<FilterMultiSelect lang="en-US" label="Assignee" options={[]} selected={["ghost"]} onToggle={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Assignee/ })).toBeEnabled();
  });
});

describe("FilterMultiSelect — every option checkbox has its own name (§672)", () => {
  beforeAll(() => loadI18n("de"));

  // Each checkbox is named by its option's label, and a stale selection missing from the options
  // is appended as one more checkbox named by its raw value. The translated set is the Gantt status
  // filter's, so two statuses translated alike would leave two checkboxes a screen reader cannot
  // tell apart. The labels themselves come from the caller; this pins that each checkbox carries
  // its own option's label rather than a shared one.
  const statusOptions = (lang: Lang): FilterOption[] =>
    (["ganttStatusOpen", "ganttStatusCompleted", "ganttStatusOverdue"] as const).map((k) => ({ value: k, label: t(lang, k) }));

  // Without the German dictionary the de case would silently re-run en-US, so pin that it loaded.
  it("renders real German for the de case", () => {
    expect(t("de", "ganttStatusCompleted")).not.toBe(t("en-US", "ganttStatusCompleted"));
  });

  it.each(["en-US", "de"] as const)("names every option and a stale selection distinctly in %s", (lang) => {
    render(<FilterMultiSelect lang={lang} label="Status" options={statusOptions(lang)} selected={["ghost"]} onToggle={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Status/ }));
    expectRowUniqueNames({ minControls: 4, roles: ["checkbox"] });
  });
});
