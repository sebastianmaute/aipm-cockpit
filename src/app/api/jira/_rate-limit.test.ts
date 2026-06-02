import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimit } from "./_rate-limit";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;

// The limiter keeps a module-level Map keyed by client IP. There is no reset
// hook, so each test uses a UNIQUE ip string to avoid bleeding state between
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
    expect(rateLimit(req("10.0.0.1"))).toBeNull();
  });

  it("allows requests up to the limit, then returns 429", async () => {
    const ip = "10.0.0.2";
    for (let i = 0; i < MAX_REQUESTS; i++) {
      expect(rateLimit(req(ip))).toBeNull();
    }
    const blocked = rateLimit(req(ip));
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
    expect(blocked!.headers.get("Retry-After")).toBeTruthy();
    await expect(blocked!.json()).resolves.toEqual({ error: "too-many-requests" });
  });

  it("sets Retry-After to the seconds remaining in the window", () => {
    const ip = "10.0.0.3";
    for (let i = 0; i < MAX_REQUESTS; i++) rateLimit(req(ip));
    // Advance 10s into the 60s window before tripping the limit.
    vi.advanceTimersByTime(10_000);
    const blocked = rateLimit(req(ip));
    expect(blocked!.headers.get("Retry-After")).toBe("50");
  });

  it("resets the counter once the window elapses", () => {
    const ip = "10.0.0.4";
    for (let i = 0; i < MAX_REQUESTS; i++) rateLimit(req(ip));
    expect(rateLimit(req(ip))!.status).toBe(429);
    // Cross the window boundary — the next request starts a fresh window.
    vi.advanceTimersByTime(WINDOW_MS);
    expect(rateLimit(req(ip))).toBeNull();
  });

  it("tracks distinct IPs independently", () => {
    const a = "10.0.0.5";
    const b = "10.0.0.6";
    for (let i = 0; i < MAX_REQUESTS; i++) rateLimit(req(a));
    expect(rateLimit(req(a))!.status).toBe(429);
    // b is untouched, so it is still allowed.
    expect(rateLimit(req(b))).toBeNull();
  });

  it("uses the first IP in a comma-separated x-forwarded-for chain", () => {
    const proxied = "203.0.113.9, 70.41.3.18, 150.172.238.178";
    for (let i = 0; i < MAX_REQUESTS; i++) rateLimit(req(proxied));
    // Same leading client IP → counted as one bucket → 61st blocked.
    expect(rateLimit(req(proxied))!.status).toBe(429);
    // A request whose leading IP differs is a different bucket.
    expect(rateLimit(req("198.51.100.1, 70.41.3.18"))).toBeNull();
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const ip = "192.0.2.50";
    for (let i = 0; i < MAX_REQUESTS; i++) rateLimit(req(ip, "x-real-ip"));
    expect(rateLimit(req(ip, "x-real-ip"))!.status).toBe(429);
  });

  it("buckets all header-less requests under 'unknown'", () => {
    const bare = () =>
      new Request("https://example.com/api/jira/test", { method: "POST" });
    for (let i = 0; i < MAX_REQUESTS; i++) expect(rateLimit(bare())).toBeNull();
    expect(rateLimit(bare())!.status).toBe(429);
  });
});
