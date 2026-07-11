import { describe, expect, it } from "vitest";
import { materializeRoleRates, DEFAULT_WORKDAY_HOURS } from "./role-rates";
import type { Role } from "./types";

const base: Role = { id: 1, disciplineId: 1, gradeId: 1, internalRate: 0, externalRate: 0 };

describe("materializeRoleRates", () => {
  it("basis 'day' derives hourly = day / workdayHours", () => {
    const r = materializeRoleRates(
      { ...base, rateBasis: "day", internalRateDay: 800, externalRateDay: 1200 },
      8,
    );
    expect(r.internalRate).toBe(100);
    expect(r.externalRate).toBe(150);
    // Day rates preserved (authoritative).
    expect(r.internalRateDay).toBe(800);
    expect(r.externalRateDay).toBe(1200);
    expect(r.rateBasis).toBe("day");
  });

  it("basis 'hour' derives day = hourly * workdayHours", () => {
    const r = materializeRoleRates(
      { ...base, rateBasis: "hour", internalRate: 100, externalRate: 150 },
      8,
    );
    expect(r.internalRateDay).toBe(800);
    expect(r.externalRateDay).toBe(1200);
    // Hourly rates preserved (authoritative).
    expect(r.internalRate).toBe(100);
    expect(r.externalRate).toBe(150);
    expect(r.rateBasis).toBe("hour");
  });

  it("absent basis defaults to 'hour'", () => {
    const r = materializeRoleRates({ ...base, internalRate: 50, externalRate: 75 }, 8);
    expect(r.rateBasis).toBe("hour");
    expect(r.internalRateDay).toBe(400);
    expect(r.externalRateDay).toBe(600);
  });

  it("guards workdayHours <= 0 by falling back to 8 (never divides by zero)", () => {
    const r = materializeRoleRates(
      { ...base, rateBasis: "day", internalRateDay: 800, externalRateDay: 1600 },
      0,
    );
    expect(r.internalRate).toBe(100);
    expect(r.externalRate).toBe(200);
    expect(DEFAULT_WORKDAY_HOURS).toBe(8);
  });

  it("negative workdayHours also falls back to 8", () => {
    const r = materializeRoleRates(
      { ...base, rateBasis: "hour", internalRate: 10, externalRate: 20 },
      -4,
    );
    expect(r.internalRateDay).toBe(80);
    expect(r.externalRateDay).toBe(160);
  });

  it("rounds to 2 decimals", () => {
    const r = materializeRoleRates(
      { ...base, rateBasis: "day", internalRateDay: 100, externalRateDay: 100 },
      3,
    );
    // 100 / 3 = 33.333... → 33.33
    expect(r.internalRate).toBe(33.33);
    expect(r.externalRate).toBe(33.33);
  });
});
