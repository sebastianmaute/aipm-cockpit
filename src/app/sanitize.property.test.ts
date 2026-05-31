import { describe, expect, test } from "vitest";
import fc from "fast-check";
import {
  sanitizeTaskName,
  sanitizeNotes,
  sanitizeLabel,
  sanitizeLabels,
  sanitizeNonNegInt,
  sanitizeOptionalMinutes,
  sanitizeIsoDate,
  serializeDependencies,
  parseDependenciesString,
  encodePeriodMap,
  decodePeriodMap,
  TASK_NAME_MAX,
  TEXTAREA_MAX,
  LABEL_MAX,
  LABELS_MAX_COUNT,
} from "./sanitize";
import type { TaskDependency } from "./types";

const depTypeArb = fc.constantFrom("FS" as const, "SS" as const, "FF" as const, "SF" as const);

// These sanitizers guard the JSON / CSV / chat-tool boundary. The realistic
// untrusted-input domain is therefore JSON values (+ undefined for absent
// fields) — NOT Symbols or null-prototype objects, which `JSON.parse` and CSV
// parsing can never produce and on which `Number(x)` would throw.
const jsonLikeArb = fc.oneof(fc.jsonValue(), fc.constant(undefined));

describe("sanitize — properties", () => {
  test("sanitizeTaskName respects the length cap and is idempotent", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const once = sanitizeTaskName(s);
        expect(once.length).toBeLessThanOrEqual(TASK_NAME_MAX);
        expect(sanitizeTaskName(once)).toBe(once);
      }),
    );
  });

  test("sanitizeNotes respects the textarea cap and is idempotent", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: TEXTAREA_MAX + 200 }), (s) => {
        const once = sanitizeNotes(s);
        expect(once.length).toBeLessThanOrEqual(TEXTAREA_MAX);
        expect(sanitizeNotes(once)).toBe(once);
      }),
    );
  });

  test("sanitizeLabel strips separators, caps length, and is idempotent", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const out = sanitizeLabel(s);
        expect(/[|,\r\n\t]/.test(out)).toBe(false);
        expect(out.length).toBeLessThanOrEqual(LABEL_MAX);
        expect(sanitizeLabel(out)).toBe(out);
      }),
    );
  });

  test("sanitizeLabels caps count, dedupes case-insensitively, caps each length", () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { maxLength: 60 }), (labels) => {
        const out = sanitizeLabels(labels);
        expect(out.length).toBeLessThanOrEqual(LABELS_MAX_COUNT);
        const lowered = out.map((l) => l.toLowerCase());
        expect(new Set(lowered).size).toBe(lowered.length); // no case-insensitive dups
        for (const l of out) {
          expect(l.length).toBeLessThanOrEqual(LABEL_MAX);
          expect(l.length).toBeGreaterThan(0);
        }
      }),
    );
  });

  test("sanitizeNonNegInt always returns a non-negative integer", () => {
    fc.assert(
      fc.property(jsonLikeArb, (v) => {
        const n = sanitizeNonNegInt(v);
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  test("sanitizeOptionalMinutes is undefined or a non-negative integer", () => {
    fc.assert(
      fc.property(jsonLikeArb, (v) => {
        const n = sanitizeOptionalMinutes(v);
        if (n === undefined) return;
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  test("sanitizeIsoDate returns '' or a valid in-range date, and is idempotent", () => {
    const mixed = fc.oneof(
      fc.string(),
      fc
        .date({ min: new Date("1850-01-01"), max: new Date("2150-12-31"), noInvalidDate: true })
        .map((d) => d.toISOString().slice(0, 10)),
    );
    fc.assert(
      fc.property(mixed, (s) => {
        const out = sanitizeIsoDate(s);
        if (out !== "") {
          expect(/^\d{4}-\d{2}-\d{2}$/.test(out)).toBe(true);
          const year = Number(out.slice(0, 4));
          expect(year).toBeGreaterThanOrEqual(1900);
          expect(year).toBeLessThanOrEqual(2100);
        }
        expect(sanitizeIsoDate(out)).toBe(out); // idempotent
      }),
    );
  });

  test("serialize∘parse round-trips a deduped list of valid dependencies", () => {
    const depArb: fc.Arbitrary<TaskDependency> = fc.record({
      taskId: fc.integer({ min: 1, max: 100000 }),
      type: depTypeArb,
    });
    fc.assert(
      fc.property(fc.array(depArb, { maxLength: 15 }), (deps) => {
        // The functions dedupe by `${taskId}:${type}` and cap at 20; mirror that
        // to compute the expected canonical form.
        const seen = new Set<string>();
        const expected: TaskDependency[] = [];
        for (const d of deps) {
          const key = `${d.taskId}:${d.type}`;
          if (seen.has(key)) continue;
          seen.add(key);
          expected.push(d);
        }
        expect(parseDependenciesString(serializeDependencies(deps))).toEqual(expected);
      }),
    );
  });

  test("encode∘decode round-trips a valid period→integer map", () => {
    const periodKeyArb = fc.oneof(
      fc.tuple(fc.integer({ min: 2000, max: 2099 }), fc.integer({ min: 1, max: 12 })).map(
        ([y, m]) => `${y}-${String(m).padStart(2, "0")}`,
      ),
      fc.tuple(fc.integer({ min: 2000, max: 2099 }), fc.integer({ min: 1, max: 53 })).map(
        ([y, w]) => `${y}-W${String(w).padStart(2, "0")}`,
      ),
    );
    const mapArb = fc.dictionary(periodKeyArb, fc.integer({ min: 0, max: 100000 }));
    fc.assert(
      fc.property(mapArb, (map) => {
        expect(decodePeriodMap(encodePeriodMap(map))).toEqual(map);
      }),
    );
  });
});
