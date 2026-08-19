import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { WorkspaceTabProvider } from "./workspace-tab-context";
import { StakeholdersPanel } from "./stakeholders-panel";
import { t } from "./i18n";
import type { Stakeholder } from "./types";

// The add/edit modal renders ModalFieldControls, which reads field visibility
// from the workspace, so the panel needs a WorkspaceProvider/FiltersProvider.
function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <WorkspaceTabProvider>{children}</WorkspaceTabProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}

const items: Stakeholder[] = [
  { id: 1, name: "Zoe", category: "Customer", influence: "High", interest: "Low", raci: {} },
  { id: 2, name: "Amy", category: "Internal", influence: "Low", interest: "High", raci: {} },
];

function sampleStakeholder(overrides: Partial<Stakeholder> & { name: string }): Stakeholder {
  return {
    id: 99,
    category: "Customer",
    influence: "Medium",
    interest: "Medium",
    raci: {},
    ...overrides,
  };
}

function setup() {
  const props = {
    lang: "en-US" as const, stakeholders: items, resources: [], milestones: [],
    onSave: vi.fn(), onDelete: vi.fn(),
  };
  render(<StakeholdersPanel {...props} />, { wrapper });
  return props;
}

function renderStakeholders(overrides: { stakeholders: Stakeholder[] }) {
  const props = {
    lang: "en-US" as const, resources: [], milestones: [],
    onSave: vi.fn(), onDelete: vi.fn(),
    ...overrides,
  };
  render(<StakeholdersPanel {...props} />, { wrapper });
  return props;
}

describe("StakeholdersPanel", () => {
  it("renders a row per stakeholder", () => {
    setup();
    expect(screen.getByText("Zoe")).toBeInTheDocument();
    expect(screen.getByText("Amy")).toBeInTheDocument();
  });
  it("opens the add modal", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /add stakeholder/i }));
    expect(screen.getByRole("heading", { name: /add stakeholder/i })).toBeInTheDocument();
  });
  it("level chips carry dark-mode variants for legibility", () => {
    renderStakeholders({ stakeholders: [sampleStakeholder({ name: "Test", influence: "High", interest: "Medium" })] });
    const high = screen.getByText(t("en-US", "levelHigh")).closest("span")!;
    const med = screen.getByText(t("en-US", "levelMedium")).closest("span")!;
    expect(high.className).toContain("dark:");
    expect(med.className).toContain("dark:");
  });
  it("clicking a row opens the editor (RAID-style row click)", () => {
    renderStakeholders({ stakeholders: [sampleStakeholder({ name: "Dana" })] });
    const row = screen.getByRole("button", { name: "Dana" }).closest("tr")!;
    expect(row.className).toContain("cursor-pointer");
    expect(row.className).toContain("hover:bg-surface-muted");
    fireEvent.click(row);
    expect(screen.getByRole("heading", { name: /stakeholder/i })).toBeInTheDocument();
  });

  it("clicking the name button opens editor exactly once (stopPropagation prevents double-fire)", () => {
    renderStakeholders({ stakeholders: [sampleStakeholder({ name: "Dana" })] });
    const btn = screen.getByRole("button", { name: "Dana" });
    fireEvent.click(btn);
    // Editor opens — one modal heading, not two
    expect(screen.getAllByRole("heading", { name: /stakeholder/i })).toHaveLength(1);
  });

  it("threads the comms-pending set to the editor matrix: jump-to-Action-Center icon fires onJumpToComms", () => {
    const onJumpToComms = vi.fn();
    const stakeholder = sampleStakeholder({ id: 42, name: "Dana" });
    render(
      <StakeholdersPanel
        lang="en-US"
        stakeholders={[stakeholder]}
        resources={[]}
        milestones={[]}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        commsPendingStakeholderIds={new Set([42])}
        onJumpToComms={onJumpToComms}
      />,
      { wrapper },
    );
    // Open Dana's editor — the matrix renders her selected cell with the icon.
    fireEvent.click(screen.getByRole("button", { name: "Dana" }));
    const icon = screen.getByRole("button", { name: t("en-US", "stakeholderNeedsComms") });
    fireEvent.click(icon);
    expect(onJumpToComms).toHaveBeenCalledWith(42);
  });
});

describe("Stakeholders inline AI edit", () => {
  it("renders the ✨ Ask-Claude button and fires onAiEdit when aiEditEnabled is true", () => {
    const onAiEdit = vi.fn();
    const stakeholder = sampleStakeholder({ id: 7, name: "Dana" });
    render(
      <StakeholdersPanel
        lang="en-US"
        stakeholders={[stakeholder]}
        resources={[]}
        milestones={[]}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onAiEdit={onAiEdit}
        aiEditEnabled={() => true}
      />,
      { wrapper },
    );
    const btn = screen.getByRole("button", {
      name: `${t("en-US", "inlineAiEdit")} – Dana`,
    });
    fireEvent.click(btn);
    expect(onAiEdit).toHaveBeenCalledWith(stakeholder);
  });

  it("hides the ✨ Ask-Claude button when aiEditEnabled returns false", () => {
    render(
      <StakeholdersPanel
        lang="en-US"
        stakeholders={[sampleStakeholder({ id: 8, name: "Dana" })]}
        resources={[]}
        milestones={[]}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onAiEdit={vi.fn()}
        aiEditEnabled={() => false}
      />,
      { wrapper },
    );
    expect(screen.queryByRole("button", { name: /ask claude/i })).not.toBeInTheDocument();
  });
});

describe("Stakeholders column visibility", () => {
  it("hides the email column (header + cell) when unticked in the column config popover", () => {
    renderStakeholders({ stakeholders: [sampleStakeholder({ name: "Ada", email: "ada@example.com" })] });
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("en-US", "colConfigTitle") }));
    fireEvent.click(screen.getByLabelText(t("en-US", "stakeholderFieldEmail")));

    expect(screen.queryByText("ada@example.com")).not.toBeInTheDocument();
  });
});

describe("Stakeholders bulk edit", () => {
  it("applies a bulk influence change to the selected row via onSave", () => {
    const stakeholder = sampleStakeholder({ id: 1, name: "Dana", influence: "Low" });
    const props = renderStakeholders({ stakeholders: [stakeholder] });

    // select the row
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "selectItem", "Dana") }));
    // open the bulk panel
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "bulkEdit") }));
    // enable Influence + set it to High (the bulk select shares its name with the
    // column-header sort control — disambiguate by the bulk control's id)
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "stakeholderFieldInfluence") }));
    const bulkInfluence = screen
      .getAllByRole("combobox", { name: t("en-US", "stakeholderFieldInfluence") })
      .find((el) => el.id === "bulk-influence")!;
    fireEvent.change(bulkInfluence, { target: { value: "High" } });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "bulkApplyCount", "1") }));

    expect(props.onSave).toHaveBeenCalledTimes(1);
    // Bulk apply passes suppressFieldUndo so the looped save skips per-field
    // undo capture: the panel captures the whole op ITSELF, as one set of
    // {before, after} field patches handed to onCaptureBulk (pinned by the test
    // below). Without the flag every row would also be captured a second time by
    // the save handler.
    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, influence: "High" }),
      undefined,
      { suppressFieldUndo: true },
    );
  });

  // The capture is the ONLY input to the bulk undo, and nothing pinned it from a
  // panel. The panel hoists `buildBulkFieldEdits(rows)` above the optional
  // `onCaptureBulk?.(build())` call so the builder runs even unwired. Two ticked
  // fields over THREE rows, each row a different shape of overlap with the pick:
  //   Dana  — both picked values are new            → both keys captured, saved
  //   Eve   — ONE of the two is already at target   → one key captured, saved
  //   Finn  — BOTH are already at target            → no patch at all, NOT saved
  // Eve exercises the per-KEY delta; Finn exercises the per-ROW one, and only
  // Finn can tell the write set apart from the selection. Without that row the panel
  // could save every selected row while capturing only the changed ones and
  // every assertion below would still hold.
  it("captures one patch per row it wrote, and neither captures nor writes a row already at every picked value", () => {
    const onSave = vi.fn<(item: Stakeholder, isNew?: boolean, opts?: { suppressFieldUndo?: boolean }) => void>();
    const onCaptureBulk =
      vi.fn<(edits: readonly { id: number; before: Partial<Stakeholder>; after: Partial<Stakeholder> }[]) => void>();
    const stakeholders = [
      sampleStakeholder({ id: 1, name: "Dana", influence: "Low", interest: "Low" }),
      // Interest is ALREADY High — the pick is a no-op for that one field, so it
      // must stay out of this row's patch while influence still lands in it.
      sampleStakeholder({ id: 2, name: "Eve", influence: "Medium", interest: "High" }),
      // BOTH picked values are already stored, and `category` — the third bulk
      // field — is left unticked, so `patch` copies it through untouched. Finn's
      // `after` is therefore value-identical to his `before` on every key,
      // `buildBulkFieldEdits` drops the row, and the panel must not save it.
      sampleStakeholder({ id: 3, name: "Finn", influence: "High", interest: "High" }),
    ];
    render(
      <StakeholdersPanel
        lang="en-US"
        stakeholders={stakeholders}
        resources={[]}
        milestones={[]}
        onSave={onSave}
        onDelete={vi.fn()}
        onCaptureBulk={onCaptureBulk}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "selectItem", "Dana") }));
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "selectItem", "Eve") }));
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "selectItem", "Finn") }));
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "bulkEdit") }));

    // Tick + set both fields (the bulk selects share their names with the column
    // header sort controls — disambiguate by the bulk control's id).
    for (const [field, id] of [
      ["stakeholderFieldInfluence", "bulk-influence"],
      ["stakeholderFieldInterest", "bulk-interest"],
    ] as const) {
      fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", field) }));
      const control = screen.getAllByRole("combobox", { name: t("en-US", field) }).find((el) => el.id === id)!;
      fireEvent.change(control, { target: { value: "High" } });
    }
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "bulkApplyCount", "3") }));

    expect(onCaptureBulk).toHaveBeenCalledTimes(1);
    const edits = onCaptureBulk.mock.calls[0][0];
    const saved = new Map<number, Stakeholder>(onSave.mock.calls.map(([row]) => [row.id, row] as const));

    // THE WRITE SET IS THE CAPTURED SET — three rows selected, two written.
    // Finn is the row that makes this assertion able to fail: with the panel's
    // `wrote.has(after.id)` guard removed that row is saved but not captured, so it
    // appears on the left of this equality and not on the right. `Stakeholder`
    // carries neither `noteLog` nor `outlookEventId`, so no `WRITE_THROUGH_KEYS`
    // exclusion in `buildBulkFieldEdits` can drop a key here and manufacture an
    // empty patch for a row that really did change.
    expect([...saved.keys()].sort()).toEqual([1, 2]);
    expect(edits.map((e) => e.id).sort()).toEqual([1, 2]);
    expect(saved.has(3)).toBe(false);
    expect(edits.some((e) => e.id === 3)).toBe(false);

    // `after` is what the save actually wrote — every captured key, every row.
    for (const e of edits) {
      const row = saved.get(e.id)!;
      for (const [key, value] of Object.entries(e.after)) {
        expect(value).toEqual(row[key as keyof Stakeholder]);
      }
    }

    const dana = edits.find((e) => e.id === 1)!;
    expect(Object.keys(dana.before).sort()).toEqual(["influence", "interest"]);
    expect(dana.before).toEqual({ influence: "Low", interest: "Low" });
    expect(dana.after).toEqual({ influence: "High", interest: "High" });

    const eve = edits.find((e) => e.id === 2)!;
    // Interest was already High, so it is absent here — the patch is the delta,
    // not the row. A whole-row capture would carry name/category/raci as well.
    expect(Object.keys(eve.before)).toEqual(["influence"]);
    expect(eve.before).toEqual({ influence: "Medium" });
    expect(eve.after).toEqual({ influence: "High" });

    // STATEMENT ORDER ONLY, and it is NOT what makes the payload correct.
    // `rows` — both halves of every {before, after} — is materialised before
    // either step, so moving the capture below the loop would leave the payload
    // above byte-identical. (The panel used to carry a "Capture BEFORE the
    // saves" comment claiming otherwise; it was retired with the fix above.)
    // What the loop DOES depend on is `edits`, and that dependency is pinned by
    // the Finn assertions, not by this line.
    expect(onCaptureBulk.mock.invocationCallOrder[0]).toBeLessThan(onSave.mock.invocationCallOrder[0]);
  });
});
