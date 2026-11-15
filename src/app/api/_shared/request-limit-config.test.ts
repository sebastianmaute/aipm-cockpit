import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_RELAY_MAX_REQUESTS_ENV,
  MAX_REQUEST_LIMIT,
  STT_MAX_REQUESTS_ENV,
  parseRequestLimit,
  readRequestLimit,
} from "./request-limit-config";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseRequestLimit", () => {
  it("unset or blank → the route's default, not invalid", () => {
    expect(parseRequestLimit(undefined, 120)).toEqual({ max: 120, invalid: false });
    expect(parseRequestLimit("", 120)).toEqual({ max: 120, invalid: false });
    expect(parseRequestLimit("   ", 60)).toEqual({ max: 60, invalid: false });
  });

  it.each([
    ["1", 1],
    ["250", 250],
    [" 30 ", 30],
    [String(MAX_REQUEST_LIMIT), MAX_REQUEST_LIMIT],
  ])("a whole number in range (%j) is the limit", (raw, max) => {
    expect(parseRequestLimit(raw, 120)).toEqual({ max, invalid: false });
  });

  // An unusable value keeps the default, so a typo can never switch the limit off.
  it.each(["0", "-3", "1.5", "abc", "12abc", "1e3", "0x10", String(MAX_REQUEST_LIMIT + 1), "99999999999999999999"])(
    "%j is invalid and keeps the default",
    (raw) => {
      expect(parseRequestLimit(raw, 120)).toEqual({ max: 120, invalid: true });
    },
  );
});

describe("readRequestLimit", () => {
  it("reads the named setting", () => {
    expect(readRequestLimit({ [AI_RELAY_MAX_REQUESTS_ENV]: "300" }, AI_RELAY_MAX_REQUESTS_ENV, 120)).toBe(300);
    expect(readRequestLimit({ [STT_MAX_REQUESTS_ENV]: "15" }, STT_MAX_REQUESTS_ENV, 60)).toBe(15);
    // Each route reads its own setting only.
    expect(readRequestLimit({ [AI_RELAY_MAX_REQUESTS_ENV]: "300" }, STT_MAX_REQUESTS_ENV, 60)).toBe(60);
  });

  it("an invalid setting is logged once per process, naming the setting and never its value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = { [STT_MAX_REQUESTS_ENV]: "lots-secret-ish" };
    expect(readRequestLimit(env, STT_MAX_REQUESTS_ENV, 60)).toBe(60);
    expect(readRequestLimit(env, STT_MAX_REQUESTS_ENV, 60)).toBe(60);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(STT_MAX_REQUESTS_ENV);
    expect(String(warn.mock.calls[0][0])).not.toContain("lots-secret-ish");
  });

  it("the setting names are the documented ones", () => {
    expect(AI_RELAY_MAX_REQUESTS_ENV).toBe("AIPM_AI_RELAY_MAX_REQUESTS");
    expect(STT_MAX_REQUESTS_ENV).toBe("AIPM_STT_MAX_REQUESTS");
    expect(MAX_REQUEST_LIMIT).toBe(100_000);
  });
});
