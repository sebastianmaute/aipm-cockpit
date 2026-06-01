import { describe, expect, test } from "vitest";
import { blendedDisciplineRate, effectiveRates } from "./budget-rates";
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
