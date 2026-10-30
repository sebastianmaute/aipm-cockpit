import { describe, expect, it } from "vitest";
import { LEGACY_PATH } from "./ai-usage-paths";
import { isoDate, usageCostEquivalent, weekToDate } from "./ai-usage";
import {
  AI_USAGE_BY_PATH_KEY,
  readPathBuckets,
  recordPathUsage,
  totalsByDay,
  weekByPath,
  type PathBuckets,
} from "./ai-usage-store";

const OLD_KEY = "aipm-cockpit:ai-usage";

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    key: (i) => Array.from(m.keys())[i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

// Thursday 2026-10-29; its Monday is 2026-10-26.
const NOW = new Date(2026, 9, 29, 12);
const u = (input: number, output = 0, cacheWrite = 0, cacheRead = 0) => ({ input, output, cacheWrite, cacheRead });

describe("ai-usage-store", () => {
  it("two writers keep both recordings", () => {
    const s = memoryStorage();
    readPathBuckets(s); // writer A's stale read
    recordPathUsage(s, NOW, "chat", u(10)); // writer B
    recordPathUsage(s, NOW, "wbs:interactive", u(20)); // writer A
    const stored = readPathBuckets(s);
    const day = stored[isoDate(NOW)];
    expect(day.chat.input).toBe(10);
    expect(day["wbs:interactive"].input).toBe(20);
  });

  it("migrates old buckets into the legacy path once", () => {
    const s = memoryStorage();
    const monday = isoDate(new Date(2026, 9, 26));
    s.setItem(OLD_KEY, JSON.stringify({ [monday]: u(100, 50, 10, 5) }));
    const b = readPathBuckets(s);
    expect(b[monday][LEGACY_PATH]).toEqual(u(100, 50, 10, 5));
    expect(weekToDate(totalsByDay(b), NOW)).toBe(usageCostEquivalent(u(100, 50, 10, 5)));
    expect(s.getItem(AI_USAGE_BY_PATH_KEY)).not.toBeNull();
    s.setItem(OLD_KEY, JSON.stringify({ [monday]: u(999) }));
    expect(readPathBuckets(s)[monday][LEGACY_PATH].input).toBe(100);
  });

  it("migrates an old-shape bucket without NaN", () => {
    const s = memoryStorage();
    const monday = isoDate(new Date(2026, 9, 26));
    s.setItem(OLD_KEY, JSON.stringify({ [monday]: { input: 7, output: 3 } }));
    const got = readPathBuckets(s)[monday][LEGACY_PATH];
    expect(got).toEqual(u(7, 3, 0, 0));
    expect(Number.isNaN(usageCostEquivalent(got))).toBe(false);
  });

  it("weekByPath excludes last week and totalsByDay sums paths per day", () => {
    const b: PathBuckets = {
      [isoDate(new Date(2026, 9, 25))]: { chat: u(1000) },
      [isoDate(new Date(2026, 9, 27))]: { chat: u(1), digest: u(2) },
      [isoDate(NOW)]: { chat: u(4) },
    };
    expect(weekByPath(b, NOW)).toEqual({ chat: u(5), digest: u(2) });
    expect(totalsByDay(b)[isoDate(new Date(2026, 9, 27))]).toEqual(u(3));
  });

  it("malformed JSON yields {} and the next record writes a valid value", () => {
    const s = memoryStorage();
    s.setItem(AI_USAGE_BY_PATH_KEY, "{not json");
    expect(readPathBuckets(s)).toEqual({});
    recordPathUsage(s, NOW, "chat", u(3));
    expect(JSON.parse(s.getItem(AI_USAGE_BY_PATH_KEY) as string)[isoDate(NOW)].chat.input).toBe(3);
  });
});
