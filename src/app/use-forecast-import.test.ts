// §500 — the forecast import's state machine: file → sheet grid → rows →
// validated → plan → ONE bucket commit. The engines are tested beside
// themselves; this pins the wiring and, above all, that Apply re-plans from the
// LIVE buckets and refuses rather than writes when the bucket changed under an
// open preview (Review Focus 5).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { defaultSettings, type Settings } from "./settings-types";
import type { BudgetBucket, Resource, ResourcePlan, Role } from "./types";
import { AiHttpError } from "./ai-errors";
import { MAX_ATTACHMENT_BYTES } from "./chat-attachments";
import { forecastImportErrorOf, useForecastImport, wideMappingFor, type ForecastImportDeps } from "./use-forecast-import";

vi.mock("./use-settings", () => ({ useSettings: vi.fn() }));
import { useSettings } from "./use-settings";
const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>;

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

  it("opens the mapping step on the default columns when no layout is found", async () => {
    const { result } = await loaded(depsOf(), "just,some\r\nwords,here\r\n");
    expect(result.current.step).toBe("mapping");
    expect(result.current.layoutDetected).toBe(false);
    expect(result.current.mapping).toEqual(wideMappingFor(result.current.sheets[0].rows, 0, { person: 0 }));
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
  });
});

describe("useForecastImport — the Claude route", () => {
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
});
