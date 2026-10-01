import { describe, expect, it } from "vitest";
import { createMirrorLedger } from "./mirror-ledger";
import type { Workspace } from "./storage";

const ws = (over: Partial<Workspace> = {}): Workspace => ({ tasks: [], raid: [], absences: [], shifts: [], ...over }) as unknown as Workspace;
const list = (name: string) => [{ name }] as unknown as Workspace["tasks"];

/** A ledger that loaded `base`; returns it with the live workspace a commit would hold. */
function loaded(base = ws()) {
  const ledger = createMirrorLedger();
  ledger.markSaved(base);
  return { ledger, base };
}

describe("createMirrorLedger", () => {
  it("is never mirrored-only before a load or save", () => {
    const ledger = createMirrorLedger();
    const peer = list("peer");
    ledger.judge("tasks", [], peer);
    expect(ledger.isMirroredOnly(ws({ tasks: peer }))).toBe(false);
  });

  it("is not mirrored-only when nothing changed, so a no-change run still writes", () => {
    const { ledger, base } = loaded();
    expect(ledger.isMirroredOnly(base)).toBe(false);
  });

  it("is mirrored-only when every change is the latest peer value of its part", () => {
    const { ledger, base } = loaded();
    const peer = list("peer");
    ledger.judge("tasks", base.tasks, peer);
    expect(ledger.isMirroredOnly({ ...base, tasks: peer })).toBe(true);
  });

  it("counts an own change of another part, or an older peer value, as own", () => {
    const { ledger, base } = loaded();
    const p1 = list("p1");
    const p2 = list("p2");
    ledger.judge("tasks", base.tasks, p1);
    ledger.judge("tasks", p1, p2);
    expect(ledger.isMirroredOnly({ ...base, tasks: p2, raid: [{ id: "own" }] as unknown as Workspace["raid"] })).toBe(false);
    expect(ledger.isMirroredOnly({ ...base, tasks: p1 })).toBe(false);
    expect(ledger.isMirroredOnly({ ...base, tasks: base.tasks })).toBe(false); // back to the saved value
  });

  it("marks a part contested when the peer value lands on an own unsaved value", () => {
    const { ledger, base } = loaded();
    const own = list("own");
    const peer = list("peer");
    ledger.judge("tasks", own, peer);
    expect(ledger.isMirroredOnly({ ...base, tasks: peer })).toBe(false);
  });

  it("gives the same answer when an updater runs twice (StrictMode)", () => {
    const { ledger, base } = loaded();
    const p1 = list("p1");
    const p2 = list("p2");
    ledger.judge("tasks", base.tasks, p1);
    ledger.judge("tasks", p1, p2);
    ledger.judge("tasks", p1, p2); // the second invocation sees the same `live`
    expect(ledger.isMirroredOnly({ ...base, tasks: p2 })).toBe(true);
  });

  it("markSaved forgets every mirrored, contested and remembered value", () => {
    const { ledger, base } = loaded();
    const peer = list("peer");
    ledger.judge("tasks", list("own"), peer);
    const next = { ...base, tasks: peer };
    ledger.markSaved(next);
    expect(ledger.peerValueCount("tasks")).toBe(0);
    expect(ledger.isMirroredOnly(next)).toBe(false);
  });

  // A write's snapshot is taken before it lands; a peer value applied meanwhile is still the peer's to save.
  it("markWritten keeps a peer value its write did not hold, so that part stays mirrored", () => {
    const { ledger, base } = loaded();
    const own = [{ id: "own" }] as unknown as Workspace["raid"];
    const peer = list("peer");
    const written = { ...base, raid: own }; // the in-flight snapshot: the own edit, the old tasks
    ledger.judge("tasks", base.tasks, peer);
    ledger.markWritten(written);
    expect(ledger.isMirroredOnly({ ...written, tasks: peer })).toBe(true);
    expect(ledger.isMirroredOnly({ ...written, tasks: list("own again") })).toBe(false);
  });

  it("markWritten forgets a peer value its write held", () => {
    const { ledger, base } = loaded();
    const peer = list("peer");
    ledger.judge("tasks", base.tasks, peer);
    const written = { ...base, tasks: peer };
    ledger.markWritten(written);
    expect(ledger.peerValueCount("tasks")).toBe(0);
    expect(ledger.isMirroredOnly(written)).toBe(false); // nothing changed since the write
  });

  // The peer value was applied BEFORE the snapshot and an own edit then replaced it: the write superseded
  // it in storage, so the entry is dead and must not make later mirrors of other parts count as own.
  it("markWritten forgets a peer value its write replaced with an own edit", () => {
    const { ledger, base } = loaded();
    const peer = list("peer");
    const own = list("own");
    ledger.judge("tasks", base.tasks, peer);
    const written = { ...base, tasks: own }; // the own edit that replaced the mirrored value
    ledger.markWritten(written);
    expect(ledger.peerValueCount("tasks")).toBe(0);
    const peerRaid = [{ id: "peer" }] as unknown as Workspace["raid"];
    ledger.judge("raid", base.raid, peerRaid);
    expect(ledger.isMirroredOnly({ ...written, raid: peerRaid })).toBe(true);
  });

  // A peer value landed on an own unsaved value (contested), and the write then held that peer value: the
  // contested mark goes with the entry, or every later mirror of any part would count as own.
  it("markWritten clears a contested mark when its write held the peer value", () => {
    const { ledger, base } = loaded();
    const peer = list("peer");
    ledger.judge("tasks", list("own"), peer);
    const written = { ...base, tasks: peer };
    ledger.markWritten(written);
    const peerRaid = [{ id: "peer raid" }] as unknown as Workspace["raid"];
    ledger.judge("raid", written.raid, peerRaid);
    expect(ledger.isMirroredOnly({ ...written, raid: peerRaid })).toBe(true);
  });

  it("markWritten keeps a contested part contested when its write did not hold the peer value", () => {
    const { ledger, base } = loaded();
    const own = list("own");
    const peer = list("peer");
    ledger.judge("tasks", own, peer);
    ledger.markWritten({ ...base, tasks: own });
    expect(ledger.isMirroredOnly({ ...base, tasks: peer })).toBe(false);
  });

  // A window that only mirrors never calls markSaved, so without a prune it keeps every peer value.
  it("keeps at most two peer values per part across many mirrored commits", () => {
    const { ledger, base } = loaded();
    let live = base.tasks;
    for (let i = 0; i < 50; i += 1) {
      const next = list(`p${i}`);
      ledger.judge("tasks", live, next);
      live = next;
      ledger.prune({ ...base, tasks: live });
      expect(ledger.peerValueCount("tasks")).toBeLessThanOrEqual(2);
    }
    expect(ledger.isMirroredOnly({ ...base, tasks: live })).toBe(true);
  });

  it("prune keeps the committed peer value and the latest mirrored one", () => {
    const { ledger, base } = loaded();
    const p1 = list("p1");
    const p2 = list("p2");
    ledger.judge("tasks", base.tasks, p1);
    ledger.judge("tasks", p1, p2); // p2 queued behind the committed p1
    ledger.prune({ ...base, tasks: p1 });
    expect(ledger.peerValueCount("tasks")).toBe(2);
    // The next render's updaters see p1 (committed) or p2 (just added): neither is own.
    const p3 = list("p3");
    ledger.judge("tasks", p2, p3);
    expect(ledger.isMirroredOnly({ ...base, tasks: p3 })).toBe(true);
  });

  it("after a prune, an own edit back to an older peer value is own when a newer one crosses it", () => {
    const { ledger, base } = loaded();
    const p1 = list("p1");
    const p2 = list("p2");
    ledger.judge("tasks", base.tasks, p1);
    ledger.prune({ ...base, tasks: p1 });
    ledger.judge("tasks", p1, p2);
    ledger.prune({ ...base, tasks: p2 });
    ledger.prune({ ...base, tasks: p1 }); // the own edit back to p1 commits
    const p3 = list("p3");
    ledger.judge("tasks", p1, p3);
    expect(ledger.isMirroredOnly({ ...base, tasks: p3 })).toBe(false);
  });
});
