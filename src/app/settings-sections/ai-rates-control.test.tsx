import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { setDisabledIntegrations } from "../integration-switches";
import { t } from "../i18n";
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
