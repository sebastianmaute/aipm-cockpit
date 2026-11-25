// A row's writes are bound to the portfolio its list was read from, and assigning a project to a legacy job keeps
// keyboard focus and lets a follow-up edit reach the job (the real hook, over a store mock with one list per backend).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScheduledJobsSection } from "./scheduled-jobs-section";
import { newConsent } from "../ai-consent";
import { defaultSettings, type Settings } from "../settings-types";
import { t } from "../i18n";
import type { ScheduledJob } from "../scheduled-jobs/types";
import type { TursoConfig } from "../turso-config";
import { __resetEditedHereForTests, ACCEPTANCE_KEY } from "../scheduled-job-acceptance";

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
  return () => { store.loadGate = null; release(); };
}

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
