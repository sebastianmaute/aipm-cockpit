import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseClockOffsetDays, registerClockOffset } from "./clock-offset";

describe("parseClockOffsetDays", () => {
  it("is off when unset, empty or zero", () => {
    expect(parseClockOffsetDays(undefined)).toBeNull();
    expect(parseClockOffsetDays("")).toBeNull();
    expect(parseClockOffsetDays("  ")).toBeNull();
    expect(parseClockOffsetDays("0")).toBeNull();
  });

  it("reads whole days, forward or back", () => {
    expect(parseClockOffsetDays("400")).toBe(400);
    expect(parseClockOffsetDays(" 30 ")).toBe(30);
    expect(parseClockOffsetDays("-7")).toBe(-7);
  });

  it("throws on anything that is not a whole number of days", () => {
    for (const bad of ["abc", "1.5", "400d", "1e3"]) {
      expect(() => parseClockOffsetDays(bad)).toThrow(/whole number of days/);
    }
  });
});

describe("registerClockOffset", () => {
  // ★ Start each case on the REAL clock. In the weekly unit-future-clock job the
  // setup has already shifted Date before this runs, so a baseline read without
  // this would itself be 400 days ahead.
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.useRealTimers());

  function capture() {
    const before: Array<() => void> = [];
    const after: Array<() => void> = [];
    return {
      hooks: { beforeEach: (fn: () => void) => before.push(fn), afterEach: (fn: () => void) => after.push(fn) },
      runBefore: () => before.forEach((fn) => fn()),
      runAfter: () => after.forEach((fn) => fn()),
    };
  }

  it("moves Date forward by the offset for the test, then restores the real clock", () => {
    const h = capture();
    registerClockOffset(400, h.hooks, vi);
    const real = Date.now();
    h.runBefore();
    const shifted = Date.now() - real;
    // 400 days, give or take the few ms the test itself takes.
    expect(shifted).toBeGreaterThan(400 * 86_400_000 - 1_000);
    expect(shifted).toBeLessThan(400 * 86_400_000 + 60_000);
    expect(new Date().getTime()).toBeGreaterThan(real + 399 * 86_400_000);
    h.runAfter();
    expect(vi.isFakeTimers()).toBe(false);
    expect(Math.abs(Date.now() - real)).toBeLessThan(60_000);
  });

  it("fakes only Date, leaving the timer functions real", () => {
    const h = capture();
    registerClockOffset(400, h.hooks, vi);
    const realSetTimeout = globalThis.setTimeout;
    const realSetInterval = globalThis.setInterval;
    h.runBefore();
    // ★ Identity, not "the timer still fires": with shouldAdvanceTime a faked
    // setTimeout fires on real time too, so firing cannot tell them apart.
    expect(globalThis.setTimeout).toBe(realSetTimeout);
    expect(globalThis.setInterval).toBe(realSetInterval);
    h.runAfter();
  });

  it("keeps the faked clock moving", async () => {
    const h = capture();
    registerClockOffset(400, h.hooks, vi);
    h.runBefore();
    const t0 = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(Date.now()).toBeGreaterThan(t0);
    h.runAfter();
  });
});
