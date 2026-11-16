import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ActivityLogProvider } from "../activity-log-context";
import { AiPrivacyProvider, useAiPrivacySource } from "../ai-privacy-context";
import type { Workspace } from "../workspace";
import { setDisabledIntegrations } from "../integration-switches";
import { loadI18n, t } from "../i18n";
import type { SettingsOverrides } from "../settings-types";
import { AiRatesControl } from "./ai-rates-control";

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
      <AiRatesControl lang="en-US" />
    </ActivityLogProvider>,
  );
}

const control = () => screen.getByRole("checkbox", { name: t("en-US", "aiRatesWithheldLabel") });

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

describe("AiRatesControl", () => {
  it("reads off by default, with the hint, and its accessible name is the visible label", () => {
    render(<AiRatesControl lang="en-US" />);
    expect(control()).not.toBeChecked();
    expect(screen.getByText(t("en-US", "aiRatesWithheldLabel"))).toBeInTheDocument();
    expect(control()).toHaveAccessibleDescription(t("en-US", "aiRatesWithheldHint"));
  });

  // §804 — like people protection: turning the safeguard ON needs no dialog and is logged; turning it OFF
  // asks first, and only a confirmed change is written and logged (actor "user"). Each write sets the state the
  // user chose, so a second click cannot flip it back.
  it("turning it on stores ratesWithheld: true, asks nothing and logs ai.ratesWithheldOn", () => {
    renderControl();
    fireEvent.click(control());
    expect(state.confirm).not.toHaveBeenCalled();
    expect(applied(undefined)).toEqual({ ai: { ratesWithheld: true } });
    expect(applied({ ai: { ratesWithheld: true } })).toEqual({ ai: { ratesWithheld: true } });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("user", "ai.ratesWithheldOn");
  });

  it("turning it off asks first, and Cancel leaves it on with nothing written or logged", async () => {
    state.overrides = { ai: { ratesWithheld: true } };
    state.confirm.mockResolvedValue(false);
    renderControl();
    fireEvent.click(control());
    await waitFor(() => expect(state.confirm).toHaveBeenCalledTimes(1));
    expect(state.confirm.mock.calls[0][0].message).toBe(t("en-US", "aiRatesWithheldOffConfirm"));
    expect(state.setOverrides).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(control()).toBeChecked();
  });

  it("Confirm clears the stored choice back to absence and logs ai.ratesWithheldOff once", async () => {
    state.overrides = { ai: { ratesWithheld: true } };
    state.confirm.mockResolvedValue(true);
    renderControl();
    fireEvent.click(control());
    await waitFor(() => expect(state.setOverrides).toHaveBeenCalledTimes(1));
    expect(applied({ ai: { ratesWithheld: true } })).toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("user", "ai.ratesWithheldOff");
  });

  it("with the deployment lock it is on, disabled and says why; a click changes nothing", () => {
    setDisabledIntegrations(["ai-rates"]);
    render(<AiRatesControl lang="en-US" />);
    expect(control()).toBeChecked();
    expect(control()).toBeDisabled();
    const reason = screen.getByText(t("en-US", "aiRatesWithheldForced"));
    expect(control()).toHaveAccessibleDescription(expect.stringContaining(reason.textContent ?? ""));
    fireEvent.click(control());
    expect(state.setOverrides).not.toHaveBeenCalled();
  });

  it("does not show the forced reason when nothing forces it", () => {
    render(<AiRatesControl lang="en-US" />);
    expect(screen.queryByText(t("en-US", "aiRatesWithheldForced"))).toBeNull();
  });
});

// §804 — the switch covers the chat's forecast and dashboard figures too, and the hint says what is left out without claiming nothing
// else is sent.
describe("the rates switch wording", () => {
  it("names Plan with AI and the forecast, and does not say only people, roles and hours are sent", async () => {
    for (const lang of ["en-US", "de"] as const) {
      if (lang === "de") await loadI18n("de");
      const label = t(lang, "aiRatesWithheldLabel");
      const hint = t(lang, "aiRatesWithheldHint");
      expect(label, lang).toMatch(lang === "de" ? /Mit KI planen.*Prognose.*Dashboard/ : /Plan with AI.*forecast.*dashboard/);
      expect(hint, lang).toMatch(lang === "de" ? /Prognose.*Dashboard/ : /forecast.*dashboard/);
      expect(hint, lang).not.toMatch(/only the people|nur die Personen/);
    }
  });

  it("the deployment variable does not say the server refuses requests for the safeguard values", async () => {
    const en = t("en-US", "deployVarDisabledIntegrations");
    expect(en).toMatch(/ai-rates keeps hourly rates out of Plan with AI and the chat’s forecast and dashboard figures/);
    expect(en).toMatch(/no other route refuses under them/);
    await loadI18n("de");
    expect(t("de", "deployVarDisabledIntegrations")).toMatch(/keine andere Route lehnt dabei ab/);
  });
});

// §804 — the confirm dialog is awaited, as in the people-protection control: a project swap while it is open must
// not turn the safeguard off in the project that is open when it closes.
describe("AiRatesControl — a project swap while the dialog is open", () => {
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
          <AiRatesControl lang="en-US" />
        </ActivityLogProvider>
      </AiPrivacyProvider>,
    );
  }
  beforeEach(() => {
    epoch.v = 1;
    state.overrides = { ai: { ratesWithheld: true } };
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
    expect(log).toHaveBeenCalledWith("user", "ai.ratesWithheldOff");
  });
});
