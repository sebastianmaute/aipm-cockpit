import { describe, expect, it } from "vitest";
import { dailyKey, parseDailyKey } from "./timelog-types";

describe("parseDailyKey", () => {
  it("round-trips a key built by dailyKey", () => {
    expect(parseDailyKey(dailyKey(7, "2026-09-01"))).toEqual({ userId: 7, date: "2026-09-01" });
  });

  // ★★ The oversized key is the shape open-followups §367 is named for: before
  // this check it parsed successfully and was a single roll cell larger than
  // MAX_DAILY_ROLL_CHARS on its own.
  it("rejects a date half that is not ISO-shaped", () => {
    expect(parseDailyKey("7|tomorrow")).toBeNull();
    expect(parseDailyKey("7|2026-9-1")).toBeNull();
    expect(parseDailyKey("7|2026-09-01T00:00:00Z")).toBeNull();
    expect(parseDailyKey(`7|${"x".repeat(600000)}`)).toBeNull();
  });

  // ★★★ THE NEGATIVE CONTROL, AND IT IS THE ONE THAT MUST NOT BE DELETED. This
  // is a SHAPE rule, never an existence rule: the check exists to make `<`/`>`
  // comparisons on the date lexicographically meaningful downstream, not to
  // certify that a date exists. Without this assertion, "tighten it to a real
  // calendar date" reads as a safe improvement — and it is not.
  // ★★ THE CONSUMER IS TWO HOPS AWAY, and an earlier revision here put it one
  // hop away in `timelog-policy.ts`, which has no window comparison at all.
  // That engine only TRACKS the bounds — `firstViolationDate`/
  // `lastViolationDate`, a running min/max over the violating days. The
  // COMPARISON lives in `task-manager.tsx`'s insights reconcile, which clears a
  // stored guardrail insight only when the cache entry's `dailyWindow` covers
  // that pair, with plain string `<=`/`>=` and no question about whether either
  // end is a real day. Reproduce the split with `grep -rn "rollWindow" src/app`.
  it("admits an ISO-SHAPED date that is not a real day", () => {
    expect(parseDailyKey("7|9999-99-99")).toEqual({ userId: 7, date: "9999-99-99" });
  });

  // ★★ The old title said "an empty userId", which over-promised: `"|2026-09-01"`
  // dies on `i <= 0`, a LEADING-SEPARATOR rule, and nothing here bounded the
  // userId half at all. `KEY_USER_RE` is what bounds it now.
  it("rejects a missing separator, a leading separator and a non-integer userId", () => {
    expect(parseDailyKey("no-pipe")).toBeNull();
    expect(parseDailyKey("|2026-09-01")).toBeNull();
    expect(parseDailyKey("7.5|2026-09-01")).toBeNull();
  });

  // ★★★ THE HEAD IS SHAPE-CHECKED BEFORE IT IS COERCED, and every case here
  // parsed CLEANLY before that. `Number()` strips surrounding whitespace and
  // reads exotic numeric literals, so each of these produced a userId the app's
  // own writer could never have emitted — `dailyKey` builds `${userId}|${date}`
  // from a `number`, so the only heads it can produce are plain optionally
  // signed digit strings.
  it("rejects a userId half Number() would have coerced", () => {
    expect(parseDailyKey(" |2026-09-01")).toBeNull();   // was userId 0
    expect(parseDailyKey("0x10|2026-09-01")).toBeNull(); // was 16
    expect(parseDailyKey("1e3|2026-09-01")).toBeNull();  // was 1000
    expect(parseDailyKey("+7|2026-09-01")).toBeNull();   // was 7
  });

  // ★★★ THE OVERSIZED KEY open-followups §367 IS NAMED FOR, reached through the
  // USERID half — the date half was closed first and this one stayed open. A
  // 600,000-space pad is stripped by `Number()`, so the key parsed and one cell
  // serialised larger than MAX_DAILY_ROLL_CHARS on its own.
  it("rejects an oversized key whose userId half is whitespace-padded", () => {
    expect(parseDailyKey(`${" ".repeat(600000)}7|2026-09-01`)).toBeNull();
  });

  // ★★★ THE OTHER HALF OF THE GUARD PAIR, and it is why `Number.isInteger` must
  // stay beside `KEY_USER_RE`: the regex admits a 600,000-DIGIT head quite
  // happily, and `Number()` of that is `Infinity`. Only the integer check
  // rejects it. Delete either guard and one of these two oversized cases starts
  // parsing again.
  it("rejects an oversized key whose userId half is all digits", () => {
    expect(parseDailyKey(`${"1".repeat(600000)}|2026-09-01`)).toBeNull();
  });

  // ★★ NEGATIVE CONTROLS for the two shapes `/^-?\d+$/` must NOT have broken.
  // `dailyKey` is `${userId}|${date}` over a `number`, so a negative userId is
  // genuinely emittable and a bare `/^\d+$/` would start rejecting a key the
  // app's own writer produced. Leading zeros never reach a key from
  // `buildDailyRoll`, but they cost nothing to admit and `Number` reads them.
  it("still parses a negative userId and one with leading zeros", () => {
    expect(parseDailyKey("-7|2026-09-01")).toEqual({ userId: -7, date: "2026-09-01" });
    expect(parseDailyKey("007|2026-09-01")).toEqual({ userId: 7, date: "2026-09-01" });
  });
});
