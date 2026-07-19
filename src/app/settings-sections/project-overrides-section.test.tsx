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

  test("toggling appearance ON writes density + view-hints to the appearance store", () => {
    renderSection();
    const apGroup = screen.getByRole("radiogroup", { name: /appearance/i });
    fireEvent.click(within(apGroup).getByRole("radio", { name: /override for this project/i }));
    expect(state.saveAppearance).toHaveBeenCalledTimes(1);
    const [, pref] = state.saveAppearance.mock.calls[0];
    expect(pref).toMatchObject({ dashboardDensity: expect.any(String) });
    expect(pref).toHaveProperty("showViewHints");
    expect(pref).not.toHaveProperty("tasksViewMode"); // excluded from the UI
  });

  test("an existing appearance override shows the group as overridden (controls revealed)", () => {
    state.appearance = { dashboardDensity: "compact" };
    renderSection();
    const apGroup = screen.getByRole("radiogroup", { name: /appearance/i });
    expect(within(apGroup).getByRole("radio", { name: /override for this project/i })).toBeChecked();
  });
});
