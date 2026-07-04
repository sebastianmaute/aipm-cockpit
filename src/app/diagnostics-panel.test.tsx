import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DiagnosticsPanel } from "./diagnostics-panel";
import { logDiag, readDiagLog } from "./diagnostics";

beforeEach(() => window.localStorage.clear());

describe("DiagnosticsPanel", () => {
  it("renders recorded events", () => {
    logDiag("warn", "storage.saveFailed", { kind: "turso" });
    render(<DiagnosticsPanel lang="en-US" />);
    expect(screen.getByText("storage.saveFailed")).toBeInTheDocument();
  });

  it("Clear empties the ring", () => {
    logDiag("info", "x");
    render(<DiagnosticsPanel lang="en-US" />);
    fireEvent.click(screen.getByRole("button", { name: /clear log/i }));
    expect(readDiagLog()).toEqual([]);
  });

  it("does not crash on a malformed ring", () => {
    window.localStorage.setItem("lop-app:diag-log", JSON.stringify([1, 2, { at: null }]));
    expect(() => render(<DiagnosticsPanel lang="en-US" />)).not.toThrow();
  });
});
