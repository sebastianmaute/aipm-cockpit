import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { setDisabledIntegrations } from "../integration-switches";
import { loadI18n, t } from "../i18n";
import type { SettingsOverrides } from "../settings-types";
import { AiRatesControl } from "./ai-rates-control";

const state = vi.hoisted(() => ({
  overrides: undefined as SettingsOverrides | undefined,
  setOverrides: vi.fn(),
}));

vi.mock("../workspace-context", () => ({
  useWorkspace: () => ({ settingsOverrides: state.overrides, setSettingsOverrides: state.setOverrides }),
}));

const control = () => screen.getByRole("checkbox", { name: t("en-US", "aiRatesWithheldLabel") });

/** The value the functional setter produces from the previous overrides. */
function applied(prev: SettingsOverrides | undefined): SettingsOverrides | undefined {
  const updater = state.setOverrides.mock.calls[0][0] as (p: SettingsOverrides | undefined) => SettingsOverrides | undefined;
  return updater(prev);
}

beforeEach(() => {
  state.overrides = undefined;
  state.setOverrides.mockReset();
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

  it("turning it on stores ratesWithheld: true", () => {
    render(<AiRatesControl lang="en-US" />);
    fireEvent.click(control());
    expect(applied(undefined)).toEqual({ ai: { ratesWithheld: true } });
  });

  it("turning it off clears the stored choice back to absence", () => {
    state.overrides = { ai: { ratesWithheld: true } };
    render(<AiRatesControl lang="en-US" />);
    expect(control()).toBeChecked();
    fireEvent.click(control());
    expect(applied({ ai: { ratesWithheld: true } })).toBeUndefined();
  });

  it("decides from the previous overrides inside the updater, not from what was rendered", () => {
    render(<AiRatesControl lang="en-US" />); // rendered off
    fireEvent.click(control());
    expect(applied({ ai: { ratesWithheld: true } })).toBeUndefined(); // already on by the time the updater runs
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

// §804 — the switch covers the chat's forecast too, and the hint says what is left out without claiming nothing
// else is sent.
describe("the rates switch wording", () => {
  it("names Plan with AI and the forecast, and does not say only people, roles and hours are sent", async () => {
    for (const lang of ["en-US", "de"] as const) {
      if (lang === "de") await loadI18n("de");
      const label = t(lang, "aiRatesWithheldLabel");
      const hint = t(lang, "aiRatesWithheldHint");
      expect(label, lang).toMatch(lang === "de" ? /Mit KI planen.*Prognose/ : /Plan with AI.*forecast/);
      expect(hint, lang).toMatch(lang === "de" ? /Prognose/ : /forecast/);
      expect(hint, lang).not.toMatch(/only the people|nur die Personen/);
    }
  });

  it("the deployment variable does not say the server refuses requests for the safeguard values", async () => {
    const en = t("en-US", "deployVarDisabledIntegrations");
    expect(en).toMatch(/ai-rates keeps hourly rates out of Plan with AI and the chat’s forecast/);
    expect(en).toMatch(/no other route refuses under them/);
    await loadI18n("de");
    expect(t("de", "deployVarDisabledIntegrations")).toMatch(/keine andere Route lehnt dabei ab/);
  });
});
