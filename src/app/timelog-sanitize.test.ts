import { describe, it, expect } from "vitest";
import { sanitizeTimelogLinks, sanitizeTimelogConfig } from "./timelog-sanitize";
import { defaultTimelogConfig } from "./timelog-types";

describe("sanitizeTimelogLinks", () => {
  it("returns undefined for non-objects", () => {
    expect(sanitizeTimelogLinks(null)).toBeUndefined();
    expect(sanitizeTimelogLinks(42)).toBeUndefined();
    expect(sanitizeTimelogLinks([])).toBeUndefined();
  });
  it("keeps valid links and coerces manual to boolean", () => {
    const out = sanitizeTimelogLinks({
      userLinks: [{ timelogUserId: 5, resourceId: 9, manual: true }],
      projectLinks: [{ timelogProjectId: 3, bucketId: 7, manual: 1 }],
    });
    expect(out).toEqual({
      userLinks: [{ timelogUserId: 5, resourceId: 9, manual: true }],
      projectLinks: [{ timelogProjectId: 3, bucketId: 7, manual: true }],
    });
  });
  it("drops links with non-numeric ids and dedupes by timelog id (last wins)", () => {
    const out = sanitizeTimelogLinks({
      userLinks: [
        { timelogUserId: 5, resourceId: 1, manual: false },
        { timelogUserId: 5, resourceId: 2, manual: true },
        { timelogUserId: "x", resourceId: 3, manual: false },
      ],
      projectLinks: [],
    });
    expect(out).toEqual({
      userLinks: [{ timelogUserId: 5, resourceId: 2, manual: true }],
      projectLinks: [],
    });
  });
  it("accepts bucketId null (explicit unmapped) but drops missing ids", () => {
    const out = sanitizeTimelogLinks({
      userLinks: [],
      projectLinks: [{ timelogProjectId: 3, bucketId: null, manual: false }],
    });
    expect(out?.projectLinks).toEqual([{ timelogProjectId: 3, bucketId: null, manual: false }]);
  });
  it("keeps a positive integer customerId (project scope)", () => {
    const out = sanitizeTimelogLinks({ userLinks: [], projectLinks: [], customerId: 42 });
    expect(out?.customerId).toBe(42);
  });
  it("drops a non-positive / non-integer / missing customerId", () => {
    expect(sanitizeTimelogLinks({ userLinks: [], projectLinks: [], customerId: 0 })?.customerId).toBeUndefined();
    expect(sanitizeTimelogLinks({ userLinks: [], projectLinks: [], customerId: -3 })?.customerId).toBeUndefined();
    expect(sanitizeTimelogLinks({ userLinks: [], projectLinks: [], customerId: 1.5 })?.customerId).toBeUndefined();
    expect(sanitizeTimelogLinks({ userLinks: [], projectLinks: [], customerId: "7" })?.customerId).toBeUndefined();
    expect(sanitizeTimelogLinks({ userLinks: [], projectLinks: [] })?.customerId).toBeUndefined();
  });
  it("keeps positive-int projectIds, deduped; drops bad values + the empty key", () => {
    const out = sanitizeTimelogLinks({ userLinks: [], projectLinks: [], projectIds: [9, 9, 12, 0, -1, 1.5, "3", null] });
    expect(out?.projectIds).toEqual([9, 12]);
    expect(sanitizeTimelogLinks({ userLinks: [], projectLinks: [], projectIds: [] })?.projectIds).toBeUndefined();
    expect(sanitizeTimelogLinks({ userLinks: [], projectLinks: [], projectIds: "nope" })?.projectIds).toBeUndefined();
    expect(sanitizeTimelogLinks({ userLinks: [], projectLinks: [] })?.projectIds).toBeUndefined();
  });
});

describe("sanitizeTimelogConfig", () => {
  it("falls back to defaults for garbage", () => {
    expect(sanitizeTimelogConfig(null)).toEqual(defaultTimelogConfig);
  });
  it("clamps scopeMode to the allowed set and trims strings", () => {
    const out = sanitizeTimelogConfig({
      enabled: true, host: " app1.timelog.com ", tenant: "acme", email: "a@b.c",
      apiToken: "tok", scopeMode: "bogus",
    });
    expect(out.enabled).toBe(true);
    expect(out.host).toBe("app1.timelog.com");
    expect(out.scopeMode).toBe("auto");
  });
  it("passes through a valid tokenInvalidAt string and drops a non-string", () => {
    const valid = sanitizeTimelogConfig({ tokenInvalidAt: "2026-06-23T10:00:00.000Z" });
    expect(valid.tokenInvalidAt).toBe("2026-06-23T10:00:00.000Z");
    const invalid = sanitizeTimelogConfig({ tokenInvalidAt: 12345 });
    expect(invalid.tokenInvalidAt).toBeUndefined();
  });
});

describe("sanitizeTimelogLinks policy", () => {
  const base = { userLinks: [], projectLinks: [] };

  // ★★ TRAP (d): the round-trip alone does not protect golden-workspace.test.
  // This is the half that does — an unconfigured blob must be byte-identical
  // to what it was before `policy` existed.
  it("omits the policy key entirely when no rule is configured", () => {
    const out = sanitizeTimelogLinks({ ...base });
    expect(out).toBeDefined();
    expect(Object.keys(out as object)).toEqual(["userLinks", "projectLinks"]);
    expect(JSON.stringify(out)).toBe('{"userLinks":[],"projectLinks":[]}');
  });

  it("omits the policy key when the policy object is present but empty", () => {
    const out = sanitizeTimelogLinks({ ...base, policy: {} });
    expect(JSON.stringify(out)).toBe('{"userLinks":[],"projectLinks":[]}');
  });

  it("keeps a configured rule and its threshold", () => {
    const out = sanitizeTimelogLinks({
      ...base,
      policy: { timelogCapPerDay: { enabled: true, threshold: 10 } },
    });
    expect(out?.policy).toEqual({ timelogCapPerDay: { enabled: true, threshold: 10 } });
  });

  it("keeps a disabled rule, because off is a decision the user made", () => {
    const out = sanitizeTimelogLinks({
      ...base,
      policy: { timelogCapPerDay: { enabled: false, threshold: 10 } },
    });
    expect(out?.policy).toEqual({ timelogCapPerDay: { enabled: false, threshold: 10 } });
  });

  it("drops an unknown rule id", () => {
    const out = sanitizeTimelogLinks({
      ...base,
      policy: { nope: { enabled: true, threshold: 3 }, timelogNonWorkingDay: { enabled: true } },
    });
    expect(out?.policy).toEqual({ timelogNonWorkingDay: { enabled: true } });
  });

  it("drops a non-finite or out-of-range threshold but keeps the enabled flag", () => {
    const out = sanitizeTimelogLinks({
      ...base,
      policy: {
        timelogCapPerDay: { enabled: true, threshold: Number.NaN },
        timelogCapPerEntry: { enabled: true, threshold: 999 },
      },
    });
    expect(out?.policy).toEqual({
      timelogCapPerDay: { enabled: true },
      timelogCapPerEntry: { enabled: true },
    });
  });

  it("ignores a non-object policy without dropping the links", () => {
    const out = sanitizeTimelogLinks({ ...base, policy: "yes" });
    expect(out).toEqual({ userLinks: [], projectLinks: [] });
  });
});
