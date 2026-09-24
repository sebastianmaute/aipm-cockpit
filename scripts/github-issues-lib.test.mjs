import { describe, expect, it } from "vitest";
import {
  graphQLRateLimitMs,
  parseNextLink,
  rateLimitRetryMs,
  redactAndCap,
  retryAfterMs,
  toTrackerIssue,
} from "./github-issues-lib.mjs";

describe("parseNextLink", () => {
  it("returns the page-2 URL from a Link header naming next and last", () => {
    const header = '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=9>; rel="last"';
    expect(parseNextLink(header)).toBe("https://api.github.com/x?page=2");
  });
  it("returns null for a missing header", () => {
    expect(parseNextLink(null)).toBeNull();
  });
  it("returns null when only rel=prev is present", () => {
    expect(parseNextLink('<https://api.github.com/x?page=1>; rel="prev"')).toBeNull();
  });
});

describe("toTrackerIssue", () => {
  it("maps a GitHub issue to the tracker-neutral shape, labels flattened to names", () => {
    expect(toTrackerIssue({ number: 5, title: "§5: a", labels: [{ name: "x" }] })).toEqual({
      iid: 5,
      title: "§5: a",
      labels: ["x"],
    });
  });
  it("returns null for a pull request, even one with an empty pull_request object", () => {
    expect(toTrackerIssue({ number: 6, title: "a PR", labels: [], pull_request: {} })).toBeNull();
  });
  it("throws when the title is missing", () => {
    expect(() => toTrackerIssue({ number: 7, labels: [] })).toThrow();
  });
});

describe("retryAfterMs", () => {
  it("reads retry-after in seconds, converted to ms", () => {
    expect(retryAfterMs(429, new Headers({ "retry-after": "3" }))).toBe(3000);
  });
  it("returns null for a non-rate-limit status", () => {
    expect(retryAfterMs(500, new Headers())).toBeNull();
  });
  it("falls back to x-ratelimit-remaining=0 + x-ratelimit-reset on a 403", () => {
    const now = 1_700_000_000_000;
    const resetSeconds = Math.floor(now / 1000) + 10;
    const headers = new Headers({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(resetSeconds) });
    const ms = retryAfterMs(403, headers, now);
    expect(ms).toBeGreaterThan(9000);
    expect(ms).toBeLessThan(11000);
  });
  it("returns null for a plain 403 with no rate-limit headers", () => {
    expect(retryAfterMs(403, new Headers())).toBeNull();
  });
});

describe("rateLimitRetryMs", () => {
  const SECONDARY_BODY = JSON.stringify({
    message: "You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
  });
  it("waits 60 s on a 403 whose body names the secondary rate limit and carries no header", () => {
    expect(rateLimitRetryMs(403, new Headers(), SECONDARY_BODY)).toBe(60_000);
  });
  it("prefers retry-after when the secondary-limit 403 carries one", () => {
    expect(rateLimitRetryMs(403, new Headers({ "retry-after": "7" }), SECONDARY_BODY)).toBe(7000);
  });
  it("does NOT retry a bare 403 with neither a header nor the secondary-limit text", () => {
    expect(rateLimitRetryMs(403, new Headers(), JSON.stringify({ message: "Resource not accessible by integration" }))).toBeNull();
    expect(rateLimitRetryMs(403, new Headers(), "")).toBeNull();
    expect(rateLimitRetryMs(403, new Headers(), undefined)).toBeNull();
  });
  it("does not read the secondary-limit text on a status that is not 403", () => {
    expect(rateLimitRetryMs(500, new Headers(), SECONDARY_BODY)).toBeNull();
  });
  it("keeps retryAfterMs's header behaviour", () => {
    expect(rateLimitRetryMs(429, new Headers({ "retry-after": "3" }), "")).toBe(3000);
  });
});

describe("redactAndCap", () => {
  it("redacts the token before capping, so a token straddling the cut never leaks", () => {
    const token = "ghp_SECRETTOKEN1234567890";
    // The cut lands mid-token if the naive slice-then-redact order is used: 490 filler
    // characters, then the 26-character token, is 516 characters — past the 500 cap.
    const text = "x".repeat(490) + token + "y".repeat(50);
    const capped = redactAndCap(text, token, 500);
    expect(capped).not.toContain(token);
    expect(capped.length).toBeLessThanOrEqual(500);
    expect(capped).toContain("[REDACTED]");
  });
  it("caps at 500 characters by default when there is no token to redact", () => {
    const text = "z".repeat(600);
    expect(redactAndCap(text, null)).toHaveLength(500);
  });
  it("leaves text under the cap untouched apart from redaction", () => {
    expect(redactAndCap("short body", "unused-token")).toBe("short body");
  });
});

describe("graphQLRateLimitMs", () => {
  it("returns null when no error is RATE_LIMITED", () => {
    expect(graphQLRateLimitMs([{ type: "NOT_FOUND" }], new Headers())).toBeNull();
  });
  it("returns null for a non-array errors value", () => {
    expect(graphQLRateLimitMs(undefined, new Headers())).toBeNull();
  });
  it("defaults to 60 s when RATE_LIMITED and no retry-after-style header is present", () => {
    expect(graphQLRateLimitMs([{ type: "RATE_LIMITED", message: "slow down" }], new Headers())).toBe(60_000);
  });
  it("uses a retry-after header when present, even though the response is a 200", () => {
    const headers = new Headers({ "retry-after": "5" });
    expect(graphQLRateLimitMs([{ type: "RATE_LIMITED" }], headers)).toBe(5000);
  });
});
