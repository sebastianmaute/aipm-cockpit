import { describe, it, expect, beforeEach } from "vitest";
import {
  loadDigestState, advanceDigestState, isDigestDue, clearDigestState,
  DIGEST_STATE_MAX_PROJECTS, type DigestState,
} from "./digest-state";

beforeEach(() => localStorage.clear());

describe("digest-state", () => {
  it("returns null for an unknown project", () => {
    expect(loadDigestState("p1")).toBeNull();
  });

  it("advance sets lastRunAt=now, nextDueAt=now+cadenceDays, snapshots rag/metrics", () => {
    advanceDigestState("p1", {
      now: "2026-07-10T09:00:00.000Z", cadenceDays: 7, rag: "R",
      metrics: { overdue: 3, openRaid: 5 },
    });
    const s = loadDigestState("p1") as DigestState;
    expect(s.lastRunAt).toBe("2026-07-10T09:00:00.000Z");
    expect(s.nextDueAt).toBe("2026-07-17T09:00:00.000Z");
    expect(s.priorRag).toBe("R");
    expect(s.priorMetrics).toEqual({ overdue: 3, openRaid: 5 });
  });

  it("isDigestDue is true at/after nextDueAt, false before", () => {
    const s: DigestState = {
      lastRunAt: "2026-07-10T09:00:00.000Z", nextDueAt: "2026-07-17T09:00:00.000Z",
      priorRag: "G", priorMetrics: { overdue: 0, openRaid: 0 },
    };
    expect(isDigestDue(s, "2026-07-16T09:00:00.000Z")).toBe(false);
    expect(isDigestDue(s, "2026-07-17T09:00:00.000Z")).toBe(true);
    expect(isDigestDue(s, "2026-07-18T00:00:00.000Z")).toBe(true);
  });

  it("keeps projects isolated and caps at DIGEST_STATE_MAX_PROJECTS", () => {
    for (let i = 0; i < DIGEST_STATE_MAX_PROJECTS + 5; i++) {
      advanceDigestState(`p${i}`, {
        now: `2026-07-10T09:00:0${(i % 10)}.000Z`, cadenceDays: 7, rag: "A",
        metrics: { overdue: i, openRaid: 0 },
      });
    }
    expect(loadDigestState(`p${DIGEST_STATE_MAX_PROJECTS + 4}`)).not.toBeNull();
    const raw = JSON.parse(localStorage.getItem("lop-app:digest-state") || "{}");
    expect(Object.keys(raw).length).toBeLessThanOrEqual(DIGEST_STATE_MAX_PROJECTS);
  });

  it("treats malformed storage as absent (no crash)", () => {
    localStorage.setItem("lop-app:digest-state", "not json");
    expect(loadDigestState("p1")).toBeNull();
  });

  it("clearDigestState wipes the key", () => {
    advanceDigestState("p1", { now: "2026-07-10T09:00:00.000Z", cadenceDays: 7, rag: "A", metrics: { overdue: 0, openRaid: 0 } });
    clearDigestState();
    expect(localStorage.getItem("lop-app:digest-state")).toBeNull();
  });
});
