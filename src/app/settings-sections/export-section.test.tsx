// src/app/settings-sections/export-section.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExportSection } from "./export-section";
import { defaultSettings } from "../settings-types";
import { EXPORT_SECTION_KEYS, defaultExportConfig } from "../settings-types";

const lang = "en-US" as const;

function renderSection(overrides: Partial<typeof defaultSettings> = {}) {
  const settings = { ...defaultSettings, ...overrides };
  const onChange = vi.fn();
  render(<ExportSection lang={lang} settings={settings} onChange={onChange} />);
  return { onChange };
}

describe("ExportSection", () => {
  it("renders 11 checkboxes — one per export section key", () => {
    renderSection();
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(EXPORT_SECTION_KEYS.length);
  });

  it("checks tasks and raid by default when settings.export is undefined", () => {
    renderSection({ export: undefined });
    // tasks default = true
    expect(screen.getByLabelText("Tasks")).toBeChecked();
    // raid default = true
    expect(screen.getByLabelText("RAID")).toBeChecked();
  });

  it("leaves all other keys unchecked by default", () => {
    renderSection({ export: undefined });
    const checkboxes = screen.getAllByRole("checkbox");
    const defaultFalseKeys = EXPORT_SECTION_KEYS.filter(
      (k) => !defaultExportConfig[k],
    );
    for (const key of defaultFalseKeys) {
      const idx = EXPORT_SECTION_KEYS.indexOf(key);
      expect(checkboxes[idx]).not.toBeChecked();
    }
  });

  it("calls onChange with the correct export object when tasks is toggled off", async () => {
    const user = userEvent.setup();
    const { onChange } = renderSection({ export: undefined });

    const tasksCheckbox = screen.getByLabelText("Tasks");
    await user.click(tasksCheckbox);

    expect(onChange).toHaveBeenCalledOnce();
    const updated = onChange.mock.calls[0][0];
    expect(updated.export.tasks).toBe(false);
    // Other keys preserved from defaultExportConfig
    expect(updated.export.raid).toBe(defaultExportConfig.raid);
    expect(updated.export.changes).toBe(defaultExportConfig.changes);
  });

  it("calls onChange with the correct export object when a false key is toggled on", async () => {
    const user = userEvent.setup();
    const { onChange } = renderSection({ export: undefined });

    const milestonesCheckbox = screen.getByLabelText("Milestones");
    await user.click(milestonesCheckbox);

    expect(onChange).toHaveBeenCalledOnce();
    const updated = onChange.mock.calls[0][0];
    expect(updated.export.milestones).toBe(true);
    // tasks unchanged
    expect(updated.export.tasks).toBe(defaultExportConfig.tasks);
    // other keys intact
    expect(updated.export.raid).toBe(defaultExportConfig.raid);
  });

  it("preserves existing export values when toggling one key", async () => {
    const user = userEvent.setup();
    const custom = {
      ...defaultExportConfig,
      budgets: true,
      resources: true,
    };
    const { onChange } = renderSection({ export: custom });

    const changesCheckbox = screen.getByLabelText("Changes");
    await user.click(changesCheckbox);

    const updated = onChange.mock.calls[0][0];
    expect(updated.export.changes).toBe(true);
    expect(updated.export.budgets).toBe(true);
    expect(updated.export.resources).toBe(true);
    expect(updated.export.tasks).toBe(true);
  });

  it("renders the hint text", () => {
    renderSection();
    expect(
      screen.getByText(/Choose which sections to include in document exports/i),
    ).toBeDefined();
  });
});
