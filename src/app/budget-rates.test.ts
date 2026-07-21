import { describe, expect, test } from "vitest";
import {
  blendedDisciplineRate,
  disciplineHasUnpricedGrade,
  effectiveRates,
  hasUsableInternalOverride,
} from "./budget-rates";
import type { Role } from "./types";

const roles: Role[] = [
  { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
  { id: 2, disciplineId: 1, gradeId: 2, internalRate: 140, externalRate: 210 },
  { id: 3, disciplineId: 2, gradeId: 1, internalRate: 80, externalRate: 120 },
];

describe("blendedDisciplineRate", () => {
  test("averages internal and external rates across the discipline's roles", () => {
    expect(blendedDisciplineRate(1, roles)).toEqual({ internal: 120, external: 180 });
  });
  test("single-role discipline returns that role's rates", () => {
    expect(blendedDisciplineRate(2, roles)).toEqual({ internal: 80, external: 120 });
  });
  test("discipline with no roles returns zeros", () => {
    expect(blendedDisciplineRate(99, roles)).toEqual({ internal: 0, external: 0 });
  });

  test("an unpriced grade poisons the internal blend instead of diluting it", () => {
    // Averaging 0 in would yield 50 — a rate nobody entered, which passes every
    // downstream guard and reads as sound. Unknowable is the honest answer.
    const mixed: Role[] = [
      { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
      { id: 2, disciplineId: 1, gradeId: 2, internalRate: 0, externalRate: 210 },
    ];
    expect(blendedDisciplineRate(1, mixed).internal).toBe(0);
  });

  test("the external blend is deliberately unaffected this slice", () => {
    const mixed: Role[] = [
      { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
      { id: 2, disciplineId: 1, gradeId: 2, internalRate: 0, externalRate: 210 },
    ];
    expect(blendedDisciplineRate(1, mixed).external).toBe(180);
  });

  test("a fully priced discipline still averages", () => {
    expect(blendedDisciplineRate(1, roles).internal).toBe(120);
  });
});

describe("disciplineHasUnpricedGrade", () => {
  test("true when any role of the discipline is unpriced", () => {
    const mixed: Role[] = [
      { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
      { id: 2, disciplineId: 1, gradeId: 2, internalRate: 0, externalRate: 210 },
    ];
    expect(disciplineHasUnpricedGrade(1, mixed)).toBe(true);
  });

  test("false when every role of the discipline is priced", () => {
    expect(disciplineHasUnpricedGrade(1, roles)).toBe(false);
  });

  test("false for a discipline with NO roles — that is a different problem", () => {
    // An empty discipline has no grade to price, so calling it "unpriced grades"
    // would send the user hunting for something that does not exist. It already
    // rates 0 and falls to the no-rates message.
    expect(disciplineHasUnpricedGrade(99, roles)).toBe(false);
  });
});

describe("hasUsableInternalOverride", () => {
  test("true for a finite rate >= 0", () => {
    expect(hasUsableInternalOverride({ rateOverrideInternal: 90 })).toBe(true);
    expect(hasUsableInternalOverride({ rateOverrideInternal: 0 })).toBe(true);
  });

  test("false when absent or invalid", () => {
    expect(hasUsableInternalOverride({})).toBe(false);
    expect(hasUsableInternalOverride({ rateOverrideInternal: -5 })).toBe(false);
    expect(hasUsableInternalOverride({ rateOverrideInternal: NaN })).toBe(false);
  });
});

describe("effectiveRates", () => {
  const fallback = { internal: 100, external: 150 };
  test("blank overrides fall back", () => {
    expect(effectiveRates({}, fallback)).toEqual(fallback);
  });
  test("a finite >=0 override wins per field", () => {
    expect(effectiveRates({ rateOverrideInternal: 90 }, fallback)).toEqual({ internal: 90, external: 150 });
    expect(effectiveRates({ rateOverrideExternal: 200 }, fallback)).toEqual({ internal: 100, external: 200 });
  });
  test("zero is a valid override", () => {
    expect(effectiveRates({ rateOverrideInternal: 0 }, fallback)).toEqual({ internal: 0, external: 150 });
  });
  test("negative or NaN overrides are ignored", () => {
    expect(effectiveRates({ rateOverrideInternal: -5 }, fallback)).toEqual(fallback);
    expect(effectiveRates({ rateOverrideExternal: NaN }, fallback)).toEqual(fallback);
  });
});
