import { describe, it, expect, vi } from "vitest";
import { entityToken } from "./ai-entity-token";
import { toolNamesFor, toolsFor } from "./chat-api";
import { TOKEN_REQUIRED_TOOLS } from "./chat-proposal-apply";
import { runTool } from "./chat-tools";
import { ConcurrencyTokenError } from "./chat-tools-updates";
import { FORECAST_OFF_MESSAGE, NOT_FORECAST_TOOL, runForecastTool, type ForecastToolDispatcher } from "./chat-tools-forecast";
import { FORECAST_TOOL_DEFS } from "./chat-tool-defs-forecast";
import { blockToken } from "./document-block-token";
import type { DocBlock } from "./document-model";
import { DEFAULT_HISTORY_WINDOW, MAX_HORIZON_WORKING_DAYS } from "./forecast/constants";
import { MAX_FORECAST_SCENARIOS, type ForecastScenario } from "./forecast-scenarios";

// §502 part 4 — six since the three decision writes joined (delete, proposal, target confidence).
const FORECAST_NAMES = [
  "get_forecast", "create_forecast_scenario", "update_forecast_scenario",
  "delete_forecast_scenario", "set_forecast_proposal", "set_forecast_target_confidence",
];

const row: ForecastScenario = {
  id: 3,
  name: "Hire two",
  changes: [{ kind: "scope", tasks: 5, on: "2026-11-02" }],
};

const result = { id: 3, name: "Hire two", expectedToken: "t", changes: row.changes };

function makeDispatcher(over: Partial<ForecastToolDispatcher> = {}): ForecastToolDispatcher {
  return {
    isForecastEnabled: vi.fn(() => true),
    getForecast: vi.fn(() => ({}) as ReturnType<ForecastToolDispatcher["getForecast"]>),
    getForecastScenarioRow: vi.fn((id: number) => (id === 3 ? row : null)),
    createForecastScenario: vi.fn(() => result),
    updateForecastScenario: vi.fn(() => result),
    deleteForecastScenario: vi.fn((id: number) => ({ deleted: true as const, id, name: "Hire two" })),
    setForecastProposal: vi.fn((id: number | null) => ({ proposal: id === null ? null : { id, name: "Hire two" } })),
    setForecastTargetConfidence: vi.fn((v) => ({ targetConfidence: v })),
    ...over,
  };
}

describe("the forecast tool variant bit", () => {
  it("offers none of the six unless forecast is true", () => {
    for (const flags of [{}, { historySearch: true, chatSearch: true }, { forecast: false }]) {
      const names = toolNamesFor(flags);
      for (const n of FORECAST_NAMES) expect(names.has(n)).toBe(false);
    }
  });

  it("offers all six when forecast is true", () => {
    const names = toolNamesFor({ forecast: true });
    for (const n of FORECAST_NAMES) expect(names.has(n)).toBe(true);
  });

  it("keeps one array identity per combination", () => {
    expect(toolsFor({ forecast: true })).toBe(toolsFor({ forecast: true }));
    expect(toolsFor({ forecast: true })).not.toBe(toolsFor({}));
  });

  it("declares the update and delete tokens as required", () => {
    expect(TOKEN_REQUIRED_TOOLS.has("update_forecast_scenario")).toBe(true);
    expect(TOKEN_REQUIRED_TOOLS.has("delete_forecast_scenario")).toBe(true);
  });
});

describe("the model-facing texts", () => {
  const description = (name: string) => FORECAST_TOOL_DEFS.find((d) => d.name === name)?.description ?? "";

  // ★ The Forecast view runs the simulation whatever the switch says, so the refusal must not claim
  //   forecasting itself is off; it sends the user to the view instead.
  it("the off refusal points to the Forecast view and never says forecasting is off", () => {
    expect(FORECAST_OFF_MESSAGE).toBe(
      'The assistant cannot read or write this project\'s forecast: the project\'s "Use Monte Carlo forecasting" switch is off, or the Forecast view is hidden. While the view is shown it still displays the simulation to the user; point them there, and never estimate forecast dates yourself. Nothing was read or written.',
    );
  });

  it("templates the constants into the descriptions", () => {
    expect(description("get_forecast")).toContain(`(${DEFAULT_HISTORY_WINDOW}-working-day history, tasks unit)`);
    expect(description("get_forecast")).toContain('"beyond" means past the 1,300-working-day horizon');
    expect(MAX_HORIZON_WORKING_DAYS).toBe(1300);
    expect(description("create_forecast_scenario")).toContain(`(at most ${MAX_FORECAST_SCENARIOS} per project)`);
  });

  it("states when cost is null or unavailable, and when weeklyChange is null", () => {
    const text = description("get_forecast");
    expect(text).toContain(
      "cost is null when the Budget module is off, the project has no budget buckets, or the simulation switch is off; cost is {unavailable: reason} when a cost exists but cannot be simulated yet",
    );
    expect(text).not.toContain("cost basis");
    expect(text).toContain('weeklyChange is null when asIs is "insufficient"');
  });

  it("describes the decision reads: target, what it would take, proposal and P80 history (§502 part 4)", () => {
    const text = description("get_forecast");
    expect(text).toContain("targetConfidence (50, 80 or 95) is the project's goal for a chance, as a percent: chances are fractions, so 80 means 0.8");
    expect(text).toContain(
      'whatItTakes holds planEnd (null when asIs has no plan-end chance) and one entry per milestone whose chance is below targetConfidence, worst first, at most 5; notSearched lists {id, name} of the below-target milestones that were not searched, normally those past the cap; planEnd is null and both lists are empty when asIs is "insufficient", and {omitted: "whatIf"} on a call with whatIf (it does not depend on the draft: call without whatIf to read it)',
    );
    expect(text).toContain('state "inert" with a reason (needs-booked-hours, no-open-tasks, too-few-tasks)');
    expect(text).toContain("proposal is {id, name} of the scenario the user proposed, or null");
    expect(text).toContain("p80History is the last 26 recorded entries, oldest first");
  });

  it("says what removedRows counts", () => {
    expect(description("update_forecast_scenario")).toContain(
      "removedRows: stored rows not kept unchanged (an edited row counts as removed and re-added)",
    );
  });
});

describe("runForecastTool", () => {
  it("returns the sentinel for a name that is not a forecast tool", () => {
    expect(runForecastTool("list_tasks", {}, makeDispatcher())).toBe(NOT_FORECAST_TOOL);
  });

  it("refuses every forecast tool while the simulation is off, touching nothing", () => {
    for (const name of FORECAST_NAMES) {
      const d = makeDispatcher({ isForecastEnabled: () => false });
      expect(() => runForecastTool(name, { id: 3, expectedToken: "x" }, d)).toThrow(FORECAST_OFF_MESSAGE);
      expect(d.getForecast).not.toHaveBeenCalled();
      expect(d.getForecastScenarioRow).not.toHaveBeenCalled();
      expect(d.createForecastScenario).not.toHaveBeenCalled();
      expect(d.updateForecastScenario).not.toHaveBeenCalled();
      expect(d.deleteForecastScenario).not.toHaveBeenCalled();
      expect(d.setForecastProposal).not.toHaveBeenCalled();
      expect(d.setForecastTargetConfidence).not.toHaveBeenCalled();
    }
  });

  it("reads with no whatIf as null", () => {
    const d = makeDispatcher();
    runForecastTool("get_forecast", {}, d);
    expect(d.getForecast).toHaveBeenCalledWith(null);
  });

  it("prefixes a bad whatIf row's error", () => {
    const d = makeDispatcher();
    expect(() =>
      runForecastTool("get_forecast", { whatIf: [{ kind: "scope", tasks: "3", on: "2026-11-02" }] }, d),
    ).toThrow("whatIf changes[0]: tasks must be a number");
    expect(d.getForecast).not.toHaveBeenCalled();
  });

  it("creates through the dispatcher with parsed changes", () => {
    const d = makeDispatcher();
    runForecastTool("create_forecast_scenario", { name: "A", changes: row.changes }, d);
    expect(d.createForecastScenario).toHaveBeenCalledWith("A", row.changes);
  });

  it("refuses a create without a string name", () => {
    expect(() => runForecastTool("create_forecast_scenario", { name: 4, changes: [] }, makeDispatcher())).toThrow(
      "name must be a string",
    );
  });

  describe("update_forecast_scenario", () => {
    it("reports an unknown id as not found before any token check", () => {
      expect(() => runForecastTool("update_forecast_scenario", { id: 9 }, makeDispatcher())).toThrow(
        "forecast scenario 9 not found",
      );
    });

    it("refuses a missing token", () => {
      const d = makeDispatcher();
      expect(() => runForecastTool("update_forecast_scenario", { id: 3, name: "x" }, d)).toThrow(
        ConcurrencyTokenError,
      );
      expect(d.updateForecastScenario).not.toHaveBeenCalled();
    });

    it("refuses a wrong token", () => {
      const d = makeDispatcher();
      expect(() =>
        runForecastTool("update_forecast_scenario", { id: 3, expectedToken: "nope", name: "x" }, d),
      ).toThrow(ConcurrencyTokenError);
      expect(d.updateForecastScenario).not.toHaveBeenCalled();
    });

    it("needs name or changes once the token holds", () => {
      const d = makeDispatcher();
      const expectedToken = entityToken("forecastScenario", row);
      expect(() => runForecastTool("update_forecast_scenario", { id: 3, expectedToken }, d)).toThrow(
        "send name, changes, or both",
      );
    });

    it("renames with a valid token and passes only the fields sent", () => {
      const d = makeDispatcher();
      const expectedToken = entityToken("forecastScenario", row);
      runForecastTool("update_forecast_scenario", { id: 3, expectedToken, name: "B" }, d);
      expect(d.updateForecastScenario).toHaveBeenCalledWith(3, { name: "B" });
    });

    it("replaces changes with a valid token", () => {
      const d = makeDispatcher();
      const expectedToken = entityToken("forecastScenario", row);
      runForecastTool("update_forecast_scenario", { id: 3, expectedToken, changes: [] }, d);
      expect(d.updateForecastScenario).toHaveBeenCalledWith(3, { changes: [] });
    });
  });
});

describe("the decision writes (§502 part 4)", () => {
  describe("delete_forecast_scenario", () => {
    it("refuses a stale token, deleting nothing", () => {
      const d = makeDispatcher();
      const stale = entityToken("forecastScenario", { ...row, name: "Old name" });
      expect(() => runForecastTool("delete_forecast_scenario", { id: 3, expectedToken: stale }, d)).toThrow(
        ConcurrencyTokenError,
      );
      expect(d.deleteForecastScenario).not.toHaveBeenCalled();
    });

    it("reports an unknown id as not found", () => {
      expect(() => runForecastTool("delete_forecast_scenario", { id: 9, expectedToken: "x" }, makeDispatcher())).toThrow(
        "forecast scenario 9 not found",
      );
    });

    it("deletes with a valid token", () => {
      const d = makeDispatcher();
      const expectedToken = entityToken("forecastScenario", row);
      expect(runForecastTool("delete_forecast_scenario", { id: 3, expectedToken }, d)).toEqual({
        deleted: true, id: 3, name: "Hire two",
      });
      expect(d.deleteForecastScenario).toHaveBeenCalledWith(3);
    });
  });

  describe("set_forecast_proposal", () => {
    it("passes a numeric id, and null to clear", () => {
      const d = makeDispatcher();
      runForecastTool("set_forecast_proposal", { id: 3 }, d);
      runForecastTool("set_forecast_proposal", { id: null }, d);
      expect(vi.mocked(d.setForecastProposal).mock.calls).toEqual([[3], [null]]);
    });

    it.each([["a string", "3"], ["absent", undefined], ["NaN", Number.NaN]])("refuses an id that is %s", (_l, id) => {
      const d = makeDispatcher();
      expect(() => runForecastTool("set_forecast_proposal", { id }, d)).toThrow("id must be a number, or null to clear");
      expect(d.setForecastProposal).not.toHaveBeenCalled();
    });
  });

  describe("set_forecast_target_confidence", () => {
    it.each([50, 80, 95] as const)("sets %i", (value) => {
      const d = makeDispatcher();
      expect(runForecastTool("set_forecast_target_confidence", { value }, d)).toEqual({ targetConfidence: value });
    });

    it.each([70, "95", undefined])("refuses %s, writing nothing", (value) => {
      const d = makeDispatcher();
      expect(() => runForecastTool("set_forecast_target_confidence", { value }, d)).toThrow("value must be one of 50, 80, 95");
      expect(d.setForecastTargetConfidence).not.toHaveBeenCalled();
    });
  });

  it("schemas: delete takes the token, the proposal id may be null, the target is an enum of the three", () => {
    const schema = (name: string) => FORECAST_TOOL_DEFS.find((d) => d.name === name)?.input_schema as unknown as {
      properties: Record<string, { type?: unknown; enum?: unknown }>; required: string[];
    };
    expect(schema("delete_forecast_scenario").required).toEqual(["id", "expectedToken"]);
    expect(schema("set_forecast_proposal").properties.id.type).toEqual(["number", "null"]);
    expect(schema("set_forecast_target_confidence").properties.value.enum).toEqual([50, 80, 95]);
  });
});

// §502 part 4, ruling P3-1 — the forecast decision data section exists only while the simulation is active.
describe("the forecastDecision data section follows the simulation", () => {
  type Def = { name: string; input_schema: unknown };
  const keysIn = (defs: readonly Def[], name: string): string[] => {
    const def = defs.find((d) => d.name === name);
    expect(def).toBeDefined();
    return [...JSON.stringify(def).matchAll(/"forecastDecision"/g)].map((m) => m[0]);
  };

  it("offers it on create_document and update_document only with the forecast bit", () => {
    const on = toolsFor({ forecast: true }) as readonly Def[];
    const off = toolsFor({}) as readonly Def[];
    for (const name of ["create_document", "update_document"]) {
      expect(keysIn(on, name).length).toBeGreaterThan(0);
      expect(keysIn(off, name)).toEqual([]);
    }
    // CONTROL: only that key went — every other data section is still offered while off.
    const offCreate = JSON.stringify(off.find((d) => d.name === "create_document"));
    const onCreate = JSON.stringify(on.find((d) => d.name === "create_document"));
    expect(offCreate).toBe(onCreate.replaceAll(',"forecastDecision"', "").replaceAll('"forecastDecision",', ""));
    expect(offCreate).toContain('"budgetForecast"');
  });

  const block = { type: "dataSection", key: "forecastDecision" };
  const tasksBlock = { type: "dataSection", key: "tasks" };
  const docDispatcher = (enabled: boolean, stored: readonly unknown[] = [tasksBlock]) => ({
    ...makeDispatcher({ isForecastEnabled: () => enabled }),
    getDocument: vi.fn((id: number) => (id === 1 ? { id: 1, title: "T", blocks: stored } : null)),
    createDocument: vi.fn(() => ({ id: 1, title: "T", blockCount: 1 })),
    updateDocument: vi.fn(() => ({ applied: 1, rejected: [] })),
  });

  it("refuses a create_document or update_document naming it while the simulation is off", async () => {
    const d = docDispatcher(false);
    await expect(runTool(d as never, "create_document", { title: "T", blocks: [block] })).rejects.toThrow(FORECAST_OFF_MESSAGE);
    await expect(
      runTool(d as never, "update_document", { id: 1, ops: [{ op: "insert", index: 0, block }] }),
    ).rejects.toThrow(FORECAST_OFF_MESSAGE);
    expect(d.createDocument).not.toHaveBeenCalled();
    expect(d.updateDocument).not.toHaveBeenCalled();
  });

  // A block the user added while the simulation was on stays theirs: refusing its re-send would teach the
  // model to retry without it, deleting the section through the AI. Only an ADDED block refuses.
  it("lets an update_document re-send a decision block the document already holds while off", async () => {
    const d = docDispatcher(false, [block, tasksBlock]);
    const replaceAll = { id: 1, ops: [{ op: "replaceAll", blocks: [block, tasksBlock, { type: "pageBreak" }] }] };
    await runTool(d as never, "update_document", replaceAll);
    const replace = { op: "replace", index: 0, block, expectHash: blockToken(block as DocBlock) };
    await runTool(d as never, "update_document", { id: 1, ops: [replace] });
    expect(d.updateDocument).toHaveBeenCalledTimes(2);
  });

  it("refuses an update_document adding a decision block beyond the ones it holds while off", async () => {
    const none = docDispatcher(false);
    await expect(
      runTool(none as never, "update_document", { id: 1, ops: [{ op: "replaceAll", blocks: [block, tasksBlock] }] }),
    ).rejects.toThrow(FORECAST_OFF_MESSAGE);
    const one = docDispatcher(false, [block]);
    await expect(
      runTool(one as never, "update_document", { id: 1, ops: [{ op: "append", block }] }),
    ).rejects.toThrow(FORECAST_OFF_MESSAGE);
    await expect(
      runTool(none as never, "update_document", { id: 2, ops: [{ op: "append", block }] }),
    ).rejects.toThrow(FORECAST_OFF_MESSAGE);
    expect(none.updateDocument).not.toHaveBeenCalled();
    expect(one.updateDocument).not.toHaveBeenCalled();
  });

  it("accepts it while the simulation is on", async () => {
    const d = docDispatcher(true);
    await runTool(d as never, "create_document", { title: "T", blocks: [block] });
    expect(d.createDocument).toHaveBeenCalledWith("T", [block]);
  });

  it("CONTROL: a document without it is untouched by the gate while off", async () => {
    const d = docDispatcher(false);
    await runTool(d as never, "create_document", { title: "T", blocks: [{ type: "dataSection", key: "tasks" }] });
    expect(d.createDocument).toHaveBeenCalled();
  });
});

describe("runTool routing", () => {
  it("routes a forecast name to the gate before the unknown-tool throw", async () => {
    const d = makeDispatcher({ isForecastEnabled: () => false });
    await expect(runTool(d as never, "get_forecast", {})).rejects.toThrow(FORECAST_OFF_MESSAGE);
  });
});
