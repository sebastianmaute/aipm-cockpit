// An answer pressed right after an instruction edit, through the REAL hook and section (saves immediate, or held): a
// press on an answer button keeps focus in the field, so it answers the version shown and the edit saves on the next
// blur; while a save is in flight the buttons wait. An edit never answers.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScheduledJobsSection } from "./scheduled-jobs-section";
import { newConsent } from "../ai-consent";
import { defaultSettings, type Settings } from "../settings-types";
import { t } from "../i18n";
import type { ScheduledJob } from "../scheduled-jobs/types";
import type { TursoConfig } from "../turso-config";
import { __resetEditedHereForTests, ACCEPTANCE_KEY, acceptanceState, acceptJob, jobFingerprint, storedAcceptanceEntry } from "../scheduled-job-acceptance";

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
const storedEntry = () => storedAcceptanceEntry(KEY);

beforeEach(() => {
  localStorage.removeItem(ACCEPTANCE_KEY);
  __resetEditedHereForTests();
  store.list = [job()];
  store.gate = null;
  store.fail = false;
});
afterEach(() => { heldRelease(); heldRelease = () => {}; });

async function typeInstruction(user: ReturnType<typeof userEvent.setup>, text: string): Promise<void> {
  await user.clear(field());
  await user.type(field(), text);
}

describe("ScheduledJobsSection — a press answers the version shown, and waits for this device's saves", () => {
  it("Stop pressed right after typing (saves land at once) stops the version shown: the field keeps focus and nothing is saved by the press", async () => {
    acceptJob(job());
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobAcceptedHere"));
    await typeInstruction(user, "c");
    await user.click(screen.getByRole("button", { name: "Stop on this device: Daily risks" }));
    expect(document.activeElement).toBe(field()); // the press did not end the edit
    expect((store.list[0] as ScheduledJob).instruction).toBe("b"); // no save started
    expect(acceptanceState(job())).toBe("declined"); // the version that was shown
    expect(acceptanceState(job({ instruction: "c" }))).not.toBe("accepted");
    await user.click(document.body); // the edit saves on the next blur and then asks again
    await screen.findByText(t("en-US", "scheduledJobChangedHereStopped"));
    expect((store.list[0] as ScheduledJob).instruction).toBe("c");
    expect(acceptanceState(job({ instruction: "c" }))).toBe("declined-changed");
  });

  it("Accept pressed after typing back the accepted text accepts the version shown and records no Stop", async () => {
    store.list = [job({ instruction: "b" })];
    acceptJob(job({ instruction: "a" })); // this device accepted a; another device made it b
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobChanged"));
    await typeInstruction(user, "a");
    const writes = vi.spyOn(Storage.prototype, "setItem");
    let answers: string[] = [];
    try {
      await user.click(screen.getByRole("button", { name: "Accept: Daily risks" }));
      await waitFor(() => expect(acceptanceState(job({ instruction: "b" }))).toBe("accepted")); // the version shown
      answers = writes.mock.calls.filter(([k]) => k === ACCEPTANCE_KEY).map(([, v]) => JSON.parse(v as string)[KEY] as string);
    } finally {
      writes.mockRestore();
    }
    expect(answers.length).toBeGreaterThan(0);
    expect(answers.some((v) => v.startsWith("declined:"))).toBe(false); // no Stop the user did not press
    expect(document.activeElement).toBe(field());
    expect((store.list[0] as ScheduledJob).instruction).toBe("b");
    await user.click(document.body);
    await screen.findByText(t("en-US", "scheduledJobChangedHere"));
    expect(acceptanceState(job({ instruction: "a" }))).toBe("changed"); // a was not accepted by that press
  });

  it("Not on this device pressed right after typing on a never-answered job stops the version shown", async () => {
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    await typeInstruction(user, "c");
    await user.click(screen.getByRole("button", { name: "Not on this device: Daily risks" }));
    expect(document.activeElement).toBe(field());
    expect(acceptanceState(job())).toBe("declined");
    expect(acceptanceState(job({ instruction: "c" }))).not.toBe("accepted");
  });

  it("a press is ignored when a save started by another path changes the job before the release", async () => {
    acceptJob(job());
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobAcceptedHere"));
    const user = userEvent.setup();
    await typeInstruction(user, "c");
    const main = screen.getByRole("button", { name: "Stop on this device: Daily risks" });
    fireEvent.pointerDown(main);
    fireEvent.focusOut(field()); // the field's own blur saves the edit while the press is held
    await waitFor(() => expect(main).toHaveAccessibleName("Accept: Daily risks")); // the save landed: the label changed
    fireEvent.click(main);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(acceptanceState(job())).toBe("accepted"); // untouched: no Stop of b ...
    expect(acceptanceState(job({ instruction: "c" }))).toBe("changed"); // ... and no Accept of c
    expect(screen.getByText(t("en-US", "scheduledJobPressIgnored"))).toBeInTheDocument(); // the ignored press says so
    // The next valid press answers and clears the notice.
    fireEvent.pointerDown(main);
    fireEvent.click(main);
    await waitFor(() => expect(acceptanceState(job({ instruction: "c" }))).toBe("accepted"));
    expect(screen.queryByText(t("en-US", "scheduledJobPressIgnored"))).toBeNull();
  });

  it("a press that began while saving is ignored even when the save ends before the release", async () => {
    acceptJob(job());
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobAcceptedHere"));
    await typeInstruction(user, "c");
    const release = holdSaves();
    await user.click(document.body);
    const main = screen.getByRole("button", { name: `${saving} Stop on this device: Daily risks` });
    fireEvent.pointerDown(main);
    release();
    await waitFor(() => expect(main).toHaveAccessibleName("Accept: Daily risks"));
    fireEvent.click(main);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(acceptanceState(job({ instruction: "c" }))).toBe("changed");
  });

  it("Space held on Saving… Stop across the end of the save answers nothing (accepted b, typed c)", async () => {
    acceptJob(job());
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobAcceptedHere"));
    await typeInstruction(user, "c");
    const release = holdSaves();
    await user.tab(); // the field's blur starts the (held) save; focus lands on the main button
    const main = screen.getByRole("button", { name: `${saving} Stop on this device: Daily risks` });
    expect(document.activeElement).toBe(main);
    await user.keyboard("[Space>]"); // pressed while saving ...
    release();
    await waitFor(() => expect(main).toHaveAccessibleName("Accept: Daily risks"));
    await user.keyboard("[/Space]"); // ... released after the save: the click must not answer the new version
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(acceptanceState(job({ instruction: "c" }))).toBe("changed");
    expect(acceptanceState(job())).toBe("accepted"); // and no Stop of b either
  });

  it("Space held on Saving… Accept across the end of a revert's save records no Stop (accepted a, stored b, typed a)", async () => {
    store.list = [job({ instruction: "b" })];
    acceptJob(job({ instruction: "a" }));
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobChanged"));
    await typeInstruction(user, "a");
    const release = holdSaves();
    await user.tab();
    const main = screen.getByRole("button", { name: `${saving} Accept: Daily risks` });
    await user.keyboard("[Space>]");
    release();
    await waitFor(() => expect(main).toHaveAccessibleName("Stop on this device: Daily risks"));
    await user.keyboard("[/Space]");
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(acceptanceState(job({ instruction: "a" }))).toBe("accepted"); // the earlier answer stands: no Stop recorded
  });

  it("a failed save keeps the draft and blocks the answers (Not saved); the next blur retries and the job asks again", async () => {
    acceptJob(job());
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobAcceptedHere"));
    await typeInstruction(user, "c");
    store.fail = true;
    await user.click(document.body); // blur: the save fails
    await screen.findByText(t("en-US", "scheduledJobChangeNotSaved"));
    const notSaved = t("en-US", "scheduledJobNotSaved");
    const main = screen.getByRole("button", { name: `${notSaved} Stop on this device: Daily risks` });
    expect(main).toHaveAttribute("aria-disabled", "true");
    expect(main).toHaveTextContent(notSaved);
    expect(field()).toHaveValue("c"); // the draft is kept
    fireEvent.pointerDown(main);
    fireEvent.click(main);
    expect(acceptanceState(job())).toBe("accepted"); // the Stop wrote nothing
    expect(screen.queryByText(t("en-US", "scheduledJobPressIgnored"))).toBeNull(); // visibly blocked: silence
    store.fail = false;
    await user.click(field());
    await user.click(document.body); // the next blur retries
    await screen.findByText(t("en-US", "scheduledJobChangedHere"));
    expect((store.list[0] as ScheduledJob).instruction).toBe("c");
    expect(screen.getByRole("button", { name: "Accept: Daily risks" })).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByText(t("en-US", "scheduledJobChangeNotSaved"))).toBeNull();
  });

  it("a change from another device while a draft is open drops the draft instead of writing it over the change", async () => {
    acceptJob(job());
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobAcceptedHere"));
    await typeInstruction(user, "c");
    store.list = [job({ instruction: "d" })]; // another device saves d
    act(() => { window.dispatchEvent(new Event("focus")); }); // the list is read again
    await screen.findByText(t("en-US", "scheduledJobDraftDropped"));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect((store.list[0] as ScheduledJob).instruction).toBe("d");
    expect(field()).toHaveValue("d");
    await user.click(document.body); // leaving the field writes nothing either
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect((store.list[0] as ScheduledJob).instruction).toBe("d");
    expect(storedEntry()).toBe(jobFingerprint(job())); // nothing answered
  });

  it("keyboard: Enter on the focused Stop button answers", async () => {
    acceptJob(job());
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobAcceptedHere"));
    act(() => { screen.getByRole("button", { name: "Stop on this device: Daily risks" }).focus(); });
    await user.keyboard("{Enter}");
    expect(acceptanceState(job())).toBe("declined");
  });

  it("a held save that fails moves the buttons from Saving… to Not saved and leaves the answer as it was", async () => {
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
    const stop = await screen.findByRole("button", { name: `${t("en-US", "scheduledJobNotSaved")} Stop on this device: Daily risks` });
    expect(stop).toHaveAttribute("aria-disabled", "true"); // the field still shows the unsaved c
    expect(acceptanceState(job())).toBe("accepted");
    expect(screen.queryByText(t("en-US", "scheduledJobChangedHere"))).toBeNull();
  });
});
