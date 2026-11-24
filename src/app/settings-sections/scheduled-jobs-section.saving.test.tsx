// An answer clicked right after an instruction edit, through the REAL hook and section with saves held: the click
// blurs the field, which starts the save, and the row's answer buttons wait for that save. An edit never answers.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScheduledJobsSection } from "./scheduled-jobs-section";
import { newConsent } from "../ai-consent";
import { defaultSettings, type Settings } from "../settings-types";
import { t } from "../i18n";
import type { ScheduledJob } from "../scheduled-jobs/types";
import type { TursoConfig } from "../turso-config";
import { ACCEPTANCE_KEY, acceptanceState, acceptJob, clearEditedHere } from "../scheduled-job-acceptance";

const store = vi.hoisted(() => ({
  list: [] as unknown[],
  gate: null as Promise<void> | null,
  fail: false,
}));
vi.mock("../scheduled-jobs-store", () => ({
  loadScheduledJobs: async () => structuredClone(store.list),
  saveScheduledJobs: async (_config: unknown, next: unknown[]) => {
    if (store.gate) await store.gate;
    if (store.fail) throw new Error("offline");
    store.list = structuredClone(next);
  },
}));
vi.mock("../turso-portfolio", () => ({ listProjectRefs: async () => ({ active: [{ id: "p1", name: "Alpha" }], archived: [] }) }));
vi.mock("../portfolio-mode", () => ({ loadPortfolioMode: () => "turso", loadCurrentTursoProjectId: () => null }));

const TURSO = { httpUrl: "https://saving.example", authToken: "t" } as unknown as TursoConfig;
const settings: Settings = {
  ...defaultSettings,
  ai: { ...defaultSettings.ai, apiKey: "sk-test", enabled: true, consent: newConsent(new Date(0)), backgroundConsent: newConsent(new Date(0)), scheduledJobs: true },
};
const KEY = "saving-section-key";

function job(over: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: 1, name: "Daily risks", type: "portfolioAnalysis", cadence: { kind: "daily", timeOfDay: "09:00" }, enabled: true,
    projectId: "p1", timeZone: "UTC", key: KEY, instruction: "b", lastRunAt: null, history: [], ...over,
  };
}

/** Holds every save until the returned release is called; a test that fails meanwhile is released in afterEach, so
 *  the shared write chain is never left blocked for the next test. */
let heldRelease: () => void = () => {};
function holdSaves(): () => void {
  let release: () => void = () => {};
  store.gate = new Promise<void>((r) => { release = r; });
  heldRelease = () => { store.gate = null; release(); };
  return heldRelease;
}

const field = () => screen.getByRole("textbox", { name: `${t("en-US", "scheduledJobInstruction")} – Daily risks` });
const saving = t("en-US", "scheduledJobSaving");

beforeEach(() => {
  localStorage.removeItem(ACCEPTANCE_KEY);
  clearEditedHere(KEY);
  store.list = [job()];
  store.gate = null;
  store.fail = false;
});
afterEach(() => { heldRelease(); heldRelease = () => {}; });

async function typeInstruction(user: ReturnType<typeof userEvent.setup>, text: string): Promise<void> {
  await user.clear(field());
  await user.type(field(), text);
}

describe("ScheduledJobsSection — answers wait for this device's save", () => {
  it("Stop clicked right after editing an accepted job does nothing; after the save the job asks again, and Accept accepts the new version", async () => {
    acceptJob(job());
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobAcceptedHere"));
    await typeInstruction(user, "c");
    const release = holdSaves();
    await user.click(screen.getByRole("button", { name: "Stop on this device: Daily risks" })); // the click blurs the field
    const main = screen.getByRole("button", { name: `${saving} Stop on this device: Daily risks` });
    expect(main).toHaveAttribute("aria-disabled", "true");
    expect(acceptanceState(job())).toBe("accepted"); // the Stop did nothing
    release();
    await screen.findByText(t("en-US", "scheduledJobChangedHere"));
    expect(acceptanceState(job({ instruction: "c" }))).toBe("changed");
    await user.click(screen.getByRole("button", { name: "Accept: Daily risks" }));
    await waitFor(() => expect(screen.getByText(t("en-US", "scheduledJobAcceptedHere"))).toBeInTheDocument());
    expect(acceptanceState(job({ instruction: "c" }))).toBe("accepted");
  });

  it("Not on this device clicked right after editing a never-answered job does nothing until the save; then it stops the new version", async () => {
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    await typeInstruction(user, "c");
    const release = holdSaves();
    await user.click(screen.getByRole("button", { name: "Not on this device: Daily risks" }));
    expect(screen.getByRole("button", { name: `${saving} Not on this device: Daily risks` })).toHaveAttribute("aria-disabled", "true");
    expect(localStorage.getItem(ACCEPTANCE_KEY)).toBeNull(); // nothing was answered
    release();
    await waitFor(() => expect(field()).toHaveValue("c"));
    await user.click(await screen.findByRole("button", { name: "Not on this device: Daily risks" }));
    await waitFor(() => expect(screen.getByText(t("en-US", "scheduledJobStoppedHere"))).toBeInTheDocument());
    expect(acceptanceState(job({ instruction: "c" }))).toBe("declined");
  });

  it("a failed save re-enables the buttons and leaves the answer as it was", async () => {
    acceptJob(job());
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobAcceptedHere"));
    await typeInstruction(user, "c");
    const release = holdSaves();
    store.fail = true;
    await user.click(document.body); // blur: the save starts
    expect(screen.getByRole("button", { name: `${saving} Stop on this device: Daily risks` })).toHaveAttribute("aria-disabled", "true");
    release();
    await screen.findByText(t("en-US", "scheduledJobsWriteFailed"));
    const stop = await screen.findByRole("button", { name: "Stop on this device: Daily risks" });
    expect(stop).not.toHaveAttribute("aria-disabled");
    expect(acceptanceState(job())).toBe("accepted");
    expect(screen.queryByText(t("en-US", "scheduledJobChangedHere"))).toBeNull();
  });
});
