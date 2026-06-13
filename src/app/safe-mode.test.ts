import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isSafeMode, __resetSafeModeCache } from "./safe-mode";

describe("isSafeMode", () => {
  beforeEach(() => {
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => {
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/");
  });

  it("is false on a normal URL", () => {
    expect(isSafeMode()).toBe(false);
  });

  it("is true with ?safe=1", () => {
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/?safe=1");
    expect(isSafeMode()).toBe(true);
  });

  it("is true with a bare ?safe", () => {
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/?safe");
    expect(isSafeMode()).toBe(true);
  });

  it("is true with #safe", () => {
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/#safe");
    expect(isSafeMode()).toBe(true);
  });

  it("memoizes the first read (URL change after first call is ignored)", () => {
    expect(isSafeMode()).toBe(false);
    window.history.replaceState({}, "", "/?safe=1");
    expect(isSafeMode()).toBe(false); // cached
  });
});
