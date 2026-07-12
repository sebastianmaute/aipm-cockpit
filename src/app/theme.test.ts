import { describe, test, expect } from "vitest";
import { resolveTheme, readStoredTheme, THEME_STORAGE_KEY } from "./theme";

describe("resolveTheme", () => {
  test("system follows the OS preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
  test("explicit choice overrides the OS preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("readStoredTheme", () => {
  test("returns a valid stored value", () => {
    expect(readStoredTheme("dark")).toBe("dark");
    expect(readStoredTheme("light")).toBe("light");
    expect(readStoredTheme("system")).toBe("system");
  });
  test("falls back to system on null or invalid input", () => {
    expect(readStoredTheme(null)).toBe("system");
    expect(readStoredTheme("bogus")).toBe("system");
    expect(readStoredTheme("")).toBe("system");
  });
});

test("storage key is the documented constant", () => {
  expect(THEME_STORAGE_KEY).toBe("aipm-cockpit-theme");
});
