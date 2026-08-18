import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
import { foldCellsByStakeholder, useRaciSuggest } from "./use-raci-suggest";
import { ToastProvider } from "./toast-context";
import { defaultSettings, type Settings } from "./settings-types";
import type { Milestone, Stakeholder } from "./types";
import { t } from "./i18n";
import { MAX_CONTEXT_MILESTONES } from "./raci-suggest/raci-suggest";
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
  onCaptureBulk?: (edits: readonly { id: number; before: Partial<Stakeholder>; after: Partial<Stakeholder> }[]) => void;
  // Forwards the FULL argument list, not just the item. A harness that accepts
  // only `item` cannot observe the undo-suppression flag, so dropping that flag
  // in the hook would fail no test here.
  onSaves?: (item: Stakeholder, isNew?: boolean, opts?: { suppressFieldUndo?: boolean }) => void;
  /** Override the milestone list so a test can exceed the context cap. */
  milestones?: Milestone[];
  /** Seed stakeholder 1's stored RACI so a proposal can be a pure no-op. */
  stakeholderRaci?: Record<string, string>;
}

function Harness({ onCaptureBulk, onSaves, milestones: milestonesProp, stakeholderRaci }: HarnessProps) {
  const [stakeholders, setStakeholders] = useState<readonly Stakeholder[]>([
    { id: 1, name: "Sam", category: "Sponsor", influence: "High", interest: "High", raci: (stakeholderRaci ?? {}) as Stakeholder["raci"] },
    { id: 2, name: "Lee", category: "Internal", influence: "Medium", interest: "High", raci: {} },
  ]);
  const suggest = useRaciSuggest({
    settings: AI_ON,
    isPopout: false,
    lang: "en-US",
    stakeholders,
    milestones: milestonesProp ?? milestones,
    onSave: (item, isNew, opts) => {
      onSaves?.(item, isNew, opts);
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

  it("says the assignments already exist rather than 'Claude proposed no assignments'", async () => {
    // Every proposed cell matches what is stored, so grounding drops them all
    // as no-ops: zero cells AND zero skips. The model DID propose — claiming
    // otherwise is false, and this is the ordinary outcome of re-running
    // against a populated matrix, so it is the most-seen message of the two.
    vi.mocked(call.runRaciSuggestion).mockResolvedValue({
      cells: [{ stakeholderId: 1, milestoneId: 10, role: "R" }],
      truncated: false,
    });
    renderHarness({ stakeholderRaci: { "10": "R" } });
    fireEvent.click(screen.getByRole("button", { name: /suggest raci/i }));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("info", t("en-US", "raciSuggestAllExisting")),
    );
    expect(showToast).not.toHaveBeenCalledWith("info", t("en-US", "raciSuggestNoProposal"));
  });

  it("reports a capped context even when the result is EMPTY", async () => {
    // The modal is the only renderer of that notice and this path never opens
    // it, so the signal was computed and dropped exactly where "why is this
    // empty?" most needs answering.
    const many: Milestone[] = Array.from({ length: MAX_CONTEXT_MILESTONES + 5 }, (_, i) => ({
      id: 1000 + i, name: `M${i}`, date: "2026-03-01",
    }) as Milestone);
    vi.mocked(call.runRaciSuggestion).mockResolvedValue({ cells: [], truncated: false });
    renderHarness({ milestones: many });
    fireEvent.click(screen.getByRole("button", { name: /suggest raci/i }));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("info", t("en-US", "raciSuggestContextTruncated")),
    );
  });

  it("names the trigger by its BUSY label while a proposal is in flight", async () => {
    // WCAG 2.5.3: the visible text flips while a proposal is in flight, so the
    // accessible name must follow it. Since the trigger became the shared
    // AiTriggerButton that busy label is "Stop" (the control now ABORTS rather
    // than sitting disabled), not the old "Asking Claude…".
    //
    // ★ Matched EXACTLY, never as a regex alternation like /suggest raci|stop/i
    //   — a matcher that accepts both states would also pass against the idle
    //   button and stop testing the thing this test is named for.
    let release: (v: { cells: never[]; truncated: boolean }) => void = () => {};
    vi.mocked(call.runRaciSuggestion).mockReturnValue(
      new Promise((res) => { release = res; }) as ReturnType<typeof call.runRaciSuggestion>,
    );
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: /suggest raci/i }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: t("en-US", "aiStop") }),
      ).toBeTruthy(),
    );
    release({ cells: [], truncated: false });
  });

  it("renders NO trigger when there are no milestones to assign against", () => {
    // The hook's own guard. raci-panel's equivalent test cannot reach it — that
    // panel early-returns an empty state before the toolbar mounts, so it stays
    // green even with this guard deleted. Asserted here, where the hook is the
    // only thing deciding.
    renderHarness({ milestones: [] });
    expect(screen.queryByRole("button", { name: /suggest raci/i })).toBeNull();
  });

  it("surfaces a CAPPED CONTEXT in the preview", async () => {
    // buildRaciContext computes `truncated` when the workspace exceeds what the
    // model is shown, and that flag was previously computed and dropped — the
    // engine's own docstring promised it was reported. With it dropped, a user
    // whose 200-milestone project got 60 sent sees a partial proposal and no
    // hint that the rest were never considered, which reads as "Claude decided
    // they need no one". The only prior consumer was an engine unit test.
    const many: Milestone[] = Array.from({ length: MAX_CONTEXT_MILESTONES + 5 }, (_, i) => ({
      id: 1000 + i,
      name: `M${i}`,
      date: "2026-03-01",
    }) as Milestone);
    vi.mocked(call.runRaciSuggestion).mockResolvedValue({
      cells: [{ stakeholderId: 1, milestoneId: 1000, role: "R" }],
      truncated: false,
    });
    renderHarness({ milestones: many });

    fireEvent.click(screen.getByRole("button", { name: /suggest raci/i }));
    await waitFor(() =>
      expect(screen.getByText(t("en-US", "raciSuggestContextTruncated"))).toBeTruthy(),
    );
    // And NOT the response-cap sentence — the response was not capped.
    expect(screen.queryByText(t("en-US", "raciSuggestTruncated"))).toBeNull();
  });

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
    expect(onCaptureBulk).toHaveBeenCalledWith([
      { id: 1, before: { raci: {} }, after: { raci: { "10": "R", "11": "C" } } },
    ]);
    // The bulk capture above is the ONLY undo entry this apply may create, so
    // the save must suppress the per-field one. Dropping this option is
    // invisible to every other assertion here — the write still lands, and the
    // user silently gets two stack entries for one action, so undo takes two
    // presses and the first appears to do nothing.
    expect(onSaves).toHaveBeenCalledWith(expect.anything(), false, { suppressFieldUndo: true });
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
