// A row's writes are bound to the portfolio its list was read from, and assigning a project to a legacy job keeps
// keyboard focus and lets a follow-up edit reach the job (the real hook, over a store mock with one list per backend).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScheduledJobsSection } from "./scheduled-jobs-section";
import { newConsent } from "../ai-consent";
import { defaultSettings, type Settings } from "../settings-types";
import { t } from "../i18n";
import type { ScheduledJob } from "../scheduled-jobs/types";
import type { TursoConfig } from "../turso-config";
import { __resetEditedHereForTests, ACCEPTANCE_KEY, acceptanceScope, acceptanceState, storedAcceptanceEntry } from "../scheduled-job-acceptance";

const store = vi.hoisted(() => ({
  lists: new Map<string, unknown[]>(),
  loadGate: null as Promise<void> | null,
  writes: [] as string[],
  /** How many of the next saves fail (the database unreachable). */
  failNext: 0,
}));
vi.mock("../scheduled-jobs-store", () => ({
  loadScheduledJobs: async (config: { httpUrl: string } | null) => {
    if (store.loadGate) await store.loadGate;
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
