import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { periodCost, formatCurrency } from "./resource-cost";
import type { Role } from "./types";

const roleArb: fc.Arbitrary<Role> = fc.record({
  id: fc.integer({ min: 1, max: 1000 }),
  disciplineId: fc.integer({ min: 1, max: 100 }),
  gradeId: fc.integer({ min: 1, max: 100 }),
  internalRate: fc.double({ min: 0, max: 100000, noNaN: true }),
  externalRate: fc.double({ min: 0, max: 100000, noNaN: true }),
});

const hoursArb = fc.double({ min: 0, max: 1_000_000, noNaN: true });

describe("resource-cost — properties", () => {
  test("periodCost obeys its defining identities (internal/external/margin)", () => {
    fc.assert(
      fc.property(hoursArb, roleArb, (hours, role) => {
        const { internal, external, margin } = periodCost(hours, role);
        expect(internal).toBe(hours * role.internalRate);
        expect(external).toBe(hours * role.externalRate);
        expect(margin).toBe(external - internal);
      }),
    );
  });

  test("periodCost with no role is all zero", () => {
    fc.assert(
      fc.property(hoursArb, (hours) => {
        expect(periodCost(hours, undefined)).toEqual({ internal: 0, external: 0, margin: 0 });
      }),
    );
  });

  test("periodCost scales linearly in capacity hours", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1000, noNaN: true }), fc.integer({ min: 0, max: 1000 }), roleArb, (hours, k, role) => {
        const single = periodCost(hours, role);
        const scaled = periodCost(hours * k, role);
        expect(scaled.internal).toBeCloseTo(single.internal * k, 4);
        expect(scaled.external).toBeCloseTo(single.external * k, 4);
      }),
    );
  });

  test("formatCurrency never throws, even for invalid currency codes", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e9, max: 1e9, noNaN: true }),
        fc.oneof(fc.constantFrom("EUR", "USD", "GBP"), fc.string()),
        fc.constantFrom("en-US", "de-DE", "en-GB"),
        (amount, currency, locale) => {
          expect(typeof formatCurrency(amount, currency, locale)).toBe("string");
        },
      ),
    );
  });
});
