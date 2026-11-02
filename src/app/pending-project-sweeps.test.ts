import { describe, it, expect, vi, beforeEach } from "vitest";

const runTursoPipeline = vi.fn();
const logDiag = vi.fn();
vi.mock("./turso-pipeline", () => ({ runTursoPipeline: (...a: unknown[]) => runTursoPipeline(...a) }));
vi.mock("./diagnostics", () => ({ logDiag: (...a: unknown[]) => logDiag(...a) }));

import {
  PENDING_PROJECT_SWEEPS_KEY, pendingProjectSweeps, addPendingProjectSweep, removePendingProjectSweep,
  retryPendingProjectSweeps,
} from "./pending-project-sweeps";
import { projectSideTableSweepStatements } from "./project-side-tables";

const A = "https://a.example";
const B = "https://b.example";

beforeEach(() => {
  window.localStorage.clear();
  runTursoPipeline.mockReset().mockResolvedValue([]);
  logDiag.mockReset();
});

describe("pending project sweeps", () => {
  it("stores project ids per database under one localStorage key", () => {
    addPendingProjectSweep(A, "p1");
    addPendingProjectSweep(A, "p2");
    addPendingProjectSweep(A, "p1");
    addPendingProjectSweep(B, "p9");
    expect(pendingProjectSweeps(A)).toEqual(["p1", "p2"]);
    expect(pendingProjectSweeps(B)).toEqual(["p9"]);
    expect(JSON.parse(window.localStorage.getItem(PENDING_PROJECT_SWEEPS_KEY)!)).toEqual({ [A]: ["p1", "p2"], [B]: ["p9"] });
  });

  it("removes one id, and the database entry with its last id", () => {
    addPendingProjectSweep(A, "p1");
    addPendingProjectSweep(A, "p2");
    removePendingProjectSweep(A, "p1");
    expect(pendingProjectSweeps(A)).toEqual(["p2"]);
    removePendingProjectSweep(A, "p2");
    expect(JSON.parse(window.localStorage.getItem(PENDING_PROJECT_SWEEPS_KEY)!)).toEqual({});
  });

  it("reads a malformed entry as empty and drops non-string ids", () => {
    window.localStorage.setItem(PENDING_PROJECT_SWEEPS_KEY, "{not json");
    expect(pendingProjectSweeps(A)).toEqual([]);
    window.localStorage.setItem(PENDING_PROJECT_SWEEPS_KEY, JSON.stringify({ [A]: ["p1", 7, ""], [B]: "p2" }));
    expect(pendingProjectSweeps(A)).toEqual(["p1"]);
    expect(pendingProjectSweeps(B)).toEqual([]);
  });

  it("retries each queued project with the side-table sweep and clears it on success", async () => {
    addPendingProjectSweep(A, "p1");
    addPendingProjectSweep(A, "p2");
    addPendingProjectSweep(B, "p9");
    await retryPendingProjectSweeps({ httpUrl: A, authToken: "t" });
    expect(runTursoPipeline).toHaveBeenCalledTimes(2);
    expect(runTursoPipeline.mock.calls[0][1]).toEqual(projectSideTableSweepStatements("p1"));
    expect(runTursoPipeline.mock.calls[1][1]).toEqual(projectSideTableSweepStatements("p2"));
    expect(pendingProjectSweeps(A)).toEqual([]);
    expect(pendingProjectSweeps(B)).toEqual(["p9"]);
  });

  it("keeps a project whose retry fails and logs only its id", async () => {
    addPendingProjectSweep(A, "p1");
    addPendingProjectSweep(A, "p2");
    runTursoPipeline.mockRejectedValueOnce(new Error("secret detail")).mockResolvedValueOnce([]);
    await retryPendingProjectSweeps({ httpUrl: A, authToken: "t" });
    expect(pendingProjectSweeps(A)).toEqual(["p1"]);
    expect(logDiag).toHaveBeenCalledWith("warn", "storage.projectSideTableSweepRetryFailed", { id: "p1" });
  });

  it("makes no call when nothing is queued", async () => {
    await retryPendingProjectSweeps({ httpUrl: A, authToken: "t" });
    expect(runTursoPipeline).not.toHaveBeenCalled();
  });
});
