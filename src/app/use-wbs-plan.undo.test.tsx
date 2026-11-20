// §796 — undo of an "Optimize with AI" apply reverts its edits AND removes the tasks it created, keeping any
// that changed or became referenced since. The proposal call is mocked; the workspace is the REAL
// WorkspaceProvider, the stack the REAL useUndoStack and the apply the hook's real one.
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("./ai-privacy-context", async () => ({
  ...(await import("../test/ai-privacy-unprotected")),
}));
import { newConsent } from "./ai-consent";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useEffect } from "react";
import { useWbsPlan } from "./use-wbs-plan";
import { ToastProvider } from "./toast-context";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { useUndoStack, type UndoStackApi } from "./undo/use-undo-stack";
import { defaultSettings, type Settings } from "./settings-types";
import { type RaidItem, type Task } from "./types";
import * as call from "./wbs-plan-call";
import { type ParsedWbsProposal, type RawWbsItem } from "./wbs-plan/wbs-plan";
import { t, tPlural } from "./i18n";
import type { OperatingGuide } from "./operating-guide";

vi.mock("./wbs-plan-call");

const AI_ON: Settings = {
  ...defaultSettings,
  ai: { ...defaultSettings.ai, enabled: true, consent: newConsent(new Date(0)), apiKey: "sk-ant-test", model: "claude-x" },
};

const task = (id: number, over: Partial<Task> = {}): Task =>
  ({
    id,
    taskName: `Task ${id}`,
    assignee: "",
    assigneeEmail: "",
    dueDate: "2026-11-01",
    lastUpdateDate: "2026-10-01",
    priority: "Medium",
    status: "To Do",
    blockers: "",
    description: "",
    ...over,
  }) as Task;

const SEED: readonly Task[] = [task(1, { group: "Core" }), task(2, { group: "Core" }), task(3, { group: "Ops" })];
const NO_GUIDES: readonly OperatingGuide[] = [];
const NO_HOLIDAYS: ReadonlySet<string> = new Set();

interface Api {
  ws: ReturnType<typeof useWorkspace>;
  undo: UndoStackApi;
}

/** `sharedToast`: the stack's toast goes to the same spy as the hook's, as both reach the one slot in the app. */
function Harness({ onApi, sharedToast }: { onApi: (api: Api) => void; sharedToast: boolean }) {
  const ws = useWorkspace();
  const undo = useUndoStack({ lang: "en-US", logActivity: vi.fn(), showToast: sharedToast ? showToast : stackToast, showToastAction: vi.fn() });
  const wbs = useWbsPlan({
    settings: AI_ON,
    isPopout: false,
    lang: "en-US",
    captureComposite: undo.captureComposite,
    getScopeEpoch: () => 0,
    loadPending: false,
    today: "2026-10-12",
    holidaySet: NO_HOLIDAYS,
    guides: NO_GUIDES,
  });
  useEffect(() => { onApi({ ws, undo }); });
  return (
    <div>
      {wbs.button}
      {wbs.modal}
    </div>
  );
}

const showToast = vi.fn();
const stackToast = vi.fn();

function renderHarness(seed: readonly Task[] = SEED, sharedToast = false) {
  const box: { api: Api | null } = { api: null };
  render(
    <ToastProvider value={{ showToast, showToastAction: vi.fn() }}>
      <FiltersProvider>
        <WorkspaceProvider>
          <Harness sharedToast={sharedToast} onApi={(a) => { box.api = a; }} />
        </WorkspaceProvider>
      </FiltersProvider>
    </ToastProvider>,
  );
  act(() => { box.api!.ws.setTasks(seed); });
  return () => box.api!;
}

async function applyProposal(items: RawWbsItem[]) {
  vi.mocked(call.runWbsProposal).mockResolvedValue({ items, truncated: false } satisfies ParsedWbsProposal);
  fireEvent.click(screen.getByRole("button", { name: t("en-US", "wbsPlanButton") }));
  fireEvent.click(screen.getByRole("button", { name: t("en-US", "wbsPlanPropose") }));
  const boxes = await screen.findAllByRole("checkbox", { name: /include this change/i });
  fireEvent.click(screen.getByRole("button", { name: tPlural("en-US", "wbsPlanApply", boxes.length, boxes.length) }));
}

/** Drain the microtask `onKept` is queued on. */
const settle = () => act(async () => { await Promise.resolve(); });

const named = (tasks: readonly Task[], name: string) => tasks.filter((x) => x.taskName === name);
const ids = (tasks: readonly Task[]) => tasks.map((x) => x.id);
const noDuplicateIds = (tasks: readonly Task[]) => expect(new Set(ids(tasks)).size).toBe(tasks.length);
const noDanglingDeps = (tasks: readonly Task[]) => {
  const live = new Set(ids(tasks));
  for (const x of tasks) for (const d of x.dependencies ?? []) expect(live.has(d.taskId)).toBe(true);
};
/** The rows without the save stamp, which no undo restores and nothing here compares. */
const fields = (tasks: readonly Task[]) =>
  tasks.map((x) => {
    const rest: Partial<Task> = { ...x };
    delete rest.localModifiedAt;
    return rest;
  });

const SPLIT_AND_NEW: RawWbsItem[] = [
  { kind: "split", taskId: 1, pieces: [{ taskName: "Design API" }, { taskName: "Build API" }], why: "too big" },
  { kind: "newTask", ref: "n1", taskName: "Write docs", dueDate: "2026-11-15", why: "missing" },
  { kind: "newTask", ref: "n2", taskName: "Review docs", dueDate: "2026-11-16", why: "missing" },
  { kind: "link", from: { kind: "piece", taskId: 1, piece: 2 }, to: { kind: "task", id: 2 }, why: "order" },
  // A chain between two created tasks: n1 is only "referenced" by n2's own created image.
  { kind: "link", from: { kind: "ref", ref: "n1" }, to: { kind: "ref", ref: "n2" }, why: "order" },
];

/** The split piece 2 and task 2's link to it. */
const SPLIT_LINKED: RawWbsItem[] = [
  { kind: "split", taskId: 1, pieces: [{ taskName: "Design API" }, { taskName: "Build API" }], why: "too big" },
  { kind: "link", from: { kind: "piece", taskId: 1, piece: 2 }, to: { kind: "task", id: 2 }, why: "order" },
];

describe("useWbsPlan undo (§796)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("undo reverts the edits and removes every created task", async () => {
    const api = renderHarness();
    await applyProposal(SPLIT_AND_NEW);
    expect(api().ws.tasks).toHaveLength(6);

    act(() => { api().undo.undo(); });

    expect(fields(api().ws.tasks)).toEqual(fields(SEED));
    await settle();
    expect(showToast).not.toHaveBeenCalledWith("info", expect.stringContaining("kept"));
  });

  it("undo keeps a created task edited since and shows the kept toast", async () => {
    const api = renderHarness();
    await applyProposal(SPLIT_AND_NEW);
    act(() => {
      api().ws.setTasks((prev) => prev.map((x) => (x.taskName === "Write docs" ? { ...x, taskName: "Write docs v2" } : x)));
    });

    act(() => { api().undo.undo(); });
    await settle();

    const tasks = api().ws.tasks;
    expect(named(tasks, "Write docs v2")).toHaveLength(1);
    expect(named(tasks, "Build API")).toHaveLength(0);
    expect(named(tasks, "Review docs")).toHaveLength(0);
    expect(byName(tasks, "Task 1")).toBeDefined();
    noDanglingDeps(tasks);
    expect(showToast).toHaveBeenLastCalledWith("info", "Undone. 1 new task was kept because it changed after the breakdown.");
  });

  // The kept task is the chain's TAIL: its link to the removed head is dropped, and redo puts it back.
  it("undo drops a kept task's link to a removed task, and redo restores it", async () => {
    const api = renderHarness();
    await applyProposal(SPLIT_AND_NEW);
    const docsId = named(api().ws.tasks, "Write docs")[0].id;
    expect(byName(api().ws.tasks, "Review docs")?.dependencies).toEqual([{ taskId: docsId, type: "FS" }]);
    act(() => {
      api().ws.setTasks((prev) => prev.map((x) => (x.taskName === "Review docs" ? { ...x, description: "<p>edited</p>" } : x)));
    });

    act(() => { api().undo.undo(); });
    await settle();

    expect(named(api().ws.tasks, "Write docs")).toHaveLength(0);
    expect(byName(api().ws.tasks, "Review docs")?.dependencies ?? []).toEqual([]);
    expect(showToast).toHaveBeenLastCalledWith("info", "Undone. 1 new task was kept because it changed after the breakdown.");

    act(() => { api().undo.redo(); });

    noDuplicateIds(api().ws.tasks);
    expect(ids(named(api().ws.tasks, "Write docs"))).toEqual([docsId]);
    expect(byName(api().ws.tasks, "Review docs")?.dependencies).toEqual([{ taskId: docsId, type: "FS" }]);
  });

  // The stack's own "Undone" toast and the kept toast share the app's one slot: the kept one must land LAST.
  it("the kept toast replaces the stack's Undone toast", async () => {
    const api = renderHarness(SEED, true);
    await applyProposal(SPLIT_AND_NEW);
    act(() => {
      api().ws.setTasks((prev) => prev.map((x) => (x.taskName === "Write docs" ? { ...x, taskName: "Write docs v2" } : x)));
    });
    showToast.mockClear();

    act(() => { api().undo.undo(); });
    await settle();

    const texts = showToast.mock.calls.map((c) => c[1] as string);
    expect(texts.some((x) => x.startsWith("Undone") && !x.includes("kept"))).toBe(true);
    expect(texts.at(-1)).toBe("Undone. 1 new task was kept because it changed after the breakdown.");
  });

  // Without an edit there is no field fragment, so the created fragment alone must carry the re-mint map.
  it("an apply that only creates survives two re-mints in a row", async () => {
    const api = renderHarness();
    await applyProposal([
      { kind: "newTask", ref: "n1", taskName: "Write docs", dueDate: "2026-11-15", why: "missing" },
      { kind: "newTask", ref: "n2", taskName: "Review docs", dueDate: "2026-11-16", why: "missing" },
      { kind: "link", from: { kind: "ref", ref: "n1" }, to: { kind: "ref", ref: "n2" }, why: "order" },
    ]);
    const docsId = named(api().ws.tasks, "Write docs")[0].id;
    act(() => { api().undo.undo(); });
    act(() => { api().ws.setTasks((prev) => [...prev, task(docsId, { taskName: "Intruder" })]); });
    const withIntruder = fields(api().ws.tasks);
    act(() => { api().undo.redo(); });
    expect(named(api().ws.tasks, "Write docs")[0].id).not.toBe(docsId);
    act(() => { api().undo.undo(); });
    expect(fields(api().ws.tasks)).toEqual(withIntruder);
    act(() => { api().undo.redo(); });
    const docs = named(api().ws.tasks, "Write docs")[0];
    expect(byName(api().ws.tasks, "Review docs")?.dependencies).toEqual([{ taskId: docs.id, type: "FS" }]);

    act(() => { api().undo.undo(); });
    await settle();

    expect(fields(api().ws.tasks)).toEqual(withIntruder);
    expect(showToast).not.toHaveBeenCalledWith("info", expect.stringContaining("kept"));
  });

  it("undo keeps a created task a RAID item links to", async () => {
    const api = renderHarness();
    await applyProposal(SPLIT_AND_NEW);
    const docsId = named(api().ws.tasks, "Write docs")[0].id;
    act(() => {
      api().ws.setRaid([{ id: 1, category: "R", title: "Risk", status: "Open", linkedTaskIds: [docsId], raisedDate: "2026-10-01" } as unknown as RaidItem]);
    });

    act(() => { api().undo.undo(); });
    await settle();

    const tasks = api().ws.tasks;
    expect(ids(named(tasks, "Write docs"))).toEqual([docsId]);
    expect(named(tasks, "Build API")).toHaveLength(0);
    expect(named(tasks, "Review docs")).toHaveLength(0);
    noDanglingDeps(tasks);
    expect(showToast).toHaveBeenLastCalledWith("info", "Undone. 1 new task was kept because it changed after the breakdown.");
  });

  it("redo restores edits and created tasks with no duplicate ids", async () => {
    const api = renderHarness();
    await applyProposal(SPLIT_AND_NEW);
    const applied = fields(api().ws.tasks);

    act(() => { api().undo.undo(); });
    act(() => { api().undo.redo(); });

    const tasks = api().ws.tasks;
    noDuplicateIds(tasks);
    expect(fields(tasks)).toEqual(applied);
  });

  it("redo after a task took a freed id re-mints and the split's links follow it", async () => {
    const api = renderHarness();
    await applyProposal(SPLIT_LINKED);
    const pieceId = named(api().ws.tasks, "Build API")[0].id;
    expect(byName(api().ws.tasks, "Task 2")?.dependencies).toEqual([{ taskId: pieceId, type: "FS" }]);

    act(() => { api().undo.undo(); });
    expect(named(api().ws.tasks, "Build API")).toHaveLength(0);
    act(() => { api().ws.setTasks((prev) => [...prev, task(pieceId, { taskName: "Intruder" })]); });
    act(() => { api().undo.redo(); });

    const tasks = api().ws.tasks;
    noDuplicateIds(tasks);
    const piece = named(tasks, "Build API");
    expect(piece).toHaveLength(1);
    expect(piece[0].id).not.toBe(pieceId);
    expect(byName(tasks, "Task 2")?.dependencies).toEqual([{ taskId: piece[0].id, type: "FS" }]);
    expect(named(tasks, "Intruder").map((x) => x.id)).toEqual([pieceId]);
  });

  it("undo → redo with a re-mint → undo again removes the re-minted task and reverts the edits", async () => {
    const api = renderHarness();
    await applyProposal(SPLIT_LINKED);
    const pieceId = named(api().ws.tasks, "Build API")[0].id;
    act(() => { api().undo.undo(); });
    act(() => { api().ws.setTasks((prev) => [...prev, task(pieceId, { taskName: "Intruder" })]); });
    const beforeRedo = fields(api().ws.tasks);
    act(() => { api().undo.redo(); });
    const remintedId = named(api().ws.tasks, "Build API")[0].id;

    act(() => { api().undo.undo(); });
    await settle();

    const tasks = api().ws.tasks;
    expect(fields(tasks)).toEqual(beforeRedo);
    noDuplicateIds(tasks);
    noDanglingDeps(tasks);
    expect(ids(tasks)).not.toContain(remintedId);
    expect(showToast).not.toHaveBeenCalledWith("info", expect.stringContaining("kept"));

    // And a further redo puts the piece back with task 2 linked to IT, never to the intruder.
    act(() => { api().undo.redo(); });
    const again = api().ws.tasks;
    noDuplicateIds(again);
    const piece = named(again, "Build API");
    expect(piece).toHaveLength(1);
    expect(byName(again, "Task 2")?.dependencies).toEqual([{ taskId: piece[0].id, type: "FS" }]);
    expect(byName(again, "Intruder")?.dependencies ?? []).toEqual([]);
  });

  // A chain between created tasks whose head was re-minted: the tail's link followed the head, so the head is
  // still only "referenced" by the tail's own created image and goes with it.
  it("undo after a re-minting redo still removes a created chain", async () => {
    const api = renderHarness();
    await applyProposal(SPLIT_AND_NEW);
    const docsId = named(api().ws.tasks, "Write docs")[0].id;
    act(() => { api().undo.undo(); });
    act(() => { api().ws.setTasks((prev) => [...prev, task(docsId, { taskName: "Intruder" })]); });
    const beforeRedo = fields(api().ws.tasks);
    act(() => { api().undo.redo(); });
    const docs = named(api().ws.tasks, "Write docs")[0];
    expect(docs.id).not.toBe(docsId);
    expect(byName(api().ws.tasks, "Review docs")?.dependencies).toEqual([{ taskId: docs.id, type: "FS" }]);

    act(() => { api().undo.undo(); });
    await settle();

    expect(fields(api().ws.tasks)).toEqual(beforeRedo);
    expect(showToast).not.toHaveBeenCalledWith("info", expect.stringContaining("kept"));
  });

  it("an apply that only creates gets an undo entry", async () => {
    const api = renderHarness();
    await applyProposal([{ kind: "newTask", ref: "n1", taskName: "Write docs", dueDate: "2026-11-15", why: "missing" }]);
    expect(named(api().ws.tasks, "Write docs")).toHaveLength(1);
    expect(api().undo.canUndo).toBe(true);

    act(() => { api().undo.undo(); });

    expect(fields(api().ws.tasks)).toEqual(fields(SEED));
  });
});

function byName(tasks: readonly Task[], name: string): Task | undefined {
  return tasks.find((x) => x.taskName === name);
}
