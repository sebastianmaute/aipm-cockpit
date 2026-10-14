import { describe, expect, it } from "vitest";
import { TOOL_DEFS } from "../chat-tool-defs";
import { ALLOWED_REC_TOOLS, REC_MONEY_ARGS, recommendationPredatesSwitch, type InsightRecommendation } from "./insight";
import type { BaselineEntry } from "../baseline-currency";

type Prop = { type?: string | string[]; items?: Prop; properties?: Record<string, Prop> };
type Def = { name: string; input_schema: { properties?: Record<string, Prop> } };

/**
 * §476 — every NUMBER argument of an allowed recommendation tool, classified by a person. A
 * money argument (in the project's currency) goes in `REC_MONEY_ARGS`, so a recommendation made
 * before a currency switch is refused; anything else goes HERE, with what it measures. An
 * argument in neither list fails the test below: a new number argument must be decided, never
 * defaulted, because a description that does not say "currency" is no evidence it is not money.
 */
const NON_MONEY_NUMBER_ARGS: Readonly<Record<string, string>> = {
  id: "record id",
  probability: "risk probability, 1-5",
  impact: "risk impact, 1-5",
  scheduleImpactDays: "days",
  linkedTaskIds: "task ids",
  linkedRaidIds: "RAID item ids",
  causedByRaidIds: "RAID item ids",
  stakeholderIds: "stakeholder ids",
};

const isNumber = (p: Prop): boolean => {
  const types = Array.isArray(p.type) ? p.type : [p.type];
  if (types.includes("number") || types.includes("integer")) return true;
  return p.items !== undefined && isNumber(p.items);
};

/** Adds every number-typed (or number-array) property, at any depth: inside an object argument
 *  and inside the objects of an array argument, because `recommendationPredatesSwitch` looks
 *  for a money argument at any depth too. */
function collectNumberArgs(properties: Record<string, Prop>, found: Set<string>): void {
  for (const [arg, prop] of Object.entries(properties)) {
    if (isNumber(prop)) found.add(arg);
    collectNested(prop, found);
  }
}

/** Descends into an object's properties and through array `items` at any nesting. */
function collectNested(prop: Prop, found: Set<string>): void {
  if (prop.properties) collectNumberArgs(prop.properties, found);
  if (prop.items) collectNested(prop.items, found);
}

/** Every number-typed (or number-array) argument of every `ALLOWED_REC_TOOLS` tool. */
function numberArgsOfAllowedTools(defs: readonly Def[]): Set<string> {
  const found = new Set<string>();
  for (const def of defs) {
    if (ALLOWED_REC_TOOLS.has(def.name)) collectNumberArgs(def.input_schema.properties ?? {}, found);
  }
  return found;
}

const unclassified = (args: Set<string>): string[] =>
  [...args].filter((a) => !REC_MONEY_ARGS.includes(a) && !(a in NON_MONEY_NUMBER_ARGS)).sort();

describe("REC_MONEY_ARGS (§476)", () => {
  const defs = TOOL_DEFS as unknown as readonly Def[];

  it("every number argument of an allowed tool is classified as money or non-money", () => {
    const found = numberArgsOfAllowedTools(defs);
    expect(found.has("costImpact")).toBe(true); // anti-vacuity: the scan sees the money argument
    expect(found.has("probability")).toBe(true); // and a non-money one
    expect(unclassified(found)).toEqual([]);
  });

  it("no argument is in both lists, and every money argument exists on an allowed tool", () => {
    const found = numberArgsOfAllowedTools(defs);
    expect(REC_MONEY_ARGS.filter((a) => a in NON_MONEY_NUMBER_ARGS)).toEqual([]);
    expect(REC_MONEY_ARGS.filter((a) => !found.has(a))).toEqual([]);
    // A stale non-money entry would hide nothing today but reads as coverage; keep the list exact.
    expect(Object.keys(NON_MONEY_NUMBER_ARGS).filter((a) => !found.has(a))).toEqual([]);
  });

  it("a new, unclassified number argument fails the classification (control)", () => {
    const fake: Def = { name: "create_change", input_schema: { properties: { feeAmount: { type: "number" } } } };
    expect(unclassified(numberArgsOfAllowedTools([...defs, fake]))).toEqual(["feeAmount"]);
  });

  it("a number argument nested in an object or array-of-objects argument is found too (control)", () => {
    const fake: Def = {
      name: "create_change",
      input_schema: {
        properties: {
          lines: { type: "array", items: { type: "object", properties: { unitPrice: { type: "number" } } } },
          meta: { type: "object", properties: { fee: { type: "number" } } },
          grid: { type: "array", items: { type: "array", items: { type: "object", properties: { rate: { type: "number" } } } } },
        },
      },
    };
    expect(unclassified(numberArgsOfAllowedTools([...defs, fake]))).toEqual(["fee", "rate", "unitPrice"]);
  });
});

describe("recommendationPredatesSwitch (§476)", () => {
  const rec = (input: Record<string, unknown>, historyLength?: number): InsightRecommendation => ({
    summary: "s", proposedCalls: [{ name: "update_change", input }], generatedAt: "2026-09-03", status: "proposed",
    ...(historyLength !== undefined ? { historyLength } : {}),
  });
  const sw = (from: string): BaselineEntry => ({ from, at: `${from}T10:00:00.000Z`, currency: "GBP", perPrevious: 0.85 });
  const creation: BaselineEntry = { from: "2026-09-01", at: "2026-09-01T10:00:00.000Z", currency: "EUR" };

  it("a stamped recommendation is refused when the history grew since it was stamped", () => {
    expect(recommendationPredatesSwitch(rec({ id: 1, costImpact: 10 }, 0), [sw("2026-09-03")])).toBe(true);
    expect(recommendationPredatesSwitch(rec({ id: 1, costImpact: 10 }, 1), [sw("2026-09-03")])).toBe(false);
    expect(recommendationPredatesSwitch(rec({ id: 1, costImpact: 10 }, 1), [sw("2026-09-03"), sw("2026-09-03")])).toBe(true);
  });

  it("a history SHORTER than the stamp is refused: the denomination it was made in is unknown", () => {
    expect(recommendationPredatesSwitch(rec({ id: 1, costImpact: 10 }, 2), [sw("2026-09-03")])).toBe(true);
    expect(recommendationPredatesSwitch(rec({ id: 1, costImpact: 10 }, 1), [])).toBe(true);
  });

  it("an equal-length history whose last entry differs from the stamp is refused: it was replaced and regrown", () => {
    const r = { ...rec({ id: 1, costImpact: 10 }, 1), historyLastAt: "2026-09-03T10:00:00.000Z" };
    expect(recommendationPredatesSwitch(r, [sw("2026-09-03")])).toBe(false);
    expect(recommendationPredatesSwitch(r, [sw("2026-09-07")])).toBe(true);
    // A length-only stamp (an earlier build of this feature) keeps the length rule alone.
    expect(recommendationPredatesSwitch(rec({ id: 1, costImpact: 10 }, 1), [sw("2026-09-07")])).toBe(false);
  });

  it("the stamped last entry may sit anywhere in an equal-length history: a reload sorts it by `at`", () => {
    // Appended in memory with an `at` older than an existing entry (a device clock behind), then
    // reloaded: `sanitizeBaselineHistory` orders by `at`, so the stamped entry is no longer last.
    const r = { ...rec({ id: 1, costImpact: 10 }, 2), historyLastAt: sw("2026-09-02").at };
    expect(recommendationPredatesSwitch(r, [sw("2026-09-05"), sw("2026-09-02")])).toBe(false);
    expect(recommendationPredatesSwitch(r, [sw("2026-09-02"), sw("2026-09-05")])).toBe(false);
  });

  it("a money argument nested in an object or array argument counts", () => {
    expect(recommendationPredatesSwitch(rec({ id: 1, lines: [{ costImpact: 10 }] }, 0), [sw("2026-09-03")])).toBe(true);
    expect(recommendationPredatesSwitch(rec({ id: 1, meta: { costImpact: 10 } }, 0), [sw("2026-09-03")])).toBe(true);
    expect(recommendationPredatesSwitch(rec({ id: 1, lines: [{ title: "x" }] }, 0), [sw("2026-09-03")])).toBe(false);
  });

  it("never refuses a recommendation without a money argument", () => {
    expect(recommendationPredatesSwitch(rec({ id: 1, title: "x" }, 0), [sw("2026-09-05")])).toBe(false);
    expect(recommendationPredatesSwitch(rec({ id: 1, title: "x" }), [sw("2026-09-05")])).toBe(false);
  });

  it("an unstamped recommendation is refused once any switch exists; the creation entry is not one", () => {
    expect(recommendationPredatesSwitch(rec({ id: 1, costImpact: 10 }), [creation])).toBe(false);
    expect(recommendationPredatesSwitch(rec({ id: 1, costImpact: 10 }), [])).toBe(false);
    expect(recommendationPredatesSwitch(rec({ id: 1, costImpact: 10 }), [creation, sw("2026-08-01")])).toBe(true);
  });
});
