// src/app/secrets-device-key.test.ts — the device key is created ONCE per browser, across tabs: two
// module instances (two tabs) sharing one IndexedDB end up with the same key, and a failed IndexedDB
// open does not leave a rejected promise behind for every later call.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";

type SecretsModule = typeof import("./secrets");

/** A stand-in for `navigator.locks`: one queue per lock name, shared by every module instance. */
function installFakeLocks(): { names: string[] } {
  const tails = new Map<string, Promise<unknown>>();
  const names: string[] = [];
  const locks = {
    request: (name: string, cb: () => Promise<unknown>) => {
      names.push(name);
      const run = (tails.get(name) ?? Promise.resolve()).then(() => cb());
      tails.set(name, run.catch(() => undefined));
      return run;
    },
  };
  Object.defineProperty(window.navigator, "locks", { value: locks, configurable: true });
  return { names };
}

/** A fresh module instance, as a second tab would load. */
async function freshTab(): Promise<SecretsModule> {
  vi.resetModules();
  return import("./secrets");
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
});
afterEach(() => {
  Reflect.deleteProperty(window.navigator, "locks");
  vi.unstubAllGlobals();
});

describe("the device key across tabs", () => {
  it("two tabs asking for the first device key at once end up with the same key", async () => {
    const tabA = await freshTab();
    const tabB = await freshTab();
    const { names } = installFakeLocks();

    await Promise.all([tabA.getDeviceKey(), tabB.getDeviceKey()]);

    const sealedInA = await tabA.sealDeviceValue("same key");
    expect(await tabB.openDeviceValue(sealedInA)).toBe("same key");
    expect(names).toContain("aipm-cockpit:device-key");
  });

  it("a failed IndexedDB open does not poison later calls", async () => {
    const tab = await freshTab();
    const working = globalThis.indexedDB;
    const failing = {
      open: () => {
        const req: { error?: Error; onerror?: () => void } = {};
        setTimeout(() => {
          req.error = new Error("open failed");
          req.onerror?.();
        }, 0);
        return req;
      },
    };
    vi.stubGlobal("indexedDB", failing);
    await expect(tab.getDeviceKey()).rejects.toThrow("open failed");
    vi.stubGlobal("indexedDB", working);
    const sealed = await tab.sealDeviceValue("after the failure");
    expect(await tab.openDeviceValue(sealed)).toBe("after the failure");
  });
});
