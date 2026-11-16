import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_REQUESTS, TRUSTED_PROXY_HOPS_ENV, clientKey, rateLimit, storeSize } from "./_rate-limit";

const WINDOW_MS = 60_000;

// The limiter keeps a module-level Map keyed by scope and client key. There is
// no reset hook, so each test uses a UNIQUE scope string to avoid bleeding state between
// tests. Fake timers let us drive the sliding window deterministically.
function req(ip: string, header: "x-forwarded-for" | "x-real-ip" = "x-forwarded-for"): Request {
  return new Request("https://example.com/api/jira/test", {
    method: "POST",
    headers: { [header]: ip },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-02T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("rateLimit", () => {
  it("allows the first request from an IP", () => {
    expect(rateLimit(req("10.0.0.1"), "first")).toBeNull();
  });

  it("allows requests up to the limit, then returns 429", async () => {
    const ip = "10.0.0.2";
    for (let i = 0; i < MAX_REQUESTS; i++) {
      expect(rateLimit(req(ip), ip)).toBeNull();
    }
    const blocked = rateLimit(req(ip), ip);
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
    expect(blocked!.headers.get("Retry-After")).toBeTruthy();
    await expect(blocked!.json()).resolves.toEqual({ error: "too-many-requests" });
  });

  it("sets Retry-After to the seconds remaining in the window", () => {
    const ip = "10.0.0.3";
    for (let i = 0; i < MAX_REQUESTS; i++) rateLimit(req(ip), ip);
    // Advance 10s into the 60s window before tripping the limit.
    vi.advanceTimersByTime(10_000);
    const blocked = rateLimit(req(ip), ip);
    expect(blocked!.headers.get("Retry-After")).toBe("50");
  });

  it("resets the counter once the window elapses", () => {
    const ip = "10.0.0.4";
    for (let i = 0; i < MAX_REQUESTS; i++) rateLimit(req(ip), ip);
    expect(rateLimit(req(ip), ip)!.status).toBe(429);
    // Cross the window boundary — the next request starts a fresh window.
    vi.advanceTimersByTime(WINDOW_MS);
    expect(rateLimit(req(ip), ip)).toBeNull();
  });

  it("hops 0 (unset): different x-forwarded-for values share one bucket", () => {
    const scope = "hops0-xff";
    for (let i = 0; i < MAX_REQUESTS; i++) expect(rateLimit(req("1.1.1.1"), scope)).toBeNull();
    expect(rateLimit(req("2.2.2.2"), scope)!.status).toBe(429);
  });

  it("hops 0: x-real-ip is ignored", () => {
    const scope = "hops0-real";
    for (let i = 0; i < MAX_REQUESTS; i++) {
      expect(rateLimit(req("1.1.1.1", "x-real-ip"), scope)).toBeNull();
    }
    expect(rateLimit(req("2.2.2.2", "x-real-ip"), scope)!.status).toBe(429);
  });

  it("keys buckets per scope so routes do not share limits", () => {
    const ip = "10.0.0.7";
    for (let i = 0; i < MAX_REQUESTS; i++) rateLimit(req(ip), ip);
    expect(rateLimit(req(ip), ip)!.status).toBe(429);
    // The same IP under a different scope has its own untouched bucket.
    expect(rateLimit(req(ip), "ecb")).toBeNull();
  });

  it("evicts elapsed-window buckets when a request starts a fresh window", () => {
    const exhausted = "10.0.0.30";
    for (let i = 0; i < MAX_REQUESTS; i++) rateLimit(req(exhausted), exhausted);
    expect(rateLimit(req(exhausted), exhausted)!.status).toBe(429);
    rateLimit(req("10.0.0.31"), "10.0.0.31"); // another stale-to-be bucket
    const before = storeSize();
    expect(before).toBeGreaterThan(1);

    // Cross the window boundary — the next fresh-window request sweeps every
    // bucket whose window has fully elapsed.
    vi.advanceTimersByTime(WINDOW_MS);
    expect(rateLimit(req("10.0.0.32"), "10.0.0.32")).toBeNull();
    expect(storeSize()).toBeLessThan(before);
    // The previously rate-limited IP was evicted, so it is allowed again.
    expect(rateLimit(req(exhausted), exhausted)).toBeNull();
  });

});

describe("clientKey", () => {
  const hops = (n: string) => ({ [TRUSTED_PROXY_HOPS_ENV]: n });

  it("hops 1: keys on the rightmost entry", () => {
    expect(clientKey(req("9.9.9.9, 10.0.0.1"), hops("1"))).toBe("10.0.0.1");
    expect(clientKey(req("6.6.6.6, 10.0.0.1"), hops("1"))).toBe("10.0.0.1");
  });

  it("hops 2: second from the right", () => {
    expect(clientKey(req("a, 1.1.1.1, 10.0.0.1"), hops("2"))).toBe("1.1.1.1");
  });

  it("fewer entries than hops gives the shared key", () => {
    expect(clientKey(req("10.0.0.1"), hops("2"))).toBe("shared");
    const bare = new Request("https://example.com/api/jira/test", { method: "POST" });
    expect(clientKey(bare, hops("1"))).toBe("shared");
  });

  it("empty entries are dropped", () => {
    expect(clientKey(req("1.1.1.1,, "), hops("1"))).toBe("1.1.1.1");
  });

  it.each(["abc", "-1", "1.5", "", "99999", "11"])("bad env value %j is hops 0", (v) => {
    expect(clientKey(req("9.9.9.9, 10.0.0.1"), hops(v))).toBe("shared");
  });

  it("unset env is hops 0", () => {
    expect(clientKey(req("9.9.9.9"), {})).toBe("shared");
  });
});
