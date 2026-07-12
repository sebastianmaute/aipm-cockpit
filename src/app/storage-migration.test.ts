import { describe, it, expect, beforeEach } from "vitest";
import { migrateLocalStorage } from "./storage-migration";

describe("migrateLocalStorage", () => {
  beforeEach(() => localStorage.clear());

  it("renames lop-app: prefixed keys and removes old", () => {
    localStorage.setItem("lop-app:settings", "{}");
    localStorage.setItem("lop-app:color-schemes", "[]");
    migrateLocalStorage();
    expect(localStorage.getItem("aipm-cockpit:settings")).toBe("{}");
    expect(localStorage.getItem("aipm-cockpit:color-schemes")).toBe("[]");
    expect(localStorage.getItem("lop-app:settings")).toBeNull();
  });

  it("renames the 5 non-prefixed scheme/style/theme keys", () => {
    localStorage.setItem("lop-style", "custom");
    localStorage.setItem("lop-theme", "dark");
    localStorage.setItem("lop-active-scheme-colors", "{}");
    localStorage.setItem("lop-active-scheme-structural", "{}");
    localStorage.setItem("lop-scheme-supports-dark", "1");
    migrateLocalStorage();
    expect(localStorage.getItem("aipm-cockpit-style")).toBe("custom");
    expect(localStorage.getItem("aipm-cockpit-theme")).toBe("dark");
    expect(localStorage.getItem("aipm-cockpit-active-scheme-colors")).toBe("{}");
    expect(localStorage.getItem("aipm-cockpit-active-scheme-structural")).toBe("{}");
    expect(localStorage.getItem("aipm-cockpit-scheme-supports-dark")).toBe("1");
    expect(localStorage.getItem("lop-style")).toBeNull();
  });

  it("is idempotent and does not clobber a newer target", () => {
    localStorage.setItem("aipm-cockpit:settings", "NEW");
    localStorage.setItem("lop-app:settings", "OLD");
    migrateLocalStorage();
    expect(localStorage.getItem("aipm-cockpit:settings")).toBe("NEW");
    expect(localStorage.getItem("lop-app:settings")).toBeNull();
    migrateLocalStorage();
    expect(localStorage.getItem("aipm-cockpit:settings")).toBe("NEW");
  });
});
