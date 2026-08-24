import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiagnosticsSection } from "./diagnostics-section";
import * as diagnostics from "../diagnostics";

vi.mock("../workspace-context", () => ({
  useWorkspace: () => ({
    tasks: [
      { id: 1, taskName: "a", status: "Done", completedDate: "2026-01-01", createdDate: "2026-01-01", lastUpdateDate: "2026-01-01" },
      { id: 2, taskName: "b", status: "In Progress", completedDate: "2026-01-01", createdDate: "2026-01-01", lastUpdateDate: "2026-01-01" },
    ],
  }),
}));

describe("DiagnosticsSection", () => {
  it("counts the workspace's split pairs and hands them to the panel", () => {
    render(<DiagnosticsSection lang="en-US" />);
    expect(screen.getByText(/inconsistent completion data: 1/i)).toBeInTheDocument();
  });

  it("logs the count to the diagnostic ring when it is non-zero", () => {
    const spy = vi.spyOn(diagnostics, "logDiag");
    render(<DiagnosticsSection lang="en-US" />);
    expect(spy).toHaveBeenCalledWith("warn", "task-pair-split", { count: 1 });
    spy.mockRestore();
  });
});
