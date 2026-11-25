// A row's writes are bound to the portfolio its list was read from, and assigning a project to a legacy job keeps
// keyboard focus and lets a follow-up edit reach the job (the real hook, over a store mock with one list per backend).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScheduledJobsSection } from "./scheduled-jobs-section";
import { useScheduledJobs } from "../use-scheduled-jobs";
import { newConsent } from "../ai-consent";
import { defaultSettings, type Settings } from "../settings-types";
import { t } from "../i18n";
import type { ScheduledJob } from "../scheduled-jobs/types";
import type { TursoConfig } from "../turso-config";
import { __resetEditedHereForTests, ACCEPTANCE_KEY, acceptanceScope, acceptanceState, acceptJob, storedAcceptanceEntry } from "../scheduled-job-acceptance";

const store = vi.hoisted(() => ({
  lists: new Map<string, unknown[]>(),
  loadGate: null as Promise<void> | null,
  writes: [] as string[],
  /** How many of the next saves fail (the database unreachable). */
  failNext: 0,
  /** Every read of this backend fails (the database unreachable), until cleared. */
  failLoadOf: null as string | null,
}));
vi.mock("../scheduled-jobs-store", () => ({
  loadScheduledJobs: async (config: { httpUrl: string } | null) => {
    if (store.loadGate) await store.loadGate;
    if (store.failLoadOf !== null && config?.httpUrl === store.failLoadOf) throw new Error("offline");
    return structuredClone(store.lists.get(config?.httpUrl ?? "local") ?? []);
  },
  saveScheduledJobs: async (config: { httpUrl: string } | null, next: unknown[]) => {
    if (store.failNext > 0) {
      store.failNext -= 1;
      throw new Error("offline");
    }
    const k = config?.httpUrl ?? "local";
    store.writes.push(k);
    store.lists.set(k, structuredClone(next));
  },
}));
vi.mock("../turso-portfolio", () => ({ listProjectRefs: async () => ({ active: [{ id: "p1", name: "Alpha" }, { id: "p2", name: "Beta" }], archived: [] }) }));
vi.mock("../portfolio-mode", () => ({ loadPortfolioMode: () => "turso", loadCurrentTursoProjectId: () => null }));

const A = { httpUrl: "https://a.example", authToken: "t" } as unknown as TursoConfig;
const B = { httpUrl: "https://b.example", authToken: "t" } as unknown as TursoConfig;
const settings: Settings = {
  ...defaultSettings,
  ai: { ...defaultSettings.ai, apiKey: "sk-test", enabled: true, consent: newConsent(new Date(0)), backgroundConsent: newConsent(new Date(0)), scheduledJobs: true },
};
function job(over: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: 1, name: "Daily risks", type: "portfolioAnalysis", cadence: { kind: "daily", timeOfDay: "09:00" }, enabled: true,
    projectId: "p1", timeZone: "UTC", key: "KA", instruction: "b", lastRunAt: null, history: [], ...over,
  };
}
const sleep = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const fieldName = `${t("en-US", "scheduledJobInstruction")} – Daily risks`;
const field = () => screen.getByRole("textbox", { name: fieldName });
const projectSelect = () => screen.getByRole("combobox", { name: `${t("en-US", "scheduledJobProject")} – Daily risks` });
const lostBox = () => screen.queryByRole("textbox", { name: `${t("en-US", "scheduledJobLostText")} – Daily risks` });
const deletedShown = () => screen.queryByText(t("en-US", "scheduledJobDeletedElsewhere")) !== null;
const listOf = (c: TursoConfig) => store.lists.get(c.httpUrl) as ScheduledJob[];
const section = (config: TursoConfig) => <ScheduledJobsSection lang="en-US" settings={settings} onChange={vi.fn()} config={config} />;
/** Holds every list read until the returned release is called (the new portfolio's list has not arrived yet). */
function holdLoads(): () => void {
  let release: () => void = () => {};
  store.loadGate = new Promise<void>((r) => { release = r; });
  heldRelease = () => { store.loadGate = null; release(); };
  return heldRelease;
}
/** The last hold, released after every test so a failed test never leaves reads blocked for the next. */
let heldRelease: () => void = () => {};
afterEach(() => { heldRelease(); heldRelease = () => {}; });

beforeEach(() => {
  sessionStorage.clear();
  localStorage.removeItem(ACCEPTANCE_KEY);
  __resetEditedHereForTests();
  store.lists = new Map();
  store.loadGate = null;
  store.writes = [];
  store.failNext = 0;
  store.failLoadOf = null;
});

describe("ScheduledJobsSection — assigning a project to a legacy job", () => {
  it("keyboard focus stays on the job's project select across the row's fresh start", async () => {
    store.lists.set(A.httpUrl, [job({ key: null, projectId: null, timeZone: null })]);
    render(section(A));
    await screen.findByRole("textbox", { name: fieldName });
    await sleep(50);
    const before = projectSelect();
    before.focus();
    fireEvent.change(before, { target: { value: "p1" } }); // an arrow key on a closed select changes it
    await sleep(250);
    expect(listOf(A)[0].key).not.toBeNull();
    const after = projectSelect();
    expect(after).not.toBe(before); // the row started afresh
    expect(document.activeElement).toBe(after);
  });

  it("an edit made before the row starts afresh reaches the job (no 'deleted' notice, nothing dropped)", async () => {
    store.lists.set(A.httpUrl, [job({ key: null, projectId: null, timeZone: null })]);
    render(section(A));
    await screen.findByRole("textbox", { name: fieldName });
    await sleep(50);
    fireEvent.change(projectSelect(), { target: { value: "p1" } });
    fireEvent.click(screen.getByRole("checkbox", { name: `${t("en-US", "scheduledJobEnabled")} – Daily risks` })); // still the keyless row
    await sleep(300);
    expect(listOf(A)[0].key).not.toBeNull();
    expect(listOf(A)[0].enabled).toBe(false);
    expect(deletedShown()).toBe(false);
  });
});

describe("ScheduledJobsSection — an assign whose save failed leaves the legacy job as it was", () => {
  /** Assigns p1 to the legacy job with the save failing: the job keeps no key. */
  async function failAssign(): Promise<void> {
    store.lists.set(A.httpUrl, [job({ key: null, projectId: null, timeZone: null })]);
    render(section(A));
    await screen.findByRole("textbox", { name: fieldName });
    await sleep(50);
    store.failNext = 1;
    fireEvent.change(projectSelect(), { target: { value: "p1" } });
    await sleep(250);
    expect(listOf(A)[0].key).toBeNull();
  }

  it("a retried assign lands and gives the job its key, with no 'deleted' notice", async () => {
    await failAssign();
    fireEvent.change(projectSelect(), { target: { value: "p2" } });
    await sleep(300);
    expect(listOf(A)[0].key).not.toBeNull();
    expect(listOf(A)[0].projectId).toBe("p2");
    expect(deletedShown()).toBe(false);
  });

  it("a name edit after it reaches the job, with no 'deleted' notice", async () => {
    await failAssign();
    fireEvent.change(screen.getByRole("textbox", { name: `${t("en-US", "scheduledJobName")} – Daily risks` }), { target: { value: "Renamed" } });
    await sleep(300);
    expect(listOf(A)[0].name).toBe("Renamed");
    expect(deletedShown()).toBe(false);
  });

  it("a delete after it deletes the job", async () => {
    await failAssign();
    fireEvent.click(screen.getByRole("button", { name: `${t("en-US", "delete")} – Daily risks` }));
    await sleep(300);
    expect(listOf(A)).toEqual([]);
  });
});

describe("ScheduledJobsSection — an answer counts in its own portfolio only", () => {
  it("a job accepted in one portfolio waits for an OK in a clone that holds the same job, and stays accepted at home", async () => {
    const user = userEvent.setup();
    store.lists.set(A.httpUrl, [job()]);
    store.lists.set(B.httpUrl, [job()]);
    const view = render(section(A));
    await screen.findByRole("textbox", { name: fieldName });
    await user.click(screen.getByRole("button", { name: "Accept: Daily risks" }));
    await sleep(150);
    expect(acceptanceState(job(), acceptanceScope(A.httpUrl))).toBe("accepted");
    view.rerender(section(B));
    await sleep(300);
    expect(acceptanceState(job(), acceptanceScope(B.httpUrl))).toBe("none");
    expect(screen.getByRole("button", { name: "Accept: Daily risks" })).toBeInTheDocument(); // asks again here
    view.rerender(section(A));
    await sleep(300);
    expect(screen.getByRole("button", { name: "Stop on this device: Daily risks" })).toBeInTheDocument();
  });
});

describe("ScheduledJobsSection — an answer is recorded only for the portfolio of the list on screen", () => {
  const entryIn = (c: TursoConfig) => storedAcceptanceEntry("KA", acceptanceScope(c.httpUrl));
  const acceptButton = () => screen.getByRole("button", { name: "Accept: Daily risks" });

  it("while the previous portfolio's list is still shown after a switch, Accept answers nothing anywhere", async () => {
    store.lists.set(A.httpUrl, [job()]);
    store.lists.set(B.httpUrl, [job()]); // a clone: same key, project and instruction
    const view = render(section(A));
    await screen.findByRole("textbox", { name: fieldName });
    const release = holdLoads();
    view.rerender(section(B));
    await sleep(20);
    expect(acceptButton()).toHaveAttribute("aria-disabled", "true"); // A's row, still on screen
    fireEvent.click(acceptButton());
    await sleep(20);
    release();
    await sleep(300);
    expect(entryIn(A)).toBeNull();
    expect(entryIn(B)).toBeNull();
  });

  it("once the new list is shown, its rows answer for that portfolio", async () => {
    const user = userEvent.setup();
    store.lists.set(A.httpUrl, [job()]);
    store.lists.set(B.httpUrl, [job()]);
    const view = render(section(A));
    await screen.findByRole("textbox", { name: fieldName });
    view.rerender(section(B));
    await sleep(300);
    expect(acceptButton()).not.toHaveAttribute("aria-disabled");
    await user.click(acceptButton());
    await sleep(150);
    expect(acceptanceState(job(), acceptanceScope(B.httpUrl))).toBe("accepted");
    expect(entryIn(A)).toBeNull();
  });

  it("an Accept whose read resolves after a switch answers nothing (A is no longer active)", async () => {
    store.lists.set(A.httpUrl, [job()]);
    store.lists.set(B.httpUrl, [job()]);
    const view = render(section(A));
    await screen.findByRole("textbox", { name: fieldName });
    const release = holdLoads();
    fireEvent.click(acceptButton()); // the re-read of A starts, held
    await sleep(20);
    view.rerender(section(B));
    await sleep(20);
    release();
    await sleep(300);
    expect(entryIn(A)).toBeNull();
    expect(entryIn(B)).toBeNull();
  });

  it("an Accept whose re-read would start in another portfolio answers nothing, even after switching back", async () => {
    const other = job({ id: 2, key: "K2", name: "Other job" });
    store.lists.set(A.httpUrl, [job(), other]);
    store.lists.set(B.httpUrl, [job(), other]);
    const view = render(section(A));
    await screen.findByRole("textbox", { name: fieldName });
    let release = holdLoads();
    // A save of another job of A is in flight (held), so the Accept's re-read waits behind it.
    fireEvent.click(screen.getByRole("checkbox", { name: `${t("en-US", "scheduledJobEnabled")} – Other job` }));
    await sleep(20);
    fireEvent.click(acceptButton());
    await sleep(20);
    view.rerender(section(B)); // the re-read would now start in B
    await sleep(20);
    await act(async () => {
      release();
      release = holdLoads(); // B's read (if it started) is held while the user switches back
    });
    await sleep(20);
    view.rerender(section(A));
    await sleep(20);
    release();
    await sleep(300);
    expect(entryIn(A)).toBeNull(); // never an answer for A judged on B's job
    expect(entryIn(B)).toBeNull();
    // A refused Accept says nothing: no "couldn't check" notice on the job's row.
    expect(screen.queryByText(t("en-US", "scheduledJobAcceptFailed"))).toBeNull();
  });

  it("during the switch window a row shows its answer as given in the portfolio of the list on screen", async () => {
    acceptJob(job(), acceptanceScope(A.httpUrl));
    store.lists.set(A.httpUrl, [job()]);
    store.lists.set(B.httpUrl, [job()]); // a clone: in B this job waits for an OK
    const view = render(section(A));
    await screen.findByText(t("en-US", "scheduledJobAcceptedHere"));
    holdLoads();
    view.rerender(section(B));
    await sleep(20);
    expect(screen.getByText(t("en-US", "scheduledJobAcceptedHere"))).toBeInTheDocument(); // A's state, not B's
    expect(screen.queryByText(t("en-US", "scheduledJobNeedsOk"))).toBeNull();
  });

  it("Stop pressed during the switch window writes nothing anywhere and says nothing", async () => {
    acceptJob(job(), acceptanceScope(A.httpUrl));
    store.lists.set(A.httpUrl, [job()]);
    store.lists.set(B.httpUrl, [job()]);
    const view = render(section(A));
    await screen.findByText(t("en-US", "scheduledJobAcceptedHere"));
    const release = holdLoads();
    view.rerender(section(B));
    await sleep(20);
    fireEvent.click(screen.getByRole("button", { name: "Stop on this device: Daily risks" }));
    await sleep(20);
    expect(screen.queryByText(t("en-US", "scheduledJobAnswerSaveFailed"))).toBeNull();
    release();
    await sleep(300);
    expect(acceptanceState(job(), acceptanceScope(A.httpUrl))).toBe("accepted");
    expect(entryIn(B)).toBeNull();
  });

  it("Not on this device pressed during the switch window writes nothing anywhere and says nothing", async () => {
    store.lists.set(A.httpUrl, [job()]);
    store.lists.set(B.httpUrl, [job()]);
    const view = render(section(A));
    await screen.findByRole("textbox", { name: fieldName });
    const release = holdLoads();
    view.rerender(section(B));
    await sleep(20);
    fireEvent.click(screen.getByRole("button", { name: "Not on this device: Daily risks" }));
    await sleep(20);
    expect(screen.queryByText(t("en-US", "scheduledJobAnswerSaveFailed"))).toBeNull();
    release();
    await sleep(300);
    expect(entryIn(A)).toBeNull();
    expect(entryIn(B)).toBeNull();
  });

  it("when the new portfolio's list cannot be loaded, the section says the list shown is the previous one's", async () => {
    store.lists.set(A.httpUrl, [job()]);
    store.lists.set(B.httpUrl, [job()]);
    const view = render(section(A));
    await screen.findByRole("textbox", { name: fieldName });
    const notice = () => screen.queryByText(t("en-US", "scheduledJobsLoadFailedAfterSwitch"));
    expect(notice()).toBeNull();
    store.failLoadOf = B.httpUrl;
    view.rerender(section(B));
    await sleep(100);
    expect(notice()).not.toBeNull();
    expect(acceptButton()).toHaveAttribute("aria-disabled", "true"); // still A's list: no answers
    store.failLoadOf = null;
    await act(async () => { window.dispatchEvent(new Event("focus")); }); // a later read succeeds
    await sleep(150);
    expect(notice()).toBeNull();
    expect(acceptButton()).not.toHaveAttribute("aria-disabled");
  });

  it("a failed load once recovered is forgotten: a later switch back to that portfolio says nothing while it loads", async () => {
    store.lists.set(A.httpUrl, [job()]);
    store.lists.set(B.httpUrl, [job()]);
    const view = render(section(A));
    await screen.findByRole("textbox", { name: fieldName });
    const notice = () => screen.queryByText(t("en-US", "scheduledJobsLoadFailedAfterSwitch"));
    store.failLoadOf = B.httpUrl;
    view.rerender(section(B));
    await sleep(100);
    expect(notice()).not.toBeNull();
    store.failLoadOf = null;
    await act(async () => { window.dispatchEvent(new Event("focus")); }); // B's list now loads
    await sleep(150);
    view.rerender(section(A));
    await sleep(150);
    holdLoads(); // B's next list is still on its way
    view.rerender(section(B));
    await sleep(20);
    expect(notice()).toBeNull(); // nothing failed this time
  });

  it("a failed re-read of the portfolio whose list is on screen shows no load-failed notice", async () => {
    store.lists.set(A.httpUrl, [job()]);
    render(section(A));
    await screen.findByRole("textbox", { name: fieldName });
    store.failLoadOf = A.httpUrl;
    await act(async () => { window.dispatchEvent(new Event("focus")); }); // A's re-read fails; A's list stays, still A's
    await sleep(100);
    expect(screen.queryByText(t("en-US", "scheduledJobsLoadFailedAfterSwitch"))).toBeNull();
    expect(acceptButton()).not.toHaveAttribute("aria-disabled");
  });

  it("a portfolio switched to that is still loading shows no load-failed notice, even after an earlier failed read", async () => {
    store.lists.set(A.httpUrl, [job()]);
    store.lists.set(B.httpUrl, [job()]);
    const view = render(section(A));
    await screen.findByRole("textbox", { name: fieldName });
    store.failLoadOf = A.httpUrl;
    await act(async () => { window.dispatchEvent(new Event("focus")); }); // A's re-read fails (A is on screen)
    await sleep(100);
    store.failLoadOf = null;
    holdLoads(); // B's list is on its way, nothing has failed for B
    view.rerender(section(B));
    await sleep(20);
    expect(screen.queryByText(t("en-US", "scheduledJobsLoadFailedAfterSwitch"))).toBeNull();
  });

  it("with no switch, Accept, Stop and Not on this device answer as before", async () => {
    const user = userEvent.setup();
    store.lists.set(A.httpUrl, [job()]);
    render(section(A));
    await screen.findByRole("textbox", { name: fieldName });
    await user.click(acceptButton());
    await sleep(150);
    expect(acceptanceState(job(), acceptanceScope(A.httpUrl))).toBe("accepted");
    await user.click(screen.getByRole("button", { name: "Stop on this device: Daily risks" }));
    await sleep(50);
    expect(acceptanceState(job(), acceptanceScope(A.httpUrl))).toBe("declined");
  });

  it("Not on this device on a job waiting for an OK declines it in this portfolio", async () => {
    const user = userEvent.setup();
    store.lists.set(A.httpUrl, [job()]);
    render(section(A));
    await screen.findByRole("textbox", { name: fieldName });
    await user.click(screen.getByRole("button", { name: "Not on this device: Daily risks" }));
    await sleep(50);
    expect(acceptanceState(job(), acceptanceScope(A.httpUrl))).toBe("declined");
  });
});

describe("ScheduledJobsSection — a row write refused by a portfolio switch is never silent", () => {
  const switchNotice = () => screen.queryByText(t("en-US", "scheduledJobChangeNotSavedPortfolioSwitch"));

  it("a delete refused by the switch says so", async () => {
    store.lists.set(A.httpUrl, [job()]);
    store.lists.set(B.httpUrl, [job({ key: "KB", name: "B job" })]);
    const view = render(section(A));
    await screen.findByRole("textbox", { name: fieldName });
    const release = holdLoads();
    view.rerender(section(B));
    await sleep(20);
    fireEvent.click(screen.getByRole("button", { name: `${t("en-US", "delete")} – Daily risks` }));
    await sleep(20);
    release();
    await sleep(300);
    expect(listOf(A)).toHaveLength(1);
    expect(listOf(B)).toHaveLength(1);
    expect(switchNotice()).not.toBeNull();
  });

  it("an on/off change refused by the switch says so", async () => {
    store.lists.set(A.httpUrl, [job()]);
    store.lists.set(B.httpUrl, [job({ key: "KB", name: "B job" })]);
    const view = render(section(A));
    await screen.findByRole("textbox", { name: fieldName });
    const release = holdLoads();
    view.rerender(section(B));
    await sleep(20);
    fireEvent.click(screen.getByRole("checkbox", { name: `${t("en-US", "scheduledJobEnabled")} – Daily risks` }));
    await sleep(20);
    release();
    await sleep(300);
    expect(listOf(A)[0].enabled).toBe(true);
    expect(listOf(B)[0].enabled).toBe(true);
    expect(switchNotice()).not.toBeNull();
  });

  it("a refused instruction save keeps its text and shows no such notice", async () => {
    const user = userEvent.setup();
    store.lists.set(A.httpUrl, [job()]);
    store.lists.set(B.httpUrl, [job({ key: "KB" })]);
    const view = render(section(A));
    await screen.findByRole("textbox", { name: fieldName });
    await user.clear(field());
    await user.type(field(), "typed-in-A");
    view.rerender(section(B));
    await sleep(300);
    expect(switchNotice()).toBeNull();
  });
});

describe("ScheduledJobsSection — a row's writes stay in the portfolio it was read from", () => {
  it("unsaved text at a switch to a clone (same key, same text) never lands in the other portfolio, and is kept", async () => {
    const user = userEvent.setup();
    store.lists.set(A.httpUrl, [job()]);
    store.lists.set(B.httpUrl, [job()]);
    const view = render(section(A));
    await screen.findByRole("textbox", { name: fieldName });
    await user.clear(field());
    await user.type(field(), "typed-in-A");
    view.rerender(section(B));
    await sleep(300);
    expect(listOf(B)[0].instruction).toBe("b");
    expect(store.writes).not.toContain(B.httpUrl);
    expect(deletedShown()).toBe(false);
    view.rerender(section(A));
    await sleep(300);
    expect(lostBox()).toHaveValue("typed-in-A"); // kept for copying
  });

  it("unsaved text at a switch to a portfolio with another job under that id: no false 'deleted' notice, the text kept", async () => {
    const user = userEvent.setup();
    store.lists.set(A.httpUrl, [job()]);
    store.lists.set(B.httpUrl, [job({ key: "KB" })]);
    const view = render(section(A));
    await screen.findByRole("textbox", { name: fieldName });
    await user.clear(field());
    await user.type(field(), "typed-in-A");
    view.rerender(section(B));
    await sleep(300);
    expect(deletedShown()).toBe(false);
    expect(listOf(B)[0].instruction).toBe("b");
    view.rerender(section(A));
    await sleep(300);
    expect(listOf(A)[0].instruction).toBe("b");
    expect(lostBox()).toHaveValue("typed-in-A");
  });

  it("a blur while the new portfolio's list is still loading writes nothing there, and keeps the text", async () => {
    const user = userEvent.setup();
    store.lists.set(A.httpUrl, [job()]);
    store.lists.set(B.httpUrl, [job({ key: "KB", instruction: "bee" })]);
    const view = render(section(A));
    await screen.findByRole("textbox", { name: fieldName });
    await user.clear(field());
    await user.type(field(), "typed-in-A");
    const release = holdLoads();
    view.rerender(section(B));
    await sleep(20);
    fireEvent.focusOut(field());
    await sleep(20);
    release();
    await sleep(300);
    expect(listOf(B)[0]).toMatchObject({ instruction: "bee", key: "KB" });
    expect(store.writes).not.toContain(B.httpUrl);
    expect(deletedShown()).toBe(false);
    view.rerender(section(A));
    await sleep(300);
    expect(lostBox()).toHaveValue("typed-in-A");
  });

  it("a legacy row's name edit while the new portfolio's list is loading does not reach that portfolio's job", async () => {
    store.lists.set(A.httpUrl, [job({ key: null, projectId: null, timeZone: null })]);
    store.lists.set(B.httpUrl, [job({ key: null, projectId: null, timeZone: null, name: "B job" })]);
    const view = render(section(A));
    await screen.findByRole("textbox", { name: fieldName });
    const release = holdLoads();
    view.rerender(section(B));
    await sleep(20);
    fireEvent.change(screen.getByRole("textbox", { name: `${t("en-US", "scheduledJobName")} – Daily risks` }), { target: { value: "Daily risks!" } });
    await sleep(20);
    release();
    await sleep(300);
    expect(listOf(B)[0].name).toBe("B job");
    expect(store.writes).not.toContain(B.httpUrl);
  });
});

describe("useScheduledJobs — failedSource names only the active backend", () => {
  it("a read of the previous backend that fails after the switch is not reported", async () => {
    store.lists.set(A.httpUrl, [job()]);
    store.lists.set(B.httpUrl, [job()]);
    store.failLoadOf = A.httpUrl;
    let releaseA: () => void = () => {};
    store.loadGate = new Promise<void>((r) => { releaseA = r; }); // A's first read waits here
    const hook = renderHook((p: { config: TursoConfig }) => useScheduledJobs({ config: p.config }), { initialProps: { config: A } });
    await sleep(20);
    store.loadGate = null; // B's read is not held
    hook.rerender({ config: B });
    await sleep(50);
    expect(hook.result.current.jobsSource).toBe(B.httpUrl);
    await act(async () => { releaseA(); }); // A's read now fails, with B active
    await sleep(50);
    expect(hook.result.current.failedSource).toBeUndefined();
  });

  it("a failed read of the active backend is reported, and a later successful read clears it", async () => {
    store.lists.set(A.httpUrl, [job()]);
    store.failLoadOf = A.httpUrl;
    const hook = renderHook(() => useScheduledJobs({ config: A }));
    await sleep(50);
    expect(hook.result.current.failedSource).toBe(A.httpUrl);
    store.failLoadOf = null;
    await act(async () => { await hook.result.current.refresh(); });
    expect(hook.result.current.failedSource).toBeUndefined();
  });
});
