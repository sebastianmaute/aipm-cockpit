import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { useForecastScenarios, type ScenarioDraft } from "./use-forecast-scenarios";
import { useUndoStack, type CaptureOpts } from "./undo/use-undo-stack";
import { __resetMintStateForTests } from "./id-mint-session";
import { MAX_FORECAST_SCENARIOS, sanitizeForecastScenarios, type ForecastScenario, type ScenarioChange } from "./forecast-scenarios";
import type { ActivityKind, FieldChange } from "./activity-log";
import { t, type Lang } from "./i18n";

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

const AVAIL: ScenarioChange = { kind: "availability", percent: 80, from: "2026-11-02", until: "" };
const SCOPE: ScenarioChange = { kind: "scope", tasks: 5, on: "2026-11-09" };

function draft(name: string, changes: readonly ScenarioChange[] = [AVAIL]): ScenarioDraft {
  return { name, changes };
}

// A REAL undo stack beside the hook, with `capture` wrapped so each test can
// both count the captures AND undo through the live setter.
function setup() {
  const logActivity = vi.fn<(kind: ActivityKind, ...args: (string | number)[]) => void>();
  const logActivityChanges = vi.fn<(kind: ActivityKind, changes: readonly FieldChange[], ...args: (string | number)[]) => void>();
  const showToast = vi.fn<(kind: "info" | "error", text: string) => void>();
  const captures: CaptureOpts<{ id: number }>[] = [];
  const { result } = renderHook(
    () => {
      const undoApi = useUndoStack({ lang: "en-US" as Lang, logActivity: vi.fn(), showToast: vi.fn(), showToastAction: vi.fn() });
      const api = useForecastScenarios({
        lang: "en-US",
        showToast,
        logActivity,
        logActivityChanges,
        capture: (opts) => {
          captures.push(opts as unknown as CaptureOpts<{ id: number }>);
          undoApi.capture(opts);
        },
      });
      const workspace = useWorkspace();
      return { api, workspace, undo: undoApi.undo };
    },
    { wrapper: Wrapper },
  );
  return { result, logActivity, logActivityChanges, showToast, captures };
}

function seed(result: ReturnType<typeof setup>["result"], list: readonly ForecastScenario[]) {
  act(() => result.current.workspace.setForecastScenarios(list));
}

beforeEach(() => {
  __resetMintStateForTests();
});

describe("useForecastScenarios — create", () => {
  it("create appends, logs created and captures nothing", () => {
    const { result, logActivity, captures } = setup();
    let id: number | null = null;
    act(() => {
      id = result.current.api.createScenario(result.current.api.mintId(), draft("  Hire two  "));
    });
    expect(id).toBe(1);
    expect(result.current.workspace.forecastScenarios).toEqual([{ id: 1, name: "Hire two", changes: [AVAIL] }]);
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(logActivity).toHaveBeenCalledWith("forecastScenario.created", 1, "Hire two");
    expect(captures).toHaveLength(0);
  });

  it("a create whose open-time id was taken since re-mints and leaves the concurrent scenario untouched", () => {
    const { result } = setup();
    const openId = result.current.api.mintId();
    const concurrent: ForecastScenario = { id: openId, name: "From the AI", changes: [SCOPE] };
    // The collision lands BETWEEN the editor opening (mintId) and its save.
    act(() => result.current.workspace.setForecastScenarios((prev) => [...prev, concurrent]));
    let id: number | null = null;
    act(() => {
      id = result.current.api.createScenario(openId, draft("Mine"));
    });
    expect(id).not.toBeNull();
    expect(id).not.toBe(openId);
    const list = result.current.workspace.forecastScenarios;
    expect(list).toHaveLength(2);
    expect(list.find((s) => s.id === openId)).toBe(concurrent);
    expect(list.find((s) => s.id === id)?.name).toBe("Mine");
  });

  it("a deleted scenario's id is not reused by the next create", () => {
    const { result } = setup();
    let second: number | null = null;
    act(() => {
      result.current.api.createScenario(result.current.api.mintId(), draft("A"));
    });
    act(() => {
      second = result.current.api.createScenario(result.current.api.mintId(), draft("B"));
    });
    act(() => result.current.api.deleteScenario(second as unknown as number));
    let third: number | null = null;
    act(() => {
      third = result.current.api.createScenario(result.current.api.mintId(), draft("C"));
    });
    expect(second).toBe(2);
    expect(third).toBe(3);
  });

  it("create is refused at the cap", () => {
    const { result, logActivity } = setup();
    const full = Array.from({ length: MAX_FORECAST_SCENARIOS }, (_, i) => ({ id: i + 1, name: `S${i + 1}`, changes: [] }));
    seed(result, full);
    expect(result.current.api.canCreate).toBe(false);
    let id: number | null = 0;
    act(() => {
      id = result.current.api.createScenario(result.current.api.mintId(), draft("Fifth"));
    });
    expect(id).toBeNull();
    expect(result.current.workspace.forecastScenarios).toHaveLength(MAX_FORECAST_SCENARIOS);
    expect(logActivity).not.toHaveBeenCalled();
  });
});

describe("useForecastScenarios — edit and rename", () => {
  it("an edit that changes name and rows is ONE undo entry and one log entry whose changes are the name diff plus the synthetic row count", () => {
    const { result, captures, logActivityChanges } = setup();
    seed(result, [{ id: 1, name: "Old", changes: [AVAIL] }]);
    let ok = false;
    act(() => {
      ok = result.current.api.updateScenario(1, draft("New", [AVAIL, SCOPE]));
    });
    expect(ok).toBe(true);
    expect(result.current.workspace.forecastScenarios).toEqual([{ id: 1, name: "New", changes: [AVAIL, SCOPE] }]);
    expect(captures).toHaveLength(1);
    expect(captures[0].kind).toBe("forecastScenario.updated");
    expect(logActivityChanges).toHaveBeenCalledTimes(1);
    expect(logActivityChanges).toHaveBeenCalledWith(
      "forecastScenario.updated",
      [
        { field: "name", from: "Old", to: "New" },
        { field: "changes", from: "1", to: "2" },
      ],
      1,
      "New",
    );
  });

  it("a rows-only edit logs only the row count", () => {
    const { result, captures, logActivityChanges } = setup();
    seed(result, [{ id: 1, name: "Same", changes: [AVAIL, SCOPE] }]);
    act(() => {
      result.current.api.updateScenario(1, draft("Same", [SCOPE]));
    });
    expect(captures).toHaveLength(1);
    expect(logActivityChanges).toHaveBeenCalledWith(
      "forecastScenario.updated",
      [{ field: "changes", from: "2", to: "1" }],
      1,
      "Same",
    );
  });

  it("a name-only save from the editor, whose rows are an equal COPY, logs no row count", () => {
    const { result, logActivityChanges } = setup();
    seed(result, [{ id: 1, name: "Old", changes: [AVAIL] }]);
    act(() => {
      result.current.api.updateScenario(1, draft("New", [{ ...AVAIL }]));
    });
    expect(logActivityChanges).toHaveBeenCalledWith(
      "forecastScenario.updated",
      [{ field: "name", from: "Old", to: "New" }],
      1,
      "New",
    );
  });

  // Final review deferred minor: the count is stored as bare digits (raw data, no language); the panel words it.
  it("a same-length rows edit logs the equal count, which the panel reads as edited", () => {
    const { result, logActivityChanges } = setup();
    seed(result, [{ id: 1, name: "Same", changes: [AVAIL] }]);
    act(() => {
      result.current.api.updateScenario(1, draft("Same", [SCOPE]));
    });
    expect(logActivityChanges).toHaveBeenCalledWith("forecastScenario.updated", [{ field: "changes", from: "1", to: "1" }], 1, "Same");
  });

  // Final review Minor 6: the sanitizer trims a placeholder label on load, so a label saved as typed changed on
  // its first round trip. Saving trims it, and an untouched list re-saved with the stored label writes nothing.
  it("trims a placeholder label on create and update, so a reload changes nothing", () => {
    const placeholder = (label: string): ScenarioChange => ({
      kind: "addPeople", who: { label, count: 1, rate: 50, currency: "EUR", hoursPerWeek: 20 }, from: "2026-11-02", until: "", rampWeeks: 4,
    });
    const { result, captures } = setup();
    act(() => {
      result.current.api.createScenario(result.current.api.mintId(), draft("Hire", [placeholder("  Dev  ")]));
    });
    const [created] = result.current.workspace.forecastScenarios;
    expect(created.changes).toEqual([placeholder("Dev")]);
    expect(sanitizeForecastScenarios(JSON.parse(JSON.stringify([created])))).toEqual([created]);
    act(() => {
      result.current.api.updateScenario(created.id, draft("Hire", [placeholder("Dev "), AVAIL]));
    });
    expect(result.current.workspace.forecastScenarios[0].changes).toEqual([placeholder("Dev"), AVAIL]);
    // Re-saving the stored rows with a padded label is no edit at all: no undo entry, the same reference.
    const stored = result.current.workspace.forecastScenarios[0];
    const before = captures.length;
    act(() => {
      result.current.api.updateScenario(created.id, draft("Hire", [placeholder(" Dev"), AVAIL]));
    });
    expect(captures).toHaveLength(before);
    expect(result.current.workspace.forecastScenarios[0]).toBe(stored);
  });

  it("rename is one undo entry", () => {
    const { result, captures, logActivityChanges } = setup();
    seed(result, [{ id: 1, name: "Old", changes: [AVAIL] }]);
    let ok = false;
    act(() => {
      ok = result.current.api.renameScenario(1, "Renamed");
    });
    expect(ok).toBe(true);
    expect(result.current.workspace.forecastScenarios[0]).toEqual({ id: 1, name: "Renamed", changes: [AVAIL] });
    expect(captures).toHaveLength(1);
    expect(logActivityChanges).toHaveBeenCalledWith(
      "forecastScenario.updated",
      [{ field: "name", from: "Old", to: "Renamed" }],
      1,
      "Renamed",
    );
  });

  it("undo of an edit restores the old changes", () => {
    const { result } = setup();
    seed(result, [{ id: 1, name: "Base", changes: [AVAIL] }]);
    act(() => {
      result.current.api.updateScenario(1, draft("Base", [SCOPE]));
    });
    expect(result.current.workspace.forecastScenarios[0].changes).toEqual([SCOPE]);
    act(() => result.current.undo());
    expect(result.current.workspace.forecastScenarios[0]).toEqual({ id: 1, name: "Base", changes: [AVAIL] });
  });

  it("editing a scenario another tab deleted toasts and writes nothing", () => {
    const { result, showToast, captures, logActivity, logActivityChanges } = setup();
    seed(result, [{ id: 1, name: "Doomed", changes: [AVAIL] }]);
    // Another writer removes it while the editor is open.
    act(() => result.current.workspace.setForecastScenarios([]));
    let ok = true;
    act(() => {
      ok = result.current.api.updateScenario(1, draft("Edited"));
    });
    expect(ok).toBe(false);
    expect(showToast).toHaveBeenCalledWith("error", t("en-US", "guardEditVanished"));
    expect(result.current.workspace.forecastScenarios).toEqual([]);
    expect(captures).toHaveLength(0);
    expect(logActivity).not.toHaveBeenCalled();
    expect(logActivityChanges).not.toHaveBeenCalled();
  });
});

describe("useForecastScenarios — delete", () => {
  it("delete captures the removed row and logs deleted", () => {
    const { result, captures, logActivity } = setup();
    const row: ForecastScenario = { id: 3, name: "Gone", changes: [SCOPE] };
    seed(result, [{ id: 1, name: "Kept", changes: [] }, row]);
    act(() => result.current.api.deleteScenario(3));
    expect(result.current.workspace.forecastScenarios.map((s) => s.id)).toEqual([1]);
    expect(captures).toHaveLength(1);
    expect(captures[0].kind).toBe("forecastScenario.deleted");
    expect(captures[0].removed).toEqual([row]);
    expect(logActivity).toHaveBeenCalledWith("forecastScenario.deleted", 3, "Gone");
  });

  it("undoing a delete at the cap restores a fifth scenario", () => {
    const { result } = setup();
    const full = Array.from({ length: MAX_FORECAST_SCENARIOS }, (_, i) => ({ id: i + 1, name: `S${i + 1}`, changes: [] }));
    seed(result, full);
    act(() => result.current.api.deleteScenario(2));
    let created: number | null = null;
    act(() => {
      created = result.current.api.createScenario(result.current.api.mintId(), draft("New one"));
    });
    expect(created).not.toBeNull();
    expect(result.current.workspace.forecastScenarios).toHaveLength(MAX_FORECAST_SCENARIOS);
    act(() => result.current.undo());
    // Undo restores a ROW; it is not a create and does not pass the cap check.
    const list = result.current.workspace.forecastScenarios;
    expect(list).toHaveLength(MAX_FORECAST_SCENARIOS + 1);
    expect(list.find((s) => s.id === 2)?.name).toBe("S2");
    expect(list.find((s) => s.id === created)?.name).toBe("New one");
  });
});
