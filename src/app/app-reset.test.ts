import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAppConfig, resetAppToCleanSlate } from "./app-reset";
import { beginSealedWrite, SECRETS_KEY } from "./secrets-store";
import { sealDevice } from "./secrets";
import { keptProjectKey, UNLOAD_JOURNAL_PREFIX } from "./unload-journal";

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

  it("§4 removes both unload-journal slots of a project: the ordinary one and the kept one", () => {
    localStorage.setItem(`${UNLOAD_JOURNAL_PREFIX}p1`, "{}");
    localStorage.setItem(`${UNLOAD_JOURNAL_PREFIX}${keptProjectKey("p1")}`, "{}");
    localStorage.setItem(`${UNLOAD_JOURNAL_PREFIX}${keptProjectKey("p1", 123)}`, "{}");
    clearAppConfig();
    expect(localStorage.getItem(`${UNLOAD_JOURNAL_PREFIX}p1`)).toBeNull();
    expect(localStorage.getItem(`${UNLOAD_JOURNAL_PREFIX}${keptProjectKey("p1")}`)).toBeNull();
    expect(localStorage.getItem(`${UNLOAD_JOURNAL_PREFIX}${keptProjectKey("p1", 123)}`)).toBeNull();
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

// §609 — `clearAppConfig` removes the secrets key directly (not via `removeSealed`), and the
// reload that follows does not stop a WebCrypto continuation already queued, so it must also
// cancel every seal in flight.
describe("clearAppConfig vs a seal in flight (§609)", () => {
  it("a seal that began before the reset never writes the secrets key back", async () => {
    const sealed = await sealDevice("anthropicApiKey", "sk-1");
    const commit = beginSealedWrite("anthropicApiKey");
    clearAppConfig();
    expect(commit(sealed)).toBe(false);
    expect(localStorage.getItem(SECRETS_KEY)).toBeNull();
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
