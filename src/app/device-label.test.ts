import { describe, it, expect, beforeEach, vi } from "vitest";
import { getDeviceLabel } from "./device-label";

describe("getDeviceLabel", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("mints an 8-character label once and returns the same one afterwards", () => {
    const first = getDeviceLabel();
    expect(first).toHaveLength(8);
    expect(getDeviceLabel()).toBe(first);
    expect(localStorage.getItem("aipm-cockpit:device-label")).toBe(first);
  });

  it("falls back to unknown when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(getDeviceLabel()).toBe("unknown");
  });
});
