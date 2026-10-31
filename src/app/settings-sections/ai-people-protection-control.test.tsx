import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ActivityLogProvider } from "../activity-log-context";
import { setDisabledIntegrations } from "../integration-switches";
import { t } from "../i18n";
import type { SettingsOverrides } from "../settings-types";
import { AiPeopleProtectionControl } from "./ai-people-protection-control";

const state = vi.hoisted(() => ({
  overrides: undefined as SettingsOverrides | undefined,
  setOverrides: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("../workspace-context", () => ({
  useWorkspace: () => ({ settingsOverrides: state.overrides, setSettingsOverrides: state.setOverrides }),
}));
vi.mock("../confirm-dialog", () => ({ useConfirm: () => state.confirm }));

const log = vi.fn();

function renderControl() {
  return render(
    <ActivityLogProvider value={log}>
      <AiPeopleProtectionControl lang="en-US" />
    </ActivityLogProvider>,
  );
}

const control = () => screen.getByRole("checkbox", { name: t("en-US", "aiPeopleProtectionLabel") });

/** The value a functional setter produces from the previous overrides. */
function applied(prev: SettingsOverrides | undefined): SettingsOverrides | undefined {
  const updater = state.setOverrides.mock.calls[0][0] as (p: SettingsOverrides | undefined) => SettingsOverrides | undefined;
  return updater(prev);
}

beforeEach(() => {
  state.overrides = undefined;
  state.setOverrides.mockReset();
  state.confirm.mockReset();
  log.mockReset();
  setDisabledIntegrations([]);
});
afterEach(() => {
  cleanup();
  setDisabledIntegrations([]);
});

describe("AiPeopleProtectionControl", () => {
  it("reads on by default, with the help text", () => {
    renderControl();
    expect(control()).toBeChecked();
    expect(screen.getByText(t("en-US", "aiPeopleProtectionHelp"))).toBeInTheDocument();
  });

  it("turning it off asks first, and Cancel leaves it on", async () => {
    state.confirm.mockResolvedValue(false);
    renderControl();
    fireEvent.click(control());
    await waitFor(() => expect(state.confirm).toHaveBeenCalledTimes(1));
    expect(state.confirm.mock.calls[0][0].message).toBe(t("en-US", "aiPeopleProtectionOffConfirm"));
    expect(state.setOverrides).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(control()).toBeChecked();
  });

  it("Confirm stores peopleAllowed and logs ai.peopleProtectionOff as the user", async () => {
    state.confirm.mockResolvedValue(true);
    renderControl();
    fireEvent.click(control());
    await waitFor(() => expect(state.setOverrides).toHaveBeenCalledTimes(1));
    expect(applied(undefined)).toEqual({ ai: { peopleAllowed: true } });
    expect(log).toHaveBeenCalledWith("user", "ai.peopleProtectionOff");
  });

  it("turning it back on needs no dialog, clears the stored choice and logs ai.peopleProtectionOn", () => {
    state.overrides = { ai: { peopleAllowed: true } };
    renderControl();
    expect(control()).not.toBeChecked();
    fireEvent.click(control());
    expect(state.confirm).not.toHaveBeenCalled();
    expect(applied({ ai: { peopleAllowed: true } })).toBeUndefined();
    expect(log).toHaveBeenCalledWith("user", "ai.peopleProtectionOn");
  });

  it("with the deployment lock the control is on, disabled and says why; a click changes nothing", () => {
    setDisabledIntegrations(["ai-people"]);
    state.overrides = { ai: { peopleAllowed: true } }; // a stored choice never overrides the lock
    renderControl();
    expect(control()).toBeChecked();
    expect(control()).toBeDisabled();
    const reason = screen.getByText(t("en-US", "aiPeopleProtectionLocked"));
    expect(control()).toHaveAccessibleDescription(expect.stringContaining(reason.textContent ?? ""));
    fireEvent.click(control());
    expect(state.confirm).not.toHaveBeenCalled();
    expect(state.setOverrides).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("does not show the locked reason when nothing forces protection", () => {
    renderControl();
    expect(screen.queryByText(t("en-US", "aiPeopleProtectionLocked"))).toBeNull();
  });
});
