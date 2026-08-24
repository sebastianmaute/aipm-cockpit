import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiagnosticsSection } from "./diagnostics-section";
import * as diagnostics from "../diagnostics";

// ★ vi.mock is hoisted above ordinary const/let, so the mock factory needs a
//   vi.hoisted-backed handle to swap fixtures per test instead of one fixed
//   module-level array.
const fixture = vi.hoisted(() => ({ tasks: [] as unknown[] }));

vi.mock("../workspace-context", () => ({
  useWorkspace: () => ({ tasks: fixture.tasks }),
}));

describe("DiagnosticsSection", () => {
  it("counts the workspace's split pairs and hands them to the panel", () => {
    fixture.tasks = [
      { id: 1, taskName: "a", status: "Done", completedDate: "2026-01-01", createdDate: "2026-01-01", lastUpdateDate: "2026-01-01" },
      { id: 2, taskName: "b", status: "In Progress", completedDate: "2026-01-01", createdDate: "2026-01-01", lastUpdateDate: "2026-01-01" },
    ];
    render(<DiagnosticsSection lang="en-US" />);
    expect(screen.getByText(/inconsistent completion data: 1/i)).toBeInTheDocument();
  });

  it("logs the count to the diagnostic ring when it is non-zero", () => {
    fixture.tasks = [
      { id: 1, taskName: "a", status: "Done", completedDate: "2026-01-01", createdDate: "2026-01-01", lastUpdateDate: "2026-01-01" },
      { id: 2, taskName: "b", status: "In Progress", completedDate: "2026-01-01", createdDate: "2026-01-01", lastUpdateDate: "2026-01-01" },
    ];
    // ★ try/finally, not a trailing mockRestore: there is no global
    //   `restoreMocks`, so a failing expectation would leave the spy live and
    //   the NEXT test would inherit it — one red reported as two. The
    //   `--sequence.shuffle` gate makes which test inherits it vary by seed.
    const spy = vi.spyOn(diagnostics, "logDiag");
    try {
      render(<DiagnosticsSection lang="en-US" />);
      expect(spy).toHaveBeenCalledWith("warn", "task-pair-split", { count: 1 });
    } finally {
      spy.mockRestore();
    }
  });

  it("logs nothing when the workspace has no split pairs", () => {
    // ★ The guard is `splitPairs > 0`, and it is the reason a clean workspace
    //   stays out of the ring. Without this test `>= 0` ships green: every
    //   mount of Settings → Diagnostics would then write a `warn` entry
    //   reading `count: 0` — noise in a 200-entry ring, and a false signal in
    //   a support bundle, where a warn-level "task-pair-split" reads as a
    //   problem report rather than an all-clear.
    fixture.tasks = [
      { id: 1, taskName: "a", status: "Done", completedDate: "2026-01-01", createdDate: "2026-01-01", lastUpdateDate: "2026-01-01" },
      { id: 2, taskName: "b", status: "In Progress", completedDate: undefined, createdDate: "2026-01-01", lastUpdateDate: "2026-01-01" },
    ];
    const spy = vi.spyOn(diagnostics, "logDiag");
    try {
      render(<DiagnosticsSection lang="en-US" />);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("still renders the row for a clean workspace", () => {
    // ★ Not logging is not the same as not REPORTING. A measured zero is a
    //   positive signal and must still reach the panel — it distinguishes
    //   "measured, clean" from the recovery mount, which supplies no count at
    //   all and renders no row.
    fixture.tasks = [
      { id: 1, taskName: "a", status: "Done", completedDate: "2026-01-01", createdDate: "2026-01-01", lastUpdateDate: "2026-01-01" },
    ];
    render(<DiagnosticsSection lang="en-US" />);
    expect(screen.getByText(/inconsistent completion data: 0/i)).toBeInTheDocument();
  });
});
