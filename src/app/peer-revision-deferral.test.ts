import { describe, expect, it, vi } from "vitest";
import { createPeerRevisionDeferral } from "./peer-revision-deferral";
import type { StorageBackend } from "./workspace";

/** A backend holding revision `held`, which `adoptRevision` replaces. */
function backendAt(held: string | null) {
  const b = { revision: () => held, adoptRevision: vi.fn((rev: string) => { held = rev; }) };
  return b as unknown as StorageBackend & { adoptRevision: ReturnType<typeof vi.fn> };
}

describe("createPeerRevisionDeferral (§662)", () => {
  it("defer bumps the sequence and reports it, once per deferred revision", () => {
    const onDeferred = vi.fn();
    const d = createPeerRevisionDeferral(onDeferred);
    const b = backendAt("1");
    d.defer(b, "2", "1");
    d.defer(b, "3", "2");
    expect(onDeferred.mock.calls).toEqual([[1], [2]]);
  });

  it("with nothing deferred every job writes and nothing is adopted", () => {
    const d = createPeerRevisionDeferral(() => {});
    const b = backendAt("1");
    expect(d.settle(b, 0, false)).toBe("write");
    expect(b.adoptRevision).not.toHaveBeenCalled();
    expect(d.covers(b, "1", 0, false)).toBe(false);
  });

  it("skips a job whose snapshot predates the deferred revision, without consuming it", () => {
    const d = createPeerRevisionDeferral(() => {});
    const b = backendAt("1");
    d.defer(b, "2", "1");
    expect(d.settle(b, 0, false)).toBe("skip");
    expect(b.adoptRevision).not.toHaveBeenCalled();
    expect(d.settle(b, 1, false)).toBe("write"); // the job the bump caused
    expect(b.adoptRevision).toHaveBeenCalledWith("2");
  });

  it("adopts once: a later job writes from the adopted revision with nothing left to adopt", () => {
    const d = createPeerRevisionDeferral(() => {});
    const b = backendAt("1");
    d.defer(b, "2", "1");
    d.settle(b, 1, false);
    expect(d.settle(b, 0, false)).toBe("write"); // consumed: even an old snapshot is no longer skipped
    expect(b.adoptRevision).toHaveBeenCalledTimes(1);
  });

  it("drops an entry whose base this backend no longer holds, and writes", () => {
    const d = createPeerRevisionDeferral(() => {});
    const b = backendAt("5");
    d.defer(b, "2", "1");
    expect(d.settle(b, 0, false)).toBe("write");
    expect(b.adoptRevision).not.toHaveBeenCalled();
    expect(d.covers(b, "1", 0, false)).toBe(false);
  });

  it("a contested slice drops the entry: the job writes from its own base and meets the revision check", () => {
    const d = createPeerRevisionDeferral(() => {});
    const b = backendAt("1");
    d.defer(b, "2", "1");
    expect(d.covers(b, "1", 0, true)).toBe(false);
    expect(d.settle(b, 1, true)).toBe("write");
    expect(b.adoptRevision).not.toHaveBeenCalled();
    expect(d.settle(b, 1, false)).toBe("write");
    expect(b.adoptRevision).not.toHaveBeenCalled();
  });

  it("another backend instance's job neither adopts nor drops the entry", () => {
    const d = createPeerRevisionDeferral(() => {});
    const live = backendAt("1");
    const old = backendAt("1");
    d.defer(live, "2", "1");
    expect(d.settle(old, 9, false)).toBe("write");
    expect(old.adoptRevision).not.toHaveBeenCalled();
    expect(d.covers(old, "1", 0, false)).toBe(false);
    expect(d.settle(live, 1, false)).toBe("write");
    expect(live.adoptRevision).toHaveBeenCalledWith("2");
  });

  it("covers a refused job that read the deferred base and predates it, and nothing else", () => {
    const d = createPeerRevisionDeferral(() => {});
    const b = backendAt("1");
    d.defer(b, "2", "1");
    expect(d.covers(b, "1", 0, false)).toBe(true);
    expect(d.covers(b, "1", 1, false)).toBe(false); // built after the message: its refusal is a third writer
    expect(d.covers(b, "0", 0, false)).toBe(false); // read another base
    expect(d.covers(b, null, 0, false)).toBe(false);
    expect(d.covers(b, undefined, 0, false)).toBe(false); // never read one: the job never ran
  });
});
