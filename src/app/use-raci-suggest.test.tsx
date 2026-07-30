import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
import { foldCellsByStakeholder, useRaciSuggest } from "./use-raci-suggest";
import { ToastProvider } from "./toast-context";
import { defaultSettings, type Settings } from "./settings-types";
import type { Milestone, Stakeholder } from "./types";
import * as call from "./raci-suggest-call";

vi.mock("./raci-suggest-call");

const sh = (id: number, raci: Record<string, "R" | "A" | "C" | "I"> = {}): Stakeholder =>
  ({ id, name: `S${id}`, category: "Internal", influence: "High", interest: "High", raci } as Stakeholder);

describe("foldCellsByStakeholder", () => {
  it("folds MULTIPLE cells for one stakeholder into a SINGLE save, keeping every role", () => {
    const out = foldCellsByStakeholder(
      [
        { stakeholderId: 1, milestoneId: 10, role: "R" },
        { stakeholderId: 1, milestoneId: 11, role: "C" },
      ] as never,
      [sh(1)],
    );
    expect(out).toHaveLength(1);
    expect(out[0].raci["10"]).toBe("R");
    expect(out[0].raci["11"]).toBe("C");
  });

  it("preserves roles the proposal did not touch", () => {
    const out = foldCellsByStakeholder(
      [{ stakeholderId: 1, milestoneId: 11, role: "C" }] as never,
      [sh(1, { "10": "A" })],
    );
    expect(out[0].raci["10"]).toBe("A");
    expect(out[0].raci["11"]).toBe("C");
  });

  it("returns one entry per stakeholder", () => {
    const out = foldCellsByStakeholder(
      [
        { stakeholderId: 1, milestoneId: 10, role: "R" },
        { stakeholderId: 2, milestoneId: 10, role: "C" },
      ] as never,
      [sh(1), sh(2)],
    );
    expect(out).toHaveLength(2);
  });

  it("skips a stakeholder that vanished between propose and confirm", () => {
    const out = foldCellsByStakeholder(
      [{ stakeholderId: 9, milestoneId: 10, role: "R" }] as never,
      [sh(1)],
    );
    expect(out).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// End-to-end hook behavior: propose -> preview -> confirm/cancel, mirroring
// use-tasks-dedup.test.tsx's harness shape.
// ---------------------------------------------------------------------------

const AI_ON: Settings = {
  ...defaultSettings,
  ai: { ...defaultSettings.ai, enabled: true, apiKey: "sk-ant-test", model: "claude-x" },
};

const milestones: Milestone[] = [
  { id: 10, name: "Go-Live", date: "2026-09-01", linkedTaskIds: [] },
  { id: 11, name: "Kickoff", date: "2026-06-01", linkedTaskIds: [] },
];

interface HarnessProps {
  onCaptureBulk?: (ids: readonly number[]) => void;
  onSaves?: (item: Stakeholder) => void;
}

function Harness({ onCaptureBulk, onSaves }: HarnessProps) {
  const [stakeholders, setStakeholders] = useState<readonly Stakeholder[]>([
    { id: 1, name: "Sam", category: "Sponsor", influence: "High", interest: "High", raci: {} },
    { id: 2, name: "Lee", category: "Internal", influence: "Medium", interest: "High", raci: {} },
  ]);
  const suggest = useRaciSuggest({
    settings: AI_ON,
    isPopout: false,
    lang: "en-US",
    stakeholders,
    milestones,
    onSave: (item) => {
      onSaves?.(item);
      setStakeholders((prev) => prev.map((s) => (s.id === item.id ? item : s)));
    },
    onCaptureBulk,
  });
  return (
    <div>
      {suggest.button}
      {suggest.modal}
      <output data-testid="sam-raci">{JSON.stringify(stakeholders.find((s) => s.id === 1)?.raci ?? {})}</output>
    </div>
  );
}

const showToast = vi.fn();
function renderHarness(props: HarnessProps = {}) {
  return render(
    <ToastProvider value={{ showToast, showToastAction: vi.fn() }}>
      <Harness {...props} />
    </ToastProvider>,
  );
}

describe("useRaciSuggest (plan-then-apply)", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("shows the proposed cells in a preview and mutates NOTHING before confirm", async () => {
    vi.mocked(call.runRaciSuggestion).mockResolvedValue({
      cells: [
        { stakeholderId: 1, milestoneId: 10, role: "R" },
        { stakeholderId: 1, milestoneId: 11, role: "C" },
      ],
      truncated: false,
    });
    const onSaves = vi.fn();
    renderHarness({ onSaves });

    fireEvent.click(screen.getByRole("button", { name: /suggest raci/i }));

    await waitFor(() => expect(screen.getByText(/Go-Live/)).toBeTruthy());
    expect(screen.getByText(/Kickoff/)).toBeTruthy();
    // Preview is open — but no stakeholder mutation has happened yet.
    expect(onSaves).not.toHaveBeenCalled();
    expect(screen.getByTestId("sam-raci").textContent).toBe("{}");
  });

  it("on confirm with both cells ticked, folds both roles into ONE save and ONE capture-bulk", async () => {
    vi.mocked(call.runRaciSuggestion).mockResolvedValue({
      cells: [
        { stakeholderId: 1, milestoneId: 10, role: "R" },
        { stakeholderId: 1, milestoneId: 11, role: "C" },
      ],
      truncated: false,
    });
    const onSaves = vi.fn();
    const onCaptureBulk = vi.fn();
    renderHarness({ onSaves, onCaptureBulk });

    fireEvent.click(screen.getByRole("button", { name: /suggest raci/i }));
    await waitFor(() => expect(screen.getByText(/Go-Live/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /apply selected/i }));

    await waitFor(() =>
      expect(screen.getByTestId("sam-raci").textContent).toBe(JSON.stringify({ "10": "R", "11": "C" })),
    );
    // ONE save for the one touched stakeholder, not one per cell.
    expect(onSaves).toHaveBeenCalledTimes(1);
    expect(onCaptureBulk).toHaveBeenCalledTimes(1);
    expect(onCaptureBulk).toHaveBeenCalledWith([1]);
  });

  it("unticking a cell excludes it from Apply — only the ticked role is written", async () => {
    vi.mocked(call.runRaciSuggestion).mockResolvedValue({
      cells: [
        { stakeholderId: 1, milestoneId: 10, role: "R" },
        { stakeholderId: 1, milestoneId: 11, role: "C" },
      ],
      truncated: false,
    });
    const onSaves = vi.fn();
    renderHarness({ onSaves });

    fireEvent.click(screen.getByRole("button", { name: /suggest raci/i }));
    await waitFor(() => expect(screen.getByText(/Kickoff/)).toBeTruthy());
    // Untick the Kickoff (milestone 11) cell — row-unique checkbox name.
    fireEvent.click(screen.getByRole("checkbox", { name: /Sam.*Kickoff/i }));
    fireEvent.click(screen.getByRole("button", { name: /apply selected/i }));

    await waitFor(() => expect(onSaves).toHaveBeenCalledTimes(1));
    // Only "10": "R" was applied — "11": "C" was unticked and must be absent.
    expect(screen.getByTestId("sam-raci").textContent).toBe(JSON.stringify({ "10": "R" }));
  });

  it("shows a 'no proposal' toast and no modal when the model returns nothing", async () => {
    vi.mocked(call.runRaciSuggestion).mockResolvedValue({ cells: [], truncated: false });
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: /suggest raci/i }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("info", expect.stringMatching(/no assignments/i)));
    expect(screen.queryByRole("button", { name: /apply selected/i })).toBeNull();
  });
});
