import { afterEach, describe, expect, it, vi } from "vitest";
import { enqueueSave, SAVE_STALL_MS, whenSaved } from "./save-queue";

/** A save the test settles by hand, recording the snapshot it wrote. */
function manual() {
  const written: string[] = [];
  const pending: Array<{ snap: string; resolve: () => void; reject: (e: unknown) => void }> = [];
  const save = (snap: string) => () => new Promise<void>((resolve, reject) => {
    pending.push({
      snap,
      resolve: () => { written.push(snap); resolve(); },
      reject,
    });
  });
  return { written, pending, save };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("enqueueSave (§627)", () => {
  it("runs a save at once when the backend is idle", async () => {
    const m = manual();
    const backend = {};
    const p = enqueueSave(backend, m.save("A"));
    expect(m.pending.map((x) => x.snap)).toEqual(["A"]);
    m.pending[0].resolve();
    await expect(p).resolves.toBe("saved");
  });

  it("starts a second save only after the first settles, so the newer snapshot is written last", async () => {
    const m = manual();
    const backend = {};
    const pa = enqueueSave(backend, m.save("A"));
    const pb = enqueueSave(backend, m.save("B"));
    expect(m.pending.map((x) => x.snap)).toEqual(["A"]); // B waits
    m.pending[0].resolve();
    await flush();
    expect(m.pending.map((x) => x.snap)).toEqual(["A", "B"]);
    m.pending[1].resolve();
    await expect(pa).resolves.toBe("saved");
    await expect(pb).resolves.toBe("saved");
    expect(m.written).toEqual(["A", "B"]);
  });

  it("a newer save replaces the waiting one, which never runs and settles as superseded once the newer one has", async () => {
    const m = manual();
    const backend = {};
    const pa = enqueueSave(backend, m.save("A"));
    const pb = enqueueSave(backend, m.save("B"));
    const pc = enqueueSave(backend, m.save("C"));
    let bSettled = false;
    void pb.then(() => { bSettled = true; });
    m.pending[0].resolve();
    await flush();
    expect(m.pending.map((x) => x.snap)).toEqual(["A", "C"]);
    expect(bSettled).toBe(false); // not before C has landed: its content is in flight in C
    m.pending[1].resolve();
    await expect(pa).resolves.toBe("saved");
    await expect(pb).resolves.toBe("superseded");
    await expect(pc).resolves.toBe("saved");
    expect(m.written).toEqual(["A", "C"]);
  });

  it("a superseded save still resolves as superseded when the save that replaced it fails", async () => {
    const m = manual();
    const backend = {};
    void enqueueSave(backend, m.save("A"));
    const pb = enqueueSave(backend, m.save("B"));
    const pc = enqueueSave(backend, m.save("C"));
    m.pending[0].resolve();
    await flush();
    m.pending[1].reject(new Error("C boom"));
    await expect(pc).rejects.toThrow("C boom");
    await expect(pb).resolves.toBe("superseded");
  });

  it("a failed save does not block the one waiting behind it", async () => {
    const m = manual();
    const backend = {};
    const pa = enqueueSave(backend, m.save("A"));
    const pb = enqueueSave(backend, m.save("B"));
    m.pending[0].reject(new Error("A boom"));
    await expect(pa).rejects.toThrow("A boom");
    await flush();
    expect(m.pending.map((x) => x.snap)).toEqual(["A", "B"]);
    m.pending[1].resolve();
    await expect(pb).resolves.toBe("saved");
  });

  it("a save that throws synchronously rejects its promise and frees the queue", async () => {
    const m = manual();
    const backend = {};
    const pa = enqueueSave(backend, () => { throw new Error("sync boom"); });
    await expect(pa).rejects.toThrow("sync boom");
    const pb = enqueueSave(backend, m.save("B"));
    expect(m.pending.map((x) => x.snap)).toEqual(["B"]);
    m.pending[0].resolve();
    await expect(pb).resolves.toBe("saved");
  });

  it("queues per backend: saves to different backends do not wait for each other", () => {
    const m = manual();
    void enqueueSave({}, m.save("A"));
    void enqueueSave({}, m.save("B"));
    expect(m.pending.map((x) => x.snap)).toEqual(["A", "B"]);
  });

  it("a replacement chain: every replaced save settles superseded, only the newest runs", async () => {
    const m = manual();
    const backend = {};
    void enqueueSave(backend, m.save("A"));
    const pb = enqueueSave(backend, m.save("B"));
    const pc = enqueueSave(backend, m.save("C"));
    const pd = enqueueSave(backend, m.save("D"));
    m.pending[0].resolve();
    await flush();
    expect(m.pending.map((x) => x.snap)).toEqual(["A", "D"]);
    m.pending[1].resolve();
    await expect(pb).resolves.toBe("superseded");
    await expect(pc).resolves.toBe("superseded");
    await expect(pd).resolves.toBe("saved");
    expect(m.written).toEqual(["A", "D"]);
  });

  it("settleReplacedAsOwn: the replaced save settles as the replacing one did — saved, or its error", async () => {
    const m = manual();
    const backend = {};
    void enqueueSave(backend, m.save("A"));
    const pb = enqueueSave(backend, m.save("B"));
    const pc = enqueueSave(backend, m.save("C"), { settleReplacedAsOwn: true });
    m.pending[0].resolve();
    await flush();
    m.pending[1].resolve();
    await expect(pc).resolves.toBe("saved");
    await expect(pb).resolves.toBe("saved");

    const pe = enqueueSave(backend, m.save("E"));
    const pf = enqueueSave(backend, m.save("F"));
    const pg = enqueueSave(backend, m.save("G"), { settleReplacedAsOwn: true });
    m.pending[2].resolve();
    await flush();
    m.pending[3].reject(new Error("G boom"));
    await expect(pe).resolves.toBe("saved");
    await expect(pg).rejects.toThrow("G boom");
    await expect(pf).rejects.toThrow("G boom");
  });

  it("a save returning a non-promise does not lock the queue", async () => {
    const m = manual();
    const backend = {};
    const pa = enqueueSave(backend, (() => undefined) as unknown as () => Promise<void>);
    await expect(pa).resolves.toBe("saved");
    void enqueueSave(backend, m.save("B"));
    expect(m.pending.map((x) => x.snap)).toEqual(["B"]);
  });

  it("the queue is idle again after it drains", async () => {
    const m = manual();
    const backend = {};
    const pa = enqueueSave(backend, m.save("A"));
    m.pending[0].resolve();
    await pa;
    void enqueueSave(backend, m.save("B"));
    expect(m.pending.map((x) => x.snap)).toEqual(["A", "B"]);
  });
});

describe("enqueueSave — a save that never settles (§627 review I1)", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("releases the queue after SAVE_STALL_MS, and the stalled save still settles its own promise later", async () => {
    vi.useFakeTimers();
    const m = manual();
    const backend = {};
    const pa = enqueueSave(backend, m.save("A")); // hangs
    void enqueueSave(backend, m.save("B"));
    await vi.advanceTimersByTimeAsync(SAVE_STALL_MS - 1);
    expect(m.pending.map((x) => x.snap)).toEqual(["A"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(m.pending.map((x) => x.snap)).toEqual(["A", "B"]); // B started anyway

    void enqueueSave(backend, m.save("C")); // B holds the queue now
    m.pending[0].resolve(); // A finally lands: it must not release B's hold
    await expect(pa).resolves.toBe("saved");
    expect(m.pending.map((x) => x.snap)).toEqual(["A", "B"]);
    m.pending[1].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(m.pending.map((x) => x.snap)).toEqual(["A", "B", "C"]);
  });
});

describe("whenSaved — the reload waits for every queued save (§641)", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("is null when nothing is saving to the backend, or once it has drained", async () => {
    expect(whenSaved({})).toBeNull();
    const m = manual();
    const backend = {};
    void enqueueSave(backend, m.save("A"));
    expect(whenSaved(backend)).not.toBeNull();
    m.pending[0].resolve();
    await flush();
    expect(whenSaved(backend)).toBeNull();
  });

  it("waits for the running save AND the one waiting behind it", async () => {
    const m = manual();
    const backend = {};
    void enqueueSave(backend, m.save("A"));
    void enqueueSave(backend, m.save("B"));
    let idle = false;
    void whenSaved(backend)?.then(() => { idle = true; });
    m.pending[0].resolve();
    await flush();
    expect(idle).toBe(false); // B started, still running
    m.pending[1].resolve();
    await flush();
    expect(idle).toBe(true);
    expect(m.written).toEqual(["A", "B"]);
  });

  it("does not replace the waiting save", async () => {
    const m = manual();
    const backend = {};
    void enqueueSave(backend, m.save("A"));
    const pb = enqueueSave(backend, m.save("B"));
    void whenSaved(backend);
    m.pending[0].resolve();
    await flush();
    m.pending[1].resolve();
    await expect(pb).resolves.toBe("saved");
  });

  it("resolves after a failed save too", async () => {
    const m = manual();
    const backend = {};
    enqueueSave(backend, m.save("A")).catch(() => undefined);
    const idle = whenSaved(backend);
    m.pending[0].reject(new Error("disk full"));
    await expect(idle).resolves.toBeUndefined();
  });

  it("resolves when the stall timer releases a save that never settles", async () => {
    vi.useFakeTimers();
    const backend = {};
    void enqueueSave(backend, () => new Promise<void>(() => undefined));
    let idle = false;
    void whenSaved(backend)?.then(() => { idle = true; });
    await vi.advanceTimersByTimeAsync(SAVE_STALL_MS - 1);
    expect(idle).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(idle).toBe(true);
  });

  it("is per backend: another backend's save does not hold it", async () => {
    const m = manual();
    const saving = enqueueSave({}, m.save("A"));
    expect(whenSaved({})).toBeNull();
    m.pending[0].resolve(); // ★ settle it, so its stall timer does not outlive the test
    await saving;
  });
});
