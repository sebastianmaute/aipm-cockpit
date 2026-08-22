// src/app/document-asset-repairs.test.ts
//
// ★★ THE COUNTER IS MODULE STATE AND NOTHING RESETS IT, so every assertion here
// is RELATIVE to a value read at the top of the test. An absolute expectation
// (`toBe(1)`) would pass in isolation and fail the moment another test in the
// same file, or a shuffled neighbour, fired a repair first — `npm run
// test:shuffle` is a blocking gate and shuffles within a file too.

import { describe, it, expect, vi } from "vitest";
import {
  notifyAssetRepaired, subscribeAssetRepairs,
  getAssetRepairGeneration, getServerAssetRepairGeneration,
} from "./document-asset-repairs";

describe("document-asset-repairs", () => {
  it("advances the generation and tells every live subscriber", () => {
    const a = vi.fn();
    const b = vi.fn();
    const before = getAssetRepairGeneration();
    const offA = subscribeAssetRepairs(a);
    const offB = subscribeAssetRepairs(b);

    notifyAssetRepaired();

    expect(getAssetRepairGeneration()).toBe(before + 1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    offB();
  });

  it("stops calling a subscriber once it has unsubscribed", () => {
    // ★ React calls the returned teardown on unmount. A subscribe that leaked
    // would keep a detached preview's `useSyncExternalStore` callback alive for
    // the life of the page.
    const listener = vi.fn();
    const off = subscribeAssetRepairs(listener);
    off();

    notifyAssetRepaired();

    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps the server snapshot pinned at 0 while the client counter moves", () => {
    // ★★ Module state on a server is shared across requests, so the server
    // snapshot must not read the live counter — one request's repair would
    // otherwise reach another request's markup.
    notifyAssetRepaired();

    expect(getAssetRepairGeneration()).toBeGreaterThan(0);
    expect(getServerAssetRepairGeneration()).toBe(0);
  });
});
