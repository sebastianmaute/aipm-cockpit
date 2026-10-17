import { describe, expect, it } from "vitest";
import { checkToolDraft, parseToolChanges } from "./forecast-scenario-tool-input";
import type { ForecastScenario, ScenarioChange, ValidationContext } from "./forecast-scenarios";
import type { Milestone, Resource } from "./types";

const avail = { kind: "availability", percent: 50, from: "2026-11-02" };
const person = { kind: "addPeople", who: { resourceId: 3, hoursPerWeek: 20 }, from: "2026-11-02" };
const placeholder = {
  kind: "addPeople",
  who: { label: "Dev", count: 2, rate: 90, currency: "EUR", hoursPerWeek: 30 },
  from: "2026-11-02",
};

describe("parseToolChanges", () => {
  it("refuses a numeric string, never coerces it", () => {
    expect(parseToolChanges([{ ...avail, percent: "50" }])).toEqual({
      ok: false, error: "changes[0]: percent must be a number",
    });
  });

  it("refuses a non-finite number", () => {
    expect(parseToolChanges([{ ...avail, percent: Number.POSITIVE_INFINITY }])).toEqual({
      ok: false, error: "changes[0]: percent must be a number",
    });
  });

  it("defaults an absent until to the empty string", () => {
    expect(parseToolChanges([avail])).toEqual({
      ok: true, changes: [{ kind: "availability", percent: 50, from: "2026-11-02", until: "" }],
    });
  });

  it("defaults an absent rampWeeks to 4", () => {
    const r = parseToolChanges([person]);
    expect(r).toEqual({
      ok: true,
      changes: [{ kind: "addPeople", who: { resourceId: 3, hoursPerWeek: 20 }, from: "2026-11-02", until: "", rampWeeks: 4 }],
    });
  });

  it("does not clamp an out-of-range value", () => {
    expect(parseToolChanges([{ ...avail, percent: 5000 }])).toEqual({
      ok: true, changes: [{ kind: "availability", percent: 5000, from: "2026-11-02", until: "" }],
    });
  });

  it("accepts a placeholder who", () => {
    const r = parseToolChanges([placeholder]);
    expect(r.ok).toBe(true);
  });

  it("refuses a who carrying both shapes", () => {
    const both = { ...person, who: { resourceId: 3, label: "Dev", hoursPerWeek: 20 } };
    expect(parseToolChanges([both])).toEqual({
      ok: false,
      error: "changes[0]: who must be either {resourceId, hoursPerWeek} or {label, count, rate, currency, hoursPerWeek}",
    });
  });

  it("refuses a resource who carrying a placeholder key", () => {
    const mixed = { ...person, who: { resourceId: 3, hoursPerWeek: 20, rate: 5 } };
    expect(parseToolChanges([mixed]).ok).toBe(false);
  });

  it("refuses an unknown kind", () => {
    const r = parseToolChanges([{ kind: "hire", from: "2026-11-02" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.startsWith("changes[0]: ")).toBe(true);
  });

  it("refuses 21 rows", () => {
    expect(parseToolChanges(Array.from({ length: 21 }, () => avail))).toEqual({
      ok: false, error: "changes must be an array of at most 20 rows",
    });
  });

  it("refuses a non-array", () => {
    expect(parseToolChanges("x")).toEqual({ ok: false, error: "changes must be an array of at most 20 rows" });
  });

  it("drops an unknown extra key", () => {
    const r = parseToolChanges([{ ...avail, foo: 1 }]);
    expect(r).toEqual({
      ok: true, changes: [{ kind: "availability", percent: 50, from: "2026-11-02", until: "" }],
    });
  });

  it("names the index of the failing row", () => {
    expect(parseToolChanges([avail, avail, { ...avail, percent: "x" }])).toEqual({
      ok: false, error: "changes[2]: percent must be a number",
    });
  });

  it("parses a scope row with and without a milestone", () => {
    expect(parseToolChanges([{ kind: "scope", tasks: 5, on: "2026-11-02" }])).toEqual({
      ok: true, changes: [{ kind: "scope", tasks: 5, on: "2026-11-02" }],
    });
    expect(parseToolChanges([{ kind: "scope", tasks: 5, on: "2026-11-02", milestoneId: 7 }])).toEqual({
      ok: true, changes: [{ kind: "scope", tasks: 5, on: "2026-11-02", milestoneId: 7 }],
    });
  });
});

const TODAY = "2026-11-02";
function milestone(id: number, achievedDate: string): Milestone {
  return { id, name: "M" + id, date: "2026-12-01", achievedDate, linkedTaskIds: [] } as unknown as Milestone;
}
function resource(id: number, active = true): Resource {
  return { id, firstName: "R", lastName: String(id), active } as unknown as Resource;
}
function ctx(over: Partial<ValidationContext> = {}): ValidationContext {
  return { milestones: [], resources: [], onTeam: new Set(), ...over };
}
function draft(over: Partial<Parameters<typeof checkToolDraft>[0]> = {}): Parameters<typeof checkToolDraft>[0] {
  return { name: "Plan", changes: [], list: [], exceptId: null, stored: [], ctx: ctx(), ...over };
}
const okRow: ScenarioChange = { kind: "availability", percent: 50, from: TODAY, until: "" };

describe("checkToolDraft", () => {
  it("returns null for a valid draft", () => {
    expect(checkToolDraft(draft({ changes: [okRow] }))).toBeNull();
  });

  it("returns the cap text at the cap", () => {
    const list: ForecastScenario[] = [1, 2, 3, 4].map((id) => ({ id, name: "S" + id, changes: [] }));
    expect(checkToolDraft(draft({ list }))).toBe(
      "This project already has 4 saved scenarios, the most it can keep. Ask the user to delete one first.",
    );
  });

  it("refuses names", () => {
    expect(checkToolDraft(draft({ name: "  " }))).toBe("A scenario needs a name.");
    expect(checkToolDraft(draft({ name: "x".repeat(61) }))).toBe("A scenario name can be at most 60 characters.");
    expect(checkToolDraft(draft({ name: "plan", list: [{ id: 1, name: "Plan", changes: [] }] }))).toBe(
      'A scenario named "plan" already exists. Choose another name.',
    );
  });

  it("refuses too many changes", () => {
    expect(checkToolDraft(draft({ changes: Array.from({ length: 21 }, () => okRow) }))).toBe(
      "A scenario can hold at most 20 changes.",
    );
  });

  it("lists every failing row, joined by a semicolon", () => {
    const bad1: ScenarioChange = { kind: "availability", percent: 5, from: TODAY, until: "" };
    const bad2: ScenarioChange = { kind: "availability", percent: 50, from: "nope", until: "" };
    expect(checkToolDraft(draft({ changes: [bad1, okRow, bad2] }))).toBe(
      "changes[0]: percent must be between 10 and 300; changes[2]: dates must be YYYY-MM-DD",
    );
  });

  it("words the reference refusals", () => {
    const scope = (milestoneId: number): ScenarioChange => ({ kind: "scope", tasks: 3, on: TODAY, milestoneId });
    const who = (resourceId: number): ScenarioChange => ({
      kind: "addPeople", who: { resourceId, hoursPerWeek: 10 }, from: TODAY, until: "", rampWeeks: 0,
    });
    const c = ctx({
      milestones: [milestone(8, "2026-10-01")],
      resources: [resource(1, false), resource(2)],
      onTeam: new Set([2]),
    });
    expect(checkToolDraft(draft({ changes: [scope(99)], ctx: c }))).toBe("changes[0]: milestone 99 does not exist");
    expect(checkToolDraft(draft({ changes: [scope(8)], ctx: c }))).toBe(
      "changes[0]: milestone 8 is already achieved or cancelled",
    );
    expect(checkToolDraft(draft({ changes: [who(9)], ctx: c }))).toBe("changes[0]: resource 9 does not exist");
    expect(checkToolDraft(draft({ changes: [who(1)], ctx: c }))).toBe("changes[0]: resource 1 is archived");
    expect(checkToolDraft(draft({ changes: [who(2)], ctx: c }))).toBe(
      "changes[0]: resource 2 already works on this project; use an availability change instead",
    );
  });

  it("accepts a stale reference only when a stored row keeps it", () => {
    const row: ScenarioChange = { kind: "scope", tasks: 3, on: TODAY, milestoneId: 7 };
    const c = ctx({ milestones: [milestone(7, "2026-10-01")] });
    expect(checkToolDraft(draft({ changes: [row], stored: [{ ...row, tasks: 9 }], ctx: c }))).toBeNull();
    expect(checkToolDraft(draft({ changes: [row], stored: [], ctx: c }))).toBe(
      "changes[0]: milestone 7 is already achieved or cancelled",
    );
  });

  it("matches a stored row by its reference, not its index", () => {
    const row: ScenarioChange = { kind: "scope", tasks: 3, on: TODAY, milestoneId: 7 };
    const other: ScenarioChange = { kind: "scope", tasks: 1, on: TODAY, milestoneId: 6 };
    const c = ctx({ milestones: [milestone(7, "2026-10-01")] });
    expect(checkToolDraft(draft({ changes: [okRow, row], stored: [row, other], ctx: c }))).toBeNull();
  });

  it("refuses a stale reference when the stored rows keep only other references", () => {
    const row: ScenarioChange = { kind: "scope", tasks: 3, on: TODAY, milestoneId: 7 };
    const other: ScenarioChange = { kind: "scope", tasks: 1, on: TODAY, milestoneId: 6 };
    const c = ctx({ milestones: [milestone(7, "2026-10-01")] });
    expect(checkToolDraft(draft({ changes: [row], stored: [other], ctx: c }))).toBe(
      "changes[0]: milestone 7 is already achieved or cancelled",
    );
  });

  it("does not excuse a non-reference error on a kept reference", () => {
    const row: ScenarioChange = { kind: "scope", tasks: 0, on: TODAY, milestoneId: 7 };
    const c = ctx({ milestones: [milestone(7, "2026-10-01")] });
    expect(checkToolDraft(draft({ changes: [row], stored: [row], ctx: c }))).toBe(
      "changes[0]: tasks must be a non-zero whole number between -1000 and 1000",
    );
  });

  it("words the remaining row refusals", () => {
    const place = (who: Record<string, unknown>): ScenarioChange => ({
      kind: "addPeople", who: who as never, from: TODAY, until: "", rampWeeks: 0,
    });
    const base = { label: "Dev", count: 2, rate: 90, currency: "EUR", hoursPerWeek: 30 };
    const text = (c: ScenarioChange) => checkToolDraft(draft({ changes: [c] }));
    expect(text({ ...okRow, until: "2026-10-01" })).toBe("changes[0]: until must be on or after from");
    expect(text(place({ ...base, hoursPerWeek: 99 }))).toBe("changes[0]: hoursPerWeek must be between 1 and 60");
    expect(text(place({ ...base, count: 0 }))).toBe("changes[0]: count must be a whole number from 1 to 20");
    expect(text({ ...place(base), rampWeeks: 30 } as ScenarioChange)).toBe(
      "changes[0]: rampWeeks must be a whole number from 0 to 26",
    );
    expect(text(place({ ...base, rate: -1 }))).toBe("changes[0]: rate must be between 0 and 100000");
    expect(text(place({ ...base, currency: "XXX" }))).toBe("changes[0]: currency must be one of EUR, USD, GBP, INR");
    expect(text(place({ ...base, label: " " }))).toBe("changes[0]: label must be 1 to 60 characters");
  });
});
