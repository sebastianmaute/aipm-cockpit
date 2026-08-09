import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";
import { defaultSettings } from "../settings-types";
import { ProjectOverridesSection } from "./project-overrides-section";

// The section pulls from hooks + reuses heavy section components; mock them so
// the test focuses on the per-group toggle wiring (which store each writes).
const state = vi.hoisted(() => ({
  overrides: undefined as unknown,
  appearance: {} as Record<string, unknown>,
  setOverrides: vi.fn(),
  saveAppearance: vi.fn(),
}));

vi.mock("../workspace-context", () => ({
  useWorkspace: () => ({ settingsOverrides: state.overrides, setSettingsOverrides: state.setOverrides }),
}));
vi.mock("../use-effective-settings", () => ({
  useEffectiveSettings: () => defaultSettings,
}));
vi.mock("../project-appearance-prefs", () => ({
  getAppearanceSnapshot: () => state.appearance,
  subscribeAppearance: () => () => {},
  saveProjectAppearance: state.saveAppearance,
}));
vi.mock("./next-actions-section", () => ({ NextActionsSection: () => <div data-testid="na" /> }));
vi.mock("./notifications-section", () => ({ NotificationsSection: () => <div data-testid="notif" /> }));
vi.mock("./timezone-settings-section", () => ({ TimezoneSettingsSection: () => <div data-testid="tz" /> }));

function renderSection() {
  return render(<ProjectOverridesSection lang="en-US" settings={defaultSettings} projectId="p1" />);
}

afterEach(() => {
  cleanup();
  state.overrides = undefined;
  state.appearance = {};
  state.setOverrides.mockReset();
  state.saveAppearance.mockReset();
});

describe("ProjectOverridesSection", () => {
  test("with no overrides, every group toggle sits on 'Use device default'", () => {
    renderSection();
    const groups = screen.getAllByRole("radiogroup");
    expect(groups).toHaveLength(4); // next-actions, notifications, timezone, appearance
    for (const g of groups) {
      const device = within(g).getByRole("radio", { name: /use device default/i });
      expect(device).toBeChecked();
    }
    // No group's controls revealed (no section stubs rendered)
    expect(screen.queryByTestId("na")).not.toBeInTheDocument();
  });

  test("toggling next-actions ON seeds the policy override via setSettingsOverrides", () => {
    renderSection();
    const naGroup = screen.getByRole("radiogroup", { name: /next actions/i });
    fireEvent.click(within(naGroup).getByRole("radio", { name: /override for this project/i }));
    expect(state.setOverrides).toHaveBeenCalledTimes(1);
  });

  test("toggling appearance ON seeds density + view-hints + view-mode into the appearance store", () => {
    renderSection();
    const apGroup = screen.getByRole("radiogroup", { name: /appearance/i });
    fireEvent.click(within(apGroup).getByRole("radio", { name: /override for this project/i }));
    expect(state.saveAppearance).toHaveBeenCalledTimes(1);
    const [, pref] = state.saveAppearance.mock.calls[0];
    expect(pref).toMatchObject({ dashboardDensity: expect.any(String) });
    expect(pref).toHaveProperty("showViewHints");
    expect(pref).toHaveProperty("tasksViewMode"); // now included in the appearance group
  });

  test("an existing appearance override shows the group as overridden (controls revealed)", () => {
    state.appearance = { dashboardDensity: "compact" };
    renderSection();
    const apGroup = screen.getByRole("radiogroup", { name: /appearance/i });
    expect(within(apGroup).getByRole("radio", { name: /override for this project/i })).toBeChecked();
  });

  // ★★ The three appearance rows wrap a radiogroup, which is not labelable — a
  // `<label>` there bound to the first RADIO instead, so clicking the caption
  // selected that option (clicking the "View" caption forced Table).
  // ★ Asserted as "no radiogroup sits inside a label" rather than via
  // expectNoLabelBoundToButton: the fix removes the LAST label from this tree,
  // so that helper's own vacuity guard (correctly) refuses to run here. The
  // group count is the positive observable — with the override off the rows do
  // not render at all and the assertion would hold for the wrong reason.
  test("wraps no appearance radiogroup in a label", () => {
    state.appearance = { dashboardDensity: "compact" };
    renderSection();
    const groups = screen.getAllByRole("radiogroup");
    // ★★ EXACT, not `> 3`. The four OverrideGroup device/project toggles are
    // themselves radiogroups and render unconditionally, so `> 3` is satisfied
    // by those alone — it would pass with ZERO appearance rows, the precise
    // wrong-reason pass this observable exists to exclude.
    expect(groups).toHaveLength(7); // 4 group toggles + the 3 appearance rows
    expect(groups.filter((g) => g.closest("label") !== null)).toEqual([]);
  });
});
