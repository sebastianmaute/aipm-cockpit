import { describe, expect, it, vi } from "vitest";
import { createPeerRevisionDeferral } from "./peer-revision-deferral";
import type { StorageBackend } from "./workspace";

/** A backend holding revision `held`, which `adoptRevision` replaces. */
function backendAt(held: string | null) {
  const b = { revision: () => held, adoptRevision: vi.fn((rev: string) => { held = rev; }) };
  return b as unknown as StorageBackend & { adoptRevision: ReturnType<typeof vi.fn> };
}

describe("createPeerRevisionDeferral (§666)", () => {
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

  // A peer that saves twice while this window is busy posts R1 (from B), then R2 (from R1). One slot
  // overwritten kept {R2, from R1}, which this window, still at B, never matched: it wrote from B and paused.
  it("chains a revision whose base is the pending one's revision, so the window adopts the peer's latest", () => {
    const d = createPeerRevisionDeferral(() => {});
    const b = backendAt("1");
    d.defer(b, "2", "1");
    d.defer(b, "3", "2");
    expect(d.covers(b, "1", 0, false)).toBe(true); // the running job read 1: the chain explains its refusal
    expect(d.settle(b, 1, false)).toBe("skip"); // a snapshot from before the SECOND message still lacks its slices
    expect(d.settle(b, 2, false)).toBe("write");
    expect(b.adoptRevision).toHaveBeenCalledWith("3");
  });

  it("ignores a revision that neither continues the pending one nor starts from this window's own", () => {
    const onDeferred = vi.fn();
    const d = createPeerRevisionDeferral(onDeferred);
    const b = backendAt("1");
    d.defer(b, "2", "1");
    d.defer(b, "9", "7"); // another writer's, from a base this window never held
    expect(onDeferred).toHaveBeenCalledTimes(1);
    expect(d.covers(b, "1", 0, false)).toBe(true); // the usable entry survived
    expect(d.settle(b, 1, false)).toBe("write");
    expect(b.adoptRevision).toHaveBeenCalledWith("2");
  });

  it("a revision from this window's own base replaces an entry it does not continue", () => {
    const d = createPeerRevisionDeferral(() => {});
    const b = backendAt("1");
    d.defer(b, "2", "1");
    d.defer(b, "5", "1"); // a second writer, also from 1: only one of the two can be adopted
    expect(d.settle(b, 2, false)).toBe("write");
    expect(b.adoptRevision).toHaveBeenCalledWith("5");
  });

  // The queue starts the successor BEFORE the refused job's rejection handler runs, so the successor's
  // `settle` may adopt (and consume) the entry first. The refusal it explains must still be covered.
  it("still covers a refusal after the successor already adopted the entry, and not the successor's own", () => {
    const d = createPeerRevisionDeferral(() => {});
    const b = backendAt("1");
    d.defer(b, "2", "1");
    expect(d.settle(b, 1, false)).toBe("write"); // the successor adopts 2
    expect(d.covers(b, "1", 0, false)).toBe(true); // the old job, read from 1 before the message
    expect(d.covers(b, "2", 1, false)).toBe(false); // the successor's own refusal is a real conflict: no loop
    expect(d.covers(b, "1", 0, true)).toBe(false); // contested: reported
  });
});

