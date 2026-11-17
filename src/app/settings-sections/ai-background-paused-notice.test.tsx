import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { setDisabledIntegrations } from "../integration-switches";
import { t } from "../i18n";
import type { SettingsOverrides } from "../settings-types";
import { AiBackgroundPausedNotice } from "./ai-background-paused-notice";

const state = vi.hoisted(() => ({ overrides: undefined as SettingsOverrides | undefined }));
vi.mock("../workspace-context", async (orig) => ({
  ...(await orig<typeof import("../workspace-context")>()),
  useOptionalSettingsOverrides: () => state.overrides,
}));

beforeEach(() => { state.overrides = undefined; setDisabledIntegrations([]); });
afterEach(() => { cleanup(); setDisabledIntegrations([]); });

describe("AiBackgroundPausedNotice", () => {
  it("shows nothing while background AI is not paused", () => {
    render(<AiBackgroundPausedNotice lang="en-US" />);
    expect(screen.queryByText(t("en-US", "aiBackgroundPausedNotice"))).toBeNull();
    expect(screen.queryByText(t("en-US", "aiBackgroundPausedByDeployment"))).toBeNull();
  });
  it("says the project paused it", () => {
    state.overrides = { ai: { backgroundOff: true } };
    render(<AiBackgroundPausedNotice lang="en-US" />);
    expect(screen.getByText(t("en-US", "aiBackgroundPausedNotice"))).toBeInTheDocument();
  });
  it("says the organisation paused it, and that wins over the project", () => {
    setDisabledIntegrations(["ai-background"]);
    state.overrides = { ai: { backgroundOff: true } };
    render(<AiBackgroundPausedNotice lang="en-US" />);
    expect(screen.getByText(t("en-US", "aiBackgroundPausedByDeployment"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "aiBackgroundPausedNotice"))).toBeNull();
  });
});
