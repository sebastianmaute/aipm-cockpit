import { describe, expect, it } from "vitest";
import { enqueueSave } from "./save-queue";

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
