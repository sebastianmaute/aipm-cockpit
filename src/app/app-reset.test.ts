import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAppConfig, resetAppToCleanSlate } from "./app-reset";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("clearAppConfig", () => {
  it("removes every aipm-cockpit:* key but leaves foreign keys untouched", () => {
    localStorage.setItem("aipm-cockpit:settings", "{}");
    localStorage.setItem("aipm-cockpit:projects", "[]");
    localStorage.setItem("aipm-cockpit:secrets", "cipher");
    localStorage.setItem("aipm-cockpit:dashboard-size", "{}");
    localStorage.setItem("aipm-cockpit:digest-state", '{"p1":{}}');
    localStorage.setItem("some-other-app:keep", "x");

    clearAppConfig();

    expect(localStorage.getItem("aipm-cockpit:settings")).toBeNull();
    expect(localStorage.getItem("aipm-cockpit:projects")).toBeNull();
    expect(localStorage.getItem("aipm-cockpit:secrets")).toBeNull();
    expect(localStorage.getItem("aipm-cockpit:dashboard-size")).toBeNull();
    expect(localStorage.getItem("aipm-cockpit:digest-state")).toBeNull();
    // A non-namespaced key from another origin/app is left alone.
    expect(localStorage.getItem("some-other-app:keep")).toBe("x");
  });

  it("deletes the config IndexedDB databases (secrets device key + file handles)", () => {
    const spy = vi.spyOn(indexedDB, "deleteDatabase");
    clearAppConfig();
    expect(spy).toHaveBeenCalledWith("aipm-cockpit-secrets");
    expect(spy).toHaveBeenCalledWith("aipm-cockpit-project-handles");
    // The workspace data store is NEVER deleted (detach-only).
    expect(spy).not.toHaveBeenCalledWith("aipm-cockpit");
  });
});

describe("resetAppToCleanSlate", () => {
  it("clears config then invokes the injected reload exactly once", () => {
    localStorage.setItem("aipm-cockpit:settings", "{}");
    const reload = vi.fn();
    resetAppToCleanSlate(reload);
    expect(localStorage.getItem("aipm-cockpit:settings")).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
