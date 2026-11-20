import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_MAX_ATTEMPTS,
  AI_REQUEST_TIMEOUT_MS,
  AI_RETRY_MAX_WAIT_MS,
  isRetryableAiAnswer,
  parseRetryAfterMs,
  retryWaitMs,
  sleepAbortable,
} from "./ai-retry";

describe("constants", () => {
  it("pins the policy values", () => {
    expect(AI_REQUEST_TIMEOUT_MS).toBe(300_000);
    expect(AI_MAX_ATTEMPTS).toBe(3);
    expect(AI_RETRY_MAX_WAIT_MS).toBe(60_000);
  });
});

describe("isRetryableAiAnswer", () => {
  it("retries 429 and 529", () => {
    expect(isRetryableAiAnswer(429, undefined)).toBe(true);
    expect(isRetryableAiAnswer(529, undefined)).toBe(true);
  });
  it("retries the limit error types at any status", () => {
    expect(isRetryableAiAnswer(500, "overloaded_error")).toBe(true);
    expect(isRetryableAiAnswer(400, "rate_limit_error")).toBe(true);
  });
  it("never retries other answers", () => {
    for (const s of [400, 401, 403, 404, 500, 503]) {
      expect(isRetryableAiAnswer(s, undefined)).toBe(false);
    }
    expect(isRetryableAiAnswer(400, "invalid_request_error")).toBe(false);
  });
});

describe("parseRetryAfterMs", () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  it("reads seconds", () => {
    expect(parseRetryAfterMs("12", now)).toBe(12_000);
    expect(parseRetryAfterMs("0", now)).toBe(0);
    expect(parseRetryAfterMs(" 7 ", now)).toBe(7_000);
  });
  it("accepts fractional seconds", () => {
    expect(parseRetryAfterMs("1.5", now)).toBe(1_500);
  });
  it("reads an HTTP date relative to now", () => {
    expect(parseRetryAfterMs(new Date(now + 30_000).toUTCString(), now)).toBe(30_000);
  });
  it("turns a past date into 0", () => {
    expect(parseRetryAfterMs(new Date(now - 30_000).toUTCString(), now)).toBe(0);
  });
  it("returns null for absent or unparseable values", () => {
    expect(parseRetryAfterMs(null, now)).toBeNull();
    expect(parseRetryAfterMs("", now)).toBeNull();
    expect(parseRetryAfterMs("   ", now)).toBeNull();
    expect(parseRetryAfterMs("abc", now)).toBeNull();
    expect(parseRetryAfterMs("-5", now)).toBeNull();
  });
});

describe("retryWaitMs", () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  it("honours retry-after", () => {
    expect(retryWaitMs(1, "12", now, () => 0.5)).toBe(12_000);
    expect(retryWaitMs(1, "60", now, () => 0.5)).toBe(60_000);
  });
  it("gives up when retry-after exceeds the cap", () => {
    expect(retryWaitMs(1, "61", now, () => 0.5)).toBeNull();
  });
  it("backs off about 2 s then 4 s without a header", () => {
    expect(retryWaitMs(1, null, now, () => 0.5)).toBe(2_000);
    expect(retryWaitMs(2, null, now, () => 0.5)).toBe(4_000);
  });
  it("jitters between 0.8 and 1.2", () => {
    expect(retryWaitMs(1, null, now, () => 0)).toBe(1_600);
    expect(retryWaitMs(2, null, now, () => 0)).toBe(3_200);
    expect(retryWaitMs(1, null, now, () => 1)).toBe(2_400);
    expect(retryWaitMs(2, null, now, () => 1)).toBe(4_800);
  });
  it("falls back to backoff on an unparseable header", () => {
    expect(retryWaitMs(1, "abc", now, () => 0.5)).toBe(2_000);
  });
});

describe("sleepAbortable", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves after the time", async () => {
    vi.useFakeTimers();
    let done = false;
    const p = sleepAbortable(1_000, undefined).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
  });

  it("resolves with a live signal and removes its listener", async () => {
    vi.useFakeTimers();
    const ctl = new AbortController();
    const p = sleepAbortable(500, ctl.signal);
    await vi.advanceTimersByTimeAsync(500);
    await expect(p).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with an AbortError when aborted mid-wait and leaves no timer", async () => {
    vi.useFakeTimers();
    const ctl = new AbortController();
    const p = sleepAbortable(10_000, ctl.signal);
    const caught = p.catch((e: unknown) => e);
    ctl.abort();
    const err = (await caught) as Error;
    expect(err.name).toBe("AbortError");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with the signal's own reason when it has one", async () => {
    vi.useFakeTimers();
    const ctl = new AbortController();
    const reason = new Error("custom");
    const p = sleepAbortable(10_000, ctl.signal);
    const caught = p.catch((e: unknown) => e);
    ctl.abort(reason);
    expect(await caught).toBe(reason);
  });

  it("rejects at once when already aborted", async () => {
    vi.useFakeTimers();
    const ctl = new AbortController();
    ctl.abort();
    await expect(sleepAbortable(10_000, ctl.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(vi.getTimerCount()).toBe(0);
  });
});
