import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ActivityLogProvider } from "../activity-log-context";
import { AiPrivacyProvider, useAiPrivacySource } from "../ai-privacy-context";
import type { Workspace } from "../workspace";
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

// Final review F4: the confirm dialog is awaited. A project swap while it is open must not lower the
// protection of the project that is open when it closes.
describe("AiPeopleProtectionControl — a project swap while the dialog is open", () => {
  const epoch = { v: 1 };
  function Registrar() {
    useAiPrivacySource("p1", () => ({}) as unknown as Workspace, () => epoch.v);
    return null;
  }
  function renderInScope() {
    return render(
      <AiPrivacyProvider>
        <Registrar />
        <ActivityLogProvider value={log}>
          <AiPeopleProtectionControl lang="en-US" />
        </ActivityLogProvider>
      </AiPrivacyProvider>,
    );
  }
  beforeEach(() => { epoch.v = 1; });

  it("drops the write and the log when the scope changed before Confirm", async () => {
    state.confirm.mockImplementation(async () => { epoch.v += 1; return true; });
    renderInScope();
    fireEvent.click(control());
    await waitFor(() => expect(state.confirm).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    await Promise.resolve();
    expect(state.setOverrides).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("CONTROL — the same scope still stores the choice and logs it", async () => {
    state.confirm.mockResolvedValue(true);
    renderInScope();
    fireEvent.click(control());
    await waitFor(() => expect(state.setOverrides).toHaveBeenCalledTimes(1));
    expect(log).toHaveBeenCalledWith("user", "ai.peopleProtectionOff");
  });
});
