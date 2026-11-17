import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ScheduledJobsSection } from "./scheduled-jobs-section";
import { newConsent } from "../ai-consent";
import { setDisabledIntegrations } from "../integration-switches";
import { defaultSettings } from "../settings-types";
import { t } from "../i18n";
import type { SettingsOverrides } from "../settings-types";
import type { TursoConfig } from "../turso-config";

const state = vi.hoisted(() => ({ overrides: undefined as SettingsOverrides | undefined }));
vi.mock("../workspace-context", async (orig) => ({
  ...(await orig<typeof import("../workspace-context")>()),
  useOptionalSettingsOverrides: () => state.overrides,
}));
vi.mock("../use-scheduled-jobs", () => ({
  useScheduledJobs: () => ({ jobs: [], busy: false, ready: true, createJob: vi.fn(), updateJob: vi.fn(), deleteJob: vi.fn(), assignProject: vi.fn(), recordRun: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("../turso-portfolio", () => ({ listProjectRefs: async () => ({ active: [], archived: [] }) }));
vi.mock("../portfolio-mode", () => ({ loadPortfolioMode: () => "turso", loadCurrentTursoProjectId: () => null }));

const TURSO = { httpUrl: "https://x.example", authToken: "t" } as unknown as TursoConfig;
const settings = {
  ...defaultSettings,
  ai: { ...defaultSettings.ai, apiKey: "sk-test", enabled: true, consent: newConsent(new Date(0)), backgroundConsent: newConsent(new Date(0)), scheduledJobs: true },
};
const show = () => render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);

beforeEach(() => { state.overrides = undefined; setDisabledIntegrations([]); });
afterEach(() => { cleanup(); setDisabledIntegrations([]); });

// The section lists jobs for ANY project, so it never reflects the OPEN project's switch: a job decides from its own
// project. It names the organisation lock while that is on, and otherwise says the rule once, statically.
describe("ScheduledJobsSection — background AI paused", () => {
  const hint = () => t("en-US", "scheduledJobsPausedProjectHint");
  it("shows the static hint while nothing pauses background AI", () => {
    show();
    expect(screen.getByText(hint())).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "aiBackgroundPausedByDeployment"))).toBeNull();
  });
  it("shows the same static hint, not the open project's notice, while the OPEN project paused it", () => {
    state.overrides = { ai: { backgroundOff: true } };
    show();
    expect(screen.getByText(hint())).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "aiBackgroundPausedNotice"))).toBeNull();
  });
  it("shows the organisation variant under the deployment lock", () => {
    setDisabledIntegrations(["ai-background"]);
    show();
    expect(screen.getByText(t("en-US", "aiBackgroundPausedByDeployment"))).toBeInTheDocument();
    expect(screen.queryByText(hint())).toBeNull();
  });
});
