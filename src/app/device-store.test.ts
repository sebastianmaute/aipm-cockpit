import { afterEach, describe, expect, it, vi } from "vitest";

import { readDeviceJson, removeDeviceKey, writeDeviceJson } from "./device-store";

const KEY = "aipm-cockpit:device-store-test";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("device-store", () => {
  it("round-trips a JSON value", () => {
    writeDeviceJson(KEY, { a: 1, b: ["x"], c: null });
    expect(readDeviceJson(KEY, null)).toEqual({ a: 1, b: ["x"], c: null });
  });

  it("returns the fallback when the key is missing", () => {
    expect(readDeviceJson(KEY, { fallback: true })).toEqual({ fallback: true });
    expect(readDeviceJson(KEY, [])).toEqual([]);
  });

  it("returns the fallback on a parse error", () => {
    localStorage.setItem(KEY, "{ not valid json");
    expect(readDeviceJson(KEY, [])).toEqual([]);
  });

  it("removeDeviceKey clears the stored value", () => {
    writeDeviceJson(KEY, 42);
    expect(readDeviceJson(KEY, "missing")).toBe(42);
    removeDeviceKey(KEY);
    expect(readDeviceJson(KEY, "missing")).toBe("missing");
  });

  it("write survives a throwing setItem (quota) without throwing", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => writeDeviceJson(KEY, { x: 1 })).not.toThrow();
    expect(spy).toHaveBeenCalled();
  });
});
