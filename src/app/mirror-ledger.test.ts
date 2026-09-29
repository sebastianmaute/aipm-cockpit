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
