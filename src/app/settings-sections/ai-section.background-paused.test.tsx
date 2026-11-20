import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spyAiFetch } from "../../test/fetch-real-response";
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
  spyAiFetch().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) } as Response);
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
  // KILLED BY: dropping the id on either notice, or the describedby on either control (the notice is then a stray
  // line a screen reader never connects to the control it explains).
  it("links the notice to the background consent and the automatic recommendations while paused", () => {
    state.overrides = { ai: { backgroundOff: true } };
    render(<AiSection lang="en-US" settings={settings} onChange={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: t("en-US", "aiBackgroundConsentToggle") })).toHaveAccessibleDescription(NOTICE);
    expect(screen.getByRole("checkbox", { name: t("en-US", "aiInsightRecommendations") })).toHaveAccessibleDescription(expect.stringContaining(NOTICE));
  });
  it("links the organisation variant under the deployment lock", () => {
    setDisabledIntegrations(["ai-background"]);
    render(<AiSection lang="en-US" settings={settings} onChange={vi.fn()} />);
    const org = t("en-US", "aiBackgroundPausedByDeployment");
    expect(screen.getByRole("checkbox", { name: t("en-US", "aiBackgroundConsentToggle") })).toHaveAccessibleDescription(org);
    expect(screen.getByRole("checkbox", { name: t("en-US", "aiInsightRecommendations") })).toHaveAccessibleDescription(expect.stringContaining(org));
  });
  it("links nothing while background AI is not paused", () => {
    render(<AiSection lang="en-US" settings={settings} onChange={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: t("en-US", "aiBackgroundConsentToggle") })).not.toHaveAccessibleDescription(NOTICE);
    expect(screen.getByRole("checkbox", { name: t("en-US", "aiBackgroundConsentToggle") }).getAttribute("aria-describedby")).toBeNull();
    expect(screen.getByRole("checkbox", { name: t("en-US", "aiInsightRecommendations") }).getAttribute("aria-describedby")).toBeNull();
  });
  it("shows the organisation variant under the deployment lock", () => {
    setDisabledIntegrations(["ai-background"]);
    render(<AiSection lang="en-US" settings={settings} onChange={vi.fn()} />);
    expect(screen.getAllByText(t("en-US", "aiBackgroundPausedByDeployment"))).toHaveLength(2);
  });
});
