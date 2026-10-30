// Hook-level tests for the "Optimize with AI" flow (use-wbs-plan.tsx): the
// forced call is mocked, the workspace is the REAL WorkspaceProvider and, where
// undo matters, the stack is the REAL useUndoStack — so apply, the apply-time
// re-ground and undo are exercised end to end, not against spies.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// Rendered without task-manager's AI privacy provider: requests carry the privacy of no project.
// AI people protection, Task 6: one describe flips `people.on` (one stable getter, as the real one is).
const people = vi.hoisted(() => {
  const state = { on: false };
  return { state, get: () => state.on };
});
vi.mock("./ai-privacy-context", async () => ({
  ...(await import("../test/ai-privacy-unprotected")),
  useOpenProjectPeopleProtected: () => people.get,
}));
import { newConsent } from "./ai-consent";
import { aiPrivacyFor } from "./ai-privacy";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { AiHttpError } from "./ai-errors";
import { useWbsPlan, type WbsPlan } from "./use-wbs-plan";
import { ToastProvider } from "./toast-context";
import { useToast } from "./use-toast";
import { FiltersProvider, useFilters } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { useUndoStack, type UndoStackApi } from "./undo/use-undo-stack";
import { defaultSettings, type Settings } from "./settings-types";
import { type Task } from "./types";
import * as call from "./wbs-plan-call";
import * as engine from "./wbs-plan/wbs-plan";
import { type ParsedWbsProposal, type RawWbsItem } from "./wbs-plan/wbs-plan";
import { loadI18n, t, tPlural } from "./i18n";
import type { OperatingGuide } from "./operating-guide";

vi.mock("./wbs-plan-call");
// The REAL engine, wrapped so one test can make the setTasks updater's apply
// throw (the R12 fallback) while the snapshot apply before it succeeds.
vi.mock("./wbs-plan/wbs-plan", async (importOriginal) => {
  const real = await importOriginal<typeof import("./wbs-plan/wbs-plan")>();
  return { ...real, applyWbsProposal: vi.fn(real.applyWbsProposal) };
});

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

const SEED: readonly Task[] = [
  task(1, { group: "Core" }),
  task(2, { group: "Core" }),
  task(3, { group: "Ops" }),
];

function proposal(items: RawWbsItem[]): ParsedWbsProposal {
  return { items, truncated: false };
}

interface Api {
  ws: ReturnType<typeof useWorkspace>;
  filters: ReturnType<typeof useFilters>;
  undo: UndoStackApi;
  wbs: WbsPlan;
}

interface HarnessProps {
  settings?: Settings;
  guides?: readonly OperatingGuide[];
  isPopout?: boolean;
  logActivitySpy?: ReturnType<typeof vi.fn>;
  /** A fake scope-epoch reader the test controls. */
  getScopeEpoch?: () => number;
  loadPending?: boolean;
  onApi: (api: Api) => void;
}

const EPOCH_ZERO = () => 0;
/** The table's clock: SEED's due dates (2026-11-01) are ahead of it. */
const TODAY = "2026-10-12";
const NO_HOLIDAYS: ReadonlySet<string> = new Set();
const NO_GUIDES: readonly OperatingGuide[] = [];
const guide = (over: Partial<OperatingGuide>): OperatingGuide => ({
  id: "g", name: "Team rules", content: "Split anything over 3 days.", enabled: true,
  priority: 10, scope: { targets: ["wbs"] }, builtIn: false, ...over,
});

function Harness({ settings = AI_ON, guides = NO_GUIDES, isPopout = false, logActivitySpy, getScopeEpoch = EPOCH_ZERO, loadPending = false, onApi }: HarnessProps) {
  const ws = useWorkspace();
  const filters = useFilters();
  const undo = useUndoStack({ lang: "en-US", logActivity: vi.fn(), showToast: vi.fn(), showToastAction: vi.fn() });
  const wbs = useWbsPlan({
    settings,
    isPopout,
    lang: "en-US",
    capture: undo.capture,
    logActivityAs: logActivitySpy as never,
    getScopeEpoch,
    loadPending,
    today: TODAY,
    holidaySet: NO_HOLIDAYS,
    guides,
  });
  useEffect(() => { onApi({ ws, filters, undo, wbs }); });
  return (
    <div>
      {wbs.button}
      {wbs.modal}
    </div>
  );
}

const showToast = vi.fn();

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <ToastProvider value={{ showToast, showToastAction: vi.fn() }}>
      <FiltersProvider>
        <WorkspaceProvider>{children}</WorkspaceProvider>
      </FiltersProvider>
    </ToastProvider>
  );
}

// The REAL single-slot toast (use-toast.ts), rendered: a mocked showToast
// records every call, so it cannot see one toast replacing another.
function RealToastWrapper({ children }: { children: ReactNode }) {
  const { toast, showToast: realShowToast, showToastAction } = useToast();
  return (
    <ToastProvider value={{ showToast: realShowToast, showToastAction }}>
      <output data-testid="toast">{toast?.text ?? ""}</output>
      <FiltersProvider>
        <WorkspaceProvider>{children}</WorkspaceProvider>
      </FiltersProvider>
    </ToastProvider>
  );
}

function renderHarness(
  props: Omit<HarnessProps, "onApi"> = {},
  seed: readonly Task[] = SEED,
  Shell: (p: { children: ReactNode }) => ReactNode = Wrapper,
) {
  const box: { api: Api | null } = { api: null };
  const onApi = (a: Api) => { box.api = a; };
  const { unmount, rerender } = render(
    <Shell>
      <Harness {...props} onApi={onApi} />
    </Shell>,
  );
  act(() => { box.api!.ws.setTasks(seed); });
  const reprops = (next: Omit<HarnessProps, "onApi">) =>
    rerender(
      <Shell>
        <Harness {...props} {...next} onApi={onApi} />
      </Shell>,
    );
  return Object.assign(() => box.api!, { unmount, reprops });
}

const byId = (tasks: readonly Task[], id: number) => tasks.find((x) => x.id === id);

async function proposeFromButton(instruction = "") {
  fireEvent.click(screen.getByRole("button", { name: t("en-US", "wbsPlanButton") }));
  if (instruction) {
    fireEvent.change(screen.getByRole("textbox", { name: t("en-US", "wbsPlanInstructionLabel") }), {
      target: { value: instruction },
    });
  }
  fireEvent.click(screen.getByRole("button", { name: t("en-US", "wbsPlanPropose") }));
}

describe("useWbsPlan (optimize work breakdown)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // §701 — the guides that target Optimize with AI reach its call; a chat-only
  // guide does not, and nothing goes when guide grounding is off.
  it("sends the guides that target wbs, and only those, with the proposal call", async () => {
    vi.mocked(call.runWbsProposal).mockResolvedValue(proposal([]));
    renderHarness({ guides: [guide({}), guide({ id: "c", content: "Chat-only rule.", scope: {} })] });
    await proposeFromButton("go");
    await waitFor(() => expect(call.runWbsProposal).toHaveBeenCalled());
    const text = vi.mocked(call.runWbsProposal).mock.calls[0][1].guideText ?? "";
    expect(text).toContain("Split anything over 3 days.");
    expect(text).not.toContain("Chat-only rule.");
  });

  it("sends no guides when guide grounding is off", async () => {
    vi.mocked(call.runWbsProposal).mockResolvedValue(proposal([]));
    renderHarness({ guides: [guide({})], settings: { ...AI_ON, ai: { ...AI_ON.ai, groundInGuides: false } } });
    await proposeFromButton("go");
    await waitFor(() => expect(call.runWbsProposal).toHaveBeenCalled());
    expect(vi.mocked(call.runWbsProposal).mock.calls[0][1].guideText).toBe("");
  });

  it("button → input → propose → preview → apply writes a split: piece 1 keeps its id, piece 2 gets a fresh id", async () => {
    vi.mocked(call.runWbsProposal).mockResolvedValue(
      proposal([
        { kind: "split", taskId: 1, pieces: [{ taskName: "Design A" }, { taskName: "Design B" }], why: "too big" },
      ]),
    );
    const logActivitySpy = vi.fn();
    const api = renderHarness({ logActivitySpy });

    await proposeFromButton("split anything over 3 days");

    // The preview lists the grounded item, ticked by default.
    const box = await screen.findByRole("checkbox", { name: /include this change/i });
    expect(box).toBeChecked();
    expect(screen.getByText("Design B · no estimate")).toBeTruthy();

    // The call got the user's instruction and a context marking the scope.
    const [context, creds, instruction, signal] = vi.mocked(call.runWbsProposal).mock.calls[0];
    expect(instruction).toBe("split anything over 3 days");
    expect(creds).toEqual({ apiKey: "sk-ant-test", model: "claude-x", guideText: "", privacy: aiPrivacyFor([]) });
    expect(context).toContain("#1 [in scope]");
    expect(signal).toBeInstanceOf(AbortSignal);

    fireEvent.click(screen.getByRole("button", { name: tPlural("en-US", "wbsPlanApply", 1, 1) }));

    const tasks = api().ws.tasks;
    expect(tasks).toHaveLength(4);
    expect(byId(tasks, 1)?.taskName).toBe("Design A");
    const created = tasks.find((x) => x.taskName === "Design B");
    expect(created).toBeDefined();
    expect(created!.id).toBeGreaterThan(3);
    expect(created!.resourceId).toBeUndefined();
    expect(logActivitySpy).toHaveBeenCalledWith("ai", "ai.wbsPlan", 1);
    expect(showToast).toHaveBeenCalledWith("info", tPlural("en-US", "wbsPlanApplied", 1, 1));
    // Back to idle — the preview is gone.
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("sends a default instruction when the field is left blank", async () => {
    vi.mocked(call.runWbsProposal).mockResolvedValue(proposal([]));
    renderHarness();
    await proposeFromButton();
    await waitFor(() => expect(call.runWbsProposal).toHaveBeenCalled());
    expect(vi.mocked(call.runWbsProposal).mock.calls[0][2].trim()).not.toBe("");
  });

  it("a proposal whose every item was refused opens the preview with the reasons, not 'no changes'", async () => {
    vi.mocked(call.runWbsProposal).mockResolvedValue(
      proposal([{ kind: "regroup", taskId: 1, group: "Core", why: "" }]), // task 1 is already in Core
    );
    renderHarness();
    await proposeFromButton();
    await screen.findByText(t("en-US", "wbsPlanAllSkipped"));
    expect(screen.getByText(`Task 1 — ${t("en-US", "wbsPlanSkip_sameGroup")}`)).toBeVisible();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(showToast).not.toHaveBeenCalledWith("info", t("en-US", "wbsPlanEmpty"));
  });

  // The chat path caps instructions at 1000 characters; the toolbar must too.
  it("caps the toolbar instruction sent to the model at 1000 characters", async () => {
    vi.mocked(call.runWbsProposal).mockImplementation(() => new Promise(() => {}));
    renderHarness();
    await proposeFromButton(`  ${"x".repeat(5000)}`);
    await waitFor(() => expect(call.runWbsProposal).toHaveBeenCalled());
    expect(vi.mocked(call.runWbsProposal).mock.calls[0][2]).toBe("x".repeat(1000));
  });

  // The instruction lives in the dialog: a keystroke re-rendered the component that owns the hook (in the app,
  // task-manager, so the whole tree), measured at 40-55 ms a key in a production build against 10-15 ms in the
  // other fields. Mutation: holding the text in the hook again re-renders the host on every change.
  it("typing the instruction re-renders the dialog only, never the component that owns the hook", () => {
    const api = renderHarness();
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "wbsPlanButton") }));
    const box = screen.getByRole("textbox", { name: t("en-US", "wbsPlanInstructionLabel") });
    const before = api();
    for (const value of ["s", "sp", "spl", "split"]) fireEvent.change(box, { target: { value } });
    expect(box).toHaveValue("split");
    expect(api()).toBe(before);
  });

  it("proposes with the instruction as typed in the dialog", async () => {
    vi.mocked(call.runWbsProposal).mockImplementation(() => new Promise(() => {}));
    renderHarness();
    await proposeFromButton("split anything over a week");
    await waitFor(() => expect(call.runWbsProposal).toHaveBeenCalled());
    expect(vi.mocked(call.runWbsProposal).mock.calls[0][2]).toBe("split anything over a week");
    // The dialog stays up while the call runs, still showing what was typed.
    expect(screen.getByRole("textbox", { name: t("en-US", "wbsPlanInstructionLabel") })).toHaveValue("split anything over a week");
  });

  it("an empty proposal toasts wbsPlanEmpty and resets", async () => {
    vi.mocked(call.runWbsProposal).mockResolvedValue(proposal([]));
    renderHarness();
    await proposeFromButton();
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("info", t("en-US", "wbsPlanEmpty")));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("apply after a concurrent edit keeps the edit", async () => {
    vi.mocked(call.runWbsProposal).mockResolvedValue(
      proposal([{ kind: "regroup", taskId: 1, group: "Backend", why: "belongs there" }]),
    );
    const logActivitySpy = vi.fn();
    const api = renderHarness({ logActivitySpy });
    await proposeFromButton();
    await screen.findByRole("checkbox", { name: /include this change/i });

    // Two edits land while the preview is open: one unrelated, one on the target.
    act(() => {
      api().ws.setTasks((prev) =>
        prev.map((x) =>
          x.id === 2 ? { ...x, taskName: "Unrelated edit" } : x.id === 1 ? { ...x, taskName: "Target edit" } : x,
        ),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: tPlural("en-US", "wbsPlanApply", 1, 1) }));

    const tasks = api().ws.tasks;
    expect(byId(tasks, 2)?.taskName).toBe("Unrelated edit");
    expect(byId(tasks, 1)?.taskName).toBe("Target edit");
    expect(byId(tasks, 1)?.group).toBe("Core");
    expect(showToast).toHaveBeenCalledWith("info", tPlural("en-US", "wbsPlanStaleSkipped", 1, 1));
    expect(showToast).not.toHaveBeenCalledWith("info", expect.stringMatching(/^Applied/));
    expect(logActivitySpy).not.toHaveBeenCalled();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  // Through the real single-slot toast: two calls in one handler would leave
  // only the second on screen, so the applied count must share one message.
  it("a partial apply shows the applied and the skipped count in the one toast the user sees", async () => {
    vi.mocked(call.runWbsProposal).mockResolvedValue(
      proposal([
        { kind: "regroup", taskId: 1, group: "Backend", why: "" },
        { kind: "regroup", taskId: 2, group: "Platform", why: "" },
        { kind: "regroup", taskId: 3, group: "Infra", why: "" },
      ]),
    );
    const api = renderHarness({}, SEED, RealToastWrapper);
    await proposeFromButton();
    await screen.findAllByRole("checkbox", { name: /include this change/i });
    act(() => {
      api().ws.setTasks((prev) => prev.map((x) => (x.id === 1 ? { ...x, taskName: "Edited meanwhile" } : x)));
    });

    fireEvent.click(screen.getByRole("button", { name: tPlural("en-US", "wbsPlanApply", 3, 3) }));

    expect(byId(api().ws.tasks, 2)?.group).toBe("Platform");
    expect(byId(api().ws.tasks, 3)?.group).toBe("Infra");
    expect(byId(api().ws.tasks, 1)?.group).toBe("Core");
    expect(screen.getByTestId("toast")).toHaveTextContent(
      "Work-breakdown changes applied: 2. 1 change was skipped because the task list changed after the proposal.",
    );
  });

  it("the combined notice has EN and DE plural forms", async () => {
    await loadI18n("de");
    expect(tPlural("en-US", "wbsPlanAppliedSkipped", 3, 2, 3)).toBe(
      "Work-breakdown changes applied: 2. 3 changes were skipped because the task list changed after the proposal.",
    );
    expect(tPlural("de", "wbsPlanAppliedSkipped", 3, 2, 3)).toBe(
      "Übernommene Änderungen an den Arbeitspaketen: 2. 3 Änderungen wurden übersprungen, weil sich die Aufgabenliste seit dem Vorschlag geändert hat.",
    );
    expect(tPlural("de", "wbsPlanAppliedSkipped", 1, 4, 1)).toBe(
      "Übernommene Änderungen an den Arbeitspaketen: 4. 1 Änderung wurde übersprungen, weil sich die Aufgabenliste seit dem Vorschlag geändert hat.",
    );
  });

  it("undo reverts edits and leaves created rows single", async () => {
    vi.mocked(call.runWbsProposal).mockResolvedValue(
      proposal([
        { kind: "regroup", taskId: 2, group: "Platform", why: "fits" },
        { kind: "newTask", ref: "n1", taskName: "Write docs", dueDate: "2026-11-15", why: "missing" },
      ]),
    );
    const api = renderHarness();
    await proposeFromButton();
    await screen.findAllByRole("checkbox", { name: /include this change/i });
    fireEvent.click(screen.getByRole("button", { name: tPlural("en-US", "wbsPlanApply", 2, 2) }));

    expect(byId(api().ws.tasks, 2)?.group).toBe("Platform");
    expect(api().ws.tasks.filter((x) => x.taskName === "Write docs")).toHaveLength(1);

    act(() => { api().undo.undo(); });

    expect(byId(api().ws.tasks, 2)?.group).toBe("Core");
    expect(api().ws.tasks.filter((x) => x.taskName === "Write docs")).toHaveLength(1);
  });

  // The capture holds no image of a created row, so undo leaves a later edit
  // to that row alone (a whole-row image would roll the rename back).
  it("undo leaves a created row's later edit alone", async () => {
    vi.mocked(call.runWbsProposal).mockResolvedValue(
      proposal([
        { kind: "regroup", taskId: 2, group: "Platform", why: "fits" },
        { kind: "newTask", ref: "n1", taskName: "Write docs", dueDate: "2026-11-15", why: "missing" },
      ]),
    );
    const api = renderHarness();
    await proposeFromButton();
    await screen.findAllByRole("checkbox", { name: /include this change/i });
    fireEvent.click(screen.getByRole("button", { name: tPlural("en-US", "wbsPlanApply", 2, 2) }));
    act(() => {
      api().ws.setTasks((prev) => prev.map((x) => (x.taskName === "Write docs" ? { ...x, taskName: "Write docs v2" } : x)));
    });

    act(() => { api().undo.undo(); });

    expect(byId(api().ws.tasks, 2)?.group).toBe("Core");
    expect(api().ws.tasks.filter((x) => x.taskName === "Write docs v2")).toHaveLength(1);
    expect(api().ws.tasks.filter((x) => x.taskName === "Write docs")).toHaveLength(0);
  });

  // The one capture whose editedAfter names created rows: links to a split's
  // piece 2 and to a new task. Undo restores the original row; created rows stay
  // (undo.md "Creates"). Redo re-applies the rewrite and duplicates nothing.
  it("undo after a split and a new task restores the original row, and redo re-applies it without duplicating rows", async () => {
    vi.mocked(call.runWbsProposal).mockResolvedValue(
      proposal([
        {
          kind: "split",
          taskId: 1,
          pieces: [
            { taskName: "Design API", description: "<p>New scope</p>", estimateMinutes: 120 },
            { taskName: "Build API" },
          ],
          why: "too big",
        },
        { kind: "newTask", ref: "n1", taskName: "Write docs", dueDate: "2026-11-15", why: "missing" },
        { kind: "link", from: { kind: "piece", taskId: 1, piece: 2 }, to: { kind: "task", id: 2 }, why: "order" },
        { kind: "link", from: { kind: "ref", ref: "n1" }, to: { kind: "task", id: 1 }, why: "order" },
      ]),
    );
    const seed = [
      task(1, { group: "Core", description: "<p>Original</p>", originalEstimateMinutes: 60, dependencies: [{ taskId: 3, type: "FS" }] }),
      task(2, { group: "Core" }),
      task(3, { group: "Ops" }),
    ];
    const api = renderHarness({}, seed);
    await proposeFromButton();
    await screen.findAllByRole("checkbox", { name: /include this change/i });
    fireEvent.click(screen.getByRole("button", { name: tPlural("en-US", "wbsPlanApply", 4, 4) }));

    const once = (name: string) => api().ws.tasks.filter((x) => x.taskName === name);
    const pieceId = once("Build API")[0]?.id;
    const docsId = once("Write docs")[0]?.id;
    const rewrite = (x: Task | undefined) => ({
      taskName: x?.taskName,
      description: x?.description,
      originalEstimateMinutes: x?.originalEstimateMinutes,
      dependencies: x?.dependencies ?? [],
    });
    const applied1 = rewrite(byId(api().ws.tasks, 1));
    const applied2 = rewrite(byId(api().ws.tasks, 2));
    expect(api().ws.tasks).toHaveLength(5);
    expect(applied1).toMatchObject({ taskName: "Design API", originalEstimateMinutes: 120 });
    expect(applied1.description).toContain("New scope");
    expect(applied1.dependencies).toEqual([{ taskId: 3, type: "FS" }, { taskId: docsId, type: "FS" }]);
    expect(applied2.dependencies).toEqual([{ taskId: pieceId, type: "FS" }]);

    act(() => { api().undo.undo(); });

    expect(api().ws.tasks).toHaveLength(5);
    expect(rewrite(byId(api().ws.tasks, 1))).toEqual({
      taskName: "Task 1",
      description: "<p>Original</p>",
      originalEstimateMinutes: 60,
      dependencies: [{ taskId: 3, type: "FS" }],
    });
    expect(rewrite(byId(api().ws.tasks, 2)).dependencies).toEqual([]);
    expect(once("Build API")).toHaveLength(1);
    expect(once("Write docs")).toHaveLength(1);

    act(() => { api().undo.redo(); });

    expect(api().ws.tasks).toHaveLength(5);
    expect(rewrite(byId(api().ws.tasks, 1))).toEqual(applied1);
    expect(rewrite(byId(api().ws.tasks, 2))).toEqual(applied2);
    expect(once("Build API").map((x) => x.id)).toEqual([pieceId]);
    expect(once("Write docs").map((x) => x.id)).toEqual([docsId]);
  });

  it("open() from any view shows the modal, scoped to open non-Jira tasks", async () => {
    vi.mocked(call.runWbsProposal).mockImplementation(() => new Promise(() => {}));
    const api = renderHarness({}, [
      ...SEED,
      task(4, { status: "Done", completedDate: "2026-10-01" }),
      task(5, { jiraKey: "ABC-1" }),
    ]);

    let res: ReturnType<WbsPlan["open"]> | undefined;
    act(() => { res = api().wbs.open({}); });

    expect(res).toEqual({ opened: true, tasksInScope: 3 });
    expect(screen.getByRole("dialog")).toBeTruthy();
    await waitFor(() => expect(call.runWbsProposal).toHaveBeenCalled());
    const context = vi.mocked(call.runWbsProposal).mock.calls[0][0];
    expect(context).toContain("#3 [in scope]");
    expect(context).not.toContain("#4 [in scope]");
    expect(context).not.toContain("#5 [in scope]");
  });

  it("open({group, instructions}) scopes to the group and forwards the instructions", async () => {
    vi.mocked(call.runWbsProposal).mockImplementation(() => new Promise(() => {}));
    const api = renderHarness();
    let res: ReturnType<WbsPlan["open"]> | undefined;
    act(() => { res = api().wbs.open({ group: "Ops", instructions: "add QA tasks" }); });
    expect(res).toEqual({ opened: true, tasksInScope: 1 });
    await waitFor(() => expect(call.runWbsProposal).toHaveBeenCalled());
    const [context, , instruction] = vi.mocked(call.runWbsProposal).mock.calls[0];
    expect(instruction).toBe("add QA tasks");
    expect(context).toContain("#3 [in scope]");
    expect(context).not.toContain("#1 [in scope]");
  });

  it("grounds the proposal against the run's scope: an out-of-scope item never reaches the preview", async () => {
    vi.mocked(call.runWbsProposal).mockResolvedValue(
      proposal([{ kind: "regroup", taskId: 1, group: "Ops", why: "outside the asked-for group" }]),
    );
    const api = renderHarness();
    act(() => { api().wbs.open({ group: "Ops" }); });
    // Refused, so it is listed under "Not applied" with its reason, never offered.
    await screen.findByText(t("en-US", "wbsPlanAllSkipped"));
    expect(screen.getByText(`Task 1 — ${t("en-US", "wbsPlanSkip_outOfScope")}`)).toBeVisible();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("the button refuses a view whose only open tasks are Jira-synced, and makes no call", () => {
    renderHarness({}, [task(1, { jiraKey: "ABC-1" }), task(2, { jiraKey: "ABC-2" })]);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "wbsPlanButton") }));
    expect(showToast).toHaveBeenCalledWith("info", t("en-US", "wbsPlanNoTasks"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(call.runWbsProposal).not.toHaveBeenCalled();
  });

  it("the button's scope excludes a Jira-synced task in a mixed view", async () => {
    vi.mocked(call.runWbsProposal).mockImplementation(() => new Promise(() => {}));
    renderHarness({}, [...SEED, task(5, { jiraKey: "ABC-1" })]);
    await proposeFromButton();
    await waitFor(() => expect(call.runWbsProposal).toHaveBeenCalled());
    const context = vi.mocked(call.runWbsProposal).mock.calls[0][0];
    expect(context).toContain("#1 [in scope]");
    expect(context).toContain("#5 ");
    expect(context).not.toContain("#5 [in scope]");
  });

  // The table applies the RAG health filter on its own (tasks-section.tsx), so
  // `filteredSortedTasks` alone would put rows the user cannot see in scope.
  it("the button's scope applies the toolbar's health filter: a row the table hides is not in scope", async () => {
    vi.mocked(call.runWbsProposal).mockImplementation(() => new Promise(() => {}));
    const api = renderHarness({}, [...SEED, task(4, { dueDate: "2026-09-01" })]);
    act(() => { api().filters.setHealthFilter("red"); });
    await proposeFromButton();
    await waitFor(() => expect(call.runWbsProposal).toHaveBeenCalled());
    const context = vi.mocked(call.runWbsProposal).mock.calls[0][0];
    expect(context).toContain("#4 [in scope]");
    expect(context).toContain("#1 ");
    expect(context).not.toContain("#1 [in scope]");
  });

  it("the button opens nothing over a chat open() whose thinking state has not rendered yet", async () => {
    vi.mocked(call.runWbsProposal).mockImplementation(() => new Promise(() => {}));
    const api = renderHarness();
    const trigger = screen.getByRole("button", { name: t("en-US", "wbsPlanButton") });
    act(() => {
      api().wbs.open({ instructions: "from the chat" });
      // Same tick: the trigger's closure still reads the "idle" render.
      fireEvent.click(trigger);
    });
    expect(screen.getByRole("textbox", { name: t("en-US", "wbsPlanInstructionLabel") })).toHaveProperty(
      "value",
      "from the chat",
    );
    expect(call.runWbsProposal).toHaveBeenCalledTimes(1);
  });

  // WCAG 2.4.3: the dialog and the preview are two Modals, and the trigger is
  // disabled while the preview is open, so neither Modal can hand focus back.
  it.each(["apply", "cancel", "escape"] as const)("focus returns to the toolbar trigger when the preview closes (%s)", async (how) => {
    vi.mocked(call.runWbsProposal).mockResolvedValue(
      proposal([{ kind: "regroup", taskId: 1, group: "Backend", why: "belongs there" }]),
    );
    renderHarness();
    const trigger = screen.getByRole("button", { name: t("en-US", "wbsPlanButton") });
    trigger.focus();
    fireEvent.click(trigger);
    // As for a real user: the dialog has taken focus before Propose is pressed,
    // so nothing leaves it parked on the (then disabled) trigger.
    await waitFor(() => expect(screen.getByRole("textbox", { name: t("en-US", "wbsPlanInstructionLabel") })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "wbsPlanPropose") }));
    await screen.findByRole("checkbox", { name: /include this change/i });
    await waitFor(() => expect(document.activeElement).not.toBe(trigger));
    if (how === "apply") fireEvent.click(screen.getByRole("button", { name: tPlural("en-US", "wbsPlanApply", 1, 1) }));
    else if (how === "cancel") fireEvent.click(screen.getByRole("button", { name: t("en-US", "wbsPlanCancel") }));
    else fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("checkbox")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("a call that fails at once leaves open() usable again", async () => {
    vi.mocked(call.runWbsProposal).mockRejectedValueOnce(new Error("boom"));
    const api = renderHarness();
    let first: ReturnType<WbsPlan["open"]> | undefined;
    await act(async () => { first = api().wbs.open({}); });
    expect(first).toEqual({ opened: true, tasksInScope: 3 });
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("error", t("en-US", "wbsPlanError")));
    expect(screen.queryByRole("dialog")).toBeNull();
    vi.mocked(call.runWbsProposal).mockImplementation(() => new Promise(() => {}));
    let second: ReturnType<WbsPlan["open"]> | undefined;
    act(() => { second = api().wbs.open({}); });
    expect(second).toEqual({ opened: true, tasksInScope: 3 });
  });

  it("unmounting during thinking aborts the signal", async () => {
    let captured: AbortSignal | undefined;
    vi.mocked(call.runWbsProposal).mockImplementation((_c, _a, _i, signal) => {
      captured = signal;
      return new Promise(() => {});
    });
    const api = renderHarness();
    act(() => { api().wbs.open({}); });
    await waitFor(() => expect(captured).toBeDefined());
    expect(captured!.aborted).toBe(false);
    api.unmount();
    expect(captured!.aborted).toBe(true);
  });

  it("open({group}) matches the group case-insensitively and trimmed", async () => {
    vi.mocked(call.runWbsProposal).mockImplementation(() => new Promise(() => {}));
    const api = renderHarness();
    let res: ReturnType<WbsPlan["open"]> | undefined;
    act(() => { res = api().wbs.open({ group: "  core " }); });
    expect(res).toEqual({ opened: true, tasksInScope: 2 });
    await waitFor(() => expect(call.runWbsProposal).toHaveBeenCalled());
    const [context] = vi.mocked(call.runWbsProposal).mock.calls[0];
    expect(context).toContain("#1 [in scope]");
    expect(context).toContain("#2 [in scope]");
    expect(context).not.toContain("#3 [in scope]");
  });

  it("when the updater's apply falls back to prev: no Applied toast, no log, no undo — the error toast", async () => {
    vi.mocked(call.runWbsProposal).mockResolvedValue(
      proposal([{ kind: "regroup", taskId: 1, group: "Backend", why: "belongs there" }]),
    );
    const logActivitySpy = vi.fn();
    const api = renderHarness({ logActivitySpy });
    await proposeFromButton();
    await screen.findByRole("checkbox", { name: /include this change/i });

    const applyMock = vi.mocked(engine.applyWbsProposal);
    const real = applyMock.getMockImplementation()!;
    // The snapshot apply (first call) succeeds; every updater call throws, as on
    // a same-tick id collision.
    applyMock.mockImplementationOnce(real).mockImplementation(() => {
      throw new Error("id collision");
    });
    try {
      fireEvent.click(screen.getByRole("button", { name: tPlural("en-US", "wbsPlanApply", 1, 1) }));
    } finally {
      applyMock.mockImplementation(real);
    }

    expect(applyMock.mock.calls.length).toBeGreaterThanOrEqual(2); // the updater did run
    expect(byId(api().ws.tasks, 1)?.group).toBe("Core");
    expect(showToast).toHaveBeenCalledWith("error", t("en-US", "wbsPlanError"));
    expect(showToast).not.toHaveBeenCalledWith("info", tPlural("en-US", "wbsPlanApplied", 1, 1));
    expect(logActivitySpy).not.toHaveBeenCalled();
    expect(api().undo.canUndo).toBe(false);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  // The toast, the log and the undo images report what the UPDATER wrote: an
  // edit queued but not yet rendered at click time makes `prev` differ from the
  // click handler's list, and the item it staled was not written.
  it("an edit queued at click time: the notice, the log and undo follow the write, not the pre-click snapshot", async () => {
    vi.mocked(call.runWbsProposal).mockResolvedValue(
      proposal([{ kind: "regroup", taskId: 1, group: "Backend", why: "belongs there" }]),
    );
    const logActivitySpy = vi.fn();
    const api = renderHarness({ logActivitySpy });
    await proposeFromButton();
    await screen.findByRole("checkbox", { name: /include this change/i });

    const apply = screen.getByRole("button", { name: tPlural("en-US", "wbsPlanApply", 1, 1) });
    act(() => {
      api().ws.setTasks((prev) => prev.map((x) => (x.id === 1 ? { ...x, taskName: "Target edit" } : x)));
      fireEvent.click(apply);
    });

    expect(byId(api().ws.tasks, 1)?.taskName).toBe("Target edit");
    expect(byId(api().ws.tasks, 1)?.group).toBe("Core");
    expect(showToast).toHaveBeenCalledWith("info", tPlural("en-US", "wbsPlanStaleSkipped", 1, 1));
    expect(showToast).not.toHaveBeenCalledWith("info", tPlural("en-US", "wbsPlanApplied", 1, 1));
    expect(logActivitySpy).not.toHaveBeenCalled();
    expect(api().undo.canUndo).toBe(false);
  });

  describe("the load hold and the scope epoch (platform.md \"The load hold\")", () => {
    const REGROUP = proposal([{ kind: "regroup", taskId: 1, group: "Backend", why: "" }]);

    it("drops a proposal that resolves after the scope epoch moved: no preview, the scope-changed notice", async () => {
      let resolveCall: (p: ParsedWbsProposal) => void = () => {};
      vi.mocked(call.runWbsProposal).mockImplementation(() => new Promise((res) => { resolveCall = res; }));
      let epoch = 0;
      const api = renderHarness({ getScopeEpoch: () => epoch });
      await proposeFromButton();
      await waitFor(() => expect(call.runWbsProposal).toHaveBeenCalled());
      epoch = 1; // a project swap while the call is in flight
      await act(async () => { resolveCall(REGROUP); });
      expect(screen.queryByRole("checkbox")).toBeNull();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(showToast).toHaveBeenCalledWith("info", t("en-US", "wbsPlanScopeChanged"));
      expect(byId(api().ws.tasks, 1)?.group).toBe("Core");
    });

    it("Apply writes nothing once the scope epoch moved while the preview was open", async () => {
      vi.mocked(call.runWbsProposal).mockResolvedValue(REGROUP);
      let epoch = 0;
      const logActivitySpy = vi.fn();
      const api = renderHarness({ getScopeEpoch: () => epoch, logActivitySpy });
      await proposeFromButton();
      await screen.findByRole("checkbox", { name: /include this change/i });
      const before = api().ws.tasks;
      epoch = 1;
      fireEvent.click(screen.getByRole("button", { name: tPlural("en-US", "wbsPlanApply", 1, 1) }));
      expect(api().ws.tasks).toBe(before);
      expect(engine.applyWbsProposal).not.toHaveBeenCalled();
      expect(logActivitySpy).not.toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith("info", t("en-US", "wbsPlanScopeChanged"));
      expect(screen.queryByRole("checkbox")).toBeNull();
    });

    it("Apply still writes when the epoch did not move", async () => {
      vi.mocked(call.runWbsProposal).mockResolvedValue(REGROUP);
      const api = renderHarness({ getScopeEpoch: () => 7 });
      await proposeFromButton();
      await screen.findByRole("checkbox", { name: /include this change/i });
      fireEvent.click(screen.getByRole("button", { name: tPlural("en-US", "wbsPlanApply", 1, 1) }));
      expect(byId(api().ws.tasks, 1)?.group).toBe("Backend");
    });

    it("open() refuses during a load hold and makes no call", () => {
      const api = renderHarness({ loadPending: true });
      let res: ReturnType<WbsPlan["open"]> | undefined;
      act(() => { res = api().wbs.open({}); });
      expect(res).toEqual({ opened: false, tasksInScope: 0, reason: "loading" });
      expect(call.runWbsProposal).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("the toolbar trigger opens nothing during a load hold", () => {
      renderHarness({ loadPending: true });
      fireEvent.click(screen.getByRole("button", { name: t("en-US", "wbsPlanButton") }));
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    // While the hold lasts the app shell (and the toast) is a skeleton, so the
    // notice waits for the hold to END, or its dismiss timer runs out unseen.
    it("a load hold that closes an open preview tells the user why once the hold ends", async () => {
      vi.mocked(call.runWbsProposal).mockResolvedValue(REGROUP);
      const api = renderHarness();
      await proposeFromButton();
      await screen.findByRole("checkbox", { name: /include this change/i });
      showToast.mockClear();
      api.reprops({ loadPending: true });
      expect(showToast).not.toHaveBeenCalled();
      api.reprops({ loadPending: false });
      expect(showToast).toHaveBeenCalledTimes(1);
      expect(showToast).toHaveBeenCalledWith("info", t("en-US", "wbsPlanClosedByLoad"));
      // A later hold with the flow idle says nothing more.
      api.reprops({ loadPending: true });
      api.reprops({ loadPending: false });
      expect(showToast).toHaveBeenCalledTimes(1);
    });

    it("a load hold while the flow is idle says nothing, during it or after it", () => {
      const api = renderHarness();
      showToast.mockClear();
      api.reprops({ loadPending: true });
      api.reprops({ loadPending: false });
      expect(showToast).not.toHaveBeenCalled();
    });

    it("a load hold that starts while the preview is open closes it and writes nothing", async () => {
      vi.mocked(call.runWbsProposal).mockResolvedValue(REGROUP);
      const api = renderHarness();
      await proposeFromButton();
      await screen.findByRole("checkbox", { name: /include this change/i });
      const before = api().ws.tasks;
      api.reprops({ loadPending: true });
      expect(screen.queryByRole("checkbox")).toBeNull();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(api().ws.tasks).toBe(before);
      expect(engine.applyWbsProposal).not.toHaveBeenCalled();
      // The flow is idle again once the hold ends: a fresh open() is accepted.
      api.reprops({ loadPending: false });
      let res: ReturnType<WbsPlan["open"]> | undefined;
      act(() => { res = api().wbs.open({}); });
      expect(res?.opened).toBe(true);
    });

    it("a call that resolves after a hold closed the flow opens no preview", async () => {
      let resolveCall: (p: ParsedWbsProposal) => void = () => {};
      // Ignores the abort signal, so only the discarded request generation can stop it.
      vi.mocked(call.runWbsProposal).mockImplementation(() => new Promise((res) => { resolveCall = res; }));
      const api = renderHarness();
      act(() => { api().wbs.open({}); });
      await waitFor(() => expect(call.runWbsProposal).toHaveBeenCalled());
      api.reprops({ loadPending: true });
      api.reprops({ loadPending: false });
      await act(async () => { resolveCall(REGROUP); });
      expect(screen.queryByRole("checkbox")).toBeNull();
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("a load hold that starts during the call aborts it and closes the dialog", async () => {
      let captured: AbortSignal | undefined;
      vi.mocked(call.runWbsProposal).mockImplementation((_c, _a, _i, signal) => {
        captured = signal;
        return new Promise(() => {});
      });
      const api = renderHarness();
      act(() => { api().wbs.open({}); });
      await waitFor(() => expect(captured).toBeDefined());
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      api.reprops({ loadPending: true });
      expect(captured!.aborted).toBe(true);
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("open() refuses a group no task has as unknownGroup", () => {
    const api = renderHarness();
    let res: ReturnType<WbsPlan["open"]> | undefined;
    act(() => { res = api().wbs.open({ group: "Nope" }); });
    expect(res).toEqual({ opened: false, tasksInScope: 0, reason: "unknownGroup" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(call.runWbsProposal).not.toHaveBeenCalled();
  });

  it("open() names why it refused: busy mid-flow, noTasks for a group with no open task", async () => {
    vi.mocked(call.runWbsProposal).mockImplementation(() => new Promise(() => {}));
    const api = renderHarness({}, [...SEED, task(4, { group: "Done", status: "Done", completedDate: "2026-10-01" })]);
    let res: ReturnType<WbsPlan["open"]> | undefined;
    act(() => { res = api().wbs.open({ group: "done" }); });
    expect(res).toEqual({ opened: false, tasksInScope: 0, reason: "noTasks" });
    act(() => { res = api().wbs.open({}); });
    expect(res?.opened).toBe(true);
    act(() => { res = api().wbs.open({}); });
    expect(res).toEqual({ opened: false, tasksInScope: 0, reason: "busy" });
  });

  // cold-review C5: the hook's own list is synced after commit, so a task the
  // chat created earlier in the same model turn reaches it only through the
  // caller's synchronously-updated list.
  it("open({liveTasks}) scopes over the caller's live list, not the hook's committed one", async () => {
    vi.mocked(call.runWbsProposal).mockImplementation(() => new Promise(() => {}));
    const api = renderHarness();
    const created = task(9, { taskName: "Created this turn" });
    let res: ReturnType<WbsPlan["open"]> | undefined;
    act(() => { res = api().wbs.open({ liveTasks: [...api().ws.tasks, created] }); });
    expect(res).toEqual({ opened: true, tasksInScope: 4 });
    await waitFor(() => expect(call.runWbsProposal).toHaveBeenCalled());
    expect(vi.mocked(call.runWbsProposal).mock.calls[0][0]).toContain("#9 [in scope]");
  });

  it("open() refuses in a popout and the button is null there", () => {
    const api = renderHarness({ isPopout: true });
    expect(screen.queryByRole("button", { name: t("en-US", "wbsPlanButton") })).toBeNull();
    let res: ReturnType<WbsPlan["open"]> | undefined;
    act(() => { res = api().wbs.open({}); });
    expect(res).toEqual({ opened: false, tasksInScope: 0, reason: "popout" });
    expect(call.runWbsProposal).not.toHaveBeenCalled();
  });

  it("open() refuses with the AI off, and the button is disabled with its reason", () => {
    const api = renderHarness({ settings: defaultSettings });
    const button = screen.getByRole("button", { name: t("en-US", "wbsPlanButton") });
    expect(button).toBeDisabled();
    expect(button.getAttribute("title")).toBe(t("en-US", "wbsPlanNeedsAi"));
    let res: ReturnType<WbsPlan["open"]> | undefined;
    act(() => { res = api().wbs.open({}); });
    expect(res).toEqual({ opened: false, tasksInScope: 0, reason: "aiOff" });
    expect(call.runWbsProposal).not.toHaveBeenCalled();
  });

  it("cancel during thinking aborts the signal and shows no error toast", async () => {
    let captured: AbortSignal | undefined;
    let rejectCall!: (e: unknown) => void;
    vi.mocked(call.runWbsProposal).mockImplementation((_c, _a, _i, signal) => {
      captured = signal;
      return new Promise((_resolve, reject) => { rejectCall = reject; });
    });
    renderHarness();
    await proposeFromButton();
    await waitFor(() => expect(captured).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: t("en-US", "wbsPlanCancel") }));
    expect(captured!.aborted).toBe(true);
    await act(async () => { rejectCall({ name: "AbortError" }); });

    expect(showToast).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("an aborted call (plain AbortError-shaped object) produces no error toast", async () => {
    vi.mocked(call.runWbsProposal).mockRejectedValue({ name: "AbortError" });
    renderHarness();
    await proposeFromButton();
    await waitFor(() => expect(call.runWbsProposal).toHaveBeenCalled());
    await act(async () => {});
    expect(showToast).not.toHaveBeenCalled();
  });

  it("a 401 shows the key-error toast", async () => {
    vi.mocked(call.runWbsProposal).mockRejectedValue(new AiHttpError(401));
    renderHarness();
    await proposeFromButton();
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("error", t("en-US", "aiKeyRejected")));
  });

  it("a generic failure shows the wbsPlanError toast", async () => {
    vi.mocked(call.runWbsProposal).mockRejectedValue(new Error("boom"));
    renderHarness();
    await proposeFromButton();
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("error", t("en-US", "wbsPlanError")));
  });
});

// AI people protection, Task 6 (R4): a new task the model proposed with an assignee is previewed and
// applied unassigned when the project protects its people.
describe("new-task assignees under people protection", () => {
  afterEach(() => { people.state.on = false; });

  async function applyOneNewTask(peopleProtected: boolean) {
    people.state.on = peopleProtected;
    vi.mocked(call.runWbsProposal).mockResolvedValue(
      proposal([{ kind: "newTask", ref: "n1", taskName: "Write docs", dueDate: "2026-11-15", assignee: "Zelda Quartz", why: "missing" }]),
    );
    const api = renderHarness();
    await proposeFromButton();
    await screen.findAllByRole("checkbox", { name: /include this change/i });
    const previewShowsAssignee = screen.queryAllByText(/Zelda Quartz/).length > 0;
    fireEvent.click(screen.getByRole("button", { name: tPlural("en-US", "wbsPlanApply", 1, 1) }));
    return { previewShowsAssignee, created: api().ws.tasks.find((x) => x.taskName === "Write docs")! };
  }

  it("previews and creates the task without the model's assignee", async () => {
    const { previewShowsAssignee, created } = await applyOneNewTask(true);
    expect(previewShowsAssignee).toBe(false);
    expect(created.assignee).toBe("");
  });

  it("protection off: the assignee is previewed and applied (positive control)", async () => {
    const { previewShowsAssignee, created } = await applyOneNewTask(false);
    expect(previewShowsAssignee).toBe(true);
    expect(created.assignee).toBe("Zelda Quartz");
  });
});
