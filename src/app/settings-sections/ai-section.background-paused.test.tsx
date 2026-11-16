import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AiSection } from "./ai-section";
import { newConsent } from "../ai-consent";
import { setDisabledIntegrations } from "../integration-switches";
import { defaultSettings as baseSettings } from "../settings-types";
import { t } from "../i18n";
import type { SettingsOverrides } from "../settings-types";

const state = vi.hoisted(() => ({ overrides: undefined as SettingsOverrides | undefined }));
vi.mock("../workspace-context", async (orig) => ({
  ...(await orig<typeof import("../workspace-context")>()),
  useOptionalSettingsOverrides: () => state.overrides,
}));
vi.mock("./ai-usage-panel", () => ({ AiUsagePanel: () => <div /> }));
vi.mock("../confirm-dialog", () => ({
  useConfirm: () => () => Promise.resolve(true),
  useNotice: () => () => Promise.resolve(),
}));

const settings = {
  ...baseSettings,
  ai: { ...baseSettings.ai, enabled: true, consent: newConsent(new Date(0)), backgroundConsent: newConsent(new Date(0)) },
};
const NOTICE = t("en-US", "aiBackgroundPausedNotice");

beforeEach(() => {
  state.overrides = undefined;
  setDisabledIntegrations([]);
  vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 401, json: async () => ({}) } as Response);
});
afterEach(() => { cleanup(); setDisabledIntegrations([]); vi.restoreAllMocks(); });

describe("AiSection — background AI paused", () => {
  it("shows no paused notice while nothing pauses background AI", () => {
    render(<AiSection lang="en-US" settings={settings} onChange={vi.fn()} />);
    expect(screen.queryByText(NOTICE)).toBeNull();
  });
  it("shows the project notice at the background consent and at the automatic recommendations", () => {
    state.overrides = { ai: { backgroundOff: true } };
    render(<AiSection lang="en-US" settings={settings} onChange={vi.fn()} />);
    expect(screen.getAllByText(NOTICE)).toHaveLength(2);
  });
  it("shows the organisation variant under the deployment lock", () => {
    setDisabledIntegrations(["ai-background"]);
    render(<AiSection lang="en-US" settings={settings} onChange={vi.fn()} />);
    expect(screen.getAllByText(t("en-US", "aiBackgroundPausedByDeployment"))).toHaveLength(2);
  });
});
