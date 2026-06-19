import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAppConfig, resetAppToCleanSlate } from "./app-reset";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("clearAppConfig", () => {
  it("removes every lop-app:* key but leaves foreign keys untouched", () => {
    localStorage.setItem("lop-app:settings", "{}");
    localStorage.setItem("lop-app:projects", "[]");
    localStorage.setItem("lop-app:secrets", "cipher");
    localStorage.setItem("lop-app:dashboard-size", "{}");
    localStorage.setItem("some-other-app:keep", "x");

    clearAppConfig();

    expect(localStorage.getItem("lop-app:settings")).toBeNull();
    expect(localStorage.getItem("lop-app:projects")).toBeNull();
    expect(localStorage.getItem("lop-app:secrets")).toBeNull();
    expect(localStorage.getItem("lop-app:dashboard-size")).toBeNull();
    // A non-namespaced key from another origin/app is left alone.
    expect(localStorage.getItem("some-other-app:keep")).toBe("x");
  });

  it("deletes the secrets device-key IndexedDB database", () => {
    const spy = vi.spyOn(indexedDB, "deleteDatabase");
    clearAppConfig();
    expect(spy).toHaveBeenCalledWith("lop-app-secrets");
  });
});

describe("resetAppToCleanSlate", () => {
  it("clears config then invokes the injected reload exactly once", () => {
    localStorage.setItem("lop-app:settings", "{}");
    const reload = vi.fn();
    resetAppToCleanSlate(reload);
    expect(localStorage.getItem("lop-app:settings")).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
