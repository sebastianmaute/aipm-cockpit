import { describe, expect, it } from "vitest";
import { parseNextLink, retryAfterMs, toTrackerIssue } from "./github-issues-lib.mjs";

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
