// An answer given right after an instruction edit, through the REAL hook and the real Accept / Stop paths: the edit
// records this device's answer when it is called, so the click that blurs the field means the version being saved.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScheduledJobsSection } from "./scheduled-jobs-section";
import { newConsent } from "../ai-consent";
import { defaultSettings, type Settings } from "../settings-types";
import { t } from "../i18n";
import type { ScheduledJob } from "../scheduled-jobs/types";
import type { TursoConfig } from "../turso-config";
import { ACCEPTANCE_KEY, acceptanceState, acceptJob, declineJob } from "../scheduled-job-acceptance";

const store = vi.hoisted(() => ({
  list: [] as unknown[],
  gate: null as Promise<void> | null,
}));
vi.mock("../scheduled-jobs-store", () => ({
  loadScheduledJobs: async () => structuredClone(store.list),
  saveScheduledJobs: async (_config: unknown, next: unknown[]) => {
    if (store.gate) await store.gate;
    store.list = structuredClone(next);
  },
}));
vi.mock("../turso-portfolio", () => ({ listProjectRefs: async () => ({ active: [{ id: "p1", name: "Alpha" }], archived: [] }) }));
vi.mock("../portfolio-mode", () => ({ loadPortfolioMode: () => "turso", loadCurrentTursoProjectId: () => null }));

const TURSO = { httpUrl: "https://own-edit.example", authToken: "t" } as unknown as TursoConfig;
const settings: Settings = {
  ...defaultSettings,
  ai: { ...defaultSettings.ai, apiKey: "sk-test", enabled: true, consent: newConsent(new Date(0)), backgroundConsent: newConsent(new Date(0)), scheduledJobs: true },
};

function job(over: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: 1, name: "Daily risks", type: "portfolioAnalysis", cadence: { kind: "daily", timeOfDay: "09:00" }, enabled: true,
    projectId: "p1", timeZone: "UTC", key: "own-edit-key", instruction: "b", lastRunAt: null, history: [], ...over,
  };
}

/** Holds every save until the returned release is called. */
function holdSaves(): () => void {
  let release: () => void = () => {};
  store.gate = new Promise<void>((r) => { release = r; });
  return () => { store.gate = null; release(); };
}

const field = () => screen.getByRole("textbox", { name: `${t("en-US", "scheduledJobInstruction")} – Daily risks` });
const awaitingNotice = () => screen.queryByText(/shared jobs? needs? your OK/);

beforeEach(() => {
  localStorage.removeItem(ACCEPTANCE_KEY);
  store.list = [job()];
  store.gate = null;
});

describe("ScheduledJobsSection — an answer right after an instruction edit", () => {
  it("Accept clicked while the edit of a stopped job saves accepts the edited version, with no changed notice", async () => {
    declineJob(job());
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobStoppedHere"));
    await user.clear(field());
    await user.type(field(), "c");
    const release = holdSaves();
    await user.click(screen.getByRole("button", { name: "Accept: Daily risks" })); // the click blurs the field: its save is pending
    release();
    await waitFor(() => expect(screen.getByText(t("en-US", "scheduledJobAcceptedHere"))).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop on this device: Daily risks" })).not.toHaveAttribute("aria-disabled"));
    expect(acceptanceState(job({ instruction: "c" }))).toBe("accepted");
    expect(screen.queryByText(t("en-US", "scheduledJobAcceptChanged"))).toBeNull();
  });

  it("Stop clicked while the edit of an accepted job saves stops the edited version, which the notice does not count", async () => {
    acceptJob(job());
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobAcceptedHere"));
    await user.clear(field());
    await user.type(field(), "c");
    const release = holdSaves();
    await user.click(screen.getByRole("button", { name: "Stop on this device: Daily risks" }));
    release();
    await waitFor(() => expect(field()).toHaveValue("c"));
    await waitFor(() => expect(screen.getByText(t("en-US", "scheduledJobStoppedHere"))).toBeInTheDocument());
    expect(acceptanceState(job({ instruction: "c" }))).toBe("declined");
    expect(awaitingNotice()).toBeNull();
  });
});
