import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useDashboardLayout } from "./use-dashboard-layout";
import { loadLayout, saveLayout } from "./dashboard-layout-store";

// ★ No `gate` here, deliberately: `reconcile` takes ONE argument, because a gate
// decides what RENDERS and never what is STORED. Passing one would be an unused
// option, which is fatal under `--max-warnings=0`.
function Harness({ projectId = "p1", isPopout = false }: { projectId?: string; isPopout?: boolean }) {
  const l = useDashboardLayout({ projectId, isPopout });
  return (
    <div>
      <output data-testid="order">{l.layout.board.map((t) => t.id).join(",")}</output>
      <output data-testid="hidden">{l.layout.hidden.join(",")}</output>
      <output data-testid="readonly">{String(l.readOnly)}</output>
      <button onClick={() => l.hide("raid")}>hide</button>
      <button onClick={() => l.reset()}>reset</button>
    </div>
  );
}

describe("useDashboardLayout", () => {
  beforeEach(() => { localStorage.clear(); vi.useRealTimers(); });

  it("starts from the default layout when nothing is stored", () => {
    render(<Harness />);
    expect(screen.getByTestId("order").textContent).toContain("kpi");
    expect(screen.getByTestId("hidden").textContent).toBe("");
  });

  it("reconciles a stored layout on load", () => {
    saveLayout("p1", { v: 1, board: [{ id: "raid", w: 2, h: 2 }], hidden: [] });
    render(<Harness />);
    // raid stays first; everything else is inserted around it
    expect(screen.getByTestId("order").textContent!.split(",")).toContain("raid");
  });

  it("persists after a mutation", async () => {
    vi.useFakeTimers();
    render(<Harness />);
    act(() => { screen.getByText("hide").click(); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(loadLayout("p1")!.hidden).toContain("raid");
  });

  it("does not persist in a popout", async () => {
    vi.useFakeTimers();
    render(<Harness isPopout />);
    expect(screen.getByTestId("readonly").textContent).toBe("true");
    act(() => { screen.getByText("hide").click(); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(loadLayout("p1")).toBeNull();
  });

  it("reset restores the default and clears hidden", async () => {
    vi.useFakeTimers();
    render(<Harness />);
    act(() => { screen.getByText("hide").click(); });
    act(() => { screen.getByText("reset").click(); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByTestId("hidden").textContent).toBe("");
  });
});
