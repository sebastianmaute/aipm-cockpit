// src/app/settings-sections/export-section.test.tsx
import { beforeAll, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExportSection } from "./export-section";
import { loadI18n, t } from "../i18n";
import { expectRowUniqueNames } from "../../test/row-unique-names";
import { defaultSettings } from "../settings-types";
import { EXPORT_SECTION_KEYS, defaultExportConfig } from "../settings-types";
import { isViewEnabled } from "../feature-modules";

// §502 part 4 — the forecast decision checkbox shows only with the (release-hidden) Forecast view enabled; this test
// can turn the view on through the mocked `isViewEnabled`.
vi.mock("../feature-modules", async (importOriginal) => {
  const real = await importOriginal<typeof import("../feature-modules")>();
  return { ...real, isViewEnabled: vi.fn(real.isViewEnabled) };
});

const lang = "en-US" as const;
/** The checkboxes shown in this release: every key but the hidden Forecast view's decision section. */
const SHOWN_KEYS = EXPORT_SECTION_KEYS.filter((k) => k !== "forecastDecision");

function renderSection(overrides: Partial<typeof defaultSettings> = {}) {
  const settings = { ...defaultSettings, ...overrides };
  const onChange = vi.fn();
  render(<ExportSection lang={lang} settings={settings} onChange={onChange} />);
  return { onChange };
}

describe("ExportSection", () => {
  it("renders one checkbox per export section key, the hidden Forecast view's decision section excepted", () => {
    renderSection();
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(SHOWN_KEYS.length);
    expect(screen.queryByLabelText("Forecast decision (simulated)")).toBeNull();
  });

  it("shows the forecast decision checkbox once the Forecast view is enabled (§502 part 4)", () => {
    vi.mocked(isViewEnabled).mockReturnValue(true);
    try {
      renderSection();
      expect(screen.getAllByRole("checkbox")).toHaveLength(EXPORT_SECTION_KEYS.length);
      expect(screen.getByLabelText("Forecast decision (simulated)")).toBeChecked();
    } finally {
      vi.mocked(isViewEnabled).mockRestore();
    }
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
    const defaultFalseKeys = SHOWN_KEYS.filter(
      (k) => !defaultExportConfig[k],
    );
    for (const key of defaultFalseKeys) {
      const idx = SHOWN_KEYS.indexOf(key);
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

describe("ExportSection — every section checkbox has its own name (§245)", () => {
  beforeAll(() => loadI18n("de"));

  // Each checkbox is named by its section's label, so two sections translated alike would leave two
  // checkboxes a screen reader cannot tell apart.
  // Without the German dictionary the de case would silently re-run en-US, so pin that it loaded.
  it("renders real German for the de case", () => {
    expect(t("de", "exportLabelTasks")).not.toBe(t("en-US", "exportLabelTasks"));
  });

  it.each(["en-US", "de"] as const)("names every section checkbox distinctly in %s", (l) => {
    render(<ExportSection lang={l} settings={defaultSettings} onChange={vi.fn()} />);
    expectRowUniqueNames({ minControls: SHOWN_KEYS.length, roles: ["checkbox"] });
  });
});
