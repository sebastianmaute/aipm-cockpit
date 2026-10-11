// Hook-level tests for the "Optimize with AI" flow (use-wbs-plan.tsx): the
// forced call is mocked, the workspace is the REAL WorkspaceProvider and, where
// undo matters, the stack is the REAL useUndoStack — so apply, the apply-time
// re-ground and undo are exercised end to end, not against spies.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { AiHttpError } from "./ai-errors";
import { useWbsPlan, type WbsPlan } from "./use-wbs-plan";
import { ToastProvider } from "./toast-context";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { useUndoStack, type UndoStackApi } from "./undo/use-undo-stack";
import { defaultSettings, type Settings } from "./settings-types";
import { type Task } from "./types";
import * as call from "./wbs-plan-call";
import * as engine from "./wbs-plan/wbs-plan";
import { type ParsedWbsProposal, type RawWbsItem } from "./wbs-plan/wbs-plan";
import { t, tPlural } from "./i18n";

vi.mock("./wbs-plan-call");
// The REAL engine, wrapped so one test can make the setTasks updater's apply
// throw (the R12 fallback) while the snapshot apply before it succeeds.
vi.mock("./wbs-plan/wbs-plan", async (importOriginal) => {
  const real = await importOriginal<typeof import("./wbs-plan/wbs-plan")>();
  return { ...real, applyWbsProposal: vi.fn(real.applyWbsProposal) };
});

const AI_ON: Settings = {
  ...defaultSettings,
  ai: { ...defaultSettings.ai, enabled: true, apiKey: "sk-ant-test", model: "claude-x" },
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
  undo: UndoStackApi;
  wbs: WbsPlan;
}

interface HarnessProps {
  settings?: Settings;
  isPopout?: boolean;
  logActivitySpy?: ReturnType<typeof vi.fn>;
  /** A fake scope-epoch reader the test controls. */
  getScopeEpoch?: () => number;
  loadPending?: boolean;
  onApi: (api: Api) => void;
}

const EPOCH_ZERO = () => 0;

function Harness({ settings = AI_ON, isPopout = false, logActivitySpy, getScopeEpoch = EPOCH_ZERO, loadPending = false, onApi }: HarnessProps) {
  const ws = useWorkspace();
  const undo = useUndoStack({ lang: "en-US", logActivity: vi.fn(), showToast: vi.fn(), showToastAction: vi.fn() });
  const wbs = useWbsPlan({
    settings,
    isPopout,
    lang: "en-US",
    capture: undo.capture,
    logActivityAs: logActivitySpy as never,
    getScopeEpoch,
    loadPending,
  });
  useEffect(() => { onApi({ ws, undo, wbs }); });
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

function renderHarness(props: Omit<HarnessProps, "onApi"> = {}, seed: readonly Task[] = SEED) {
  const box: { api: Api | null } = { api: null };
  const onApi = (a: Api) => { box.api = a; };
  const { unmount, rerender } = render(
    <Wrapper>
      <Harness {...props} onApi={onApi} />
    </Wrapper>,
  );
  act(() => { box.api!.ws.setTasks(seed); });
  const reprops = (next: Omit<HarnessProps, "onApi">) =>
    rerender(
      <Wrapper>
        <Harness {...props} {...next} onApi={onApi} />
      </Wrapper>,
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
    expect(creds).toEqual({ apiKey: "sk-ant-test", model: "claude-x" });
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
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("info", t("en-US", "wbsPlanEmpty")));
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
      expect(res).toEqual({ opened: false, tasksInScope: 0 });
      expect(call.runWbsProposal).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("the toolbar trigger opens nothing during a load hold", () => {
      renderHarness({ loadPending: true });
      fireEvent.click(screen.getByRole("button", { name: t("en-US", "wbsPlanButton") }));
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("Apply refuses during a load hold and writes once the hold ends", async () => {
      vi.mocked(call.runWbsProposal).mockResolvedValue(REGROUP);
      const api = renderHarness();
      await proposeFromButton();
      await screen.findByRole("checkbox", { name: /include this change/i });
      api.reprops({ loadPending: true });
      const applyName = tPlural("en-US", "wbsPlanApply", 1, 1);
      fireEvent.click(screen.getByRole("button", { name: applyName }));
      expect(byId(api().ws.tasks, 1)?.group).toBe("Core");
      expect(screen.getByRole("checkbox", { name: /include this change/i })).toBeInTheDocument();
      api.reprops({ loadPending: false });
      fireEvent.click(screen.getByRole("button", { name: applyName }));
      expect(byId(api().ws.tasks, 1)?.group).toBe("Backend");
    });
  });

  it("open() refuses with an empty scope", () => {
    const api = renderHarness();
    let res: ReturnType<WbsPlan["open"]> | undefined;
    act(() => { res = api().wbs.open({ group: "Nope" }); });
    expect(res).toEqual({ opened: false, tasksInScope: 0 });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(call.runWbsProposal).not.toHaveBeenCalled();
  });

  it("open() refuses in a popout and the button is null there", () => {
    const api = renderHarness({ isPopout: true });
    expect(screen.queryByRole("button", { name: t("en-US", "wbsPlanButton") })).toBeNull();
    let res: ReturnType<WbsPlan["open"]> | undefined;
    act(() => { res = api().wbs.open({}); });
    expect(res).toEqual({ opened: false, tasksInScope: 0 });
    expect(call.runWbsProposal).not.toHaveBeenCalled();
  });

  it("open() refuses with the AI off, and the button is disabled with its reason", () => {
    const api = renderHarness({ settings: defaultSettings });
    const button = screen.getByRole("button", { name: t("en-US", "wbsPlanButton") });
    expect(button).toBeDisabled();
    expect(button.getAttribute("title")).toBe(t("en-US", "wbsPlanNeedsAi"));
    let res: ReturnType<WbsPlan["open"]> | undefined;
    act(() => { res = api().wbs.open({}); });
    expect(res).toEqual({ opened: false, tasksInScope: 0 });
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
