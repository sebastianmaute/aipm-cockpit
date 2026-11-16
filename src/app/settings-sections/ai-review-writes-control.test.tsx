import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { setDisabledIntegrations } from "../integration-switches";
import { t } from "../i18n";
import type { SettingsOverrides } from "../settings-types";
import { AiReviewWritesControl } from "./ai-review-writes-control";

const state = vi.hoisted(() => ({
  overrides: undefined as SettingsOverrides | undefined,
  setOverrides: vi.fn(),
}));

vi.mock("../workspace-context", () => ({
  useWorkspace: () => ({ settingsOverrides: state.overrides, setSettingsOverrides: state.setOverrides }),
}));

const control = () => screen.getByRole("checkbox", { name: t("en-US", "aiReviewAllWritesLabel") });

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

describe("AiReviewWritesControl", () => {
  it("reads off by default, with the hint, and its accessible name is the visible label", () => {
    render(<AiReviewWritesControl lang="en-US" />);
    expect(control()).not.toBeChecked();
    expect(screen.getByText(t("en-US", "aiReviewAllWritesLabel"))).toBeInTheDocument();
    expect(control()).toHaveAccessibleDescription(t("en-US", "aiReviewAllWritesHint"));
  });

  it("turning it on stores reviewAllWrites: true", () => {
    render(<AiReviewWritesControl lang="en-US" />);
    fireEvent.click(control());
    expect(applied(undefined)).toEqual({ ai: { reviewAllWrites: true } });
  });

  it("turning it off clears the stored choice back to absence", () => {
    state.overrides = { ai: { reviewAllWrites: true } };
    render(<AiReviewWritesControl lang="en-US" />);
    expect(control()).toBeChecked();
    fireEvent.click(control());
    expect(applied({ ai: { reviewAllWrites: true } })).toBeUndefined();
  });

  it("with the deployment lock it is on, disabled and says why; a click changes nothing", () => {
    setDisabledIntegrations(["ai-direct-writes"]);
    render(<AiReviewWritesControl lang="en-US" />);
    expect(control()).toBeChecked();
    expect(control()).toBeDisabled();
    const reason = screen.getByText(t("en-US", "aiReviewAllWritesForced"));
    expect(control()).toHaveAccessibleDescription(expect.stringContaining(reason.textContent ?? ""));
    fireEvent.click(control());
    expect(state.setOverrides).not.toHaveBeenCalled();
  });

  it("does not show the forced reason when nothing forces it", () => {
    render(<AiReviewWritesControl lang="en-US" />);
    expect(screen.queryByText(t("en-US", "aiReviewAllWritesForced"))).toBeNull();
  });
});
