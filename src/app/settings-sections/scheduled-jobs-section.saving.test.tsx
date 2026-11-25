// An answer pressed right after an instruction edit, through the REAL hook and section (saves immediate, or held): a
// press on an answer button keeps focus in the field, so it answers the version shown and the edit saves on the next
// blur; while a save is in flight the buttons wait. An edit never answers.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScheduledJobsSection } from "./scheduled-jobs-section";
import { JobRow } from "./scheduled-job-row";
import { useScheduledJobs, type UpdateJobOptions } from "../use-scheduled-jobs";
import type { JobPatch } from "./use-instruction-draft";
import { newConsent } from "../ai-consent";
import { defaultSettings, type Settings } from "../settings-types";
import { t } from "../i18n";
import type { ScheduledJob } from "../scheduled-jobs/types";
import type { TursoConfig } from "../turso-config";
import { __resetEditedHereForTests, ACCEPTANCE_KEY, acceptanceState, acceptJob, jobFingerprint, storedAcceptanceEntry } from "../scheduled-job-acceptance";

/** The portfolio this file's answers are kept for (`acceptanceScope`). */
const SCOPE = "https://saving.example";

const store = vi.hoisted(() => ({
  list: [] as unknown[],
  gate: null as Promise<void> | null,
  fail: false,
  failOnce: false,
  afterSaveOnce: null as (() => void) | null,
  loadGate: null as Promise<void> | null,
  /** Called once, right after the next list read took its copy (another device writing just after that read). */
  afterNextLoad: null as (() => void) | null,
}));
vi.mock("../scheduled-jobs-store", () => ({
  loadScheduledJobs: async () => {
    if (store.loadGate) await store.loadGate;
    const copy = structuredClone(store.list);
    const after = store.afterNextLoad;
    store.afterNextLoad = null;
    after?.();
    return copy;
  },
  saveScheduledJobs: async (_config: unknown, next: unknown[]) => {
    if (store.gate) await store.gate;
    if (store.fail) throw new Error("offline");
    if (store.failOnce) {
      store.failOnce = false;
      throw new Error("offline");
    }
    store.list = structuredClone(next);
    const after = store.afterSaveOnce;
    store.afterSaveOnce = null;
    after?.();
  },
}));
vi.mock("../turso-portfolio", () => ({ listProjectRefs: async () => ({ active: [{ id: "p1", name: "Alpha" }], archived: [] }) }));
vi.mock("../portfolio-mode", () => ({ loadPortfolioMode: () => "turso", loadCurrentTursoProjectId: () => null }));

const TURSO = { httpUrl: "https://saving.example", authToken: "t" } as unknown as TursoConfig;
const TURSO_B = { httpUrl: "https://saving-other.example", authToken: "t" } as unknown as TursoConfig;
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

/** A job a newer version rewrote, exactly as the real decoder reads it (the store module is mocked here). */
async function decodedForeign(over: Record<string, unknown> = {}): Promise<ScheduledJob> {
  const actual = await vi.importActual<typeof import("../scheduled-jobs-store")>("../scheduled-jobs-store");
  const raw = { ...actual.serializeJob(job()), type: "somethingNew", ...over };
  localStorage.setItem(actual.LOCAL_KEY, JSON.stringify([raw]));
  try {
    const [decoded] = await actual.loadScheduledJobs(null);
    return decoded;
  } finally {
    localStorage.removeItem(actual.LOCAL_KEY);
  }
}

const field = () => screen.getByRole("textbox", { name: `${t("en-US", "scheduledJobInstruction")} – Daily risks` });
const saving = t("en-US", "scheduledJobSaving");
const storedEntry = () => storedAcceptanceEntry(KEY, SCOPE);
const stored = () => (store.list[0] as ScheduledJob).instruction;
const sleep = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeEach(() => {
  sessionStorage.clear();
  localStorage.removeItem(ACCEPTANCE_KEY);
  __resetEditedHereForTests();
  store.list = [job()];
  store.gate = null;
  store.fail = false;
  store.failOnce = false;
  store.afterSaveOnce = null;
  store.loadGate = null;
  store.afterNextLoad = null;
});
afterEach(() => { heldRelease(); heldRelease = () => {}; loadRelease(); loadRelease = () => {}; });

/** Holds every read of the job list (so queued writes have not read it yet) until the returned release is called. */
let loadRelease: () => void = () => {};
function holdLoads(): () => void {
  let release: () => void = () => {};
  store.loadGate = new Promise<void>((r) => { release = r; });
  loadRelease = () => { store.loadGate = null; release(); };
  return loadRelease;
}

async function typeInstruction(user: ReturnType<typeof userEvent.setup>, text: string): Promise<void> {
  await user.clear(field());
  await user.type(field(), text);
}

describe("ScheduledJobsSection — a press answers the version shown, and waits for this device's saves", () => {
  it("Stop pressed right after typing (saves land at once) stops the version shown: the field keeps focus and nothing is saved by the press", async () => {
    acceptJob(job(), SCOPE);
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobAcceptedHere"));
    await typeInstruction(user, "c");
    await user.click(screen.getByRole("button", { name: "Stop on this device: Daily risks" }));
    expect(document.activeElement).toBe(field()); // the press did not end the edit
    expect((store.list[0] as ScheduledJob).instruction).toBe("b"); // no save started
    expect(acceptanceState(job(), SCOPE)).toBe("declined"); // the version that was shown
    expect(acceptanceState(job({ instruction: "c" }), SCOPE)).not.toBe("accepted");
    await user.click(document.body); // the edit saves on the next blur and then asks again
    await screen.findByText(t("en-US", "scheduledJobChangedHereStopped"));
    expect((store.list[0] as ScheduledJob).instruction).toBe("c");
    expect(acceptanceState(job({ instruction: "c" }), SCOPE)).toBe("declined-changed");
  });

  it("Accept pressed after typing back the accepted text accepts the version shown and records no Stop", async () => {
    store.list = [job({ instruction: "b" })];
    acceptJob(job({ instruction: "a" }), SCOPE); // this device accepted a; another device made it b
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobChanged"));
    await typeInstruction(user, "a");
    const writes = vi.spyOn(Storage.prototype, "setItem");
    let answers: string[] = [];
    try {
      await user.click(screen.getByRole("button", { name: "Accept: Daily risks" }));
      await waitFor(() => expect(acceptanceState(job({ instruction: "b" }), SCOPE)).toBe("accepted")); // the version shown
      answers = writes.mock.calls.filter(([k]) => k === ACCEPTANCE_KEY).map(([, v]) => JSON.parse(v as string)[`${SCOPE}|${KEY}`] as string);
    } finally {
      writes.mockRestore();
    }
    expect(answers.length).toBeGreaterThan(0);
    expect(answers.some((v) => v.startsWith("declined:"))).toBe(false); // no Stop the user did not press
    expect(document.activeElement).toBe(field());
    expect((store.list[0] as ScheduledJob).instruction).toBe("b");
    await user.click(document.body);
    await screen.findByText(t("en-US", "scheduledJobChangedHere"));
    expect(acceptanceState(job({ instruction: "a" }), SCOPE)).toBe("changed"); // a was not accepted by that press
  });

  it("Not on this device pressed right after typing on a never-answered job stops the version shown", async () => {
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    await typeInstruction(user, "c");
    await user.click(screen.getByRole("button", { name: "Not on this device: Daily risks" }));
    expect(document.activeElement).toBe(field());
    expect(acceptanceState(job(), SCOPE)).toBe("declined");
    expect(acceptanceState(job({ instruction: "c" }), SCOPE)).not.toBe("accepted");
  });

  it("a press is ignored when a save started by another path changes the job before the release", async () => {
    acceptJob(job(), SCOPE);
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
    expect(acceptanceState(job(), SCOPE)).toBe("accepted"); // untouched: no Stop of b ...
    expect(acceptanceState(job({ instruction: "c" }), SCOPE)).toBe("changed"); // ... and no Accept of c
    expect(screen.getByText(t("en-US", "scheduledJobPressIgnored"))).toBeInTheDocument(); // the ignored press says so
    // The next valid press answers and clears the notice.
    fireEvent.pointerDown(main);
    fireEvent.click(main);
    await waitFor(() => expect(acceptanceState(job({ instruction: "c" }), SCOPE)).toBe("accepted"));
    expect(screen.queryByText(t("en-US", "scheduledJobPressIgnored"))).toBeNull();
  });

  it("a press that began while saving is ignored even when the save ends before the release", async () => {
    acceptJob(job(), SCOPE);
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
    expect(acceptanceState(job({ instruction: "c" }), SCOPE)).toBe("changed");
  });

  it("Space held on Saving… Stop across the end of the save answers nothing (accepted b, typed c)", async () => {
    acceptJob(job(), SCOPE);
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
    expect(acceptanceState(job({ instruction: "c" }), SCOPE)).toBe("changed");
    expect(acceptanceState(job(), SCOPE)).toBe("accepted"); // and no Stop of b either
  });

  it("Space held on Saving… Accept across the end of a revert's save records no Stop (accepted a, stored b, typed a)", async () => {
    store.list = [job({ instruction: "b" })];
    acceptJob(job({ instruction: "a" }), SCOPE);
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
    expect(acceptanceState(job({ instruction: "a" }), SCOPE)).toBe("accepted"); // the earlier answer stands: no Stop recorded
  });

  it("a failed save keeps the draft and blocks the answers (Not saved); the next blur retries and the job asks again", async () => {
    acceptJob(job(), SCOPE);
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
    expect(acceptanceState(job(), SCOPE)).toBe("accepted"); // the Stop wrote nothing
    expect(screen.queryByText(t("en-US", "scheduledJobPressIgnored"))).toBeNull(); // visibly blocked: silence
    store.fail = false;
    await user.click(field());
    await user.click(document.body); // the next blur retries
    await screen.findByText(t("en-US", "scheduledJobChangedHere"));
    expect((store.list[0] as ScheduledJob).instruction).toBe("c");
    expect(screen.getByRole("button", { name: "Accept: Daily risks" })).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByText(t("en-US", "scheduledJobChangeNotSaved"))).toBeNull();
  });

  it("a change from another device that this tab has NOT re-read is not overwritten by the draft's save", async () => {
    acceptJob(job(), SCOPE);
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobAcceptedHere"));
    await typeInstruction(user, "c");
    store.list = [job({ instruction: "d" })]; // another device saves d; this tab does not know yet
    await user.click(document.body); // the draft's save started from b: refused
    await screen.findByText(t("en-US", "scheduledJobDraftDropped"));
    await sleep(50);
    expect(stored()).toBe("d");
    expect(field()).toHaveValue("d");
    expect(screen.queryByText(t("en-US", "scheduledJobsWriteFailed"))).toBeNull(); // not a failed save ...
    expect(screen.queryByText(t("en-US", "scheduledJobChangeNotSaved"))).toBeNull(); // ... and not "not saved"
    expect(storedEntry()).toBe(jobFingerprint(job())); // nothing answered
  });

  it("a change from another device seen by a re-read keeps the draft until its save is refused the same way", async () => {
    acceptJob(job(), SCOPE);
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobAcceptedHere"));
    await typeInstruction(user, "c");
    store.list = [job({ instruction: "d" })];
    act(() => { window.dispatchEvent(new Event("focus")); }); // the list is read again
    await sleep(50);
    expect(field()).toHaveValue("c"); // the draft stays while it is open
    await user.click(document.body);
    await screen.findByText(t("en-US", "scheduledJobDraftDropped"));
    await sleep(50);
    expect(stored()).toBe("d");
    expect(field()).toHaveValue("d");
    expect(storedEntry()).toBe(jobFingerprint(job()));
  });

  it("this tab's own save landing while the user keeps typing keeps the draft, with no notice, and the next blur saves it", async () => {
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    const release = holdSaves();
    await typeInstruction(user, "c");
    fireEvent.focusOut(field()); // save of c, held
    await sleep(10);
    await user.type(field(), "d");
    release();
    await sleep(80);
    expect(field()).toHaveValue("cd");
    expect(stored()).toBe("c");
    expect(screen.queryByText(t("en-US", "scheduledJobDraftDropped"))).toBeNull();
    fireEvent.focusOut(field());
    await sleep(80);
    expect(stored()).toBe("cd");
    expect(screen.queryByText(t("en-US", "scheduledJobDraftDropped"))).toBeNull();
  });

  it("two held saves from two blurs both land, with no notice", async () => {
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    const release = holdSaves();
    await typeInstruction(user, "c");
    fireEvent.focusOut(field());
    await sleep(10);
    await user.type(field(), "d");
    fireEvent.focusOut(field());
    await sleep(10);
    release();
    await sleep(120);
    expect(stored()).toBe("cd");
    expect(field()).toHaveValue("cd");
    expect(screen.queryByText(t("en-US", "scheduledJobDraftDropped"))).toBeNull();
  });

  it("a failed save of text the user has since typed back to the stored text leaves the buttons usable", async () => {
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    const release = holdSaves();
    store.fail = true;
    await typeInstruction(user, "c");
    fireEvent.focusOut(field());
    await sleep(10);
    await typeInstruction(user, "b");
    release();
    await sleep(80);
    // The failed text is no longer in the field: nothing is "not saved", even before the next blur.
    expect(screen.getByRole("button", { name: "Accept: Daily risks" })).not.toHaveAttribute("aria-disabled");
    store.fail = false;
    fireEvent.focusOut(field());
    await sleep(80);
    expect(screen.getByRole("button", { name: "Accept: Daily risks" })).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByText(t("en-US", "scheduledJobNotSaved"))).toBeNull();
    expect(screen.queryByText(t("en-US", "scheduledJobChangeNotSaved"))).toBeNull();
  });

  it("a held Enter (key repeat) never answers again after the first answer lands", async () => {
    store.list = [job({ instruction: "b" })];
    acceptJob(job({ instruction: "a" }), SCOPE);
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobChanged"));
    const btn = screen.getByRole("button", { name: "Accept: Daily risks" });
    act(() => { btn.focus(); });
    fireEvent.keyDown(btn, { key: "Enter" });
    fireEvent.click(btn);
    await sleep(60);
    expect(acceptanceState(job(), SCOPE)).toBe("accepted");
    expect(btn).toHaveAccessibleName("Stop on this device: Daily risks");
    const repeat = fireEvent.keyDown(btn, { key: "Enter", repeat: true });
    expect(repeat).toBe(false); // default prevented: no further click from the browser
    fireEvent.click(btn); // a click that still arrives while the key repeats is ignored, silently
    await sleep(30);
    expect(acceptanceState(job(), SCOPE)).toBe("accepted");
    expect(screen.queryByText(t("en-US", "scheduledJobPressIgnored"))).toBeNull();
    fireEvent.keyUp(btn, { key: "Enter" });
    fireEvent.keyDown(btn, { key: "Enter" }); // a new press after the release answers again
    fireEvent.click(btn);
    expect(acceptanceState(job(), SCOPE)).toBe("declined");
  });

  it("typing back to the start text while this row's save is held keeps the typed text when that save lands; the next blur saves it", async () => {
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    const release = holdSaves();
    await typeInstruction(user, "c");
    fireEvent.focusOut(field()); // save of c, held
    await sleep(10);
    await typeInstruction(user, "b"); // typed back to the start text
    release();
    await sleep(80);
    expect(stored()).toBe("c");
    expect(field()).toHaveValue("b"); // the landing save does not overwrite the field
    fireEvent.focusOut(field());
    await sleep(80);
    expect(stored()).toBe("b"); // saved over c, the text this row wrote
    expect(screen.queryByText(t("en-US", "scheduledJobDraftDropped"))).toBeNull();
  });

  it("another device reverting the job right after this row's first save lands refuses the second save", async () => {
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    const release = holdSaves();
    await typeInstruction(user, "c");
    fireEvent.focusOut(field());
    await sleep(10);
    await user.type(field(), "d");
    fireEvent.focusOut(field());
    await sleep(10);
    store.afterSaveOnce = () => { store.list = [job({ instruction: "b" })]; }; // another device reverts to b at once
    release();
    await screen.findByText(t("en-US", "scheduledJobDraftDropped"));
    await sleep(50);
    expect(stored()).toBe("b");
    expect(field()).toHaveValue("b");
  });

  it("after this row's first save failed, a change from another device to that same text still refuses the second save", async () => {
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    const release = holdSaves();
    store.failOnce = true;
    await typeInstruction(user, "c");
    fireEvent.focusOut(field()); // fails
    await sleep(10);
    await user.type(field(), "d");
    fireEvent.focusOut(field()); // cd, started from b
    await sleep(10);
    store.list = [job({ instruction: "c" })]; // another device stores c
    release();
    await screen.findByText(t("en-US", "scheduledJobDraftDropped"));
    await sleep(50);
    expect(stored()).toBe("c");
    expect(field()).toHaveValue("c");
  });

  it("another device storing exactly the draft's text is not a dropped draft", async () => {
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    await typeInstruction(user, "c");
    store.list = [job({ instruction: "c" })]; // the same text, saved elsewhere
    fireEvent.focusOut(field());
    await sleep(80);
    expect(stored()).toBe("c");
    expect(field()).toHaveValue("c");
    expect(screen.queryByText(t("en-US", "scheduledJobDraftDropped"))).toBeNull();
    // Seen by a re-read first, too: the draft rebases with no notice.
    await typeInstruction(user, "e");
    store.list = [job({ instruction: "e" })];
    act(() => { window.dispatchEvent(new Event("focus")); });
    await sleep(50);
    fireEvent.focusOut(field());
    await sleep(80);
    expect(stored()).toBe("e");
    expect(screen.queryByText(t("en-US", "scheduledJobDraftDropped"))).toBeNull();
  });

  /** Two own saves (c, then cd) queued before either read the list; another device stores x meanwhile. */
  async function refusedWithOneQueued(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    const release = holdLoads();
    await typeInstruction(user, "c");
    fireEvent.focusOut(field());
    await sleep(10);
    await user.type(field(), "d");
    fireEvent.focusOut(field());
    await sleep(10);
    store.list = [job({ instruction: "x" })];
    release();
    await sleep(150);
  }

  it("a refused save refuses this row's queued saves too: the other device's text stands and the field shows it", async () => {
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    await refusedWithOneQueued(user);
    expect(stored()).toBe("x");
    expect(field()).toHaveValue("x");
    expect(screen.getByText(t("en-US", "scheduledJobDraftDropped"))).toBeInTheDocument();
  });

  it("after such a refusal, Accept accepts the other device's text the row shows", async () => {
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    await refusedWithOneQueued(user);
    const accept = screen.getByRole("button", { name: "Accept: Daily risks" });
    fireEvent.pointerDown(accept);
    fireEvent.pointerUp(accept);
    fireEvent.click(accept);
    await sleep(80);
    expect(storedEntry()).toBe(jobFingerprint(job({ instruction: "x" })));
  });

  it("after such a refusal, the next edit is judged against the other device's text and saves", async () => {
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    await refusedWithOneQueued(user);
    await user.type(field(), "z");
    fireEvent.focusOut(field());
    await sleep(100);
    expect(stored()).toBe("xz");
  });

  it("a refusal after the section closed never lets the closing save through", async () => {
    const user = userEvent.setup();
    const view = render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    const release = holdLoads();
    await typeInstruction(user, "c");
    fireEvent.focusOut(field());
    await sleep(10);
    await user.type(field(), "d");
    view.unmount(); // the closing save of cd is queued behind c
    store.list = [job({ instruction: "x" })];
    release();
    await sleep(150);
    expect(stored()).toBe("x");
  });

  /** c and cd queued (reads held); another device stores x, then — right after c's read — puts b back. */
  async function refusedThenReverted(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    const release = holdLoads();
    await typeInstruction(user, "c");
    fireEvent.focusOut(field());
    await sleep(10);
    await user.type(field(), "d");
    fireEvent.focusOut(field());
    await sleep(10);
    store.list = [job({ instruction: "x" })];
    store.afterNextLoad = () => { store.list = [job({ instruction: "b" })]; }; // c reads x; everything after reads b
    release();
    await sleep(200);
  }

  it("every save queued before a refusal is refused, even if the stored text has gone back to what it expected", async () => {
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    await refusedThenReverted(user);
    expect(stored()).toBe("b"); // cd was not written over it
    expect(field()).toHaveValue("b"); // the field follows the store
    expect(screen.getByText(t("en-US", "scheduledJobDraftDropped"))).toBeInTheDocument();
  });

  it("after such a refusal, Accept records the version the field shows", async () => {
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    await refusedThenReverted(user);
    const accept = screen.getByRole("button", { name: "Accept: Daily risks" });
    fireEvent.pointerDown(accept);
    fireEvent.pointerUp(accept);
    fireEvent.click(accept);
    await sleep(80);
    expect(field()).toHaveValue("b");
    expect(storedEntry()).toBe(jobFingerprint(job({ instruction: "b" })));
  });

  it("a closing save queued before a refusal is refused too, whatever the stored text did since", async () => {
    const user = userEvent.setup();
    const view = render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    const release = holdLoads();
    await typeInstruction(user, "c");
    fireEvent.focusOut(field());
    await sleep(10);
    await user.type(field(), "d");
    view.unmount(); // the closing save of cd is queued behind c
    store.list = [job({ instruction: "x" })];
    store.afterNextLoad = () => { store.list = [job({ instruction: "b" })]; };
    release();
    await sleep(200);
    expect(stored()).toBe("b");
  });

  it("an edit typed after the refusal notice, while an older save is still queued, is judged against the text shown", async () => {
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    const release = holdLoads();
    await typeInstruction(user, "c");
    fireEvent.focusOut(field());
    await sleep(10);
    await user.type(field(), "d");
    fireEvent.focusOut(field());
    await sleep(10);
    store.list = [job({ instruction: "x" })];
    let releaseSecond: () => void = () => {};
    const secondGate = new Promise<void>((r) => { releaseSecond = r; });
    store.afterNextLoad = () => { store.loadGate = secondGate; }; // c reads x; cd's read waits
    release();
    await screen.findByText(t("en-US", "scheduledJobDraftDropped"));
    expect(field()).toHaveValue("x");
    await user.type(field(), "z");
    fireEvent.focusOut(field()); // xz, started from x
    await sleep(10);
    store.loadGate = null;
    releaseSecond();
    await sleep(250);
    expect(stored()).toBe("xz");
    expect(field()).toHaveValue("xz");
    expect(screen.queryByText(t("en-US", "scheduledJobDraftDropped"))).toBeNull();
  });

  const show = () => render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);

  /** Unmount with the closing save of cd queued behind c; another device stores x, so both are refused. */
  async function loseRefusedText(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    const first = show();
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    const release = holdLoads();
    await typeInstruction(user, "c");
    fireEvent.focusOut(field());
    await sleep(10);
    await user.type(field(), "d");
    first.unmount();
    store.list = [job({ instruction: "x" })];
    release();
    await sleep(200);
  }
  /** Unmount with the closing save of c failing (no change elsewhere). */
  async function loseFailedText(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    const first = show();
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    await typeInstruction(user, "c");
    store.fail = true;
    first.unmount();
    await sleep(100);
    store.fail = false;
  }
  const LOST = "aipm-cockpit:scheduled-job-lost-draft";
  const seedLost = (...entries: { text: string; reason: "dropped" | "notSaved" }[]) =>
    sessionStorage.setItem(LOST, JSON.stringify({ [KEY]: entries }));
  const lostEntries = (): unknown => {
    const raw = sessionStorage.getItem(LOST);
    return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>)[KEY] ?? null;
  };
  const lostText = () => screen.queryByRole("textbox", { name: `${t("en-US", "scheduledJobLostText")} – Daily risks` });
  const dismiss = () => screen.getByRole("button", { name: t("en-US", "scheduledJobLostTextDismissNamed", "Daily risks") });
  const refocus = async () => {
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await sleep(100);
  };
  const lostNotSaved = t("en-US", "scheduledJobLostNotSaved");

  it("text refused after the dialog closed is offered next time read-only, with the dropped notice and a hint; the field shows the stored text", async () => {
    const user = userEvent.setup();
    await loseRefusedText(user);
    expect(stored()).toBe("x");
    show();
    await screen.findByText(t("en-US", "scheduledJobDraftDropped"));
    expect(field()).toHaveValue("x"); // what the job holds
    expect(lostText()).toHaveValue("cd"); // the lost text, to copy from
    expect(lostText()).toHaveAttribute("readonly");
    expect(lostText()).toHaveAccessibleDescription(t("en-US", "scheduledJobLostTextHint"));
    expect(stored()).toBe("x"); // restoring saves nothing
    expect(storedEntry()).toBeNull(); // and answers nothing
  });

  it("focusing and leaving the field of such a restore writes nothing", async () => {
    const user = userEvent.setup();
    await loseRefusedText(user);
    show();
    await screen.findByText(t("en-US", "scheduledJobDraftDropped"));
    await user.click(field());
    await user.click(document.body);
    await sleep(100);
    expect(stored()).toBe("x");
  });

  it("Accept on such a restore accepts the version the field shows, and leaves the offered text", async () => {
    const user = userEvent.setup();
    await loseRefusedText(user);
    show();
    await screen.findByText(t("en-US", "scheduledJobDraftDropped"));
    expect(field()).toHaveValue("x");
    const accept = screen.getByRole("button", { name: "Accept: Daily risks" });
    fireEvent.pointerDown(accept);
    fireEvent.pointerUp(accept);
    fireEvent.click(accept);
    await sleep(80);
    expect(storedEntry()).toBe(jobFingerprint(job({ instruction: "x" })));
    expect(lostText()).toHaveValue("cd"); // an answer does not take it away
  });

  it("Dismiss takes the offered text away and forgets it", async () => {
    const user = userEvent.setup();
    await loseRefusedText(user);
    const second = show();
    await screen.findByText(t("en-US", "scheduledJobDraftDropped"));
    await user.click(dismiss());
    expect(lostText()).toBeNull();
    expect(lostEntries()).toBeNull();
    second.unmount();
    await sleep(50);
    show();
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    expect(lostText()).toBeNull();
  });

  it("a restore whose lost text the job already holds shows nothing, and is forgotten", async () => {
    const user = userEvent.setup();
    await loseRefusedText(user);
    store.list = [job({ instruction: "cd" })]; // the same text arrived after all
    show();
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    expect(screen.queryByText(t("en-US", "scheduledJobDraftDropped"))).toBeNull();
    expect(lostText()).toBeNull();
    expect(sessionStorage.getItem(LOST)).toBeNull();
  });

  it("a not-saved entry whose text the job already holds shows no notice, is forgotten, and a new edit saves", async () => {
    const user = userEvent.setup();
    store.list = [job({ instruction: "c" })];
    seedLost({ text: "c", reason: "notSaved" });
    show();
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    await sleep(50);
    expect(screen.queryByText(lostNotSaved)).toBeNull();
    expect(lostText()).toBeNull();
    expect(sessionStorage.getItem(LOST)).toBeNull();
    await typeInstruction(user, "d");
    fireEvent.focusOut(field());
    await sleep(200);
    expect(stored()).toBe("d");
    expect(screen.queryByText(t("en-US", "scheduledJobDraftDropped"))).toBeNull();
  });

  it("text whose closing save failed is offered next time read-only; the field shows the stored text and the buttons answer it", async () => {
    const user = userEvent.setup();
    await loseFailedText(user);
    show();
    await screen.findByText(lostNotSaved);
    expect(field()).toHaveValue("b");
    expect(lostText()).toHaveValue("c");
    expect(stored()).toBe("b");
    const accept = screen.getByRole("button", { name: "Accept: Daily risks" }); // not "Not saved"
    expect(accept).not.toHaveAttribute("aria-disabled");
    fireEvent.pointerDown(accept);
    fireEvent.pointerUp(accept);
    fireEvent.click(accept);
    await sleep(80);
    expect(storedEntry()).toBe(jobFingerprint(job()));
  });

  it("after a not-saved restore, edits save normally even when the job changed elsewhere in between", async () => {
    const user = userEvent.setup();
    await loseFailedText(user);
    show();
    await screen.findByText(lostNotSaved);
    await typeInstruction(user, "b");
    fireEvent.focusOut(field());
    await sleep(100);
    expect(stored()).toBe("b");
    store.list = [job({ instruction: "y" })];
    await refocus();
    expect(field()).toHaveValue("y");
    await typeInstruction(user, "z");
    fireEvent.focusOut(field());
    await sleep(200);
    expect(stored()).toBe("z");
    expect(screen.queryByText(t("en-US", "scheduledJobDraftDropped"))).toBeNull();
  });

  it("a not-saved restore whose text another device then stores loses its notice and box; a new edit saves", async () => {
    const user = userEvent.setup();
    await loseFailedText(user);
    show();
    await screen.findByText(lostNotSaved);
    store.list = [job({ instruction: "c" })];
    await refocus();
    expect(screen.queryByText(lostNotSaved)).toBeNull();
    expect(lostText()).toBeNull();
    await typeInstruction(user, "d");
    fireEvent.focusOut(field());
    await sleep(200);
    expect(stored()).toBe("d");
  });

  it("a not-saved restore after a change elsewhere writes nothing on blur", async () => {
    const user = userEvent.setup();
    await loseFailedText(user);
    store.list = [job({ instruction: "x" })];
    show();
    await screen.findByText(lostNotSaved);
    expect(field()).toHaveValue("x");
    expect(lostText()).toHaveValue("c");
    fireEvent.focusOut(field());
    await sleep(150);
    expect(stored()).toBe("x");
  });

  it("restored text is kept when closing again untouched, and offered again after that", async () => {
    const user = userEvent.setup();
    await loseFailedText(user);
    const second = show();
    await screen.findByText(lostNotSaved);
    second.unmount();
    await sleep(100);
    expect(stored()).toBe("b");
    show();
    await screen.findByText(lostNotSaved);
    expect(lostText()).toHaveValue("c");
  });

  it("a successful save of other text, even the closing one, leaves the offered text", async () => {
    const user = userEvent.setup();
    await loseRefusedText(user);
    const second = show();
    await screen.findByText(t("en-US", "scheduledJobDraftDropped"));
    await typeInstruction(user, "ef");
    second.unmount(); // the closing save of ef lands
    await sleep(200);
    expect(stored()).toBe("ef");
    expect(lostEntries()).toEqual([{ text: "cd", reason: "dropped" }]);
    show();
    await screen.findByText(t("en-US", "scheduledJobDraftDropped"));
    expect(lostText()).toHaveValue("cd");
  });

  it("a save removes only the offered texts equal to what it saved", async () => {
    const user = userEvent.setup();
    store.list = [job({ instruction: "x" })];
    seedLost({ text: "cd", reason: "dropped" }, { text: "old", reason: "notSaved" });
    show();
    await screen.findByText(t("en-US", "scheduledJobDraftDropped"));
    await typeInstruction(user, "z");
    fireEvent.focusOut(field());
    await sleep(200);
    expect(stored()).toBe("z");
    expect(lostText()).toHaveValue("cd\n\nold");
    await typeInstruction(user, " old ");
    fireEvent.focusOut(field());
    await sleep(200);
    expect(stored()).toBe("old");
    expect(lostText()).toHaveValue("cd");
    expect(lostEntries()).toEqual([{ text: "cd", reason: "dropped" }]);
  });

  it("a closed editor's late failure is offered in the row that has reopened, and survives that row's own save", async () => {
    const user = userEvent.setup();
    const first = show();
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    await typeInstruction(user, "c");
    const release = holdSaves();
    first.unmount(); // the closing save of c waits
    await sleep(50);
    show();
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    store.failOnce = true;
    release();
    await sleep(150);
    expect(lostText()).toHaveValue("c"); // shown in the open row
    await typeInstruction(user, "z");
    fireEvent.focusOut(field());
    await sleep(200);
    expect(stored()).toBe("z");
    expect(lostText()).toHaveValue("c");
    expect(lostEntries()).toEqual([{ text: "c", reason: "notSaved" }]);
  });

  it("a closed editor's late failure survives a refusal in the reopened row", async () => {
    const user = userEvent.setup();
    const first = show();
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    await typeInstruction(user, "c");
    const release = holdSaves();
    first.unmount();
    await sleep(50);
    show();
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    store.failOnce = true;
    release();
    await sleep(150);
    store.list = [job({ instruction: "y" })];
    await typeInstruction(user, "z");
    fireEvent.focusOut(field());
    await sleep(200);
    expect(stored()).toBe("y");
    expect(lostText()).toHaveValue("z\n\nc");
    expect(lostEntries()).toEqual([{ text: "z", reason: "dropped" }, { text: "c", reason: "notSaved" }]);
  });

  it("text typed after the blur is offered too when the save is refused", async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    const release = holdLoads();
    await typeInstruction(user, "c");
    fireEvent.focusOut(field());
    store.list = [job({ instruction: "y" })];
    await user.type(field(), "de"); // still typing, not blurred
    release();
    await sleep(200);
    expect(stored()).toBe("y");
    expect(field()).toHaveValue("y");
    expect(lostText()).toHaveValue("cde\n\nc");
    expect(screen.getByText(t("en-US", "scheduledJobDraftDropped"))).toBeInTheDocument();
  });

  it("Dismiss moves focus to the instruction field", async () => {
    const user = userEvent.setup();
    store.list = [job({ instruction: "x" })];
    seedLost({ text: "cd", reason: "dropped" });
    show();
    await screen.findByText(t("en-US", "scheduledJobDraftDropped"));
    await user.click(dismiss());
    expect(lostText()).toBeNull();
    expect(field()).toHaveFocus();
  });

  it("an open row never drops a text it shows; storage keeps the newest five", async () => {
    const user = userEvent.setup();
    store.list = [job({ instruction: "x" })];
    seedLost(...["t5", "t4", "t3", "t2", "t1"].map((text) => ({ text, reason: "dropped" as const })));
    show();
    await screen.findByText(t("en-US", "scheduledJobDraftDropped"));
    await typeInstruction(user, "t6");
    store.list = [job({ instruction: "y" })];
    fireEvent.focusOut(field());
    await sleep(200);
    expect(lostText()).toHaveValue("t6\n\nt5\n\nt4\n\nt3\n\nt2\n\nt1");
    expect((lostEntries() as { text: string }[]).map((d) => d.text)).toEqual(["t6", "t5", "t4", "t3", "t2"]);
  });

  it("a row whose id now names a different job does not show the old job's texts", async () => {
    store.list = [job({ instruction: "x" })];
    seedLost({ text: "cd", reason: "dropped" });
    show();
    await screen.findByText(t("en-US", "scheduledJobDraftDropped"));
    // Ids reassigned elsewhere: id 1 now names another job, and this job (still listed) has id 2.
    store.list = [job({ key: "another-key", name: "Other", instruction: "x" }), job({ id: 2, instruction: "x" })];
    await refocus();
    expect(screen.queryByRole("textbox", { name: `${t("en-US", "scheduledJobLostText")} – Other` })).toBeNull();
    expect(lostText()).toHaveValue("cd"); // still offered for its own job
  });

  it("an Accept clears the newer-version message", async () => {
    const user = userEvent.setup();
    store.list = [job(), job({ id: 2, key: "second-key", name: "Weekly" })];
    show();
    await screen.findAllByText(t("en-US", "scheduledJobNeedsOk"));
    await typeInstruction(user, "c");
    store.list = [await decodedForeign(), job({ id: 2, key: "second-key", name: "Weekly" })];
    await user.click(document.body);
    await screen.findByText(t("en-US", "scheduledJobEditedByNewerVersion"));
    await user.click(screen.getByRole("button", { name: "Accept: Weekly" }));
    await sleep(150);
    expect(screen.queryByText(t("en-US", "scheduledJobEditedByNewerVersion"))).toBeNull();
  });

  it("copying the offered text into the field and leaving it saves it and takes the offer away", async () => {
    const user = userEvent.setup();
    await loseRefusedText(user);
    const second = show();
    await screen.findByText(t("en-US", "scheduledJobDraftDropped"));
    await typeInstruction(user, "cd");
    fireEvent.focusOut(field());
    await sleep(200);
    expect(stored()).toBe("cd");
    expect(lostText()).toBeNull();
    second.unmount();
    await sleep(100);
    expect(lostEntries()).toBeNull();
  });

  it("a refusal while the editor is open offers the refused text read-only too", async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    await typeInstruction(user, "c");
    store.list = [job({ instruction: "x" })]; // another device
    fireEvent.focusOut(field());
    await screen.findByText(t("en-US", "scheduledJobDraftDropped"));
    expect(field()).toHaveValue("x");
    expect(lostText()).toHaveValue("c");
    expect(stored()).toBe("x");
  });

  it("when two saves of one edit are refused while the editor is open, the newest text is the one offered", async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    const release = holdLoads();
    await typeInstruction(user, "c");
    fireEvent.focusOut(field());
    await sleep(10);
    await user.type(field(), "d");
    fireEvent.focusOut(field()); // cd queued behind c
    store.list = [job({ instruction: "x" })];
    release();
    await sleep(200);
    expect(stored()).toBe("x");
    expect(field()).toHaveValue("x");
    expect(lostText()).toHaveValue("cd"); // c was only on its way to cd
  });

  it("a newer lost text is offered together with the one already kept, newest first", async () => {
    const user = userEvent.setup();
    await loseRefusedText(user);
    const second = show();
    await screen.findByText(t("en-US", "scheduledJobDraftDropped"));
    await typeInstruction(user, "ef");
    store.list = [job({ instruction: "y" })]; // another device, before the closing save
    second.unmount();
    await sleep(200);
    expect(stored()).toBe("y");
    show();
    await screen.findByText(t("en-US", "scheduledJobDraftDropped"));
    expect(field()).toHaveValue("y");
    expect(lostText()).toHaveValue("ef\n\ncd");
  });

  it("a job deleted elsewhere while its text is offered leaves nothing kept", async () => {
    store.list = [job({ instruction: "x" })];
    seedLost({ text: "cd", reason: "dropped" });
    const a = show();
    await screen.findByText(t("en-US", "scheduledJobDraftDropped"));
    store.list = [];
    await refocus();
    expect(lostEntries()).toBeNull();
    a.unmount();
    await sleep(100);
    expect(lostEntries()).toBeNull();
  });

  it("a save of a job that a newer version changed writes nothing, says so, and offers the text only while the row shows", async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    await typeInstruction(user, "c");
    const turned = await decodedForeign();
    expect(turned.foreign).toBeDefined();
    store.list = [turned];
    await user.click(document.body);
    await screen.findByText(t("en-US", "scheduledJobEditedByNewerVersion"));
    expect(screen.queryByText(t("en-US", "scheduledJobsWriteFailed"))).toBeNull(); // not the connection alert
    expect(store.list).toEqual([turned]);
    expect(lostText()).toHaveValue("c"); // the row is still listed (read-only): the text is offered there
    expect(sessionStorage.getItem(LOST)).toBeNull(); // and never kept for later
  });

  it("a closing save of a job that a newer version changed keeps nothing for later", async () => {
    const user = userEvent.setup();
    const first = show();
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    await typeInstruction(user, "c");
    store.list = [await decodedForeign()];
    first.unmount(); // the closing save finds the job no longer editable here
    await sleep(100);
    expect(sessionStorage.getItem(LOST)).toBeNull();
  });

  it("a keyed job a newer version rewrote while typing: not editable (not deleted), the text offered, kept texts survive", async () => {
    const user = userEvent.setup();
    store.list = [job({ instruction: "x" })];
    seedLost({ text: "cd", reason: "dropped" });
    show();
    await screen.findByText(t("en-US", "scheduledJobDraftDropped"));
    await typeInstruction(user, "c");
    store.list = [await decodedForeign({ instruction: "x" })];
    fireEvent.focusOut(field());
    await screen.findByText(t("en-US", "scheduledJobEditedByNewerVersion"));
    await sleep(100);
    expect(screen.queryByText(t("en-US", "scheduledJobDeletedElsewhere"))).toBeNull();
    expect(screen.getByText(t("en-US", "scheduledJobForeign"))).toBeInTheDocument();
    expect(lostText()).toHaveValue("c\n\ncd");
    expect(lostEntries()).toEqual([{ text: "cd", reason: "dropped" }]);
  });

  it("an Accept whose re-read finds the job rewritten by a newer version answers nothing and says so", async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    store.list = [await decodedForeign()];
    await user.click(screen.getByRole("button", { name: "Accept: Daily risks" }));
    await screen.findByText(t("en-US", "scheduledJobEditedByNewerVersion"));
    expect(storedEntry()).toBeNull();
    expect(screen.queryByText(t("en-US", "scheduledJobDeletedElsewhere"))).toBeNull();
  });

  it("a text kept between the row's first read and its subscription is shown; Dismiss leaves a text it never showed", async () => {
    const user = userEvent.setup();
    store.list = [job({ instruction: "x" })];
    seedLost({ text: "cd", reason: "dropped" });
    const realGet = Storage.prototype.getItem;
    let injected = false;
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, k: string) {
      const value = realGet.call(this, k);
      if (k === LOST && !injected) {
        // Another write lands right after the row's first read (no listener is told: it is not subscribed yet).
        injected = true;
        Storage.prototype.setItem.call(this, LOST, JSON.stringify({ [KEY]: [{ text: "gap", reason: "notSaved" }, { text: "cd", reason: "dropped" }] }));
      }
      return value;
    });
    try {
      show();
      await screen.findByText(t("en-US", "scheduledJobDraftDropped"));
      await sleep(50);
    } finally {
      spy.mockRestore();
    }
    expect((lostText() as HTMLTextAreaElement).value.split("\n\n").sort()).toEqual(["cd", "gap"]);
    // A text written without telling anyone is not shown; Dismiss leaves it.
    sessionStorage.setItem(LOST, JSON.stringify({ [KEY]: [{ text: "unseen", reason: "dropped" }, { text: "gap", reason: "notSaved" }, { text: "cd", reason: "dropped" }] }));
    await user.click(dismiss());
    expect(lostText()).toBeNull();
    expect(lostEntries()).toEqual([{ text: "unseen", reason: "dropped" }]);
  });

  const OTHER_KEY = "other-job-key";
  const otherField = () => screen.queryByRole("textbox", { name: `${t("en-US", "scheduledJobInstruction")} – Other job` });
  const otherBox = () => screen.queryByRole("textbox", { name: `${t("en-US", "scheduledJobLostText")} – Other job` });

  it("a keyless job replaced at its id by another device's keyed job: that job is shown, editable, and nothing is written", async () => {
    store.list = [job({ key: null, projectId: null, timeZone: null })];
    show();
    expect(await screen.findByRole("textbox", { name: `${t("en-US", "scheduledJobInstruction")} – Daily risks` })).toHaveAttribute("readonly");
    const replaced = job({ key: OTHER_KEY, name: "Other job", instruction: "b" });
    store.list = [replaced];
    await refocus();
    expect(otherField()).toHaveValue("b");
    expect(otherField()).not.toHaveAttribute("readonly");
    await sleep(100);
    expect(store.list).toEqual([replaced]);
    expect(screen.queryByText(t("en-US", "scheduledJobDeletedElsewhere"))).toBeNull();
  });

  it("a keyed job's offered text and notice are not carried to a keyless job that now has its id", async () => {
    store.list = [job({ instruction: "x" })];
    seedLost({ text: "secretA", reason: "dropped" });
    show();
    await screen.findByText(t("en-US", "scheduledJobDraftDropped"));
    // Ids reassigned elsewhere: id 1 now names a keyless job, and the first job (still listed) has id 2.
    store.list = [
      job({ key: null, projectId: null, timeZone: null, name: "Other job", instruction: "w" }),
      job({ id: 2, instruction: "x" }),
    ];
    await refocus();
    expect(otherField()).toHaveValue("w");
    expect(otherBox()).toBeNull();
    const otherRow = within(otherField()?.closest("li") as HTMLElement);
    expect(otherRow.queryByText(t("en-US", "scheduledJobDraftDropped"))).toBeNull();
    expect(lostText()).toHaveValue("secretA"); // still offered for its own job
  });

  it("a keyed job replaced by another keyed job with its id shows none of the first job's text or notice", async () => {
    store.list = [job({ instruction: "x" })];
    seedLost({ text: "secretA", reason: "dropped" });
    show();
    await screen.findByText(t("en-US", "scheduledJobDraftDropped"));
    store.list = [job({ key: OTHER_KEY, name: "Other job", instruction: "w" })];
    await refocus();
    expect(otherBox()).toBeNull();
    expect(screen.queryByText(t("en-US", "scheduledJobDraftDropped"))).toBeNull();
  });

  it("the dropped notice goes when another row's save removes the last offered text", async () => {
    store.list = [job({ instruction: "x" })];
    seedLost({ text: "cd", reason: "dropped" });
    show();
    await screen.findByText(t("en-US", "scheduledJobDraftDropped"));
    const { removeLostTexts } = await import("../scheduled-jobs/lost-draft");
    await act(async () => { removeLostTexts(KEY, ["cd"]); });
    expect(lostText()).toBeNull();
    expect(screen.queryByText(t("en-US", "scheduledJobDraftDropped"))).toBeNull();
  });

  it("an Accept finding the job rewritten says so even when the answer changed during the read", async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    store.list = [await decodedForeign()];
    store.afterNextLoad = () => { localStorage.setItem(ACCEPTANCE_KEY, JSON.stringify({ [`${SCOPE}|${KEY}`]: "declined:elsewhere" })); };
    await user.click(screen.getByRole("button", { name: "Accept: Daily risks" }));
    await screen.findByText(t("en-US", "scheduledJobEditedByNewerVersion"));
    expect(storedEntry()).toBe("declined:elsewhere"); // nothing written by the Accept
  });

  it("a job without a key cannot be typed into: nothing is written on blur or close, and nothing is kept", async () => {
    store.list = [job({ key: null, projectId: null, timeZone: null })];
    const before = structuredClone(store.list);
    const user = userEvent.setup();
    const first = show();
    const box = await screen.findByRole("textbox", { name: `${t("en-US", "scheduledJobInstruction")} – Daily risks` });
    expect(box).toHaveAttribute("readonly");
    expect(box).toHaveAccessibleDescription(t("en-US", "scheduledJobAssignProjectToEdit"));
    await user.click(box);
    await user.keyboard("typed");
    expect(box).toHaveValue("b");
    await user.click(document.body);
    await sleep(100);
    first.unmount();
    await sleep(100);
    expect(store.list).toEqual(before);
    expect(sessionStorage.getItem(LOST)).toBeNull();
  });

  it("a keyless job another device gives a key is shown as that keyed job, editable, with nothing lost", async () => {
    store.list = [job({ key: null, projectId: null, timeZone: null })];
    show();
    expect(await screen.findByRole("textbox", { name: `${t("en-US", "scheduledJobInstruction")} – Daily risks` })).toHaveAttribute("readonly");
    store.list = [job({ key: "remote-key" })];
    await refocus();
    expect(field()).toHaveValue("b");
    expect(field()).not.toHaveAttribute("readonly");
    expect(screen.queryByText(t("en-US", "scheduledJobDeletedElsewhere"))).toBeNull();
    expect(sessionStorage.getItem(LOST)).toBeNull();
  });

  it("assigning a project here makes the field editable, and an edit then saves", async () => {
    const user = userEvent.setup();
    store.list = [job({ key: null, projectId: null, timeZone: null })];
    show();
    expect(await screen.findByRole("textbox", { name: `${t("en-US", "scheduledJobInstruction")} – Daily risks` })).toHaveAttribute("readonly");
    await user.selectOptions(screen.getByRole("combobox", { name: `${t("en-US", "scheduledJobProject")} – Daily risks` }), "p1");
    await sleep(250);
    expect((store.list[0] as ScheduledJob).key).not.toBeNull();
    expect(field()).not.toHaveAttribute("readonly");
    await typeInstruction(user, "z");
    fireEvent.focusOut(field());
    await sleep(200);
    expect(stored()).toBe("z");
  });

  it("a portfolio switch to a job with the same id starts a fresh row", async () => {
    const user = userEvent.setup();
    const runs = [
      { ranAt: "2026-11-02T09:00:00.000Z", summary: "s2", actionCount: 0, ok: true },
      { ranAt: "2026-11-01T09:00:00.000Z", summary: "s1", actionCount: 0, ok: true },
    ];
    store.list = [job({ key: null, projectId: null, timeZone: null, history: runs })];
    const view = show();
    await screen.findByRole("textbox", { name: `${t("en-US", "scheduledJobInstruction")} – Daily risks` });
    await user.click(screen.getByRole("button", { name: `${t("en-US", "showMore")} – Daily risks` }));
    expect(screen.getByRole("button", { name: `${t("en-US", "showLess")} – Daily risks` })).toBeInTheDocument();
    store.list = [job({ key: null, projectId: null, timeZone: null, instruction: "b2", history: runs })];
    view.rerender(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO_B} />);
    await sleep(300);
    expect(field()).toHaveValue("b2");
    expect(screen.getByRole("button", { name: `${t("en-US", "showMore")} – Daily risks` })).toBeInTheDocument(); // not carried over
    expect(lostText()).toBeNull();
  });

  it("a lost-draft store that cannot be used changes nothing else", async () => {
    const realGet = Storage.prototype.getItem;
    const realSet = Storage.prototype.setItem;
    const getSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, k: string) {
      if (k === "aipm-cockpit:scheduled-job-lost-draft") throw new Error("blocked");
      return realGet.call(this, k);
    });
    const setSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === "aipm-cockpit:scheduled-job-lost-draft") throw new Error("blocked");
      realSet.call(this, k, v);
    });
    try {
      const user = userEvent.setup();
      const first = show();
      await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
      await typeInstruction(user, "c");
      store.fail = true;
      first.unmount();
      await sleep(100);
      store.fail = false;
      show();
      await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
      expect(field()).toHaveValue("b"); // as before: the text is lost, nothing crashes
    } finally {
      getSpy.mockRestore();
      setSpy.mockRestore();
    }
  });

  it("a save of a job deleted on another device writes nothing and says so where it stays visible", async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText(t("en-US", "scheduledJobNeedsOk"));
    await typeInstruction(user, "c");
    store.list = []; // another device deleted the job
    await user.click(document.body);
    await screen.findByText(t("en-US", "scheduledJobDeletedElsewhere"));
    await sleep(50);
    expect(store.list).toEqual([]);
    expect(screen.queryByText(t("en-US", "scheduledJobsWriteFailed"))).toBeNull(); // not a failed write
    expect(screen.queryByRole("textbox", { name: `${t("en-US", "scheduledJobInstruction")} – Daily risks` })).toBeNull();
  });

  it("keyboard: Enter on the focused Stop button answers", async () => {
    acceptJob(job(), SCOPE);
    const user = userEvent.setup();
    render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={TURSO} />);
    await screen.findByText(t("en-US", "scheduledJobAcceptedHere"));
    act(() => { screen.getByRole("button", { name: "Stop on this device: Daily risks" }).focus(); });
    await user.keyboard("{Enter}");
    expect(acceptanceState(job(), SCOPE)).toBe("declined");
  });

  it("a held save that fails moves the buttons from Saving… to Not saved and leaves the answer as it was", async () => {
    acceptJob(job(), SCOPE);
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
    expect(acceptanceState(job(), SCOPE)).toBe("accepted");
    expect(screen.queryByText(t("en-US", "scheduledJobChangedHere"))).toBeNull();
  });
});

/** The real hook and a real row, with extra async hops between `updateJob` settling and the row hearing about it — the
 *  shape any wrapper (tracking, logging) gives the call. The row's own decisions must not depend on how many there are. */
function HoppingRow({ hops }: { hops: number }) {
  const { jobs, updateJob } = useScheduledJobs({ config: TURSO });
  const shown = jobs[0];
  if (!shown) return null;
  const onUpdate = (id: number, patch: JobPatch, options?: UpdateJobOptions): Promise<void> => {
    let write: Promise<void> = updateJob(id, patch, shown.key ?? undefined, options);
    for (let i = 0; i < hops; i += 1) write = write.then((v) => v);
    return write;
  };
  return (
    <ul>
      <JobRow lang="en-US" job={shown} token="Daily risks" busy={false} tz="UTC" projects={[{ id: "p1", name: "Alpha" }]}
        archivedProjects={[]} projectsLoaded zones={["UTC"]} defaultZone="UTC" onUpdate={onUpdate} onAssign={vi.fn()}
        onDelete={vi.fn()} onAccept={vi.fn()} scope={SCOPE} />
    </ul>
  );
}

describe("the refusal generation does not depend on how fast the row hears about the refusal", () => {
  for (const hops of [1, 3]) {
    it(`a save queued before a refusal is refused, with ${hops} extra hop(s) before the row's handler`, async () => {
      const user = userEvent.setup();
      render(<HoppingRow hops={hops} />);
      await screen.findByRole("textbox", { name: `${t("en-US", "scheduledJobInstruction")} – Daily risks` });
      const release = holdLoads();
      await typeInstruction(user, "c");
      fireEvent.focusOut(field());
      await sleep(10);
      await user.type(field(), "d");
      fireEvent.focusOut(field());
      await sleep(10);
      store.list = [job({ instruction: "x" })];
      store.afterNextLoad = () => { store.list = [job({ instruction: "b" })]; }; // c reads x; cd would read b
      release();
      await sleep(200);
      expect(stored()).toBe("b"); // cd was refused, not written over the store
    });
  }
});
