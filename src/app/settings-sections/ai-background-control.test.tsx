import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ActivityLogProvider } from "../activity-log-context";
import { AiPrivacyProvider, useAiPrivacySource } from "../ai-privacy-context";
import type { Workspace } from "../workspace";
import { setDisabledIntegrations } from "../integration-switches";
import { t } from "../i18n";
import type { SettingsOverrides } from "../settings-types";
import { AiBackgroundControl } from "./ai-background-control";

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

/** The control under the activity logger, as the settings views mount it. */
function renderControl() {
  return render(
    <ActivityLogProvider value={log}>
      <AiBackgroundControl lang="en-US" />
    </ActivityLogProvider>,
  );
}

const control = () => screen.getByRole("checkbox", { name: t("en-US", "aiBackgroundOffLabel") });

/** The value the functional setter produces from the previous overrides. */
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

describe("AiBackgroundControl", () => {
  it("reads off by default, with the hint, and its accessible name is the visible label", () => {
    render(<AiBackgroundControl lang="en-US" />);
    expect(control()).not.toBeChecked();
    expect(screen.getByText(t("en-US", "aiBackgroundOffLabel"))).toBeInTheDocument();
    expect(control()).toHaveAccessibleDescription(t("en-US", "aiBackgroundOffHint"));
  });

  it("turning it on stores backgroundOff: true, asks nothing and logs ai.backgroundPaused", () => {
    renderControl();
    fireEvent.click(control());
    expect(state.confirm).not.toHaveBeenCalled();
    expect(applied(undefined)).toEqual({ ai: { backgroundOff: true } });
    expect(applied({ ai: { backgroundOff: true } })).toEqual({ ai: { backgroundOff: true } });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("user", "ai.backgroundPaused");
  });

  it("turning it off asks first, and Cancel leaves it on with nothing written or logged", async () => {
    state.overrides = { ai: { backgroundOff: true } };
    state.confirm.mockResolvedValue(false);
    renderControl();
    fireEvent.click(control());
    await waitFor(() => expect(state.confirm).toHaveBeenCalledTimes(1));
    expect(state.confirm.mock.calls[0][0].message).toBe(t("en-US", "aiBackgroundOffResumeConfirm"));
    expect(state.setOverrides).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(control()).toBeChecked();
  });

  it("Confirm clears the stored choice back to absence and logs ai.backgroundResumed once", async () => {
    state.overrides = { ai: { backgroundOff: true } };
    state.confirm.mockResolvedValue(true);
    renderControl();
    fireEvent.click(control());
    await waitFor(() => expect(state.setOverrides).toHaveBeenCalledTimes(1));
    expect(applied({ ai: { backgroundOff: true } })).toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("user", "ai.backgroundResumed");
  });

  it("never touches the background consent", () => {
    renderControl();
    fireEvent.click(control());
    const next = applied(undefined);
    expect(JSON.stringify(next)).not.toMatch(/Consent/);
  });

  it("with the deployment lock it is on, disabled and says why; a click changes nothing", () => {
    setDisabledIntegrations(["ai-background"]);
    render(<AiBackgroundControl lang="en-US" />);
    expect(control()).toBeChecked();
    expect(control()).toBeDisabled();
    const reason = screen.getByText(t("en-US", "aiBackgroundOffForced"));
    expect(control()).toHaveAccessibleDescription(expect.stringContaining(reason.textContent ?? ""));
    fireEvent.click(control());
    expect(state.setOverrides).not.toHaveBeenCalled();
  });

  it("does not show the forced reason when nothing forces it", () => {
    render(<AiBackgroundControl lang="en-US" />);
    expect(screen.queryByText(t("en-US", "aiBackgroundOffForced"))).toBeNull();
  });
});

describe("AiBackgroundControl — a project swap while the dialog is open", () => {
  const epoch = { v: 1 };
  function Registrar() {
    useAiPrivacySource("p1", () => ({}) as unknown as Workspace, () => epoch.v, true);
    return null;
  }
  function renderInScope() {
    return render(
      <AiPrivacyProvider>
        <Registrar />
        <ActivityLogProvider value={log}>
          <AiBackgroundControl lang="en-US" />
        </ActivityLogProvider>
      </AiPrivacyProvider>,
    );
  }
  beforeEach(() => {
    epoch.v = 1;
    state.overrides = { ai: { backgroundOff: true } };
  });

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
    expect(log).toHaveBeenCalledWith("user", "ai.backgroundResumed");
  });
});
