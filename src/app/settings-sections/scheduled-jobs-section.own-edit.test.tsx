// An answer given right after an instruction edit, through the REAL hook and the real Accept / Stop paths: the edit
// records this device's answer when it is called, so the click that blurs the field means the version being saved.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScheduledJobsSection } from "./scheduled-jobs-section";
import { newConsent } from "../ai-consent";
import { defaultSettings, type Settings } from "../settings-types";
import { t } from "../i18n";
import type { ScheduledJob } from "../scheduled-jobs/types";
import type { TursoConfig } from "../turso-config";
import { ACCEPTANCE_KEY, acceptanceState, acceptJob, declineJob } from "../scheduled-job-acceptance";
import { forgetOwnEdit } from "../scheduled-job-own-edit";

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
  const releaseSaves = () => { store.gate = null; release(); };
  heldRelease = releaseSaves;
  return releaseSaves;
}

/** A test that fails while saves are held must not leave the shared write chain blocked for the next one. */
let heldRelease: () => void = () => {};
afterEach(() => {
  heldRelease();
  heldRelease = () => {};
});

const field = () => screen.getByRole("textbox", { name: `${t("en-US", "scheduledJobInstruction")} – Daily risks` });
const awaitingNotice = () => screen.queryByText(/shared jobs? needs? your OK/);

beforeEach(() => {
  forgetOwnEdit("own-edit-key");
  localStorage.removeItem(ACCEPTANCE_KEY);
  store.list = [job()];
  store.gate = null;
  store.fail = false;
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

  it("Accept clicked right after editing a job this device never answered accepts the edited version", async () => {
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    await user.clear(field());
    await user.type(field(), "c");
    const release = holdSaves();
    await user.click(screen.getByRole("button", { name: "Accept: Daily risks" }));
    release();
    await waitFor(() => expect(screen.getByText(t("en-US", "scheduledJobAcceptedHere"))).toBeInTheDocument());
    expect(acceptanceState(job({ instruction: "c" }))).toBe("accepted");
    expect(screen.queryByText(t("en-US", "scheduledJobAcceptChanged"))).toBeNull();
  });

  it("Not on this device clicked right after editing a job this device never answered stops the edited version", async () => {
    const user = userEvent.setup();
    const accepts = vi.spyOn(Storage.prototype, "setItem");
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    await user.clear(field());
    await user.type(field(), "c");
    const release = holdSaves();
    await user.click(screen.getByRole("button", { name: "Not on this device: Daily risks" }));
    release();
    await waitFor(() => expect(field()).toHaveValue("c"));
    await waitFor(() => expect(screen.getByText(t("en-US", "scheduledJobStoppedHere"))).toBeInTheDocument());
    expect(acceptanceState(job({ instruction: "c" }))).toBe("declined");
    const answers = accepts.mock.calls.filter(([k]) => k === ACCEPTANCE_KEY).map(([, v]) => JSON.parse(v as string)["own-edit-key"]);
    expect(answers.every((v: string) => v.startsWith("declined:"))).toBe(true); // never accepted on the way
    accepts.mockRestore();
  });

  it("Not on this device clicked right after editing a job that changed since it was accepted stops the edited version", async () => {
    acceptJob(job({ instruction: "a" }));
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobChanged"));
    await user.clear(field());
    await user.type(field(), "c");
    const release = holdSaves();
    await user.click(screen.getByRole("button", { name: "Not on this device: Daily risks" }));
    release();
    await waitFor(() => expect(field()).toHaveValue("c"));
    await waitFor(() => expect(screen.getByText(t("en-US", "scheduledJobStoppedHere"))).toBeInTheDocument());
    expect(acceptanceState(job({ instruction: "c" }))).toBe("declined");
  });

  it("Stop right after an edit whose save then fails stops the version the store still holds", async () => {
    acceptJob(job());
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobAcceptedHere"));
    await user.clear(field());
    await user.type(field(), "c");
    const release = holdSaves();
    store.fail = true;
    await user.click(screen.getByRole("button", { name: "Stop on this device: Daily risks" }));
    release();
    await screen.findByText(t("en-US", "scheduledJobsWriteFailed"));
    await waitFor(() => expect(screen.getByText(t("en-US", "scheduledJobStoppedHere"))).toBeInTheDocument());
    expect(acceptanceState(job())).toBe("declined");
  });

  it("Accept right after editing a stopped job whose save then fails says the change was not saved and accepts nothing", async () => {
    declineJob(job());
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobStoppedHere"));
    await user.clear(field());
    await user.type(field(), "c");
    const release = holdSaves();
    store.fail = true;
    await user.click(screen.getByRole("button", { name: "Accept: Daily risks" }));
    release();
    expect(await screen.findByText(t("en-US", "scheduledJobAcceptNotSaved"))).toBeInTheDocument();
    expect(acceptanceState(job())).toBe("declined");
    expect(acceptanceState(job({ instruction: "c" }))).not.toBe("accepted");
  });

  it("Accept right after editing a job this device never answered, whose save then fails, accepts nothing", async () => {
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    await user.clear(field());
    await user.type(field(), "c");
    const release = holdSaves();
    store.fail = true;
    await user.click(screen.getByRole("button", { name: "Accept: Daily risks" }));
    release();
    expect(await screen.findByText(t("en-US", "scheduledJobAcceptNotSaved"))).toBeInTheDocument();
    expect(acceptanceState(job())).toBe("none");
  });

  /** Every acceptance value this device wrote for the job while `run` ran. */
  async function answersDuring(run: () => Promise<void>): Promise<string[]> {
    const writes = vi.spyOn(Storage.prototype, "setItem");
    let calls: unknown[][] = [];
    try {
      await run();
    } finally {
      calls = [...writes.mock.calls]; // read before mockRestore, which clears them
      writes.mockRestore();
    }
    return calls.filter(([k]) => k === ACCEPTANCE_KEY).map(([, v]) => JSON.parse(v as string)["own-edit-key"] as string);
  }

  it("a job changed elsewhere, typed back to the version this device accepted, then Accept: ends accepted, never stopped", async () => {
    store.list = [job({ instruction: "b" })];
    acceptJob(job({ instruction: "a" }));
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobChanged"));
    await user.clear(field());
    await user.type(field(), "a");
    const answers = await answersDuring(async () => {
      const release = holdSaves();
      await user.click(screen.getByRole("button", { name: "Accept: Daily risks" }));
      expect(screen.getByText(t("en-US", "scheduledJobChanged"))).toBeInTheDocument(); // nothing changed under the cursor
      release();
      await waitFor(() => expect(field()).toHaveValue("a"));
      await waitFor(() => expect(screen.getByText(t("en-US", "scheduledJobAcceptedHere"))).toBeInTheDocument());
    });
    expect(acceptanceState(job({ instruction: "a" }))).toBe("accepted"); // the stored answer for a stood, untouched
    expect(answers.some((v) => v.startsWith("declined:"))).toBe(false);
  });

  it("a job changed elsewhere, typed back to the version this device accepted, then Not on this device: ends stopped, never accepted", async () => {
    store.list = [job({ instruction: "b" })];
    acceptJob(job({ instruction: "a" }));
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobChanged"));
    await user.clear(field());
    await user.type(field(), "a");
    const answers = await answersDuring(async () => {
      const release = holdSaves();
      await user.click(screen.getByRole("button", { name: "Not on this device: Daily risks" }));
      release();
      await waitFor(() => expect(field()).toHaveValue("a"));
      await waitFor(() => expect(screen.getByText(t("en-US", "scheduledJobStoppedHere"))).toBeInTheDocument());
    });
    expect(acceptanceState(job({ instruction: "a" }))).toBe("declined");
    expect(answers.length).toBeGreaterThan(0);
    expect(answers.every((v) => v.startsWith("declined:"))).toBe(true);
  });

  it("a stopped job changed elsewhere, edited, then Not on this device with a failing save: ends stopped (the click is not lost)", async () => {
    declineJob(job({ instruction: "a" }));
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobChangedElsewhere"));
    await user.clear(field());
    await user.type(field(), "c");
    const release = holdSaves();
    store.fail = true;
    await user.click(screen.getByRole("button", { name: "Not on this device: Daily risks" }));
    release();
    await screen.findByText(t("en-US", "scheduledJobsWriteFailed"));
    await waitFor(() => expect(screen.getByText(t("en-US", "scheduledJobStoppedHere"))).toBeInTheDocument());
    expect(acceptanceState(job())).toBe("declined");
  });
});
