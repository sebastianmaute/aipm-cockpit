// §500 — the forecast import's state machine: file → sheet grid → rows →
// validated → plan → ONE bucket commit. The engines are tested beside
// themselves; this pins the wiring and, above all, that Apply re-plans from the
// LIVE buckets and refuses rather than writes when the bucket changed under an
// open preview (Review Focus 5).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Rendered without task-manager's AI privacy provider: requests carry the privacy of no project.
vi.mock("./ai-privacy-context", () => import("../test/ai-privacy-unprotected"));
import "../test/ai-consent-live";
import { newConsent } from "./ai-consent";
import { act, renderHook } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { ActionGuidesProvider } from "./action-guides-context";
import type { OperatingGuide } from "./operating-guide";
import { useBudgetBuckets } from "./use-budget-buckets";
import { defaultSettings, type Settings } from "./settings-types";
import type { BudgetBucket, Resource, ResourcePlan, Role } from "./types";
import { AiDeploymentError, AiGatewayError, AiHttpError } from "./ai-errors";
import { MAX_ATTACHMENT_BYTES } from "./chat-attachments";
import { buildZip } from "./zip";
import { columnLetters, gridToForecastRows } from "./budget-import/forecast-rows";
import { forecastImportErrorOf, useForecastImport, wideMappingFor, type ForecastImportDeps } from "./use-forecast-import";
import { clearSessionAiKey, setSessionAiKey } from "./session-ai-key";

// §717 — the import takes the live AI settings as `deps.ai`; `stubSettings` sets what the next deps carry.
// A `useSettings()` of its own sees a passphrase-sealed key blank until it is unlocked there too, so any call fails.
vi.mock("./use-settings", () => ({ useSettings: () => { throw new Error("§717: the forecast import read its own settings instance"); } }));
let stubbedAi = defaultSettings.ai;

// A pass-through spy: every test runs the real detection, and one counts it.
vi.mock("./budget-import/layout-detect", async (importOriginal) => {
  const real = await importOriginal<typeof import("./budget-import/layout-detect")>();
  return { ...real, detectLayout: vi.fn(real.detectLayout) };
});
import { detectLayout } from "./budget-import/layout-detect";

const AI_ON: Settings = { ...defaultSettings, ai: { ...defaultSettings.ai, enabled: true, consent: newConsent(new Date(0)), apiKey: "sk-ant-test", model: "claude-x" } };
const AI_OFF: Settings = { ...defaultSettings, ai: { ...defaultSettings.ai, enabled: false, apiKey: "" } };

function stubSettings(settings: Settings): void {
  stubbedAi = settings.ai;
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
    ai: stubbedAi,
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
    json: async () => ({ content: [{ type: "tool_use", name: "propose_forecast_mapping", input }] }),
  } as unknown as Response);
}

/** WIDE_CSV's columns as Claude names them: Name in A, the months in B–D. */
const WIDE_MAPPING = { layout: "wide", headerRow: 1, person: "A", periodCols: ["B", "C", "D"] };

type Hook = { current: ReturnType<typeof useForecastImport> };

async function askClaudeNow(result: Hook): Promise<void> {
  await act(async () => {
    await result.current.askClaude();
  });
}

function applyOutcome(result: Hook): string | undefined {
  let outcome: string | undefined;
  act(() => {
    outcome = result.current.apply();
  });
  return outcome;
}

function hoursWrittenBy(deps: ForecastImportDeps) {
  const [next] = (deps.onChangeBuckets as ReturnType<typeof vi.fn>).mock.calls[0] as [BudgetBucket[]];
  return next[0].allocations[0].budgetHours;
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
    claudeResponds({ ...WIDE_MAPPING, periodCols: ["B"], notes: "n" });
    const { result } = await loaded(depsOf());
    await askClaudeNow(result);
    expect(result.current.route).toBe("claude");
    expect(result.current.mapping?.periodCols).toEqual([1]);
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

describe("useForecastImport — the target bucket (§719)", () => {
  const CLOSED: BudgetBucket = { ...BUCKET, id: 3, name: "Done", status: "closed" };
  const LAST_YEAR: BudgetBucket = { ...BUCKET, id: 4, name: "Pilot", startDate: "2025-01-01", endDate: "2025-03-31" };

  it("targets the bucket the import was opened for, and offers every open bucket but no closed one", () => {
    const { result } = renderHook(() => useForecastImport(depsOf({ buckets: [BUCKET, OTHER, CLOSED] })));
    expect(result.current.targetBucketId).toBe(BUCKET.id);
    expect(result.current.targetBuckets.map((b) => b.id)).toEqual([BUCKET.id, OTHER.id]);
  });

  it("keeps the target in the list when it closes while the import is open", () => {
    const deps = depsOf({ buckets: [BUCKET, OTHER] });
    const hook = renderHook((d: ForecastImportDeps) => useForecastImport(d), { initialProps: deps });
    hook.rerender({ ...deps, buckets: [{ ...BUCKET, status: "closed" }, OTHER] });
    expect(hook.result.current.targetBuckets.map((b) => b.id)).toEqual([BUCKET.id, OTHER.id]);
  });

  it("choosing another bucket clears an error", async () => {
    const { result } = renderHook(() => useForecastImport(depsOf()));
    await act(async () => {
      await result.current.loadFile(csvFile(WIDE_CSV, "old.xls"));
    });
    expect(result.current.error).not.toBeNull();
    act(() => result.current.selectBucket(OTHER.id));
    expect(result.current.error).toBeNull();
  });

  it("ignores a bucket that is closed or not in the list", () => {
    const { result } = renderHook(() => useForecastImport(depsOf({ buckets: [BUCKET, OTHER, CLOSED] })));
    act(() => result.current.selectBucket(CLOSED.id));
    expect(result.current.targetBucketId).toBe(BUCKET.id);
    act(() => result.current.selectBucket(99));
    expect(result.current.targetBucketId).toBe(BUCKET.id);
  });

  it("applies into the chosen bucket and leaves the one it was opened for as it was", async () => {
    const deps = depsOf();
    const { result } = await loaded(deps);
    act(() => result.current.selectBucket(OTHER.id));
    expect(result.current.importPlan?.changes).toHaveLength(3);
    expect(applyOutcome(result)).toBe("applied");
    const [next, meta] = (deps.onChangeBuckets as ReturnType<typeof vi.fn>).mock.calls[0] as [BudgetBucket[], unknown];
    expect(meta).toEqual({ kind: "budget.updated", name: "Run" });
    expect(next[0]).toBe(BUCKET);
    expect(next[1].allocations).toEqual([
      { roleId: ROLE.id, resourceIds: [ANN.id], budgetHours: { "2026-01": 10, "2026-02": 20, "2026-03": 30 }, actualHours: {} },
    ]);
  });

  it("a bucket chosen before the file sets the year that year-less headers are read in", async () => {
    const plan2025: ResourcePlan = { ...PLAN, startDate: "2025-01-01" };
    const { result } = renderHook(() => useForecastImport(depsOf({ buckets: [BUCKET, LAST_YEAR], plan: plan2025 })));
    act(() => result.current.selectBucket(LAST_YEAR.id));
    await act(async () => {
      await result.current.loadFile(csvFile("Name,Jan,Feb,Mär\r\nAnn Lee,10,20,30\r\n"));
    });
    expect(result.current.mapping?.year).toBe(2025);
    expect(result.current.importPlan?.changes.map((c) => c.period)).toEqual(["2025-01", "2025-02", "2025-03"]);
  });

  it("a bucket chosen after the file keeps the mapping's year, re-plans, and clears the per-person choices", async () => {
    const { result } = await loaded(depsOf({ buckets: [BUCKET, LAST_YEAR] }), "Name,Jan,Feb,Mär\r\nAnn Lee,10,20,30\r\nRobert Ray,5,5,5\r\n");
    act(() => result.current.setOverride("Robert Ray", BOB.id));
    // Ann and Bob share the one role line: three role × month cells.
    expect(result.current.importPlan?.changes).toHaveLength(3);
    act(() => result.current.selectBucket(LAST_YEAR.id));
    expect(result.current.mapping?.year).toBe(2026);
    expect(result.current.overrides.size).toBe(0);
    // Ann's 2026 periods fall outside the 2025 bucket: the preview is the chosen bucket's.
    expect(result.current.importPlan?.changes).toEqual([]);
    expect(result.current.importPlan?.outOfRange).toHaveLength(3);
    // Detect columns reads year-less headers in the year the mapping step shows, still 2026.
    act(() => result.current.detectColumns());
    expect(result.current.mapping?.year).toBe(2026);
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
    const fetchSpy = claudeResponds(WIDE_MAPPING);
    const hook = renderHook((d: ForecastImportDeps) => useForecastImport(d), { initialProps: depsOf(), wrapper });
    await act(async () => {
      await hook.result.current.loadFile(csvFile(WIDE_CSV));
    });
    await askClaudeNow(hook.result);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][1]?.body)).toContain("Hours are per month, never per week.");
  });

  it("opens the mapping step with Claude's mapping as the draft and its notes", async () => {
    const fetchSpy = claudeResponds({ ...WIDE_MAPPING, periodCols: ["B", "C"], notes: "Mar is a total." });
    const { result } = await loaded(depsOf());
    expect(result.current.step).toBe("preview");
    await askClaudeNow(result);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
    expect(result.current.route).toBe("claude");
    expect(result.current.step).toBe("mapping");
    expect(result.current.mapping).toEqual({ layout: "wide", headerRow: 0, person: 0, periodCols: [1, 2], year: 2026 });
    expect(result.current.notes).toBe("Mar is a total.");
    expect(result.current.claudeUnconfirmed).toBe(true);
    expect(result.current.sample.map((r) => r.period)).toEqual(["2026-01", "2026-02"]);
  });

  it("reads year-less headers in the bucket's start year when Claude names no year", async () => {
    claudeResponds({ ...WIDE_MAPPING, periodCols: ["B"] });
    const { result } = await loaded(depsOf(), "Name,Jan,Feb,Mar\r\nAnn Lee,10,20,30\r\n");
    await askClaudeNow(result);
    expect(result.current.mapping?.year).toBe(2026);
    act(() => result.current.confirmColumns());
    act(() => result.current.showPreview());
    expect(result.current.importPlan?.changes.map((c) => [c.period, c.next])).toEqual([["2026-01", 10]]);
    expect(result.current.assumedYear).toEqual({ year: 2026, rolled: false });
  });

  it("reads them in Claude's year when it names one", async () => {
    claudeResponds({ ...WIDE_MAPPING, periodCols: ["B"], year: 2027 });
    const { result } = await loaded(depsOf(), "Name,Jan,Feb,Mar\r\nAnn Lee,10,20,30\r\n");
    await askClaudeNow(result);
    expect(result.current.sample.map((r) => r.period)).toEqual(["2027-01"]);
  });

  // §500 fix wave 2 (CR minor 9): ONE year value feeds detection and the
  // mapping — a cleared year field means "no default year" on both routes.
  it("a cleared year field reads no year-less header on either route", async () => {
    claudeResponds({ ...WIDE_MAPPING, periodCols: ["B"] });
    const { result } = await loaded(depsOf(), "Name,Jan,Feb,Mar\r\nAnn Lee,10,20,30\r\n");
    expect(result.current.assumedYear).toEqual({ year: 2026, rolled: false });
    act(() => result.current.setMapping(wideMappingFor(result.current.sheets[0].rows, 0, { person: 0 }, undefined)));
    expect(result.current.sample).toEqual([]);
    await askClaudeNow(result);
    expect(result.current.mapping?.year).toBeUndefined();
    expect(result.current.sample).toEqual([]);
    expect(result.current.assumedYear).toBeUndefined();
    act(() => result.current.detectColumns());
    expect(result.current.layoutDetected).toBe(false);
    expect(result.current.mapping?.year).toBeUndefined();
  });

  it.each([
    ["a mapping it cannot use", () => claudeResponds({ ...WIDE_MAPPING, periodCols: ["Z"] }), { key: "forecastImportErrorBadMapping" }],
    ["a reply cut off at the output budget", () => vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ stop_reason: "max_tokens", content: [{ type: "tool_use", name: "propose_forecast_mapping", input: WIDE_MAPPING }] }),
    } as unknown as Response), { key: "forecastImportErrorTooLargeForClaude" }],
    ["an HTTP error", () => vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false, status: 500, json: async () => ({ error: { type: "api_error", message: "Overloaded" } }),
    } as unknown as Response), { message: "Overloaded" }],
  ])("shows an error for %s and leaves the hand route usable", async (_label, respond, error) => {
    respond();
    const deps = depsOf();
    const { result } = await loaded(deps);
    await askClaudeNow(result);
    expect(result.current.error).toEqual(error);
    expect(result.current.route).toBe("hand");
    expect(result.current.step).toBe("preview");
    act(() => result.current.detectColumns());
    expect(result.current.error).toBeNull();
    expect(applyOutcome(result)).toBe("applied");
    expect(hoursWrittenBy(deps)).toEqual({ "2026-01": 10, "2026-02": 20, "2026-03": 30 });
  });

  it("offers Ask Claude with a passphrase key unlocked on this page, though settings read it blank (§717)", async () => {
    stubSettings({ ...AI_ON, ai: { ...AI_ON.ai, apiKey: "" } });
    setSessionAiKey("sk-ant-unlocked");
    try {
      const { result } = await loaded(depsOf());
      expect(result.current.aiAvailable).toBe(true);
    } finally {
      clearSessionAiKey();
    }
  });

  it("does nothing when AI is off", async () => {
    stubSettings(AI_OFF);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { result } = await loaded(depsOf());
    expect(result.current.aiAvailable).toBe(false);
    await askClaudeNow(result);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.route).toBe("hand");
  });

  it("maps an oversized sheet to the too-large message without a request, and the hand route stays", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const header = ["Name", "Jan 2026", "Feb 2026", "Mar 2026"].join(",");
    const lines = Array.from({ length: 5100 }, (_, i) => `P${i},1,2,3`);
    const { result } = await loaded(depsOf(), [header, ...lines].join("\r\n"));
    await askClaudeNow(result);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.error).toEqual({ key: "forecastImportErrorTooLargeForClaude" });
    expect(result.current.busy).toBe(false);
    expect(result.current.route).toBe("hand");
    expect(result.current.step).toBe("preview");
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
    // The request leaves after the deployment status check; cancel once it is in flight.
    await act(() => vi.waitFor(() => expect(seenSignal).toBeDefined()));
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
    expect(forecastImportErrorOf(new Error("bad-mapping"))).toEqual({ key: "forecastImportErrorBadMapping" });
    expect(forecastImportErrorOf(new AiHttpError(429))).toEqual({ key: "aiUsageLimitReached" });
    expect(forecastImportErrorOf(new AiHttpError(401))).toEqual({ key: "aiKeyRejected" });
    expect(forecastImportErrorOf(new AiDeploymentError("off"))).toEqual({ key: "aiDeploymentOff" });
    expect(forecastImportErrorOf(new AiGatewayError("ai-gateway-error"))).toEqual({ key: "aiGatewayFailed" });
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

  // rr7 I2: Wide, then Long again, rebuilt the long mapping from the defaults
  // (the questioned preselection) and had cleared the gate on the way.
  it("a layout round-trip (Long, Wide, Long) confirms nothing", async () => {
    const deps = depsOf();
    const { result } = await loaded(deps, PLAN_IST);
    const long = result.current.mapping!;
    act(() => result.current.setMapping(wideMappingFor(result.current.sheets[0].rows, 0, { person: 0 }, 2026)));
    expect(result.current.ambiguous).toEqual([{ field: "hours", candidates: [2, 3] }]);
    act(() => result.current.setMapping({ ...long }));
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

});

// Claude sets the mapping (owner decision 2026-10-13): its mapping is the
// draft of the mapping step, the hand reader imports with it, and Apply waits
// for an explicit "These columns are right" press on any layout. An edit is no
// such press. Every question detection raises is asked of the mapping IN
// EFFECT, Claude's or the user's edit of it.
describe("useForecastImport — Claude's mapping waits for the user's press", () => {
  const PLAN_IST = "Name,Monat,Stunden,Ist\r\nAnn Lee,Jan 2026,40,35\r\nAnn Lee,Feb 2026,30,25\r\n";
  const STUNDEN = { layout: "long", headerRow: 1, person: "A", period: "B", hours: "C" };

  it("Apply is refused until the press, though the mapping raises no question", async () => {
    claudeResponds(WIDE_MAPPING);
    const deps = depsOf();
    const { result } = await loaded(deps);
    await askClaudeNow(result);
    expect(result.current.ambiguous).toEqual([]);
    expect(result.current.claudeUnconfirmed).toBe(true);
    act(() => result.current.showPreview());
    expect(result.current.step).toBe("preview");
    expect(result.current.route).toBe("claude");
    expect(applyOutcome(result)).toBe("refused");
    expect(result.current.error).toEqual({ key: "forecastImportConfirmClaudeFirst" });
    expect(deps.onChangeBuckets).not.toHaveBeenCalled();
  });

  it("an edit of a field is no press: Apply stays refused", async () => {
    claudeResponds(STUNDEN);
    const deps = depsOf();
    const { result } = await loaded(deps, "Name,Monat,Stunden\r\nAnn Lee,Jan 2026,40\r\n");
    await askClaudeNow(result);
    act(() => result.current.setMapping({ ...result.current.mapping!, year: 2027 }));
    act(() => result.current.setMapping({ ...result.current.mapping!, hours: 2 }));
    expect(result.current.route).toBe("claude");
    expect(result.current.claudeUnconfirmed).toBe(true);
    act(() => result.current.showPreview());
    expect(applyOutcome(result)).toBe("refused");
    expect(deps.onChangeBuckets).not.toHaveBeenCalled();
  });

  it("after the press, Apply writes exactly what the hand reader reads with that mapping", async () => {
    claudeResponds({ ...WIDE_MAPPING, periodCols: ["B", "D"] });
    const deps = depsOf();
    const { result } = await loaded(deps);
    await askClaudeNow(result);
    act(() => result.current.confirmColumns());
    expect(result.current.claudeUnconfirmed).toBe(false);
    act(() => result.current.showPreview());
    const read = gridToForecastRows(result.current.sheets[0].rows, result.current.mapping!, "forecast").rows;
    expect(read.map((r) => [r.period, r.hours])).toEqual([["2026-01", 10], ["2026-03", 30]]);
    expect(applyOutcome(result)).toBe("applied");
    expect(hoursWrittenBy(deps)).toEqual({ "2026-01": 10, "2026-03": 30 });
  });

  it("an edit after the press asks for the press again", async () => {
    claudeResponds(WIDE_MAPPING);
    const deps = depsOf();
    const { result } = await loaded(deps);
    await askClaudeNow(result);
    act(() => result.current.confirmColumns());
    expect(result.current.claudeUnconfirmed).toBe(false);
    // A copy of the confirmed mapping is no edit; a changed column is.
    act(() => result.current.setMapping(wideMappingFor(result.current.sheets[0].rows, 0, { person: 0 }, 2026)));
    expect(result.current.claudeUnconfirmed).toBe(false);
    act(() => result.current.setMapping({ ...result.current.mapping!, periodCols: [1, 2] }));
    expect(result.current.claudeUnconfirmed).toBe(true);
    act(() => result.current.showPreview());
    expect(applyOutcome(result)).toBe("refused");
    expect(deps.onChangeBuckets).not.toHaveBeenCalled();
  });

  it("Claude's Ist column on Name | Monat | Stunden | Ist is shown, named in the hours question, and nothing is written before the press", async () => {
    claudeResponds({ ...STUNDEN, hours: "D" });
    const deps = depsOf();
    const { result } = await loaded(deps, PLAN_IST);
    await askClaudeNow(result);
    expect(result.current.mapping).toMatchObject({ layout: "long", hours: 3 });
    expect(result.current.ambiguous).toEqual([{ field: "hours", candidates: [2, 3] }]);
    expect(result.current.sample.map((r) => r.hours)).toEqual([35, 25]);
    act(() => result.current.showPreview());
    expect(applyOutcome(result)).toBe("refused");
    expect(deps.onChangeBuckets).not.toHaveBeenCalled();
    // The user moves the hours to Stunden: still no press, still nothing written.
    act(() => result.current.setMapping({ ...result.current.mapping!, hours: 2 }));
    expect(result.current.ambiguous).toEqual([{ field: "hours", candidates: [2, 3] }]);
    expect(applyOutcome(result)).toBe("refused");
    expect(deps.onChangeBuckets).not.toHaveBeenCalled();
    // One press confirms the mapping and its open question.
    act(() => result.current.confirmColumns());
    expect(result.current.ambiguous).toEqual([]);
    expect(applyOutcome(result)).toBe("applied");
    expect(hoursWrittenBy(deps)).toEqual({ "2026-01": 40, "2026-02": 30 });
  });

  it("raises the rows question against Claude's mapping on Name | Art | months", async () => {
    claudeResponds({ layout: "wide", headerRow: 1, person: "A", periodCols: ["C", "D"] });
    const deps = depsOf();
    const { result } = await loaded(deps, "Name,Art,Jan 2026,Feb 2026\r\nAnn Lee,Plan,50,40\r\nAnn Lee,Ist,43,30\r\n");
    await askClaudeNow(result);
    expect(result.current.ambiguous).toEqual([{ field: "rows", candidates: [1], samples: ["Plan", "Ist"] }]);
    act(() => result.current.showPreview());
    expect(applyOutcome(result)).toBe("refused");
    expect(deps.onChangeBuckets).not.toHaveBeenCalled();
  });

  it("asks the rows and header questions of a person column detection did not choose", async () => {
    // Detection takes Name as the person and asks nothing; Claude names Team.
    const csv = "Team,Name,Jan 2026,Feb 2026\r\nCore,Ann Lee,50,40\r\nCore,Bob Ray,43,30\r\nTeam,Lead,,\r\nOps,Cid Fox,10,10\r\n";
    claudeResponds({ layout: "wide", headerRow: 1, person: "A", periodCols: ["C", "D"] });
    const deps = depsOf();
    const { result } = await loaded(deps, csv);
    expect(result.current.mapping?.person).toBe(1);
    expect(result.current.step).toBe("preview");
    expect(result.current.ambiguous).toEqual([]);
    await askClaudeNow(result);
    expect(result.current.mapping?.person).toBe(0);
    expect(result.current.ambiguous.map((a) => a.field)).toEqual(["header", "rows"]);
    expect(result.current.ambiguous).toContainEqual({ field: "rows", candidates: [1], samples: ["Ann Lee", "Bob Ray"] });
    expect(result.current.ambiguous).toContainEqual({ field: "header", candidates: [0, 3] });
    act(() => result.current.showPreview());
    expect(applyOutcome(result)).toBe("refused");
    expect(deps.onChangeBuckets).not.toHaveBeenCalled();
  });

  it("Detect columns leaves Claude's mapping for the hand route's own detection and questions", async () => {
    claudeResponds({ ...STUNDEN, hours: "D" });
    const { result } = await loaded(depsOf(), PLAN_IST);
    await askClaudeNow(result);
    act(() => result.current.confirmColumns());
    act(() => result.current.detectColumns());
    expect(result.current.route).toBe("hand");
    expect(result.current.claudeUnconfirmed).toBe(false);
    expect(result.current.mapping).toMatchObject({ layout: "long", hours: 2 });
    expect(result.current.ambiguous).toEqual([{ field: "hours", candidates: [2, 3] }]);
  });
});

// Round 2 (controller ruling on concern 1): a metadata row over a long sheet's
// Monat | Stunden | Ist reads as a wide header; its rows' own Monat column now
// makes that reading ask.
describe("useForecastImport — a wide reading whose rows hold their own period column waits (round 2)", () => {
  const METADATA = [
    "Erstellt,,01.01.2026,15.01.2026,20.01.2026", "Name,Monat,Stunden,Ist",
    "Ann Lee,Jan 2026,40,35", "Bob Ray,Feb 2026,40,35", "Cem Ott,Jan 2026,40,35", "Dora Li,Feb 2026,40,35", "Eve Wu,Jan 2026,40,35", "",
  ].join("\r\n");

  it("gates the hand route, then reads the hours the user picked", async () => {
    const deps = depsOf();
    const { result } = await loaded(deps, METADATA);
    expect(result.current.step).toBe("mapping");
    expect(result.current.mapping).toMatchObject({ layout: "wide", headerRow: 0 });
    expect(result.current.ambiguous).toEqual([{ field: "period", candidates: [1, 2, 3, 4] }]);
    act(() => result.current.showPreview());
    expect(applyOutcome(result)).toBe("refused");
    expect(result.current.error).toEqual({ key: "forecastImportConfirmFirst" });
    // The user maps it as the long sheet it is and confirms: Stunden, never Ist or their sum.
    act(() => result.current.setMapping({ layout: "long", headerRow: 1, person: 0, period: 1, hours: 2, year: 2026 }));
    act(() => result.current.confirmColumns());
    act(() => result.current.showPreview());
    const written = result.current.importPlan?.changes.map((c) => [c.period, c.next]);
    expect(written).toEqual([["2026-01", 40], ["2026-02", 40]]);
    expect(applyOutcome(result)).toBe("applied");
    expect(deps.onChangeBuckets).toHaveBeenCalledTimes(1);
  });
});

// Fix 9 I-1 (rr9 H5): with an "offen" in the Monat column the sheet once opened
// straight on the preview, and February Ist cells were applied as January.
describe("useForecastImport — one placeholder does not switch the row-period question off (fix 9 I-1)", () => {
  it("gates the sheet on the hand route", async () => {
    const csv = ["Erstellt,,01.01.2026,15.01.2026,20.01.2026", "Name,Monat,Stunden,Ist", "Ann Lee,Jan 2026,40,35", "Bob Ray,Feb 2026,40,35",
      "Cid Ott,offen,40,35", "Dora Li,Feb 2026,40,35", "Eve Wu,Jan 2026,40,35", ""].join("\r\n");
    const deps = depsOf();
    const { result } = await loaded(deps, csv);
    expect(result.current.step).toBe("mapping");
    expect(result.current.ambiguous).toEqual([{ field: "period", candidates: [1, 2, 3, 4] }]);
    act(() => result.current.showPreview());
    expect(applyOutcome(result)).toBe("refused");
    expect(deps.onChangeBuckets).not.toHaveBeenCalled();
  });
});

// Fix 9 OOS-c: the hand route waits for the header row on stacked blocks.
describe("useForecastImport — more than one header row waits for the user (fix 9 OOS-c)", () => {
  const LONG = "Name,Monat,Forecast\r\nAnn Lee,Jan 2026,40\r\nBob Ray,Feb 2026,30\r\nName,Monat,Ist\r\nAnn Lee,Jan 2026,35\r\nBob Ray,Feb 2026,25\r\n";
  const WIDE = "Name,Jan 2026,Feb 2026\r\nAnn Lee,10,20\r\nBob Ray,11,21\r\nName,Jan 2027,Feb 2027\r\nAnn Lee,30,40\r\nBob Ray,31,41\r\n";
  const applyNow = (result: { current: ReturnType<typeof useForecastImport> }) => {
    let outcome: string | undefined;
    act(() => {
      outcome = result.current.apply();
    });
    return outcome;
  };

  it("stacked long blocks: the Ist block is not applied without a confirmation; choosing header row 1 clears the gate", async () => {
    const deps = depsOf();
    const { result } = await loaded(deps, LONG);
    expect(result.current.step).toBe("mapping");
    expect(result.current.ambiguous).toEqual([{ field: "header", candidates: [0, 3] }]);
    act(() => result.current.showPreview());
    expect(applyNow(result)).toBe("refused");
    expect(deps.onChangeBuckets).not.toHaveBeenCalled();
    act(() => result.current.setMapping({ ...result.current.mapping!, headerRow: 0 }));
    expect(result.current.ambiguous).toEqual([]);
    act(() => result.current.showPreview());
    // Round 5: the repeated header row ends the reading, so header row 1 reads
    // the Forecast block only (it once summed Forecast + Ist, residue 28).
    expect(result.current.duplicates).toEqual([]);
    expect(result.current.rowsBelowRepeatedHeader).toBe(2);
    expect(result.current.importPlan?.changes.map((c) => [c.period, c.next])).toEqual([["2026-01", 40], ["2026-02", 30]]);
  });

  it("stacked wide year blocks: the 2026-only sum is not applied without a confirmation", async () => {
    const deps = depsOf();
    const { result } = await loaded(deps, WIDE);
    expect(result.current.step).toBe("mapping");
    expect(result.current.ambiguous).toEqual([{ field: "header", candidates: [0, 3] }]);
    act(() => result.current.showPreview());
    expect(applyNow(result)).toBe("refused");
    expect(deps.onChangeBuckets).not.toHaveBeenCalled();
  });
});

// Fix 9 m-a (rr9 H2): a confirmation belongs to a (layout, field) pair and to
// the column it confirmed. Choosing the period in Long once also cleared the
// Wide reading's question, so flipping back to Wide applied the very reading
// that was questioned.
describe("useForecastImport — a confirmation belongs to its layout and column (fix 9 m-a)", () => {
  const METADATA = ["Erstellt,,01.01.2026,15.01.2026,20.01.2026", "Name,Monat,Stunden,Ist",
    "Ann Lee,Jan 2026,40,35", "Bob Ray,Feb 2026,40,35", "Cid Ott,Jan 2026,40,35", "Dora Li,Feb 2026,40,35", "Eve Wu,Jan 2026,40,35", ""].join("\r\n");

  it("flipping back to the questioned Wide reading re-arms its question, and Apply is refused", async () => {
    const deps = depsOf();
    const { result } = await loaded(deps, METADATA);
    const wide = result.current.mapping!;
    expect(result.current.ambiguous).toEqual([{ field: "period", candidates: [1, 2, 3, 4] }]);
    const long = { layout: "long" as const, headerRow: 0, person: 0, period: 1, hours: 2, year: 2026 };
    act(() => result.current.setMapping(long));
    act(() => result.current.setMapping({ ...long, period: 3 }));
    expect(result.current.ambiguous).toEqual([]);
    act(() => result.current.setMapping({ ...wide }));
    expect(result.current.ambiguous).toEqual([{ field: "period", candidates: [1, 2, 3, 4] }]);
    act(() => result.current.showPreview());
    expect(applyOutcome(result)).toBe("refused");
    expect(deps.onChangeBuckets).not.toHaveBeenCalled();
  });

  it("a chosen hours column reset by a layout round-trip waits for confirmation again", async () => {
    const PLAN_IST = "Name,Monat,Plan,Ist\r\nAnn Lee,Jan 2026,40,35\r\nAnn Lee,Feb 2026,30,25\r\n";
    const { result } = await loaded(depsOf(), PLAN_IST);
    const long = result.current.mapping!;
    act(() => result.current.setMapping({ ...long, hours: 3 }));
    expect(result.current.ambiguous).toEqual([]);
    act(() => result.current.setMapping(wideMappingFor(result.current.sheets[0].rows, 0, { person: 0 }, 2026)));
    expect(result.current.ambiguous).toEqual([{ field: "hours", candidates: [2, 3] }]);
    act(() => result.current.setMapping({ ...long, hours: 2 }));
    expect(result.current.ambiguous).toEqual([{ field: "hours", candidates: [2, 3] }]);
    act(() => result.current.setMapping({ ...long, hours: 3 }));
    expect(result.current.ambiguous).toEqual([]);
  });
});

// Round 7 I-A (rr10 U1): after confirming Stunden, the Ist cell on Bob's
// blank-forecast row was once applied as his February forecast (25).
describe("useForecastImport — a blank forecast row's Ist is never applied (round 7 I-A)", () => {
  it("reads nothing from Bob's blank Stunden cell once the Stunden column is confirmed", async () => {
    const csv = "Name,Monat,Stunden,Ist\r\nAnn Lee,Jan 2026,40,35\r\nBob Ray,Feb 2026,,25\r\nCid Fox,Jan 2026,30,28\r\nDora Kim,Feb 2026,20,18\r\n";
    const { result } = await loaded(depsOf(), csv);
    expect(result.current.ambiguous).toEqual([{ field: "hours", candidates: [2, 3] }]);
    act(() => result.current.confirmColumns());
    expect(result.current.sample.map((r) => [r.person, r.hours])).toEqual([["Ann Lee", 40], ["Cid Fox", 30], ["Dora Kim", 20]]);
  });
});

// Round 7 I-B (rr10 P1/E1): two "-" in Stunden made Ist the only hours
// candidate, and the actuals (83) were applied without a word.
describe("useForecastImport — placeholders in the hours column ask (round 7 I-B)", () => {
  it("Stunden with two '-' beside Ist opens on the mapping step, and the 83 of actuals is not applied", async () => {
    const deps = depsOf();
    const csv = "Name,Monat,Stunden,Ist\r\nAnn Lee,Jan 2026,40,35\r\nBob Ray,Jan 2026,-,12\r\nCid Fox,Jan 2026,30,28\r\nDora Kim,Jan 2026,-,8\r\n";
    const { result } = await loaded(deps, csv);
    expect(result.current.step).toBe("mapping");
    expect(result.current.ambiguous).toEqual([{ field: "hours", candidates: [2, 3] }]);
    act(() => result.current.showPreview());
    let outcome: string | undefined;
    act(() => {
      outcome = result.current.apply();
    });
    expect(outcome).toBe("refused");
    expect(deps.onChangeBuckets).not.toHaveBeenCalled();
  });
});

// Round 8 m-1 (rr11): the preselection follows the candidates, not the share.
// The hours preselect the LEFTMOST candidate; the period ranks by header word
// first, then share, then leftmost. "These columns are right" once applied
// the actuals (Ist) or every row in March (Erfasst am).
describe("useForecastImport — the preselection is the forecast column (round 8 m-1)", () => {
  it("Stunden with two '-' beside Ist preselects Stunden, and confirming writes Ann's forecast 40", async () => {
    const deps = depsOf();
    const csv = "Name,Monat,Stunden,Ist\r\nAnn Lee,Jan 2026,40,35\r\nBob Ray,Jan 2026,-,12\r\nCid Fox,Jan 2026,30,28\r\nDora Kim,Jan 2026,-,8\r\n";
    const { result } = await loaded(deps, csv);
    expect(result.current.mapping).toMatchObject({ layout: "long", period: 1, hours: 2 });
    act(() => result.current.confirmColumns());
    act(() => result.current.showPreview());
    expect(result.current.importPlan?.changes.map((c) => [c.period, c.next])).toEqual([["2026-01", 40]]);
  });

  it("offen in Monat beside Erfasst am preselects Monat, and confirming writes the forecast in its own month", async () => {
    const deps = depsOf();
    const csv = "Name,Monat,Stunden,Erfasst am\r\nAnn Lee,Jan 2026,40,15.03.2026\r\nBob Ray,offen,30,15.03.2026\r\nCid Fox,Feb 2026,20,15.03.2026\r\nDora Kim,Mär 2026,10,15.03.2026\r\n";
    const { result } = await loaded(deps, csv);
    expect(result.current.ambiguous).toContainEqual({ field: "period", candidates: [1, 3] });
    expect(result.current.mapping).toMatchObject({ layout: "long", period: 1, hours: 2 });
    act(() => result.current.confirmColumns());
    act(() => result.current.showPreview());
    expect(result.current.importPlan?.changes.map((c) => [c.period, c.next])).toEqual([["2026-01", 40]]);
  });
});

// Round 9 I-D (rr12 K4): "These columns are right" on FTE | Stunden applied
// the FTE fractions as hours.
describe("useForecastImport — FTE | Stunden confirms the Stunden hours (round 9 I-D)", () => {
  it("preselects Stunden and applies 80 and 160", async () => {
    const deps = depsOf();
    const csv = "Name,Monat,FTE,Stunden\r\nAnn Lee,Jan 2026,0.5,80\r\nAnn Lee,Feb 2026,1,160\r\n";
    const { result } = await loaded(deps, csv);
    expect(result.current.mapping).toMatchObject({ layout: "long", hours: 3 });
    act(() => result.current.confirmColumns());
    act(() => result.current.showPreview());
    expect(result.current.importPlan?.changes.map((c) => [c.period, c.next])).toEqual([["2026-01", 80], ["2026-02", 160]]);
  });
});

// Round 9 I-W (rr12): one person on several rows that differ in a text column
// (Plan and Ist) was summed on both routes, unasked. Both routes ask it of the
// mapping in effect, detection's or Claude's; once confirmed, the sum is
// applied and shown.
describe("useForecastImport — one person, rows that differ in a text column (round 9 I-W)", () => {
  type Hook = { current: ReturnType<typeof useForecastImport> };
  const str = (ref: string, text: string) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
  const num = (ref: string, value: string) => `<c r="${ref}"><v>${value}</v></c>`;
  const workbook = async (grid: readonly (readonly string[])[]): Promise<File> => {
    const xml = grid.map((cells, r) => `<row r="${r + 1}">${cells.map((cell, c) => {
      const ref = `${"ABCD"[c]}${r + 1}`;
      return /^\d+$/.test(cell) ? num(ref, cell) : str(ref, cell);
    }).join("")}</row>`).join("");
    const blob = buildZip([
      { path: "xl/workbook.xml", data: `<workbook><sheets><sheet name="forecast" sheetId="1" r:id="rId1"/></sheets></workbook>` },
      { path: "xl/_rels/workbook.xml.rels", data: `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>` },
      { path: "xl/worksheets/sheet1.xml", data: `<worksheet><sheetData>${xml}</sheetData></worksheet>` },
    ]);
    return new File([await blob.arrayBuffer()], "forecast.xlsx");
  };
  const csvOf = (grid: readonly (readonly string[])[]): string => grid.map((r) => r.join(",")).join("\r\n") + "\r\n";
  const load = async (deps: ForecastImportDeps, grid: readonly (readonly string[])[], kind: "csv" | "xlsx") => {
    const hook = renderHook((d: ForecastImportDeps) => useForecastImport(d), { initialProps: deps });
    const file = kind === "csv" ? csvFile(csvOf(grid)) : await workbook(grid);
    await act(async () => {
      await hook.result.current.loadFile(file);
    });
    return hook;
  };
  const applyNow = (result: Hook) => {
    let outcome: string | undefined;
    act(() => {
      outcome = result.current.apply();
    });
    return outcome;
  };
  const hoursWritten = (deps: ForecastImportDeps) => {
    const [next] = (deps.onChangeBuckets as ReturnType<typeof vi.fn>).mock.calls[0] as [BudgetBucket[]];
    return next[0].allocations[0].budgetHours;
  };
  const changes = (result: Hook) => result.current.importPlan?.changes.map((c) => [c.period, c.next]) ?? [];

  const wideMapping = { layout: "wide", headerRow: 1, person: "A", periodCols: ["C", "D"] };
  const longMapping = { layout: "long", headerRow: 1, person: "A", period: "C", hours: "D" };
  const shapes = [
    { label: "wide CSV", kind: "csv", grid: [["Name", "Art", "Jan 2026", "Feb 2026"], ["Ann Lee", "Plan", "50", "40"], ["Ann Lee", "Ist", "43", "30"]],
      mapping: wideMapping, written: { "2026-01": 93, "2026-02": 70 } },
    { label: "wide serial", kind: "xlsx", grid: [["Name", "Art", "46023", "46054"], ["Ann Lee", "Plan", "50", "40"], ["Ann Lee", "Ist", "43", "30"]],
      mapping: wideMapping, written: { "2026-01": 93, "2026-02": 70 } },
    { label: "long CSV", kind: "csv", grid: [["Name", "Typ", "Monat", "Stunden"], ["Ann Lee", "Plan", "Jan 2026", "50"], ["Ann Lee", "Ist", "Jan 2026", "43"]],
      mapping: longMapping, written: { "2026-01": 93 } },
    { label: "long serial", kind: "xlsx", grid: [["Name", "Typ", "Monat", "Stunden"], ["Ann Lee", "Plan", "46023", "50"], ["Ann Lee", "Ist", "46023", "43"]],
      mapping: longMapping, written: { "2026-01": 93 } },
  ] as const;

  it.each(shapes)("$label, hand route: gated, nothing applied; confirmed, the sum is applied and shown", async ({ kind, grid, written }) => {
    const deps = depsOf();
    const { result } = await load(deps, grid, kind);
    expect(result.current.step).toBe("mapping");
    expect(result.current.ambiguous).toEqual([{ field: "rows", candidates: [1], samples: ["Plan", "Ist"] }]);
    act(() => result.current.showPreview());
    expect(applyNow(result)).toBe("refused");
    expect(result.current.error).toEqual({ key: "forecastImportConfirmFirst" });
    expect(deps.onChangeBuckets).not.toHaveBeenCalled();
    act(() => result.current.confirmColumns());
    expect(result.current.ambiguous).toEqual([]);
    expect(changes(result)).toEqual(Object.entries(written));
    expect(result.current.duplicates.length).toBeGreaterThan(0);
    expect(applyNow(result)).toBe("applied");
    expect(hoursWritten(deps)).toEqual(written);
  });

  it.each(shapes)("$label, Claude route: the rows question is asked of Claude's mapping; pressed, the sum", async ({ kind, grid, mapping, written }) => {
    claudeResponds(mapping);
    const deps = depsOf();
    const { result } = await load(deps, grid, kind);
    await askClaudeNow(result);
    expect(result.current.route).toBe("claude");
    expect(result.current.ambiguous).toEqual([{ field: "rows", candidates: [1], samples: ["Plan", "Ist"] }]);
    act(() => result.current.showPreview());
    expect(applyNow(result)).toBe("refused");
    expect(deps.onChangeBuckets).not.toHaveBeenCalled();
    act(() => result.current.confirmColumns());
    expect(changes(result)).toEqual(Object.entries(written));
    expect(applyNow(result)).toBe("applied");
    expect(hoursWritten(deps)).toEqual(written);
  });
});

// Final review 2 (I1): Claude's long mapping of Name | Jahr | Monat | Stunden
// without the year column read every Jan in the default year.
describe("useForecastImport — a Claude long mapping that leaves out the year column (final review 2, I1)", () => {
  const JAHR = "Name;Jahr;Monat;Stunden\r\nAnn Lee;2027;Jan;10\r\nAnn Lee;2026;Jan;5\r\nBob Ray;2027;Feb;3\r\n";
  const TWO_YEARS: BudgetBucket = { ...BUCKET, endDate: "2027-12-31" };
  const twoYearDeps = () => depsOf({ bucket: TWO_YEARS, buckets: [TWO_YEARS], plan: { ...PLAN, endDate: "2027-12-31" } });

  it("asks for the period with the year column among the candidates, and nothing is applied before the press", async () => {
    claudeResponds({ layout: "long", headerRow: 1, person: "A", period: "C", hours: "D" });
    const deps = twoYearDeps();
    const { result } = await loaded(deps, JAHR);
    await askClaudeNow(result);
    expect(result.current.mapping?.yearCol).toBeUndefined();
    expect(result.current.ambiguous).toEqual([{ field: "period", candidates: [1, 2] }]);
    act(() => result.current.showPreview());
    expect(applyOutcome(result)).toBe("refused");
    expect(deps.onChangeBuckets).not.toHaveBeenCalled();
  });

  it("with the year column mapped, 2027 is read and written", async () => {
    claudeResponds({ layout: "long", headerRow: 1, person: "A", period: "C", hours: "D" });
    const deps = twoYearDeps();
    const { result } = await loaded(deps, JAHR);
    await askClaudeNow(result);
    act(() => result.current.setMapping({ ...result.current.mapping!, yearCol: 1 }));
    expect(result.current.ambiguous).toEqual([]);
    expect(result.current.sample.map((r) => [r.person, r.period, r.hours])).toEqual([
      ["Ann Lee", "2027-01", 10], ["Ann Lee", "2026-01", 5], ["Bob Ray", "2027-02", 3],
    ]);
    act(() => result.current.confirmColumns());
    act(() => result.current.showPreview());
    expect(applyOutcome(result)).toBe("applied");
    expect(hoursWrittenBy(deps)).toEqual({ "2026-01": 5, "2027-01": 10, "2027-02": 3 });
  });
});

// Final review 3 (I1, I2, M1): Excel's merged cells, and a workbook with more
// than one detectable sheet, went straight to the preview and wrote the left
// or top sub-column (or the first sheet's actuals) with no question.
describe("useForecastImport — merged cells and several detectable sheets (final review 3)", () => {
  const PEOPLE = ["Ann Lee", "Bob Ray", "Cem Oz", "Dana Fox", "Eli Roe", "Fay Wu"];
  const str = (ref: string, text: string) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
  const num = (ref: string, value: string) => `<c r="${ref}"><v>${value}</v></c>`;
  const sheetXml = (grid: readonly (readonly string[])[]): string => `<worksheet><sheetData>${grid.map((cells, r) => `<row r="${r + 1}">${cells.map((cell, c) => {
    const ref = `${columnLetters(c)}${r + 1}`;
    if (cell === "") return "";
    return /^\d+$/.test(cell) ? num(ref, cell) : str(ref, cell);
  }).join("")}</row>`).join("")}</sheetData></worksheet>`;
  const workbook = async (sheets: readonly { name: string; grid: readonly (readonly string[])[] }[]): Promise<File> => {
    const blob = buildZip([
      { path: "xl/workbook.xml", data: `<workbook><sheets>${sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
      { path: "xl/_rels/workbook.xml.rels", data: `<Relationships>${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>` },
      ...sheets.map((s, i) => ({ path: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.grid) })),
    ]);
    return new File([await blob.arrayBuffer()], "forecast.xlsx");
  };
  const csvOf = (grid: readonly (readonly string[])[]): string => grid.map((r) => r.join(";")).join("\r\n") + "\r\n";
  const resources: Resource[] = PEOPLE.map((p, i) => {
    const [firstName, lastName] = p.split(" ");
    return { id: i + 1, firstName, lastName, roleId: ROLE.id, utilizationMode: "percent", utilization: {} };
  });
  const loadFileNow = async (deps: ForecastImportDeps, file: File) => {
    const hook = renderHook((d: ForecastImportDeps) => useForecastImport(d), { initialProps: deps });
    await act(async () => {
      await hook.result.current.loadFile(file);
    });
    return hook;
  };
  /** Opens the preview and checks that Apply is refused and nothing written. */
  const refusedBeforeConfirmation = (result: Hook, deps: ForecastImportDeps, key = "forecastImportConfirmFirst") => {
    expect(result.current.step).toBe("mapping");
    act(() => result.current.showPreview());
    expect(applyOutcome(result)).toBe("refused");
    expect(result.current.error).toEqual({ key });
    expect(deps.onChangeBuckets).not.toHaveBeenCalled();
  };

  /** `Name | <m> | (blank) …` over a sub-header row; the first sub-column holds 10/20/30. */
  const mergedMonths = (months: readonly string[], sub: readonly [string, string]): string[][] => [
    ["Name", ...months.flatMap((m) => [m, ""])],
    ["", ...months.flatMap(() => [...sub])],
    ...PEOPLE.map((p) => [p, "10", "100", "20", "110", "30", "120"]),
  ];

  it.each([
    ["CSV, Ist first", "csv", ["Jan 2026", "Feb 2026", "Mär 2026"], ["Ist", "Plan"]],
    ["CSV, Plan first", "csv", ["Jan 2026", "Feb 2026", "Mär 2026"], ["Plan", "Ist"]],
    ["CSV, € | Std", "csv", ["Jan 2026", "Feb 2026", "Mär 2026"], ["€", "Std"]],
    ["workbook serials, Actual first", "xlsx", ["46023", "46054", "46082"], ["Actual", "Forecast"]],
    ["workbook serials, € | Std", "xlsx", ["46023", "46054", "46082"], ["€", "Std"]],
  ] as const)("I1, %s: opens on the mapping step, Apply refused, no sub-column figure written before the confirmation", async (_label, kind, months, sub) => {
    const deps = depsOf({ resources });
    const grid = mergedMonths(months, sub);
    const file = kind === "csv" ? csvFile(csvOf(grid)) : await workbook([{ name: "Plan", grid }]);
    const { result } = await loadFileNow(deps, file);
    expect(result.current.ambiguous).toEqual([{ field: "period", candidates: [1, 2, 3, 4, 5, 6], blankHeaded: [2, 4, 6] }]);
    refusedBeforeConfirmation(result, deps);
    act(() => result.current.confirmColumns());
    expect(applyOutcome(result)).toBe("applied");
  });

  it.each([
    ["wide", [["Name", "Art", "Jan 2026", "Feb 2026", "Mär 2026"], ...PEOPLE.flatMap((p) => [[p, "Ist", "10", "20", "30"], ["", "Plan", "100", "110", "120"]])]],
    ["long", [["Name", "Monat", "Art", "Stunden"], ...PEOPLE.flatMap((p) => [[p, "Jan 2026", "Ist", "10"], ["", "Jan 2026", "Plan", "100"]])]],
  ] as const)("I2, %s: a person merged over two rows opens on the mapping step, Apply refused before the confirmation", async (_label, grid) => {
    const deps = depsOf({ resources });
    const { result } = await loadFileNow(deps, csvFile(csvOf(grid)));
    expect(result.current.ambiguous).toEqual([{ field: "continuation", candidates: [2, 4, 6, 8, 10, 12], samples: ["Ist", "Plan"] }]);
    refusedBeforeConfirmation(result, deps);
    act(() => result.current.confirmColumns());
    expect(result.current.ambiguous).toEqual([]);
    expect(applyOutcome(result)).toBe("applied");
  });

  const SAME_SHAPE = (h: string) => [["Name", "Jan 2026", "Feb 2026", "Mar 2026"], ["Ann Lee", h, h, h]];

  it("M1: two detectable sheets open on the mapping step with a sheet question; Apply waits; choosing a sheet confirms it", async () => {
    const deps = depsOf();
    const { result } = await loadFileNow(deps, await workbook([{ name: "Ist", grid: SAME_SHAPE("9") }, { name: "Forecast", grid: SAME_SHAPE("12") }]));
    expect(result.current.sheetIndex).toBe(0);
    expect(result.current.ambiguous).toEqual([{ field: "sheet", candidates: [0, 1] }]);
    refusedBeforeConfirmation(result, deps);
    act(() => result.current.selectSheet(1));
    expect(result.current.ambiguous).toEqual([]);
    expect(result.current.step).toBe("preview");
    expect(applyOutcome(result)).toBe("applied");
    expect(hoursWrittenBy(deps)).toEqual({ "2026-01": 12, "2026-02": 12, "2026-03": 12 });
  });

  it("M1: \"These columns are right\" confirms the sheet too; Detect columns and Ask Claude ask again", async () => {
    claudeResponds(WIDE_MAPPING);
    const deps = depsOf();
    const { result } = await loadFileNow(deps, await workbook([{ name: "Ist", grid: SAME_SHAPE("9") }, { name: "Forecast", grid: SAME_SHAPE("12") }]));
    act(() => result.current.confirmColumns());
    expect(result.current.ambiguous).toEqual([]);
    act(() => result.current.detectColumns());
    expect(result.current.ambiguous).toEqual([{ field: "sheet", candidates: [0, 1] }]);
    expect(result.current.step).toBe("mapping");
    act(() => result.current.confirmColumns());
    await askClaudeNow(result);
    expect(result.current.ambiguous).toEqual([{ field: "sheet", candidates: [0, 1] }]);
    act(() => result.current.confirmColumns());
    expect(result.current.ambiguous).toEqual([]);
    act(() => result.current.showPreview());
    expect(applyOutcome(result)).toBe("applied");
    expect(hoursWrittenBy(deps)).toEqual({ "2026-01": 9, "2026-02": 9, "2026-03": 9 });
  });

  // Final review 4, I1: a total word beside the person (`Ann Lee | Gesamt`)
  // once hid the blank-person Ist and Plan rows below it, and Ann's Gesamt was
  // written as her forecast with no question.
  const TOTAL_WIDE: string[][] = [
    ["Name", "Art", "Jan 2026", "Feb 2026", "Mär 2026"],
    ["Ann Lee", "Gesamt", "110", "130", "150"], ["", "Ist", "10", "20", "30"], ["", "Plan", "100", "110", "120"],
    ...PEOPLE.slice(1).map((p) => [p, "Plan", "10", "20", "30"]),
  ];
  const TOTAL_LONG: string[][] = [
    ["Name", "Monat", "Art", "Stunden"],
    ["Ann Lee", "Jan 2026", "Gesamt", "110"], ["", "Jan 2026", "Ist", "10"], ["", "Jan 2026", "Plan", "100"],
    ...PEOPLE.slice(1).map((p) => [p, "Jan 2026", "Plan", "10"]),
  ];
  const ALL_TOTALS_WIDE: string[][] = [
    ["Name", "Art", "Jan 2026", "Feb 2026", "Mär 2026"],
    ...PEOPLE.flatMap((p) => [[p, "Gesamt", "110", "130", "150"], ["", "Ist", "10", "20", "30"], ["", "Plan", "100", "110", "120"]]),
  ];
  const ALL_TOTALS_LONG: string[][] = [
    ["Name", "Monat", "Art", "Stunden"],
    ...PEOPLE.flatMap((p) => [[p, "Jan 2026", "Gesamt", "110"], ["", "Jan 2026", "Ist", "10"], ["", "Jan 2026", "Plan", "100"]]),
  ];
  const ALL_TOTALS_ROWS = PEOPLE.flatMap((_, i) => [2 + 3 * i, 3 + 3 * i]);

  it.each([
    ["wide", TOTAL_WIDE],
    ["long", TOTAL_LONG],
  ] as const)("final review 4 I1, hand route, %s: a Gesamt person row asks the continuation question, Apply refused", async (_label, grid) => {
    const deps = depsOf({ resources });
    const { result } = await loadFileNow(deps, csvFile(csvOf(grid)));
    expect(result.current.ambiguous).toEqual([{ field: "continuation", candidates: [2, 3], samples: ["Gesamt", "Ist"] }]);
    refusedBeforeConfirmation(result, deps);
  });

  it.each([
    ["wide", ALL_TOTALS_WIDE, { layout: "wide", headerRow: 1, person: "A", periodCols: ["C", "D", "E"] }],
    ["long", ALL_TOTALS_LONG, { layout: "long", headerRow: 1, person: "A", period: "B", hours: "D" }],
  ] as const)("final review 4 I1, Claude route, %s: every person on a Gesamt row asks, Apply refused", async (_label, grid, mapping) => {
    claudeResponds(mapping);
    const deps = depsOf({ resources });
    const { result } = await loadFileNow(deps, csvFile(csvOf(grid)));
    await askClaudeNow(result);
    expect(result.current.ambiguous).toEqual([{ field: "continuation", candidates: ALL_TOTALS_ROWS, samples: ["Gesamt", "Ist"] }]);
    refusedBeforeConfirmation(result, deps, "forecastImportConfirmClaudeFirst");
  });

  // Final review 4, I2: the long twin of final review 3's I1 — a merged
  // `Stunden` header over two sub-columns read the left one unasked.
  const mergedHours = (months: readonly string[], sub: readonly [string, string], values: readonly [string, string]): string[][] => [
    ["Name", "Monat", "Stunden", ""],
    ["", "", ...sub],
    ...PEOPLE.flatMap((p) => months.map((m) => [p, m, ...values])),
  ];
  const MERGED_HOURS_CASES = [
    ["CSV, Ist first", "csv", ["Jan 2026", "Feb 2026", "Mär 2026"], ["Ist", "Plan"], ["10", "100"]],
    ["CSV, Plan first", "csv", ["Jan 2026", "Feb 2026", "Mär 2026"], ["Plan", "Ist"], ["100", "10"]],
    ["CSV, € | Std", "csv", ["Jan 2026", "Feb 2026", "Mär 2026"], ["€", "Std"], ["500", "40"]],
    ["workbook, Ist first", "xlsx", ["46023", "46054", "46082"], ["Ist", "Plan"], ["10", "100"]],
    ["workbook, Plan first", "xlsx", ["46023", "46054", "46082"], ["Plan", "Ist"], ["100", "10"]],
    ["workbook, € | Std", "xlsx", ["46023", "46054", "46082"], ["€", "Std"], ["500", "40"]],
  ] as const;
  const mergedHoursFile = async (kind: "csv" | "xlsx", grid: string[][]): Promise<File> => (kind === "csv" ? csvFile(csvOf(grid)) : workbook([{ name: "Plan", grid }]));

  it.each(MERGED_HOURS_CASES)("final review 4 I2, hand route, %s: asks for the hours, Apply refused", async (_label, kind, months, sub, values) => {
    const deps = depsOf({ resources });
    const { result } = await loadFileNow(deps, await mergedHoursFile(kind, mergedHours(months, sub, values)));
    expect(result.current.mapping).toMatchObject({ layout: "long", hours: 2 });
    expect(result.current.ambiguous).toEqual([{ field: "hours", candidates: [2, 3] }]);
    refusedBeforeConfirmation(result, deps);
  });

  it.each(MERGED_HOURS_CASES)("final review 4 I2, Claude route, %s: asks for the hours, Apply refused", async (_label, kind, months, sub, values) => {
    claudeResponds({ layout: "long", headerRow: 1, person: "A", period: "B", hours: "C" });
    const deps = depsOf({ resources });
    const { result } = await loadFileNow(deps, await mergedHoursFile(kind, mergedHours(months, sub, values)));
    await askClaudeNow(result);
    expect(result.current.ambiguous).toEqual([{ field: "hours", candidates: [2, 3] }]);
    refusedBeforeConfirmation(result, deps, "forecastImportConfirmClaudeFirst");
  });

  it("M1: one detectable sheet behaves as today", async () => {
    const deps = depsOf();
    const { result } = await loadFileNow(deps, await workbook([{ name: "Notes", grid: [["just", "words"]] }, { name: "Forecast", grid: SAME_SHAPE("12") }]));
    expect(result.current.sheetIndex).toBe(1);
    expect(result.current.ambiguous).toEqual([]);
    expect(result.current.step).toBe("preview");
    expect(applyOutcome(result)).toBe("applied");
  });
});
