// §500 — the forecast import's state machine: file → sheet grid → rows →
// validated → plan → ONE bucket commit. The engines are tested beside
// themselves; this pins the wiring and, above all, that Apply re-plans from the
// LIVE buckets and refuses rather than writes when the bucket changed under an
// open preview (Review Focus 5).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { ActionGuidesProvider } from "./action-guides-context";
import type { OperatingGuide } from "./operating-guide";
import { useBudgetBuckets } from "./use-budget-buckets";
import { defaultSettings, type Settings } from "./settings-types";
import type { BudgetBucket, Resource, ResourcePlan, Role } from "./types";
import { AiHttpError } from "./ai-errors";
import { MAX_ATTACHMENT_BYTES } from "./chat-attachments";
import { buildZip } from "./zip";
import { forecastImportErrorOf, useForecastImport, wideMappingFor, type ForecastImportDeps } from "./use-forecast-import";

vi.mock("./use-settings", () => ({ useSettings: vi.fn() }));
import { useSettings } from "./use-settings";
const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>;

// A pass-through spy: every test runs the real detection, and one counts it.
vi.mock("./budget-import/layout-detect", async (importOriginal) => {
  const real = await importOriginal<typeof import("./budget-import/layout-detect")>();
  return { ...real, detectLayout: vi.fn(real.detectLayout) };
});
import { detectLayout } from "./budget-import/layout-detect";

const AI_ON: Settings = { ...defaultSettings, ai: { ...defaultSettings.ai, enabled: true, apiKey: "sk-ant-test", model: "claude-x" } };
const AI_OFF: Settings = { ...defaultSettings, ai: { ...defaultSettings.ai, enabled: false, apiKey: "" } };

function stubSettings(settings: Settings): void {
  mockUseSettings.mockReturnValue({ settings, setSettings: vi.fn(), hydrated: true, i18nReady: true, lang: "en-US" });
}

const ROLE: Role = { id: 10, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 };
const ANN: Resource = { id: 1, firstName: "Ann", lastName: "Lee", roleId: ROLE.id, utilizationMode: "percent", utilization: {} };
const BOB: Resource = { id: 2, firstName: "Bob", lastName: "Ray", roleId: ROLE.id, utilizationMode: "percent", utilization: {} };
const PLAN: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" };
const BUCKET: BudgetBucket = {
  id: 1, name: "Build", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-03-31",
  status: "open", allocations: [],
};
const OTHER: BudgetBucket = { ...BUCKET, id: 2, name: "Run" };

const WIDE_CSV = "Name,Jan 2026,Feb 2026,Mar 2026\r\nAnn Lee,10,20,30\r\n";

function depsOf(over: Partial<ForecastImportDeps> = {}): ForecastImportDeps {
  return {
    bucket: BUCKET,
    buckets: [BUCKET, OTHER],
    resources: [ANN, BOB],
    roles: [ROLE],
    plan: PLAN,
    holidaySet: new Set<string>(),
    onChangeBuckets: vi.fn(),
    ...over,
  };
}

function csvFile(text: string, name = "forecast.csv"): File {
  return new File([text], name, { type: "text/csv" });
}

async function loaded(deps: ForecastImportDeps, text = WIDE_CSV) {
  const hook = renderHook((d: ForecastImportDeps) => useForecastImport(d), { initialProps: deps });
  await act(async () => {
    await hook.result.current.loadFile(csvFile(text));
  });
  return hook;
}

function claudeResponds(input: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ content: [{ type: "tool_use", name: "propose_forecast_rows", input }] }),
  } as unknown as Response);
}

beforeEach(() => stubSettings(AI_ON));
afterEach(() => vi.restoreAllMocks());

describe("useForecastImport — the hand route", () => {
  it("loads a wide csv straight to the preview with the detected mapping", async () => {
    const { result } = await loaded(depsOf());
    expect(result.current.error).toBeNull();
    expect(result.current.step).toBe("preview");
    expect(result.current.route).toBe("hand");
    expect(result.current.sheets).toHaveLength(1);
    expect(result.current.mapping).toMatchObject({ layout: "wide", headerRow: 0, person: 0, periodCols: [1, 2, 3] });
    expect(result.current.importPlan?.changes.map((c) => [c.period, c.next])).toEqual([
      ["2026-01", 10], ["2026-02", 20], ["2026-03", 30],
    ]);
    expect(result.current.importPlan?.blockers).toEqual([]);
  });

  it("detects the layout of a one-sheet file once per load", async () => {
    vi.mocked(detectLayout).mockClear();
    await loaded(depsOf());
    expect(detectLayout).toHaveBeenCalledTimes(1);
  });

  it("opens the mapping step on the default columns when no layout is found", async () => {
    const { result } = await loaded(depsOf(), "just,some\r\nwords,here\r\n");
    expect(result.current.step).toBe("mapping");
    expect(result.current.layoutDetected).toBe(false);
    expect(result.current.mapping).toEqual(wideMappingFor(result.current.sheets[0].rows, 0, { person: 0 }, 2026));
    expect(result.current.importPlan).toBeNull();
  });

  it("the sample reads the default columns from the start, before any control is touched", async () => {
    // One period header is too few for detection, but the default wide
    // mapping (header row 1, person column A) reads it.
    const { result } = await loaded(depsOf(), "Name,Jan 2026,Notes\r\nAnn Lee,5,x\r\n");
    expect(result.current.layoutDetected).toBe(false);
    expect(result.current.step).toBe("mapping");
    expect(result.current.sample).toEqual([{ person: "Ann Lee", period: "2026-01", hours: 5, source: "forecast!B2" }]);
  });

  it("refuses a file over the attachment cap before reading a byte", async () => {
    const file = csvFile(WIDE_CSV);
    Object.defineProperty(file, "size", { value: MAX_ATTACHMENT_BYTES + 1 });
    const read = vi.spyOn(file, "arrayBuffer");
    const { result } = renderHook(() => useForecastImport(depsOf()));
    await act(async () => {
      await result.current.loadFile(file);
    });
    expect(read).not.toHaveBeenCalled();
    // The limit is interpolated from MAX_ATTACHMENT_BYTES, not hard-coded in the string.
    expect(result.current.error).toEqual({ key: "forecastImportErrorFileTooLarge", args: [String(MAX_ATTACHMENT_BYTES / (1024 * 1024))] });
    expect(result.current.step).toBe("source");
  });

  it("names an unsupported file type", async () => {
    const { result } = renderHook(() => useForecastImport(depsOf()));
    await act(async () => {
      await result.current.loadFile(csvFile(WIDE_CSV, "old.xls"));
    });
    expect(result.current.error).toEqual({ key: "forecastImportErrorUnsupported" });
    expect(result.current.sheets).toEqual([]);
  });

  it("names a damaged workbook as unreadable", async () => {
    const { result } = renderHook(() => useForecastImport(depsOf()));
    await act(async () => {
      await result.current.loadFile(csvFile("not a zip", "broken.xlsx"));
    });
    expect(result.current.error).toEqual({ key: "forecastImportErrorUnreadable" });
  });

  it("reads a workbook's stored numbers with a dot, end to end", async () => {
    const str = (ref: string, text: string) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
    const num = (ref: string, value: string) => `<c r="${ref}"><v>${value}</v></c>`;
    const sheetXml = "<worksheet><sheetData>"
      + `<row r="1">${str("A1", "Name")}${str("B1", "Jan 2026")}${str("C1", "Feb 2026")}${str("D1", "Mar 2026")}</row>`
      + `<row r="2">${str("A2", "Ann Lee")}${num("B2", "7.5")}${num("C2", "2.625")}${num("D2", "40")}</row>`
      + "</sheetData></worksheet>";
    const blob = buildZip([
      { path: "xl/workbook.xml", data: `<workbook><sheets><sheet name="Plan" sheetId="1" r:id="rId1"/></sheets></workbook>` },
      { path: "xl/_rels/workbook.xml.rels", data: `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>` },
      { path: "xl/worksheets/sheet1.xml", data: sheetXml },
    ]);
    const file = new File([await blob.arrayBuffer()], "plan.xlsx");
    const { result } = renderHook(() => useForecastImport(depsOf()));
    await act(async () => {
      await result.current.loadFile(file);
    });
    expect(result.current.step).toBe("preview");
    expect(result.current.importPlan?.changes.map((c) => c.next)).toEqual([7.5, 2.63, 40]);
  });

  it("an override settles an unmatched person, and the picker list stays put", async () => {
    const { result } = await loaded(depsOf(), "Name,Jan 2026,Feb 2026,Mar 2026\r\nRobert Ray,5,5,5\r\n");
    expect(result.current.unresolvedPeople.map((p) => p.person)).toEqual(["Robert Ray"]);
    expect(result.current.importPlan?.changes).toEqual([]);
    act(() => result.current.setOverride("Robert Ray", BOB.id));
    expect(result.current.importPlan?.changes).toHaveLength(3);
    // Settled, but still listed: the picker must not vanish under the user.
    expect(result.current.unresolvedPeople.map((p) => p.person)).toEqual(["Robert Ray"]);
    act(() => result.current.setOverride("Robert Ray", "skip"));
    expect(result.current.importPlan?.skipped).toEqual(["Robert Ray"]);
    expect(result.current.importPlan?.changes).toEqual([]);
  });

  it("reads year-less month headers in the target bucket's start year", async () => {
    const { result } = await loaded(depsOf(), "Name,Jan,Feb,Mär\r\nAnn Lee,10,20,30\r\n");
    expect(result.current.step).toBe("preview");
    expect(result.current.mapping?.year).toBe(2026);
    expect(result.current.importPlan?.changes.map((c) => c.period)).toEqual(["2026-01", "2026-02", "2026-03"]);
    // Another year moves every period, here out of the bucket.
    act(() => result.current.showPreview(wideMappingFor(result.current.sheets[0].rows, 0, { person: 0 }, 2025)));
    expect(result.current.importPlan?.changes).toEqual([]);
    expect(result.current.importPlan?.outOfRange).toHaveLength(3);
  });

  it("reports a numeric column whose header is not a period", async () => {
    const { result } = await loaded(depsOf(), "Name,Jan 2026,Foo,Feb 2026,Mar 2026\r\nAnn Lee,1,2,3,4\r\n");
    expect(result.current.ignoredColumns).toEqual([{ col: 2, header: "Foo" }]);
  });

  it("exposes the rows and drops of the hand route", async () => {
    const { result } = await loaded(
      depsOf(),
      "Name,Jan 2026,Feb 2026,Mar 2026\r\nAnn Lee,10,x,30\r\nTotal,10,0,30\r\nAnn Lee,800,5,5\r\n",
    );
    expect(result.current.dropped.map((d) => d.reason).sort()).toEqual(["bad-number", "total"]);
    expect(result.current.rejected.map((r) => r.reason)).toEqual(["hours"]);
    expect(result.current.sample.length).toBeGreaterThan(0);
  });
});

describe("useForecastImport — moving between steps", () => {
  it("the mapping step: a hand mapping previews, and Edit columns returns to it", async () => {
    const { result } = await loaded(depsOf(), "just,some\r\nwords,here\r\n");
    const grid = result.current.sheets[0].rows;
    act(() => result.current.setMapping(wideMappingFor(grid, 0, { person: 0 })));
    expect(result.current.mapping).toMatchObject({ layout: "wide", periodCols: [] });
    act(() => result.current.showPreview({ layout: "long", headerRow: 0, person: 0, period: 1, hours: 1 }));
    expect(result.current.step).toBe("preview");
    expect(result.current.mapping?.layout).toBe("long");
    act(() => result.current.editMapping());
    expect(result.current.step).toBe("mapping");
    expect(result.current.route).toBe("hand");
  });

  it("Detect columns returns from the Claude route to the detected columns", async () => {
    claudeResponds({ rows: [{ person: "Ann Lee", period: "Jan 2026", hours: 10, source: "forecast!B2" }], notes: "n" });
    const { result } = await loaded(depsOf());
    await act(async () => {
      await result.current.askClaude();
    });
    expect(result.current.route).toBe("claude");
    act(() => result.current.detectColumns());
    expect(result.current.route).toBe("hand");
    expect(result.current.notes).toBe("");
    expect(result.current.importPlan?.changes).toHaveLength(3);
  });

  it("selectSheet ignores a sheet that does not exist and re-reads one that does", async () => {
    const { result } = await loaded(depsOf());
    act(() => result.current.editMapping());
    act(() => result.current.selectSheet(5));
    expect(result.current.step).toBe("mapping");
    act(() => result.current.selectSheet(0));
    expect(result.current.sheetIndex).toBe(0);
    expect(result.current.step).toBe("preview");
  });

  it("a newer file supersedes a slower read of an older one", async () => {
    let release: (b: ArrayBuffer) => void = () => {};
    const slow = csvFile("Name,Jan 2026,Feb 2026,Mar 2026\r\nBob Ray,1,1,1\r\n", "slow.csv");
    const slowBytes = await slow.arrayBuffer();
    vi.spyOn(slow, "arrayBuffer").mockReturnValue(new Promise<ArrayBuffer>((resolve) => { release = resolve; }));
    const { result } = renderHook(() => useForecastImport(depsOf()));
    let first: Promise<void> | undefined;
    act(() => {
      first = result.current.loadFile(slow);
    });
    await act(async () => {
      await result.current.loadFile(csvFile(WIDE_CSV));
    });
    await act(async () => {
      release(slowBytes);
      await first;
    });
    expect(result.current.sheets[0].name).toBe("forecast");
    expect(result.current.busy).toBe(false);
  });

  it("editing the mapping, previewing, or picking a person clears a stale error", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const header = ["Name", "Jan 2026", "Feb 2026", "Mar 2026"].join(",");
    const lines = Array.from({ length: 5100 }, (_, i) => `P${i},1,2,3`);
    const { result } = await loaded(depsOf(), [header, ...lines].join("\r\n"));
    const tooLarge = { key: "forecastImportErrorTooLargeForClaude" };
    const failClaude = async () => {
      await act(async () => {
        await result.current.askClaude();
      });
      expect(result.current.error).toEqual(tooLarge);
    };
    await failClaude();
    act(() => result.current.editMapping());
    expect(result.current.error).toBeNull();
    await failClaude();
    act(() => result.current.showPreview());
    expect(result.current.error).toBeNull();
    await failClaude();
    act(() => result.current.setOverride("P1", "skip"));
    expect(result.current.error).toBeNull();
    await failClaude();
    act(() => result.current.setMapping(result.current.mapping));
    expect(result.current.error).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports a target bucket that vanished from the live list", async () => {
    const deps = depsOf();
    const hook = await loaded(deps);
    expect(hook.result.current.bucketGone).toBe(false);
    hook.rerender({ ...deps, buckets: [OTHER] });
    expect(hook.result.current.bucketGone).toBe(true);
    expect(hook.result.current.importPlan).toBeNull();
  });
});

describe("useForecastImport — apply", () => {
  // §500 fix wave 2 (CR minor 11): one apply is ONE undo step, and undoing it
  // restores the bucket — driven through the real commitBuckets, whose
  // captured field patch is what the undo stack replays.
  it("undoing an apply restores the bucket", async () => {
    const captureComposite = vi.fn();
    const noop = vi.fn();
    const hook = renderHook(() => {
      const [budgets, setBudgets] = useState<readonly BudgetBucket[]>([BUCKET, OTHER]);
      const { commitBuckets } = useBudgetBuckets({ budgets, setBudgets, allowDestructiveSave: noop, capture: noop, captureComposite, logActivity: noop });
      return { budgets, fi: useForecastImport(depsOf({ buckets: budgets, onChangeBuckets: commitBuckets })) };
    });
    await act(async () => {
      await hook.result.current.fi.loadFile(csvFile(WIDE_CSV));
    });
    act(() => {
      expect(hook.result.current.fi.apply()).toBe("applied");
    });
    expect(hook.result.current.budgets[0].allocations).toHaveLength(1);
    expect(captureComposite).toHaveBeenCalledTimes(1);
    const [, editPart] = captureComposite.mock.calls[0][0].parts;
    act(() => editPart.restore({ current: new Map() }, true));
    expect(hook.result.current.budgets[0]).toEqual(BUCKET);
    expect(hook.result.current.budgets[1]).toBe(OTHER);
  });

  it("commits ONE budget.updated change to the target bucket only", async () => {
    const deps = depsOf();
    const { result } = await loaded(deps);
    let outcome: string | undefined;
    act(() => {
      outcome = result.current.apply();
    });
    expect(outcome).toBe("applied");
    expect(deps.onChangeBuckets).toHaveBeenCalledTimes(1);
    const [next, meta] = (deps.onChangeBuckets as ReturnType<typeof vi.fn>).mock.calls[0] as [BudgetBucket[], unknown];
    expect(meta).toEqual({ kind: "budget.updated", name: "Build" });
    expect(next[1]).toBe(OTHER);
    expect(next[0].localModifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(next[0].allocations).toEqual([
      { roleId: ROLE.id, resourceIds: [ANN.id], budgetHours: { "2026-01": 10, "2026-02": 20, "2026-03": 30 }, actualHours: {} },
    ]);
  });

  it("re-plans from the live bucket, not the one the modal opened with", async () => {
    const deps = depsOf();
    const hook = await loaded(deps);
    const live: BudgetBucket = {
      ...BUCKET,
      allocations: [{ roleId: ROLE.id, resourceIds: [ANN.id], budgetHours: { "2026-01": 10, "2026-02": 99 }, actualHours: { "2026-01": 4 } }],
    };
    hook.rerender({ ...deps, buckets: [live, OTHER] });
    act(() => {
      hook.result.current.apply();
    });
    const [next] = (deps.onChangeBuckets as ReturnType<typeof vi.fn>).mock.calls[0] as [BudgetBucket[]];
    expect(next[0].allocations[0].actualHours).toEqual({ "2026-01": 4 });
    expect(next[0].allocations[0].budgetHours).toEqual({ "2026-01": 10, "2026-02": 20, "2026-03": 30 });
  });

  // Applying the plan the preview opened with onto the live bucket keeps the
  // live actuals and stored cells, so only a change to what the bucket OWNS can
  // tell a re-plan from a stale plan: the March cell the open-time plan carries
  // would land outside the shortened bucket, where no screen shows it.
  it("re-plans the bucket's periods: a cell the live bucket no longer owns is not written", async () => {
    const deps = depsOf();
    const hook = await loaded(deps);
    expect(hook.result.current.importPlan?.changes.map((c) => c.period)).toEqual(["2026-01", "2026-02", "2026-03"]);
    hook.rerender({ ...deps, buckets: [{ ...BUCKET, endDate: "2026-02-28" }, OTHER] });
    act(() => {
      hook.result.current.apply();
    });
    const [next] = (deps.onChangeBuckets as ReturnType<typeof vi.fn>).mock.calls[0] as [BudgetBucket[]];
    expect(next[0].allocations[0].budgetHours).toEqual({ "2026-01": 10, "2026-02": 20 });
  });

  it.each([
    ["closed", (d: ForecastImportDeps) => ({ ...d, buckets: [{ ...BUCKET, status: "closed" as const }, OTHER] })],
    ["follows plan", (d: ForecastImportDeps) => ({ ...d, plan: { ...PLAN, budgetFollowsPlan: true } })],
    ["deleted", (d: ForecastImportDeps) => ({ ...d, buckets: [OTHER] })],
  ])("refuses and writes nothing when the bucket is %s after the preview opened", async (_label, change) => {
    const deps = depsOf();
    const hook = await loaded(deps);
    expect(hook.result.current.importPlan?.blockers).toEqual([]);
    hook.rerender(change(deps));
    let outcome: string | undefined;
    act(() => {
      outcome = hook.result.current.apply();
    });
    expect(outcome).toBe("refused");
    expect(deps.onChangeBuckets).not.toHaveBeenCalled();
    expect(hook.result.current.error).toEqual({ key: "forecastImportRefused" });
  });

  it("refuses outside the preview step", async () => {
    const deps = depsOf();
    const { result } = await loaded(deps);
    expect(result.current.importPlan?.blockers).toEqual([]);
    act(() => result.current.editMapping());
    let outcome: string | undefined;
    act(() => {
      outcome = result.current.apply();
    });
    expect(outcome).toBe("refused");
    expect(deps.onChangeBuckets).not.toHaveBeenCalled();
  });

  it("refuses a plan with nothing to apply", async () => {
    const deps = depsOf({
      buckets: [{ ...BUCKET, allocations: [{ roleId: ROLE.id, resourceIds: [ANN.id], budgetHours: { "2026-01": 10, "2026-02": 20, "2026-03": 30 }, actualHours: {} }] }, OTHER],
    });
    const { result } = await loaded(deps);
    expect(result.current.importPlan?.blockers).toEqual(["nothing-to-apply"]);
    let outcome: string | undefined;
    act(() => {
      outcome = result.current.apply();
    });
    expect(outcome).toBe("refused");
    expect(deps.onChangeBuckets).not.toHaveBeenCalled();
    // Final review M3: the refusal names its cause, not "the bucket changed".
    expect(result.current.error).toEqual({ key: "forecastImportRefusedNothing" });
  });

  it("names nothing-to-apply when someone else applied the same hours while the preview was open", async () => {
    const deps = depsOf();
    const hook = await loaded(deps);
    expect(hook.result.current.importPlan?.blockers).toEqual([]);
    const applied: BudgetBucket = {
      ...BUCKET,
      allocations: [{ roleId: ROLE.id, resourceIds: [ANN.id], budgetHours: { "2026-01": 10, "2026-02": 20, "2026-03": 30 }, actualHours: {} }],
    };
    hook.rerender({ ...deps, buckets: [applied, OTHER] });
    let outcome: string | undefined;
    act(() => {
      outcome = hook.result.current.apply();
    });
    expect(outcome).toBe("refused");
    expect(deps.onChangeBuckets).not.toHaveBeenCalled();
    expect(hook.result.current.error).toEqual({ key: "forecastImportRefusedNothing" });
    expect(hook.result.current.error).not.toEqual({ key: "forecastImportRefused" });
  });

  it("refuses while two cells of one sheet row land on the same person and period", async () => {
    const deps = depsOf();
    const { result } = await loaded(deps, "Name,Jan 2026,Jan 2026,Feb 2026\r\nAnn Lee,10,20,5\r\n");
    expect(result.current.collisions).toEqual([
      { person: "Ann Lee", period: "2026-01", sources: ["forecast!B2", "forecast!C2"] },
    ]);
    expect(result.current.importPlan?.blockers).toEqual(["same-row-period"]);
    let outcome: string | undefined;
    act(() => {
      outcome = result.current.apply();
    });
    expect(outcome).toBe("refused");
    expect(deps.onChangeBuckets).not.toHaveBeenCalled();
    expect(result.current.error).toEqual({ key: "forecastImportRefusedSameRow" });
  });

  it("keeps the bucket-changed message when the bucket also closed: closed outranks nothing-to-apply", async () => {
    const deps = depsOf();
    const hook = await loaded(deps);
    const closedApplied: BudgetBucket = {
      ...BUCKET,
      status: "closed",
      allocations: [{ roleId: ROLE.id, resourceIds: [ANN.id], budgetHours: { "2026-01": 10, "2026-02": 20, "2026-03": 30 }, actualHours: {} }],
    };
    hook.rerender({ ...deps, buckets: [closedApplied, OTHER] });
    act(() => {
      hook.result.current.apply();
    });
    expect(hook.result.current.error).toEqual({ key: "forecastImportRefused" });
  });
});

describe("useForecastImport — the Claude route", () => {
  // §500 fix wave 2 (CR minor 11): the forecastImport guides reach the request.
  it("sends the operating guides that target the forecast import", async () => {
    const guide: OperatingGuide = {
      id: "g", name: "Forecast rules", content: "Hours are per month, never per week.", enabled: true, priority: 1,
      scope: { targets: ["forecastImport"] }, builtIn: false,
    };
    // A plain function component (no hooks), called directly: this file is .ts, not .tsx.
    const wrapper = ({ children }: { children: ReactNode }) =>
      ActionGuidesProvider({ value: { guides: [guide], groundInGuides: true, ready: true }, children });
    const fetchSpy = claudeResponds({ rows: [] });
    const hook = renderHook((d: ForecastImportDeps) => useForecastImport(d), { initialProps: depsOf(), wrapper });
    await act(async () => {
      await hook.result.current.loadFile(csvFile(WIDE_CSV));
    });
    await act(async () => {
      await hook.result.current.askClaude();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][1]?.body)).toContain("Hours are per month, never per week.");
  });

  // §500 fix wave 2 (CR I4): a reply that skips rows no longer looks complete.
  it("lists the cells a reply did not read, and nothing on the hand route", async () => {
    claudeResponds({
      rows: [
        { person: "Ann Lee", period: "Jan 2026", hours: 10, source: "forecast!B2" },
        { person: "Ann Lee", period: "Feb 2026", hours: 20, source: "forecast!C2" },
      ],
    });
    const { result } = await loaded(depsOf());
    expect(result.current.unread).toEqual({ cells: [], rows: [] });
    await act(async () => {
      await result.current.askClaude();
    });
    expect(result.current.unread).toEqual({ cells: ["forecast!D2"], rows: [] });
  });

  it("validates Claude's rows with sources required: a source-less row is rejected", async () => {
    const fetchSpy = claudeResponds({
      rows: [
        { person: "Ann Lee", period: "Jan 2026", hours: 10, source: "forecast!B2" },
        { person: "Ann Lee", period: "Feb 2026", hours: 20 },
      ],
      notes: "Skipped the Mar column.",
    });
    const { result } = await loaded(depsOf());
    await act(async () => {
      await result.current.askClaude();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
    expect(result.current.route).toBe("claude");
    expect(result.current.step).toBe("preview");
    expect(result.current.importPlan?.changes.map((c) => c.period)).toEqual(["2026-01"]);
    expect(result.current.rejected).toHaveLength(1);
    expect(result.current.rejected[0].reason).toBe("source");
    expect(result.current.notes).toBe("Skipped the Mar column.");
  });

  it("reads a Claude row under a year-less header in the bucket's start year", async () => {
    claudeResponds({ rows: [{ person: "Ann Lee", period: "Jan", hours: 10, source: "forecast!B2" }] });
    const { result } = await loaded(depsOf(), "Name,Jan,Feb,Mar\r\nAnn Lee,10,20,30\r\n");
    await act(async () => {
      await result.current.askClaude();
    });
    expect(result.current.rejected).toEqual([]);
    expect(result.current.importPlan?.changes.map((c) => [c.period, c.next])).toEqual([["2026-01", 10]]);
    expect(result.current.assumedYear).toEqual({ year: 2026, rolled: false });
  });

  // §500 fix wave 2 (CR minor 9): ONE year value feeds detection, the hand
  // route and the Claude validator — a cleared year field means "no default
  // year" on both routes.
  it("a cleared year field reads no year-less header on either route", async () => {
    claudeResponds({ rows: [{ person: "Ann Lee", period: "Jan", hours: 10, source: "forecast!B2" }] });
    const { result } = await loaded(depsOf(), "Name,Jan,Feb,Mar\r\nAnn Lee,10,20,30\r\n");
    expect(result.current.assumedYear).toEqual({ year: 2026, rolled: false });
    act(() => result.current.setMapping(wideMappingFor(result.current.sheets[0].rows, 0, { person: 0 }, undefined)));
    expect(result.current.sample).toEqual([]);
    await act(async () => {
      await result.current.askClaude();
    });
    expect(result.current.rejected.map((r) => r.reason)).toEqual(["period"]);
    expect(result.current.assumedYear).toBeUndefined();
    act(() => result.current.detectColumns());
    expect(result.current.layoutDetected).toBe(false);
    expect(result.current.mapping?.year).toBeUndefined();
  });

  // Reviewer probe (§500 final review): an email the model put on Ann's row
  // matched Bob first and sent Ann's hours to him.
  it("never lets a model-supplied email re-route a row's hours to another resource", async () => {
    claudeResponds({ rows: [{ person: "Ann Lee", email: "bob@corp", period: "Jan 2026", hours: 10, source: "forecast!B2" }] });
    const bob: Resource = { ...BOB, email: "bob@corp" };
    const { result } = await loaded(depsOf({ resources: [ANN, bob] }));
    await act(async () => {
      await result.current.askClaude();
    });
    expect(result.current.rejected).toEqual([]);
    expect(result.current.importPlan?.addResources).toEqual([{ alloc: { kind: "role", roleId: ROLE.id }, resourceIds: [ANN.id] }]);
  });

  it("refuses a reply cut off at the output budget with the too-large message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        stop_reason: "max_tokens",
        content: [{ type: "tool_use", name: "propose_forecast_rows", input: { rows: [] } }],
      }),
    } as unknown as Response);
    const { result } = await loaded(depsOf());
    await act(async () => {
      await result.current.askClaude();
    });
    expect(result.current.error).toEqual({ key: "forecastImportErrorTooLargeForClaude" });
    expect(result.current.route).toBe("hand");
  });

  it("does nothing when AI is off", async () => {
    stubSettings(AI_OFF);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { result } = await loaded(depsOf());
    expect(result.current.aiAvailable).toBe(false);
    await act(async () => {
      await result.current.askClaude();
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.route).toBe("hand");
  });

  it("maps an oversized sheet to the too-large message without a request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const header = ["Name", "Jan 2026", "Feb 2026", "Mar 2026"].join(",");
    const lines = Array.from({ length: 5100 }, (_, i) => `P${i},1,2,3`);
    const { result } = await loaded(depsOf(), [header, ...lines].join("\r\n"));
    await act(async () => {
      await result.current.askClaude();
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.error).toEqual({ key: "forecastImportErrorTooLargeForClaude" });
    expect(result.current.busy).toBe(false);
  });

  it("cancel aborts the in-flight call and sets no error", async () => {
    let seenSignal: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      seenSignal = (init as RequestInit).signal ?? undefined;
      return new Promise((_resolve, reject) => {
        seenSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    const { result } = await loaded(depsOf());
    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.current.askClaude();
    });
    expect(result.current.busy).toBe(true);
    await act(async () => {
      result.current.cancel();
      await pending;
    });
    expect(seenSignal?.aborted).toBe(true);
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.route).toBe("hand");
  });
});

describe("forecastImportErrorOf", () => {
  it("maps each failure to its message, and an abort to none", () => {
    expect(forecastImportErrorOf(new Error("too-large"))).toEqual({ key: "forecastImportErrorTooLargeForClaude" });
    expect(forecastImportErrorOf(new AiHttpError(429))).toEqual({ key: "aiUsageLimitReached" });
    expect(forecastImportErrorOf(new AiHttpError(401))).toEqual({ key: "aiKeyRejected" });
    expect(forecastImportErrorOf(new AiHttpError(500, "api_error", "Overloaded"))).toEqual({ message: "Overloaded" });
    expect(forecastImportErrorOf(new Error("parse"))).toEqual({ key: "forecastImportErrorAi" });
    expect(forecastImportErrorOf(new DOMException("Aborted", "AbortError"))).toBeNull();
  });
});

describe("wideMappingFor", () => {
  it("takes every period header except the person, email and rate columns", () => {
    const rows = [["Name", "Mail", "Jan 2026", "Total", "Feb 2026"], ["Ann", "a@x", "1", "3", "2"]];
    expect(wideMappingFor(rows, 0, { person: 0, email: 1 })).toEqual({
      layout: "wide", headerRow: 0, person: 0, email: 1, periodCols: [2, 4],
    });
  });

  it("reads year-less headers in the given year and keeps that year on the mapping", () => {
    const rows = [["Name", "Jan", "Feb"], ["Ann", "1", "2"]];
    expect(wideMappingFor(rows, 0, { person: 0 })).toEqual({ layout: "wide", headerRow: 0, person: 0, periodCols: [] });
    expect(wideMappingFor(rows, 0, { person: 0 }, 2026)).toEqual({
      layout: "wide", headerRow: 0, person: 0, periodCols: [1, 2], year: 2026,
    });
  });
});

// Fix 7 (owner decision 2026-10-13): when detection cannot tell which column
// holds the hours or the period, the import opens on the mapping step and Apply
// waits for the user to confirm — by choosing that field's column, or by
// "These columns are right". Re-detecting asks again.
describe("useForecastImport — ambiguous columns are confirmed before Apply (fix 7)", () => {
  const PLAN_IST = "Name,Monat,Plan,Ist\r\nAnn Lee,Jan 2026,40,35\r\nAnn Lee,Feb 2026,30,25\r\n";
  const DATUM_EINTRITT = "Name,Datum,Eintritt,Stunden\r\nAnn Lee,01.01.2026,03/2026,40\r\nAnn Lee,01.02.2026,03/2026,30\r\n";
  const hoursWritten = (deps: ForecastImportDeps) => {
    const [next] = (deps.onChangeBuckets as ReturnType<typeof vi.fn>).mock.calls[0] as [BudgetBucket[]];
    return next[0].allocations[0].budgetHours;
  };
  const applyNow = (result: { current: ReturnType<typeof useForecastImport> }) => {
    let outcome: string | undefined;
    act(() => {
      outcome = result.current.apply();
    });
    return outcome;
  };

  it("opens Plan | Ist on the mapping step, naming the hours candidates", async () => {
    const { result } = await loaded(depsOf(), PLAN_IST);
    expect(result.current.step).toBe("mapping");
    expect(result.current.layoutDetected).toBe(true);
    expect(result.current.ambiguous).toEqual([{ field: "hours", candidates: [2, 3] }]);
    expect(result.current.mapping).toMatchObject({ layout: "long", period: 1, hours: 2 });
  });

  it("refuses Apply in the preview until the columns are confirmed, then writes the confirmed hours", async () => {
    const deps = depsOf();
    const { result } = await loaded(deps, PLAN_IST);
    act(() => result.current.showPreview());
    expect(result.current.step).toBe("preview");
    expect(applyNow(result)).toBe("refused");
    expect(result.current.error).toEqual({ key: "forecastImportConfirmFirst" });
    expect(deps.onChangeBuckets).not.toHaveBeenCalled();
    act(() => result.current.confirmColumns());
    expect(result.current.ambiguous).toEqual([]);
    expect(applyNow(result)).toBe("applied");
    expect(hoursWritten(deps)).toEqual({ "2026-01": 40, "2026-02": 30 });
  });

  it("choosing the hours column confirms it: Ist chosen, Ist written", async () => {
    const deps = depsOf();
    const { result } = await loaded(deps, PLAN_IST);
    act(() => result.current.setMapping({ ...result.current.mapping!, hours: 3 }));
    expect(result.current.ambiguous).toEqual([]);
    act(() => result.current.showPreview());
    expect(applyNow(result)).toBe("applied");
    expect(hoursWritten(deps)).toEqual({ "2026-01": 35, "2026-02": 25 });
  });

  it("choosing another column and back to Plan confirms Plan", async () => {
    const deps = depsOf();
    const { result } = await loaded(deps, PLAN_IST);
    act(() => result.current.setMapping({ ...result.current.mapping!, hours: 3 }));
    act(() => result.current.setMapping({ ...result.current.mapping!, hours: 2 }));
    act(() => result.current.showPreview());
    expect(applyNow(result)).toBe("applied");
    expect(hoursWritten(deps)).toEqual({ "2026-01": 40, "2026-02": 30 });
  });

  it("an edit of another field does not confirm the hours column", async () => {
    const deps = depsOf();
    const { result } = await loaded(deps, PLAN_IST);
    act(() => result.current.setMapping({ ...result.current.mapping!, year: 2027 }));
    act(() => result.current.setMapping({ ...result.current.mapping!, period: 1 }));
    expect(result.current.ambiguous).toEqual([{ field: "hours", candidates: [2, 3] }]);
    act(() => result.current.showPreview());
    expect(applyNow(result)).toBe("refused");
    expect(deps.onChangeBuckets).not.toHaveBeenCalled();
  });

  it("asks for the period of Datum | Eintritt, and choosing it confirms", async () => {
    const deps = depsOf();
    const { result } = await loaded(deps, DATUM_EINTRITT);
    expect(result.current.step).toBe("mapping");
    expect(result.current.ambiguous).toEqual([{ field: "period", candidates: [1, 2] }]);
    act(() => result.current.showPreview());
    expect(applyNow(result)).toBe("refused");
    act(() => result.current.setMapping({ ...result.current.mapping!, period: 2 }));
    act(() => result.current.setMapping({ ...result.current.mapping!, period: 1 }));
    act(() => result.current.showPreview());
    expect(applyNow(result)).toBe("applied");
    expect(hoursWritten(deps)).toEqual({ "2026-01": 40, "2026-02": 30 });
  });

  it("re-detecting asks again", async () => {
    const { result } = await loaded(depsOf(), PLAN_IST);
    act(() => result.current.confirmColumns());
    expect(result.current.ambiguous).toEqual([]);
    act(() => result.current.detectColumns());
    expect(result.current.step).toBe("mapping");
    expect(result.current.ambiguous).toEqual([{ field: "hours", candidates: [2, 3] }]);
  });

  it("a clear sheet goes straight to the preview with nothing to confirm", async () => {
    const { result } = await loaded(depsOf(), "Name,Monat,Stunden\r\nAnn Lee,Jan 2026,40\r\n");
    expect(result.current.step).toBe("preview");
    expect(result.current.ambiguous).toEqual([]);
  });

  it("leaves the Claude route ungated", async () => {
    claudeResponds({ rows: [{ person: "Ann Lee", period: "Jan 2026", hours: 40, source: "forecast!C2" }] });
    const deps = depsOf();
    const { result } = await loaded(deps, PLAN_IST);
    await act(async () => {
      await result.current.askClaude();
    });
    expect(result.current.route).toBe("claude");
    expect(result.current.ambiguous).toEqual([]);
    expect(applyNow(result)).toBe("applied");
    expect(hoursWritten(deps)).toEqual({ "2026-01": 40 });
  });

  it("back on the hand route after Claude, the columns still wait for confirmation", async () => {
    claudeResponds({ rows: [{ person: "Ann Lee", period: "Jan 2026", hours: 40, source: "forecast!C2" }] });
    const deps = depsOf();
    const { result } = await loaded(deps, PLAN_IST);
    await act(async () => {
      await result.current.askClaude();
    });
    act(() => result.current.editMapping());
    act(() => result.current.showPreview());
    expect(result.current.ambiguous).toEqual([{ field: "hours", candidates: [2, 3] }]);
    expect(applyNow(result)).toBe("refused");
  });
});
