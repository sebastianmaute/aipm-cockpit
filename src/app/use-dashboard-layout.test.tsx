import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { LAYOUT_PERSIST_MS, useDashboardLayout } from "./use-dashboard-layout";
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

  it("writes nothing for a project the user never touched", async () => {
    // ★ Pins the `dirty` guard. Without it, merely mounting persists the
    // reconciled default over storage. The positive observable is the test
    // above: mutate-then-persist DOES write, so this is not vacuously green.
    vi.useFakeTimers();
    render(<Harness />);
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(loadLayout("p1")).toBeNull();
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

// ★★★ THE PANEL IS NOT REMOUNTED ON A PROJECT SWITCH — verified, not assumed:
// `task-manager.tsx` passes no `key` to `WorkspaceSection`, `workspace-section.tsx`
// mounts `DashboardPanel` while `activeTab === "dashboard"`, and `switchToProject`
// (`use-storage-file-ops.ts`) never resets `activeTab`. So the hook survives the
// switch with a NEW `projectId` prop and an OLD `layout`, which is exactly the
// pair these tests pin.
describe("useDashboardLayout across a project switch", () => {
  beforeEach(() => { localStorage.clear(); vi.useRealTimers(); });

  it("re-reads the layout when projectId changes", async () => {
    saveLayout("p2", { v: 1, board: [{ id: "changes", w: 2, h: 2 }], hidden: ["upcoming"] });
    const { rerender } = render(<Harness projectId="p1" />);
    expect(screen.getByTestId("hidden").textContent).toBe("");

    rerender(<Harness projectId="p2" />);
    expect(screen.getByTestId("hidden").textContent).toBe("upcoming");
  });

  it("does not write the OLD project's layout over the new project's stored one", async () => {
    vi.useFakeTimers();
    saveLayout("p2", { v: 1, board: [{ id: "changes", w: 2, h: 2 }], hidden: ["upcoming"] });
    const { rerender } = render(<Harness projectId="p1" />);
    // Touching p1 sets the `dirty` ref, which never reset — that is what made
    // every LATER switch in the session cross-write.
    act(() => { screen.getByText("hide").click(); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(loadLayout("p1")!.hidden).toContain("raid");

    rerender(<Harness projectId="p2" />);
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(loadLayout("p2")!.hidden).toEqual(["upcoming"]);
    // …and p1's own arrangement is untouched by the switch.
    expect(loadLayout("p1")!.hidden).toContain("raid");
  });
});

describe("useDashboardLayout debounce flush", () => {
  beforeEach(() => { localStorage.clear(); vi.useRealTimers(); });

  it("flushes a pending write when the panel unmounts inside the debounce window", async () => {
    // `DashboardPanel` is conditionally mounted, so navigating away within
    // LAYOUT_PERSIST_MS of a drop/resize/hide used to discard the write silently.
    vi.useFakeTimers();
    const { unmount } = render(<Harness projectId="p-flush" />);
    act(() => { screen.getByText("hide").click(); });
    await act(async () => { vi.advanceTimersByTime(LAYOUT_PERSIST_MS - 50); });
    expect(loadLayout("p-flush")).toBeNull();          // debounce has not fired yet
    unmount();
    expect(loadLayout("p-flush")!.hidden).toContain("raid");
  });

  it("flushes the OLD project's pending write under the OLD id on a switch", async () => {
    // The flush must not reintroduce the cross-write it sits beside.
    vi.useFakeTimers();
    const { rerender } = render(<Harness projectId="pA" />);
    act(() => { screen.getByText("hide").click(); });
    await act(async () => { vi.advanceTimersByTime(LAYOUT_PERSIST_MS - 50); });
    rerender(<Harness projectId="pB" />);
    expect(loadLayout("pA")!.hidden).toContain("raid");
    expect(loadLayout("pB")).toBeNull();
  });

  it("flushes nothing on unmount for a project the user never touched", () => {
    const { unmount } = render(<Harness projectId="p-clean" />);
    unmount();
    expect(loadLayout("p-clean")).toBeNull();
  });

  it("flushes nothing on unmount in a popout", () => {
    const { unmount } = render(<Harness projectId="p-popout" isPopout />);
    act(() => { screen.getByText("hide").click(); });
    unmount();
    expect(loadLayout("p-popout")).toBeNull();
  });
});
