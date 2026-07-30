import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { useState } from "react";
import { useAllocPlan } from "./use-alloc-plan";
import { ToastProvider } from "./toast-context";
import { defaultSettings, type Settings } from "./settings-types";
import { type Resource, type ResourcePlan } from "./types";
import * as call from "./alloc-plan-call";
import { type ParsedAllocationProposal } from "./alloc-plan/alloc-plan";
import { t } from "./i18n";

vi.mock("./alloc-plan-call");

/** Test-only shorthand — most propose-mock responses are a fully fresh cell
 *  set (nothing dropped at parse). */
function proposal(cells: ParsedAllocationProposal["cells"], truncated = false): ParsedAllocationProposal {
  return { cells, truncated };
}

const AI_ON: Settings = {
  ...defaultSettings,
  ai: { ...defaultSettings.ai, enabled: true, apiKey: "sk-ant-test", model: "claude-x" },
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

function Harness({
  settings = AI_ON,
  isPopout = false,
  captureSpy,
  logActivitySpy,
  onResources,
  externalEdit,
}: HarnessProps) {
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
    logActivity: logActivitySpy as never,
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

  it("renders no button in a popout", () => {
    renderHarness({ isPopout: true });
    expect(screen.queryByRole("button", { name: /plan with ai/i })).toBeNull();
  });

  it("renders no button when AI is disabled", () => {
    renderHarness({ settings: defaultSettings });
    expect(screen.queryByRole("button", { name: /plan with ai/i })).toBeNull();
  });

  it("a proposal that resolves AFTER cancel does not apply anything and leaves the hook idle", async () => {
    let resolveProposal!: (v: ParsedAllocationProposal) => void;
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
    // The real production path: parseAllocationProposal is where a too-large
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
    // The pre-edit image — the resource as it was BEFORE the write.
    expect(arg.edited[0].id).toBe(1);
    expect(arg.edited[0].utilization).toEqual({});
    expect(logActivitySpy).toHaveBeenCalledWith("ai.allocationPlan", 1);
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
    render(
      <ToastProvider value={{ showToast, showToastAction: vi.fn() }}>
        <Harness captureSpy={captureSpy} logActivitySpy={logActivitySpy} externalEdit={externalEdit} />
      </ToastProvider>,
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
    // Assert the STALE toast specifically (not just "contains 1") — the
    // applied-count toast below ALSO contains "1", so a loose stringContaining
    // assertion here would pass even if the stale toast were never sent.
    expect(showToast).toHaveBeenCalledWith("info", t("en-US", "allocPlanSkippedStale", 1));
    expect(showToast).toHaveBeenCalledWith("info", t("en-US", "allocPlanApplied", 1));
    // The applied count (1) — not the original selection count (2) — is what
    // gets logged, since the two diverge exactly in this window.
    expect(logActivitySpy).toHaveBeenCalledWith("ai.allocationPlan", 1);
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

    await waitFor(() => expect(showToast).toHaveBeenCalledWith("info", expect.stringContaining("1")));
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
