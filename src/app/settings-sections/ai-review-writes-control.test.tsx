import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { setDisabledIntegrations } from "../integration-switches";
import { loadI18n, t } from "../i18n";
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

  it("decides from the previous overrides inside the updater, not from what was rendered", () => {
    render(<AiReviewWritesControl lang="en-US" />); // rendered off
    fireEvent.click(control());
    expect(applied({ ai: { reviewAllWrites: true } })).toBeUndefined(); // already on by the time the updater runs
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

// §794 — not every AI change can be undone (an inquiry mail, a forecast proposal or target, a functions change,
// a document write), so the hint promises it for most changes, not for every one.
describe("the review switch hint", () => {
  it("says most changes can be undone, in English and German", async () => {
    expect(t("en-US", "aiReviewAllWritesHint")).toMatch(/most changes can be undone/);
    expect(t("en-US", "aiReviewAllWritesHint")).not.toMatch(/applied at once and can be undone/);
    await loadI18n("de");
    expect(t("de", "aiReviewAllWritesHint")).toMatch(/die meisten Änderungen lassen sich rückgängig machen/);
  });

  // Device-local calls (set_filters, set_language, update_settings without functions) still apply at once, so the
  // hint promises review for changes to project data only (as the CHANGELOG and E71 say).
  it("says it reviews every change to project data", async () => {
    expect(t("en-US", "aiReviewAllWritesHint")).toMatch(/every change to project data the AI chat proposes/);
    await loadI18n("de");
    expect(t("de", "aiReviewAllWritesHint")).toMatch(/Jede Änderung an Projektdaten, die der KI-Chat vorschlägt/);
  });
});
