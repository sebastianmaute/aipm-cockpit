import { describe, expect, it } from "vitest";
import { LEGACY_PATH } from "./ai-usage-paths";
import { isoDate, usageCostEquivalent, weekToDate } from "./ai-usage";
import {
  AI_USAGE_BY_PATH_KEY,
  USAGE_RETENTION_DAYS,
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
    const b = readPathBuckets(s, NOW);
    expect(b[monday][LEGACY_PATH]).toEqual(u(100, 50, 10, 5));
    expect(weekToDate(totalsByDay(b), NOW)).toBe(usageCostEquivalent(u(100, 50, 10, 5)));
    expect(s.getItem(AI_USAGE_BY_PATH_KEY)).not.toBeNull();
    s.setItem(OLD_KEY, JSON.stringify({ [monday]: u(999) }));
    expect(readPathBuckets(s, NOW)[monday][LEGACY_PATH].input).toBe(100);
  });

  it("migrates an old-shape bucket without NaN", () => {
    const s = memoryStorage();
    const monday = isoDate(new Date(2026, 9, 26));
    s.setItem(OLD_KEY, JSON.stringify({ [monday]: { input: 7, output: 3 } }));
    const got = readPathBuckets(s, NOW)[monday][LEGACY_PATH];
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

  it("reports a refused write, with the buckets it could not store", () => {
    const s = memoryStorage();
    expect(recordPathUsage(s, NOW, "chat", u(3)).persisted).toBe(true);
    s.setItem = () => { throw new DOMException("quota", "QuotaExceededError"); };
    const refused = recordPathUsage(s, NOW, "chat", u(4));
    expect(refused.persisted).toBe(false);
    expect(refused.buckets[isoDate(NOW)].chat.input).toBe(7);
    expect(readPathBuckets(s)[isoDate(NOW)].chat.input).toBe(3);
  });

  it("malformed JSON yields {} and the next record writes a valid value", () => {
    const s = memoryStorage();
    s.setItem(AI_USAGE_BY_PATH_KEY, "{not json");
    expect(readPathBuckets(s)).toEqual({});
    recordPathUsage(s, NOW, "chat", u(3));
    expect(JSON.parse(s.getItem(AI_USAGE_BY_PATH_KEY) as string)[isoDate(NOW)].chat.input).toBe(3);
  });
});

// AI-03 — every reader of the store reads this week only (Monday through today), so a day before the retention
// window is never read again and is dropped on write; the store holds a row per path per day.
describe("ai-usage-store retention", () => {
  const day = (offset: number): string => isoDate(new Date(2026, 9, 29 + offset));

  it("keeps a whole week: on a Sunday the week's Monday is inside the window", () => {
    expect(USAGE_RETENTION_DAYS).toBeGreaterThanOrEqual(7);
    const sunday = new Date(2026, 10, 1, 23);
    const s = memoryStorage();
    recordPathUsage(s, new Date(2026, 9, 26, 9), "chat", u(5)); // that week's Monday
    recordPathUsage(s, sunday, "chat", u(1));
    expect(weekToDate(totalsByDay(readPathBuckets(s)), sunday)).toBe(usageCostEquivalent(u(6)));
  });

  // Mutation: dropping the prune from `recordPathUsage` turns this red: the old days stay.
  it("a write drops days older than the window and keeps the oldest day inside it", () => {
    const s = memoryStorage();
    const oldest = day(-(USAGE_RETENTION_DAYS - 1));
    const tooOld = day(-USAGE_RETENTION_DAYS);
    s.setItem(AI_USAGE_BY_PATH_KEY, JSON.stringify({
      [day(-40)]: { chat: u(1) },
      [tooOld]: { chat: u(2) },
      [oldest]: { chat: u(3) },
      "not-a-day": { chat: u(4) },
    }));
    recordPathUsage(s, NOW, "chat", u(9));
    expect(Object.keys(readPathBuckets(s, NOW)).sort()).toEqual([oldest, isoDate(NOW)].sort());
  });

  // Mutation: dropping the prune from the migration branch of `readPathBuckets` turns this red.
  it("the one-time migration drops days older than the window", () => {
    const s = memoryStorage();
    s.setItem(OLD_KEY, JSON.stringify({ [day(-90)]: u(1), [day(-1)]: u(2) }));
    expect(Object.keys(readPathBuckets(s, NOW))).toEqual([day(-1)]);
    expect(Object.keys(JSON.parse(s.getItem(AI_USAGE_BY_PATH_KEY) as string))).toEqual([day(-1)]);
  });
});
