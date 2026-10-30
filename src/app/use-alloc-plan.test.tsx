import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// Rendered without task-manager's AI privacy provider: requests carry the privacy of no project.
vi.mock("./ai-privacy-context", () => import("../test/ai-privacy-unprotected"));
import { newConsent } from "./ai-consent";
import { AiHttpError } from "./ai-errors";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { defaultPeriodLabel, formatMovedHours } from "./reassign-hours-notice";
import { type ReactNode, useEffect, useState } from "react";
import { useAllocPlan } from "./use-alloc-plan";
import { ToastProvider } from "./toast-context";
import { useToast } from "./use-toast";
import { defaultSettings, type Settings } from "./settings-types";
import { type Resource, type ResourcePlan, type Task } from "./types";
import { buildUndoLabel, useUndoStack } from "./undo/use-undo-stack";
import { useReassignHours, type ReassignHours } from "./use-reassign-hours";
import { planHoursMoves } from "./reassign-hours";
import { groundAlternative, ownerChangeFor } from "./alloc-plan/alloc-ground-moves";
import { alternativeEffect } from "./alloc-plan/alloc-effect";
import * as call from "./alloc-plan-call";
import { type RawAllocCell } from "./alloc-plan/alloc-plan";
import { type ParsedAllocAlternatives } from "./alloc-plan/alloc-alternatives";
import { t, tPlural } from "./i18n";
import { ActionGuidesProvider } from "./action-guides-context";

vi.mock("./alloc-plan-call");

/** Test-only shorthand — most propose-mock responses are a fully fresh cell
 *  set (nothing dropped at parse). */
function proposal(cells: RawAllocCell[], truncated = false): ParsedAllocAlternatives {
  return { alternatives: [{ summary: "", taskMoves: [], cells }], truncated };
}

const AI_ON: Settings = {
  ...defaultSettings,
  ai: { ...defaultSettings.ai, enabled: true, consent: newConsent(new Date(0)), apiKey: "sk-ant-test", model: "claude-x" },
};

const PLAN: ResourcePlan = {
  startDate: "2026-08-01",
  endDate: "2026-08-31",
  granularity: "month",
  currency: "EUR",
};

function mkResource(id: number, firstName: string, lastName: string): Resource {
  return {
    id,
    firstName,
    lastName,
    roleId: null,
    utilizationMode: "hours",
    utilization: {},
  };
}

interface HarnessProps {
  settings?: Settings;
  isPopout?: boolean;
  captureSpy?: ReturnType<typeof vi.fn>;
  logActivitySpy?: ReturnType<typeof vi.fn>;
  onResources?: (r: readonly Resource[]) => void;
  /** Test-only escape hatch: when provided, renders a button that mutates
   *  `resources` DIRECTLY (bypassing the alloc-plan hook) — simulating
   *  another edit/background sync landing while the preview modal is open. */
  externalEdit?: (resources: readonly Resource[]) => readonly Resource[];
}

/** Renders of the component that owns the hook (in the app, the Resources panel and its planning grid). */
const harnessRenders = { count: 0 };

function Harness({
  settings = AI_ON,
  isPopout = false,
  captureSpy,
  logActivitySpy,
  onResources,
  externalEdit,
}: HarnessProps) {
  // Counted in an effect (every committed render runs it): mutating it in the render body is refused by lint.
  useEffect(() => { harnessRenders.count++; });
  const [resources, setResources] = useState<readonly Resource[]>([
    mkResource(1, "Alice", "Anderson"),
    mkResource(2, "Bob", "Baker"),
  ]);
  const alloc = useAllocPlan({
    settings,
    isPopout,
    lang: "en-US",
    resources,
    setResources: (u) =>
      setResources((prev) => {
        const next = typeof u === "function" ? u(prev) : u;
        onResources?.(next);
        return next;
      }),
    roles: [],
    disciplines: [],
    grades: [],
    plan: PLAN,
    absences: [],
    workdayHours: 8,
    holidaySet: new Set<string>(),
    capture: captureSpy as never,
    logActivityAs: logActivitySpy as never,
    tasks: [],
    milestones: [],
    stakeholders: [],
    today: "2026-08-01",
    reassignTasks: () => 0,
    isLoadHeld: () => false,
  });
  return (
    <div>
      {alloc.button}
      {alloc.modal}
      {externalEdit && (
        <button type="button" onClick={() => setResources((prev) => externalEdit(prev))}>
          external-edit
        </button>
      )}
      <output data-testid="util">{JSON.stringify(resources.map((r) => ({ id: r.id, u: r.utilization })))}</output>
    </div>
  );
}

function RealToast({ children }: { children: ReactNode }) {
  const { toast, showToast: realShowToast, showToastAction } = useToast();
  return (
    <ToastProvider value={{ showToast: realShowToast, showToastAction }}>
      <output data-testid="toast">{toast?.text ?? ""}</output>
      {children}
    </ToastProvider>
  );
}

const showToast = vi.fn();
function renderHarness(props: HarnessProps = {}) {
  return render(
    <ToastProvider value={{ showToast, showToastAction: vi.fn() }}>
      <Harness {...props} />
    </ToastProvider>,
  );
}

function openAndType(instruction = "spread 40 hours across the team") {
  fireEvent.click(screen.getByRole("button", { name: /plan with ai/i }));
  fireEvent.change(screen.getByPlaceholderText(/distribute 200 hours/i), { target: { value: instruction } });
}

describe("useAllocPlan (plan-then-apply)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The instruction lives in the modal: a keystroke re-rendered the Resources panel that owns the hook, planning
  // grid included. Mutation: holding the text in the hook again re-renders the host on every change.
  it("typing the instruction re-renders the modal only, never the component that owns the hook", () => {
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: /plan with ai/i }));
    const box = screen.getByPlaceholderText(/distribute 200 hours/i);
    const before = harnessRenders.count;
    for (const value of ["s", "sp", "spread 40 hours"]) fireEvent.change(box, { target: { value } });
    expect(box).toHaveValue("spread 40 hours");
    expect(harnessRenders.count).toBe(before);
  });

  it("proposes with the instruction as typed in the modal", async () => {
    vi.mocked(call.runAllocProposal).mockImplementation(() => new Promise(() => {}));
    renderHarness();
    openAndType("spread 40 hours across the team");
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "allocPlanPropose") }));
    await waitFor(() => expect(call.runAllocProposal).toHaveBeenCalled());
    expect(vi.mocked(call.runAllocProposal).mock.calls[0][2]).toBe("spread 40 hours across the team");
  });

  it("keeps the typed instruction when nothing came back, so it can be revised and sent again", async () => {
    vi.mocked(call.runAllocProposal).mockResolvedValue(proposal([]));
    renderHarness();
    openAndType("spread 40 hours across the team");
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "allocPlanPropose") }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("info", expect.stringMatching(/no allocation changes/i)));
    expect(screen.getByPlaceholderText(/distribute 200 hours/i)).toHaveValue("spread 40 hours across the team");
  });

  it("renders no button in a popout", () => {
    renderHarness({ isPopout: true });
    expect(screen.queryByRole("button", { name: /plan with ai/i })).toBeNull();
  });

  it("renders no button when AI is disabled", () => {
    renderHarness({ settings: defaultSettings });
    expect(screen.queryByRole("button", { name: /plan with ai/i })).toBeNull();
  });

  it("a proposal that resolves AFTER cancel does not apply anything and leaves the hook idle", async () => {
    let resolveProposal!: (v: ParsedAllocAlternatives) => void;
    vi.mocked(call.runAllocProposal).mockImplementation(
      () => new Promise((resolve) => { resolveProposal = resolve; }),
    );
    const onResources = vi.fn();
    renderHarness({ onResources });

    openAndType();
    fireEvent.click(screen.getByRole("button", { name: /^propose$/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /planning/i })).toBeTruthy());

    // Cancel while the billed call is still in flight.
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByRole("button", { name: /planning|propose|apply selected/i })).toBeNull();
    // The trigger is available again — the hook is back to idle.
    expect(
      screen.getByRole("button", { name: /plan with ai/i }),
    ).not.toBeDisabled();

    // The stale call now resolves — it must be discarded (superseded request id).
    await act(async () => {
      resolveProposal(proposal([{ resourceId: 1, periodKey: "2026-08", hours: 40 }]));
    });

    expect(onResources).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("an aborted proposal produces NO error toast", async () => {
    // A plain object shaped like an AbortError — NOT an Error/DOMException
    // instance — so this only passes if the hook reads `.name` directly
    // rather than gating on `instanceof Error`/`instanceof DOMException`
    // (which is exactly the jsdom/Node boundary trap this guards against).
    // If the detection were broken, this would instead surface
    // "allocPlanError" below — proving the assertion is not vacuous.
    vi.mocked(call.runAllocProposal).mockRejectedValue({ name: "AbortError" });

    renderHarness();
    openAndType();
    fireEvent.click(screen.getByRole("button", { name: /^propose$/i }));

    // Back on the instruction step, no error surfaced, and Propose is
    // reachable again (not stuck mid-flight).
    await waitFor(() => expect(screen.getByRole("button", { name: /^propose$/i })).toBeTruthy());
    expect(showToast).not.toHaveBeenCalled();
  });

  it("shows an error toast for a genuine (non-abort) failure", async () => {
    vi.mocked(call.runAllocProposal).mockRejectedValue(new Error("boom"));
    renderHarness();
    openAndType();
    fireEvent.click(screen.getByRole("button", { name: /^propose$/i }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("error", expect.any(String)));
  });

  it("skipped-only result opens the preview silently (no 'nothing proposed' toast)", async () => {
    // resourceId 999 names no live resource — groundAllocationCells refuses it
    // as "unknown-resource", so cells.length is 0 but skipped.length is 1.
    vi.mocked(call.runAllocProposal).mockResolvedValue(
      proposal([{ resourceId: 999, periodKey: "2026-08", hours: 40 }]),
    );
    renderHarness();
    openAndType();
    fireEvent.click(screen.getByRole("button", { name: /^propose$/i }));

    // The preview opens to explain what was skipped and why...
    await waitFor(() => expect(screen.getByText(/unknown resource/i)).toBeTruthy());
    // ...and Confirm has nothing to apply, so it stays disabled.
    expect(screen.getByRole("button", { name: /apply selected/i })).toBeDisabled();
    // Critically: no toast claiming nothing was proposed while this is on screen.
    expect(showToast).not.toHaveBeenCalled();
  });

  it("truly empty result (no cells, no skips) stays on the instruction step and toasts", async () => {
    vi.mocked(call.runAllocProposal).mockResolvedValue(proposal([]));
    renderHarness();
    openAndType();
    fireEvent.click(screen.getByRole("button", { name: /^propose$/i }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("info", expect.stringMatching(/no allocation changes/i)),
    );
    // Still on the instruction step — Propose is there, Apply selected is not.
    expect(screen.getByRole("button", { name: /^propose$/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /apply selected/i })).toBeNull();
  });

  it("shows the truncated notice from the PARSE-level flag alone (grounding itself is not truncated)", async () => {
    // The real production path: parseAllocationAlternatives is where a too-large
    // proposal actually gets cut, so the mock returns truncated: true even
    // though only ONE cell is present here — grounding this single cell can
    // never hit its own cap. If the hook read only groundAllocationCells's
    // truncated flag (dropping raw.truncated), this notice would never show.
    vi.mocked(call.runAllocProposal).mockResolvedValue(
      proposal([{ resourceId: 1, periodKey: "2026-08", hours: 40 }], true),
    );
    renderHarness();
    openAndType();
    fireEvent.click(screen.getByRole("button", { name: /^propose$/i }));

    await waitFor(() => expect(screen.getAllByRole("checkbox").length).toBe(1));
    expect(screen.getByText(t("en-US", "allocPlanTruncated"))).toBeTruthy();
  });

  it("does not show the truncated notice when neither parse nor grounding truncated anything", async () => {
    vi.mocked(call.runAllocProposal).mockResolvedValue(
      proposal([{ resourceId: 1, periodKey: "2026-08", hours: 40 }]),
    );
    renderHarness();
    openAndType();
    fireEvent.click(screen.getByRole("button", { name: /^propose$/i }));

    await waitFor(() => expect(screen.getAllByRole("checkbox").length).toBe(1));
    expect(screen.queryByText(t("en-US", "allocPlanTruncated"))).toBeNull();
  });

  it("confirm applies ONLY the selected cells", async () => {
    vi.mocked(call.runAllocProposal).mockResolvedValue(
      proposal([
        { resourceId: 1, periodKey: "2026-08", hours: 40 },
        { resourceId: 2, periodKey: "2026-08", hours: 20 },
      ]),
    );
    renderHarness();
    openAndType();
    fireEvent.click(screen.getByRole("button", { name: /^propose$/i }));

    await waitFor(() => expect(screen.getAllByRole("checkbox").length).toBe(2));
    // Deselect Bob's cell — only Alice's should be written.
    fireEvent.click(screen.getByRole("checkbox", { name: /Bob/i }));
    fireEvent.click(screen.getByRole("button", { name: /apply selected/i }));

    await waitFor(() => {
      const util = JSON.parse(screen.getByTestId("util").textContent ?? "[]");
      expect(util).toEqual([
        { id: 1, u: { "2026-08": 40 } },
        { id: 2, u: {} },
      ]);
    });
  });

  it("confirm records exactly ONE undo capture, with edited carrying the pre-edit image", async () => {
    vi.mocked(call.runAllocProposal).mockResolvedValue(
      proposal([{ resourceId: 1, periodKey: "2026-08", hours: 40 }]),
    );
    const captureSpy = vi.fn();
    const logActivitySpy = vi.fn();
    renderHarness({ captureSpy, logActivitySpy });
    openAndType();
    fireEvent.click(screen.getByRole("button", { name: /^propose$/i }));

    await waitFor(() => expect(screen.getAllByRole("checkbox").length).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: /apply selected/i }));

    await waitFor(() => expect(captureSpy).toHaveBeenCalledTimes(1));
    const arg = captureSpy.mock.calls[0][0];
    expect(arg.kind).toBe("bulk.edit");
    expect(arg.entityKey).toBe("resource");
    expect(arg.edited).toHaveLength(1);
    // §177b — the written rows ride along, so the undo is a field patch.
    expect(arg.editedAfter.some((r: { id: number }) => r.id === 1)).toBe(true);
    // The pre-edit image — the resource as it was BEFORE the write.
    expect(arg.edited[0].id).toBe(1);
    expect(arg.edited[0].utilization).toEqual({});
    expect(logActivitySpy).toHaveBeenCalledWith("ai", "ai.allocationPlan", 1);
    expect(showToast).toHaveBeenCalledWith("info", expect.stringContaining("1"));
  });

  it("confirm skips a cell whose live value moved since propose, applies the rest, and reports the reduced count", async () => {
    vi.mocked(call.runAllocProposal).mockResolvedValue(
      proposal([
        { resourceId: 1, periodKey: "2026-08", hours: 40 },
        { resourceId: 2, periodKey: "2026-08", hours: 20 },
      ]),
    );
    const captureSpy = vi.fn();
    const logActivitySpy = vi.fn();
    // Alice's utilization moves (another edit / background sync) while the
    // preview modal is open — her stored value no longer matches the
    // currentValue captured at propose time (0).
    const externalEdit = (prev: readonly Resource[]) =>
      prev.map((r) => (r.id === 1 ? { ...r, utilization: { "2026-08": 5 } } : r));
    // The REAL single-slot toast, rendered: a mocked showToast records every
    // call, so it cannot see the second call replacing the first.
    render(
      <RealToast>
        <Harness captureSpy={captureSpy} logActivitySpy={logActivitySpy} externalEdit={externalEdit} />
      </RealToast>,
    );

    openAndType();
    fireEvent.click(screen.getByRole("button", { name: /^propose$/i }));
    await waitFor(() => expect(screen.getAllByRole("checkbox").length).toBe(2));

    fireEvent.click(screen.getByRole("button", { name: "external-edit" }));
    fireEvent.click(screen.getByRole("button", { name: /apply selected/i }));

    await waitFor(() => {
      const util = JSON.parse(screen.getByTestId("util").textContent ?? "[]");
      // Alice's stale cell was NOT overwritten — her externally-set value (5)
      // survives untouched; only Bob's still-fresh cell was applied.
      expect(util).toEqual([
        { id: 1, u: { "2026-08": 5 } },
        { id: 2, u: { "2026-08": 20 } },
      ]);
    });
    // ONE toast the user sees, carrying both counts.
    expect(screen.getByTestId("toast")).toHaveTextContent(
      "Applied 1 allocation change. 1 change was skipped because the plan changed.",
    );
    // The applied count (1) — not the original selection count (2) — is what
    // gets logged, since the two diverge exactly in this window.
    expect(logActivitySpy).toHaveBeenCalledWith("ai", "ai.allocationPlan", 1);
  });

  it("confirm applies nothing and stays quiet on capture/logActivity when every chosen cell went stale", async () => {
    vi.mocked(call.runAllocProposal).mockResolvedValue(
      proposal([{ resourceId: 1, periodKey: "2026-08", hours: 40 }]),
    );
    const captureSpy = vi.fn();
    const logActivitySpy = vi.fn();
    const externalEdit = (prev: readonly Resource[]) =>
      prev.map((r) => (r.id === 1 ? { ...r, utilization: { "2026-08": 5 } } : r));
    render(
      <ToastProvider value={{ showToast, showToastAction: vi.fn() }}>
        <Harness captureSpy={captureSpy} logActivitySpy={logActivitySpy} externalEdit={externalEdit} />
      </ToastProvider>,
    );

    openAndType();
    fireEvent.click(screen.getByRole("button", { name: /^propose$/i }));
    await waitFor(() => expect(screen.getAllByRole("checkbox").length).toBe(1));

    fireEvent.click(screen.getByRole("button", { name: "external-edit" }));
    fireEvent.click(screen.getByRole("button", { name: /apply selected/i }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith("info", tPlural("en-US", "allocPlanSkippedStale", 1, 1)));
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(captureSpy).not.toHaveBeenCalled();
    expect(logActivitySpy).not.toHaveBeenCalled();
    const util = JSON.parse(screen.getByTestId("util").textContent ?? "[]");
    expect(util).toEqual([
      { id: 1, u: { "2026-08": 5 } },
      { id: 2, u: {} },
    ]);
  });

  it("toggling twice returns to the original selection (each toggle produced a NEW Set)", async () => {
    vi.mocked(call.runAllocProposal).mockResolvedValue(
      proposal([{ resourceId: 1, periodKey: "2026-08", hours: 40 }]),
    );
    renderHarness();
    openAndType();
    fireEvent.click(screen.getByRole("button", { name: /^propose$/i }));

    await waitFor(() => expect(screen.getAllByRole("checkbox").length).toBe(1));
    const checkbox = screen.getByRole("checkbox", { name: /Alice/i });
    // Preselected.
    expect(checkbox).toBeChecked();

    // First toggle: if selection were mutated in place (same Set reference
    // passed back to the setter), React would bail out on Object.is equality
    // and this box would stay checked — so this assertion only passes when
    // the toggle handler hands back a genuinely NEW Set.
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();

    // Second toggle: back to the original selection.
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
  });
});

describe("useAllocPlan — §650 a refused key shows the key message", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it.each([
    [401, "aiKeyRejected"],
    [403, "aiKeyForbidden"],
  ] as const)("a %i toasts %s, not the response's own message", async (status, key) => {
    vi.mocked(call.runAllocProposal).mockRejectedValue(new AiHttpError(status, "authentication_error", "invalid x-api-key"));
    renderHarness();
    openAndType();
    fireEvent.click(screen.getByRole("button", { name: /^propose$/i }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("error", t("en-US", key)));
    expect(showToast).not.toHaveBeenCalledWith("error", "invalid x-api-key");
  });
});

// §701 — Plan with AI renders inside the root guide provider (resources-panel)
// and sends the guides that target it.
describe("useAllocPlan guide text", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("passes the guides that target Plan with AI, and only those, to the call", async () => {
    vi.mocked(call.runAllocProposal).mockResolvedValue(proposal([]));
    render(
      <ActionGuidesProvider value={{ guides: [
      { id: "t", name: "Team", content: "TARGET-MARK", enabled: true, priority: 10, scope: { targets: ["alloc" as const] }, builtIn: false },
      { id: "c", name: "Chat", content: "CHAT-ONLY", enabled: true, priority: 11, scope: {}, builtIn: false },
    ], groundInGuides: true, ready: true }}>
        <ToastProvider value={{ showToast, showToastAction: vi.fn() }}>
          <Harness />
        </ToastProvider>
      </ActionGuidesProvider>,
    );
    openAndType();
    fireEvent.click(screen.getByRole("button", { name: /^propose$/i }));
    await waitFor(() => expect(call.runAllocProposal).toHaveBeenCalled());
    const text = vi.mocked(call.runAllocProposal).mock.calls[0][1].guideText ?? "";
    expect(text).toContain("TARGET-MARK");
    expect(text).not.toContain("CHAT-ONLY");
  });
});

// §769 Task 6 — task moves plus hour edits, applied through the REAL §774 step and the REAL undo stack.
// Sep 1 – Dec 31, monthly. Every month from Sep to Dec has 22 workdays or more, so a hand cell never hits capacity.
const PLAN_SD: ResourcePlan = { startDate: "2026-09-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" };
const TODAY_SD = "2026-09-01";
const NO_HOLIDAYS: ReadonlySet<string> = new Set<string>();

const MAYA: Resource = {
  id: 1, firstName: "Maya", lastName: "Patel", email: "maya@x.com", roleId: null, utilizationMode: "hours",
  utilization: { "2026-09": 40, "2026-10": 40 },
};
const LIAM: Resource = { id: 2, firstName: "Liam", lastName: "Foster", email: "liam@x.com", roleId: null, utilizationMode: "hours", utilization: {} };
const ZOE: Resource = { id: 3, firstName: "Zoe", lastName: "Kim", roleId: null, utilizationMode: "hours", utilization: {} };

// 16 h over Sep 1 – Oct 30: 8 h in each month.
const DESIGN: Task = {
  id: 10, taskName: "Design review", assignee: "Maya Patel", assigneeEmail: "maya@x.com", resourceId: 1,
  startDate: "2026-09-01", dueDate: "2026-10-30", remainingEstimateMinutes: 16 * 60,
  lastUpdateDate: "2026-09-01", priority: "Medium", status: "To Do",
} as Task;
// 8 h in September only.
const SEP_TASK: Task = { ...DESIGN, id: 12, taskName: "Sep only", dueDate: "2026-09-30", remainingEstimateMinutes: 8 * 60 } as Task;
// No owner at all.
const UNOWNED: Task = { ...SEP_TASK, id: 13, taskName: "Nobody's", assignee: "", assigneeEmail: "", resourceId: undefined } as Task;

const fullToast = vi.fn();
const fullLog = vi.fn();
const noopLog = () => {};

function alt(summary: string, taskMoves: { taskId: number; toResourceId: number }[], cells: RawAllocCell[]) {
  return { summary, taskMoves, cells };
}
function answer(...alternatives: ReturnType<typeof alt>[]): ParsedAllocAlternatives {
  return { alternatives, truncated: false };
}

interface FullProps {
  initialTasks: readonly Task[];
  initialResources?: readonly Resource[];
  /** Stands in for §774's step: receives the real `reassignTasks` and returns what the hook gets. */
  wrapReassign?: (real: ReassignHours["reassignTasks"]) => ReassignHours["reassignTasks"];
  externalTasks?: (tasks: readonly Task[]) => readonly Task[];
  externalResources?: (resources: readonly Resource[]) => readonly Resource[];
  /** The load hold as §774's step sees it (§548). */
  loadPending?: boolean;
}

function FullHarness({ initialTasks, initialResources, wrapReassign, externalTasks, externalResources, loadPending = false }: FullProps) {
  const [tasks, setTasks] = useState<readonly Task[]>(initialTasks);
  const [resources, setResources] = useState<readonly Resource[]>(initialResources ?? [MAYA, LIAM, ZOE]);
  const undo = useUndoStack({ lang: "en-US", logActivity: noopLog, showToast: fullToast, showToastAction: fullToast });
  const reassign = useReassignHours({
    lang: "en-US", today: TODAY_SD, isPopout: false, loadPending,
    tasks, setTasks, resources, setResources,
    plan: PLAN_SD, absences: [], workdayHours: 8, holidaySet: NO_HOLIDAYS,
    captureComposite: undo.captureComposite, logActivityAs: fullLog, showToast: fullToast,
  });
  const alloc = useAllocPlan({
    settings: AI_ON, isPopout: false, lang: "en-US",
    resources, setResources, roles: [], disciplines: [], grades: [],
    plan: PLAN_SD, absences: [], workdayHours: 8, holidaySet: NO_HOLIDAYS,
    tasks, milestones: [], stakeholders: [], today: TODAY_SD,
    reassignTasks: wrapReassign ? wrapReassign(reassign.reassignTasks) : reassign.reassignTasks,
    isLoadHeld: reassign.isLoadHeld,
    capture: undo.capture, captureComposite: undo.captureComposite,
    logActivityAs: fullLog,
  });
  return (
    <>
      {alloc.button}
      {alloc.modal}
      <button type="button" onClick={() => undo.undo()}>undo-now</button>
      {externalTasks && <button type="button" onClick={() => setTasks(externalTasks)}>edit-tasks</button>}
      {externalResources && <button type="button" onClick={() => setResources(externalResources)}>edit-resources</button>}
      <output data-testid="full-util">{JSON.stringify(Object.fromEntries(resources.map((r) => [r.id, r.utilization])))}</output>
      <output data-testid="full-owners">{JSON.stringify(Object.fromEntries(tasks.map((x) => [x.id, x.resourceId ?? null])))}</output>
      <output data-testid="full-assignees">{JSON.stringify(Object.fromEntries(tasks.map((x) => [x.id, [x.assignee, x.assigneeEmail]])))}</output>
      <output data-testid="full-stack">{JSON.stringify(undo.stack.map((e) => ({ kind: e.kind, count: e.count, label: e.label })))}</output>
    </>
  );
}

const readUtil = (): Record<string, Record<string, number>> => JSON.parse(screen.getByTestId("full-util").textContent ?? "{}");
const readOwners = (): Record<string, number | null> => JSON.parse(screen.getByTestId("full-owners").textContent ?? "{}");
const readStack = (): { kind: string; count: number; label: string }[] => JSON.parse(screen.getByTestId("full-stack").textContent ?? "[]");
const lastToast = (): string => String(fullToast.mock.calls.at(-1)?.[1] ?? "");
const moveBox = (taskId: number) => screen.getByRole("checkbox", { name: new RegExp(`#${taskId} `) });
const cellBox = (resourceId: number, periodKey: string) => screen.getByRole("checkbox", { name: new RegExp(`\\(#${resourceId}\\) – ${periodKey}`) });

async function proposeWith(parsed: ParsedAllocAlternatives, props: FullProps) {
  vi.mocked(call.runAllocProposal).mockResolvedValue(parsed);
  // The provider sits ABOVE the harness: the hook reads the toast context of the component that calls it.
  render(<ToastProvider value={{ showToast: fullToast, showToastAction: fullToast }}><FullHarness {...props} /></ToastProvider>);
  openAndType("bring Maya under 100 % in September");
  fireEvent.click(screen.getByRole("button", { name: /^propose$/i }));
  await waitFor(() => expect(screen.getByRole("button", { name: /apply selected/i })).toBeTruthy());
}

const apply = () => fireEvent.click(screen.getByRole("button", { name: /apply selected/i }));

describe("useAllocPlan — task moves and hour edits (§769)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("applying one move and one cell is one undo entry; undo restores owner, hours and cell", async () => {
    await proposeWith(answer(alt("", [{ taskId: 10, toResourceId: 2 }], [{ resourceId: 3, periodKey: "2026-11", hours: 12 }])), { initialTasks: [DESIGN] });
    apply();
    await waitFor(() => expect(readOwners()[10]).toBe(2));
    expect(readUtil()).toEqual({ 1: { "2026-09": 32, "2026-10": 32 }, 2: { "2026-09": 8, "2026-10": 8 }, 3: { "2026-11": 12 } });
    expect(JSON.parse(screen.getByTestId("full-assignees").textContent ?? "{}")[10]).toEqual(["Liam Foster", "liam@x.com"]);
    expect(readStack()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "undo-now" }));
    await waitFor(() => expect(readOwners()[10]).toBe(1));
    expect(readUtil()).toEqual({ 1: { "2026-09": 40, "2026-10": 40 }, 2: {}, 3: {} });
    expect(readStack()).toHaveLength(0);
  });

  // Mutation: write the cells from the render snapshot (`setResources(() => …)`) and Maya's September comes back to 40.
  it("a cell write does not clobber the hours a move wrote in the same apply", async () => {
    await proposeWith(answer(alt("", [{ taskId: 12, toResourceId: 2 }], [{ resourceId: 2, periodKey: "2026-10", hours: 20 }])), { initialTasks: [SEP_TASK] });
    apply();
    await waitFor(() => expect(readOwners()[12]).toBe(2));
    expect(readUtil()[1]).toEqual({ "2026-09": 32, "2026-10": 40 });
    expect(readUtil()[2]).toEqual({ "2026-09": 8, "2026-10": 20 });
    // Liam carries §774's September hours AND the October cell; one undo returns both people to their exact before-map.
    fireEvent.click(screen.getByRole("button", { name: "undo-now" }));
    await waitFor(() => expect(readOwners()[12]).toBe(1));
    expect(readUtil()[2]).toEqual({});
    expect(readUtil()[1]).toEqual({ "2026-09": 40, "2026-10": 40 });
  });

  it("a move whose task changed while the window was open is skipped as stale", async () => {
    await proposeWith(
      answer(alt("", [{ taskId: 10, toResourceId: 2 }], [{ resourceId: 3, periodKey: "2026-11", hours: 12 }])),
      { initialTasks: [DESIGN], externalTasks: (ts) => ts.map((x) => (x.id === 10 ? { ...x, dueDate: "2026-10-15" } : x)) },
    );
    fireEvent.click(screen.getByRole("button", { name: "edit-tasks" }));
    apply();
    await waitFor(() => expect(readUtil()[3]).toEqual({ "2026-11": 12 }));
    expect(readOwners()[10]).toBe(1);
    expect(readUtil()[1]).toEqual({ "2026-09": 40, "2026-10": 40 });
    expect(lastToast()).toBe(`${tPlural("en-US", "allocPlanApplied", 1, 1)} ${tPlural("en-US", "allocPlanSkippedStale", 1, 1)}`);
  });

  it("a move whose giver's planned hours changed is skipped as stale", async () => {
    await proposeWith(
      answer(alt("", [{ taskId: 10, toResourceId: 2 }], [{ resourceId: 3, periodKey: "2026-11", hours: 12 }])),
      { initialTasks: [DESIGN], externalResources: (rs) => rs.map((r) => (r.id === 1 ? { ...r, utilization: { ...r.utilization, "2026-10": 30 } } : r)) },
    );
    fireEvent.click(screen.getByRole("button", { name: "edit-resources" }));
    apply();
    await waitFor(() => expect(readUtil()[3]).toEqual({ "2026-11": 12 }));
    expect(readOwners()[10]).toBe(1);
    expect(readUtil()[1]).toEqual({ "2026-09": 40, "2026-10": 30 });
    expect(readUtil()[2]).toEqual({});
    expect(lastToast()).toBe(`${tPlural("en-US", "allocPlanApplied", 1, 1)} ${tPlural("en-US", "allocPlanSkippedStale", 1, 1)}`);
  });

  // Third wave, 1 — a move whose task changed while the window is open is marked, cannot be ticked, and leaves the
  // effect and the Apply count. Mutation: drop the preview's stale check and the row stays ticked, the effect still
  // counts the move.
  it("a move whose task changed while the window is open is marked and leaves the preview", async () => {
    await proposeWith(
      answer(alt("", [{ taskId: 10, toResourceId: 2 }], [{ resourceId: 3, periodKey: "2026-11", hours: 12 }])),
      { initialTasks: [DESIGN], externalTasks: (ts) => ts.map((x) => (x.id === 10 ? { ...x, assignee: "Zoe Kim", assigneeEmail: "", resourceId: 3 } : x)) },
    );
    const moves = tPlural("en-US", "allocPlanEffectMoves", 1, 1, formatMovedHours(16, "en-US"));
    expect(screen.getByText(new RegExp(moves.replace(/[()]/g, ".")))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "edit-tasks" }));
    expect(moveBox(10)).not.toBeChecked();
    expect(moveBox(10)).toBeDisabled();
    const row = moveBox(10).closest("li") as HTMLElement;
    expect(within(row).getByText(t("en-US", "allocPlanMoveChanged"))).toBeTruthy();
    expect(screen.queryByText(new RegExp(moves.replace(/[()]/g, ".")))).toBeNull();
    // The cell still counts, so Apply stays available — and applying writes the cell only.
    apply();
    await waitFor(() => expect(readUtil()[3]).toEqual({ "2026-11": 12 }));
    expect(readOwners()[10]).toBe(3);
    expect(readUtil()[2]).toEqual({});
  });

  // Review Focus 2. Mutation: one shared tick set for every alternative, or apply reading alternative 0.
  it("switching alternatives keeps each one's ticks; applying alternative 2 writes only its rows", async () => {
    await proposeWith(answer(
      alt("Move the review", [{ taskId: 10, toResourceId: 2 }], [{ resourceId: 3, periodKey: "2026-11", hours: 12 }]),
      alt("Shift hours", [], [{ resourceId: 3, periodKey: "2026-12", hours: 5 }, { resourceId: 2, periodKey: "2026-11", hours: 6 }]),
    ), { initialTasks: [DESIGN] });
    fireEvent.click(cellBox(3, "2026-11"));
    fireEvent.click(screen.getByRole("radio", { name: /Alternative 2/ }));
    expect(cellBox(3, "2026-12")).toBeChecked();
    fireEvent.click(cellBox(2, "2026-11"));
    fireEvent.click(screen.getByRole("radio", { name: /Alternative 1/ }));
    expect(cellBox(3, "2026-11")).not.toBeChecked();
    expect(moveBox(10)).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /Alternative 2/ }));
    expect(cellBox(2, "2026-11")).not.toBeChecked();
    expect(cellBox(3, "2026-12")).toBeChecked();
    apply();
    await waitFor(() => expect(readUtil()[3]).toEqual({ "2026-12": 5 }));
    expect(readUtil()[2]).toEqual({});
    expect(readUtil()[1]).toEqual({ "2026-09": 40, "2026-10": 40 });
    expect(readOwners()[10]).toBe(1);
  });

  // Review Focus 1. Mutation: put covered-by-move cells back into the alternative's rows when their move is unticked.
  it("unticking a move does not bring back a covered-by-move cell", async () => {
    await proposeWith(answer(alt("", [{ taskId: 10, toResourceId: 2 }], [{ resourceId: 2, periodKey: "2026-09", hours: 30 }])), { initialTasks: [DESIGN] });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    fireEvent.click(moveBox(10));
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.queryByRole("checkbox", { name: /\(#2\) – 2026-09/ })).toBeNull();
    expect(screen.getByRole("button", { name: /apply selected/i })).toBeDisabled();
    expect(readUtil()[2]).toEqual({});
  });

  it("an unlinked move assigns the owner and its cells add the hours", async () => {
    await proposeWith(answer(alt("", [{ taskId: 13, toResourceId: 2 }], [{ resourceId: 2, periodKey: "2026-09", hours: 8 }])), { initialTasks: [UNOWNED] });
    expect(cellBox(2, "2026-09")).toBeChecked();
    apply();
    await waitFor(() => expect(readOwners()[13]).toBe(2));
    expect(readUtil()[2]).toEqual({ "2026-09": 8 });
    expect(readUtil()[1]).toEqual({ "2026-09": 40, "2026-10": 40 });
    expect(readStack()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "undo-now" }));
    await waitFor(() => expect(readOwners()[13]).toBeNull());
    expect(readUtil()[2]).toEqual({});
  });

  it("logs ai.allocationPlanAlt with the alternative number, never the summary", async () => {
    await proposeWith(answer(
      alt("FIRST-SUMMARY", [], [{ resourceId: 3, periodKey: "2026-12", hours: 5 }]),
      alt("SECRET-SUMMARY", [{ taskId: 10, toResourceId: 2 }], [{ resourceId: 3, periodKey: "2026-11", hours: 12 }]),
    ), { initialTasks: [DESIGN] });
    fireEvent.click(screen.getByRole("radio", { name: /Alternative 2/ }));
    apply();
    await waitFor(() => expect(readOwners()[10]).toBe(2));
    expect(fullLog).toHaveBeenCalledWith("ai", "ai.allocationPlanAlt", 2, 1, 1);
    for (const args of fullLog.mock.calls) {
      for (const a of args) expect(String(a)).not.toMatch(/SUMMARY/);
    }
  });

  // Fix round 1 — a fresh move §774 did not apply is counted as skipped, never dropped without a word.
  // Mutation: count only stale rows and this apply closes with no toast at all.
  it("a moves-only apply that §774 applies none of toasts the skipped count", async () => {
    await proposeWith(answer(alt("", [{ taskId: 10, toResourceId: 2 }], [])), { initialTasks: [DESIGN], wrapReassign: () => () => 0 });
    apply();
    await waitFor(() => expect(fullToast).toHaveBeenCalledWith("info", tPlural("en-US", "allocPlanSkippedUnchanged", 1, 1)));
    expect(readOwners()[10]).toBe(1);
    expect(readStack()).toEqual([]);
    expect(fullLog).not.toHaveBeenCalled();
  });

  // Fix round 1. Mutation: count the edits handed over (`ownerEdits.length`) and the toast says 3 applied, 0 skipped.
  it("counts what was written when one move's edit is a no-op", async () => {
    await proposeWith(
      answer(alt("", [{ taskId: 10, toResourceId: 2 }, { taskId: 12, toResourceId: 2 }], [{ resourceId: 3, periodKey: "2026-11", hours: 12 }])),
      { initialTasks: [DESIGN, SEP_TASK], wrapReassign: (real) => (edits, actor, opts) => real(edits.slice(0, 1), actor, opts) },
    );
    apply();
    await waitFor(() => expect(readOwners()[10]).toBe(2));
    expect(readOwners()[12]).toBe(1);
    expect(lastToast().startsWith(`${tPlural("en-US", "allocPlanApplied", 2, 2)} ${tPlural("en-US", "allocPlanSkippedUnchanged", 1, 1)}`)).toBe(true);
    expect(lastToast()).not.toContain(tPlural("en-US", "allocPlanSkippedStale", 1, 1));
    expect(fullLog).toHaveBeenCalledWith("ai", "ai.allocationPlanAlt", 1, 1, 1);
    expect(readStack()).toEqual([{ kind: "bulk.edit", count: 2, label: expect.any(String) }]);
  });

  // Fix round 2 — an entry of task moves AND hour edits names no single entity. Mutation: keep `entityKey: "task"`
  // and the label reads "Bulk edit 2 tasks", one of which is an hour cell.
  it("labels an entry of moves and hour edits by its item count", async () => {
    await proposeWith(answer(alt("", [{ taskId: 10, toResourceId: 2 }], [{ resourceId: 3, periodKey: "2026-11", hours: 12 }])), { initialTasks: [DESIGN] });
    apply();
    await waitFor(() => expect(readStack()).toHaveLength(1));
    expect(readStack()[0].label).toBe(tPlural("en-US", "undoToastEdit", 2, 2));
  });

  // Fix round 4 — A→B and B→C in the same period, ticked together, are planned TOGETHER on apply exactly as the
  // preview plans them: the result is the preview's plan, and no hour is created or lost. Liam holds no September
  // hours of his own, so only a JOINT plan lets his task carry the 8 h he receives (planned alone, it moves 0 h).
  it("chained moves apply the preview's plan and conserve the hours", async () => {
    const liamTask = { ...SEP_TASK, id: 14, taskName: "Liam's", assignee: "Liam Foster", assigneeEmail: "liam@x.com", resourceId: 2 } as Task;
    const people = [MAYA, LIAM, ZOE];
    const raw = alt("", [{ taskId: 12, toResourceId: 2 }, { taskId: 14, toResourceId: 3 }], []);
    const ctx = { resources: people, plan: PLAN_SD, absences: [], workdayHours: 8, holidaySet: NO_HOLIDAYS, tasks: [SEP_TASK, liamTask], today: TODAY_SD };
    const grounded = groundAlternative(raw, ctx);
    const preview = alternativeEffect(grounded, new Set(grounded.moves.map((m) => m.key)), { ...ctx, roles: [] });
    const together = planHoursMoves([ownerChangeFor(SEP_TASK, LIAM), ownerChangeFor(liamTask, ZOE)], people, ctx);
    expect(preview.movedHours).toBe(Math.round(together.moves.reduce((n, m) => n + m.movedHours, 0) * 100) / 100);
    expect(preview.movedHours).toBeGreaterThan(0);

    await proposeWith(answer(raw), { initialTasks: [SEP_TASK, liamTask], initialResources: people });
    apply();
    await waitFor(() => expect(readOwners()[14]).toBe(3));
    expect(readOwners()[12]).toBe(2);
    const util = readUtil();
    for (const r of together.nextResources) expect(util[r.id], `resource ${r.id}`).toEqual(r.utilization);
    const sep = (u: Record<string, Record<string, number>>) => [1, 2, 3].reduce((n, id) => n + (u[id]["2026-09"] ?? 0), 0);
    expect(sep(util)).toBe(sep(Object.fromEntries(people.map((r) => [r.id, r.utilization]))));
    // Two moves are ONE undo entry and ONE toast. Mutation: apply each move through its own reassignTasks call and
    // the stack holds two entries, the screen two toasts.
    expect(readStack()).toEqual([{ kind: "bulk.edit", count: 2, label: buildUndoLabel("en-US", "bulk.edit", 2, { entityKey: "task" }) }]);
    expect(fullToast).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "undo-now" }));
    await waitFor(() => expect(readOwners()[14]).toBe(2));
    expect(readOwners()[12]).toBe(1);
    expect(readUtil()).toEqual(Object.fromEntries(people.map((r) => [r.id, r.utilization])));
    expect(readStack()).toEqual([]);
  });

  // Final review, Important 1 — the same chain plus a model cell on Zoe's September. Planned alone, Liam's move
  // carries nothing, so grounding keeps the cell; planned with Maya's, it writes Zoe's September, and the absolute
  // cell would then overwrite 8 h with 4. Mutation: judge `covered` per move only and Zoe ends at 4, the preview
  // counts 12 h for her and task 14's row reads §774's "nothing moved" reason.
  describe("a cell the ticked moves planned together already write", () => {
    const liamTask = { ...SEP_TASK, id: 14, taskName: "Liam's", assignee: "Liam Foster", assigneeEmail: "liam@x.com", resourceId: 2 } as Task;
    const people = [MAYA, LIAM, ZOE];
    const raw = alt("", [{ taskId: 12, toResourceId: 2 }, { taskId: 14, toResourceId: 3 }], [{ resourceId: 3, periodKey: "2026-09", hours: 4 }]);
    const propose = () => proposeWith(answer(raw), { initialTasks: [SEP_TASK, liamTask], initialResources: people });

    it("the preview counts it as covered and task 14's row shows the hours the moves carry together", async () => {
      await propose();
      expect(cellBox(3, "2026-09")).toBeChecked();
      expect(screen.getByText(tPlural("en-US", "allocPlanEffectCovered", 1, 1))).toBeTruthy();
      const row = moveBox(14).closest("li") as HTMLElement;
      const period = t("en-US", "allocPlanMovePeriod", defaultPeriodLabel("2026-09", "en-US"), formatMovedHours(8, "en-US"));
      expect(within(row).getByText(t("en-US", "allocPlanMoveHours", formatMovedHours(8, "en-US"), period))).toBeTruthy();
    });

    it("apply leaves Zoe at the moved hours, conserves September and counts the cell as skipped", async () => {
      await propose();
      apply();
      await waitFor(() => expect(readOwners()[14]).toBe(3));
      const util = readUtil();
      expect(util[3]).toEqual({ "2026-09": 8 });
      const sep = (u: Record<string, Record<string, number>>) => [1, 2, 3].reduce((n, id) => n + (u[id]["2026-09"] ?? 0), 0);
      expect(sep(util)).toBe(sep(Object.fromEntries(people.map((r) => [r.id, r.utilization]))));
      expect(fullToast).toHaveBeenCalledTimes(1);
      // Second wave, 1 — the cell is named for what it is. Mutation: fold `covered` into `stale` and the toast says
      // the plan changed.
      expect(lastToast().startsWith(`${tPlural("en-US", "allocPlanApplied", 2, 2)} ${tPlural("en-US", "allocPlanSkippedCovered", 1, 1)}`)).toBe(true);
      expect(lastToast()).not.toContain(tPlural("en-US", "allocPlanSkippedStale", 1, 1));
    });
  });

  // Review Focus 2, the other half: the SAME task moved to a different person in each alternative.
  // Mutation: apply alternative 0's moves and task 10 goes to Liam.
  it("the same task moved differently in two alternatives: applying alternative 2 writes only its owner", async () => {
    await proposeWith(answer(
      alt("To Liam", [{ taskId: 10, toResourceId: 2 }], []),
      alt("To Zoe", [{ taskId: 10, toResourceId: 3 }], []),
    ), { initialTasks: [DESIGN] });
    fireEvent.click(screen.getByRole("radio", { name: /Alternative 2/ }));
    apply();
    await waitFor(() => expect(readOwners()[10]).toBe(3));
    expect(readUtil()[2]).toEqual({});
    expect(readUtil()[3]).toEqual({ "2026-09": 8, "2026-10": 8 });
  });

  // Final review, Minor 3. Mutation: render `fromLabel` as is and the row reads "#13 Nobody's:  → Liam Foster".
  it("a move of an unassigned task names the owner as unassigned", async () => {
    await proposeWith(answer(alt("", [{ taskId: 13, toResourceId: 2 }], [])), { initialTasks: [UNOWNED] });
    const expected = t("en-US", "allocPlanMoveRow", 13, "Nobody's", t("en-US", "workloadTriageUnassigned"), "Liam Foster");
    expect(screen.getByText(expected)).toBeTruthy();
  });

  // Final review, Minor 4. Mutation: print ids alone and the row reads "#12 → #2 — task is closed".
  it("a skipped move names the task and the person from the live workspace", async () => {
    const done = { ...SEP_TASK, status: "Done" } as Task;
    await proposeWith(answer(alt("", [{ taskId: 12, toResourceId: 2 }, { taskId: 99, toResourceId: 3 }], [{ resourceId: 3, periodKey: "2026-11", hours: 12 }])), { initialTasks: [done] });
    expect(screen.getByText(`#12 Sep only → Liam Foster — ${t("en-US", "allocPlanSkipMoveClosed")}`)).toBeTruthy();
    expect(screen.getByText(`#99 → Zoe Kim — ${t("en-US", "allocPlanSkipMoveUnknownTask")}`)).toBeTruthy();
  });

  // Second wave, 7. Mutation: compare only the stored values and a changed absence override goes unseen.
  it("a move whose receiver's absence override changed in its period is skipped as stale", async () => {
    await proposeWith(
      answer(alt("", [{ taskId: 10, toResourceId: 2 }], [{ resourceId: 3, periodKey: "2026-11", hours: 12 }])),
      { initialTasks: [DESIGN], externalResources: (rs) => rs.map((r) => (r.id === 2 ? { ...r, absenceOverride: { "2026-09": 16 } } : r)) },
    );
    fireEvent.click(screen.getByRole("button", { name: "edit-resources" }));
    apply();
    await waitFor(() => expect(readUtil()[3]).toEqual({ "2026-11": 12 }));
    expect(readOwners()[10]).toBe(1);
    expect(readUtil()[2]).toEqual({});
    expect(lastToast()).toBe(`${tPlural("en-US", "allocPlanApplied", 1, 1)} ${tPlural("en-US", "allocPlanSkippedStale", 1, 1)}`);
  });

  // Second wave, 8 — under the load hold §774 refuses the moves; the hour edits must not be written alone.
  // Mutation: drop the guard and the Zoe cell is written while the task stays with Maya.
  it("writes nothing while the load hold is up", async () => {
    await proposeWith(answer(alt("", [{ taskId: 10, toResourceId: 2 }], [{ resourceId: 3, periodKey: "2026-11", hours: 12 }])), { initialTasks: [DESIGN], loadPending: true });
    apply();
    expect(readUtil()).toEqual({ 1: { "2026-09": 40, "2026-10": 40 }, 2: {}, 3: {} });
    expect(readOwners()[10]).toBe(1);
    expect(readStack()).toEqual([]);
    expect(fullLog).not.toHaveBeenCalled();
  });

  it("only cells ticked: captures one bulk.edit entry as today", async () => {
    await proposeWith(answer(alt("", [{ taskId: 10, toResourceId: 2 }], [{ resourceId: 3, periodKey: "2026-11", hours: 12 }])), { initialTasks: [DESIGN] });
    fireEvent.click(moveBox(10));
    apply();
    await waitFor(() => expect(readUtil()[3]).toEqual({ "2026-11": 12 }));
    expect(readOwners()[10]).toBe(1);
    expect(readStack()).toEqual([{ kind: "bulk.edit", count: 1, label: expect.any(String) }]);
    expect(fullLog).toHaveBeenCalledWith("ai", "ai.allocationPlan", 1);
    expect(fullLog.mock.calls.some((c) => c[1] === "ai.allocationPlanAlt")).toBe(false);
    expect(lastToast()).toBe(tPlural("en-US", "allocPlanApplied", 1, 1));
    fireEvent.click(screen.getByRole("button", { name: "undo-now" }));
    await waitFor(() => expect(readUtil()[3]).toEqual({}));
  });
});
