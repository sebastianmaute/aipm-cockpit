import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RaidCausedByField } from "./raid-edit-fields";
import type { RaidItem } from "./types";

// The shared EntityLinkPicker is well covered in isolation, but that proves
// nothing about THIS wiring: RaidCausedByField threads five handlers and maps
// RaidItem -> LinkPickerEntry, and a break in either is invisible to both the
// picker's own tests and the RAID modal's. Per-hop tests passing while the
// chain is dead is a failure mode this codebase has shipped before.

function raid(id: number, overrides: Partial<RaidItem> = {}): RaidItem {
  return {
    id,
    category: "R",
    title: `Item ${id}`,
    status: "Open",
    owner: "",
    createdDate: "2026-06-01",
    causedByRaidIds: [],
    linkedTaskIds: [],
    ...overrides,
  } as RaidItem;
}

function renderField(overrides: Partial<React.ComponentProps<typeof RaidCausedByField>> = {}) {
  const props = {
    lang: "en-US" as const,
    parentItems: [] as readonly RaidItem[],
    causePickerQuery: "",
    setCausePickerQuery: vi.fn(),
    availableCauses: [] as readonly RaidItem[],
    addCausedBy: vi.fn(),
    removeCausedBy: vi.fn(),
    onJumpToRaid: vi.fn(),
    causedChildren: [] as readonly RaidItem[],
    isNew: false,
    ...overrides,
  };
  return { ...render(<RaidCausedByField {...props} />), props };
}

describe("RaidCausedByField", () => {
  it("labels each chip with its category and id, not just the id", () => {
    // `raidEntry`'s `${category}#${id}` composition is what makes the remove
    // buttons row-unique; if it silently degraded to a bare id the names would
    // still LOOK fine in a one-chip fixture.
    renderField({
      parentItems: [raid(3, { title: "Vendor delay" }), raid(7, { category: "I", title: "Budget freeze" })],
    });
    expect(screen.getByRole("button", { name: "R#3 Vendor delay" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I#7 Budget freeze" })).toBeInTheDocument();
  });

  it("gives the N remove buttons distinct accessible names", () => {
    renderField({ parentItems: [raid(3), raid(7, { category: "I" })] });
    const removes = screen.getAllByRole("button", { name: /clear/i });
    expect(removes).toHaveLength(2);
    expect(new Set(removes.map((b) => b.getAttribute("aria-label"))).size).toBe(2);
  });

  it("removes the parent whose chip was clicked", () => {
    const removeCausedBy = vi.fn();
    renderField({ parentItems: [raid(3), raid(7, { category: "I" })], removeCausedBy });
    const removes = screen.getAllByRole("button", { name: /clear/i });
    fireEvent.click(removes[1]);
    expect(removeCausedBy).toHaveBeenCalledTimes(1);
    expect(removeCausedBy).toHaveBeenCalledWith(7);
  });

  it("jumps to the parent whose chip body was clicked", () => {
    const onJumpToRaid = vi.fn();
    renderField({ parentItems: [raid(3, { title: "Vendor delay" })], onJumpToRaid });
    fireEvent.click(screen.getByRole("button", { name: "R#3 Vendor delay" }));
    expect(onJumpToRaid).toHaveBeenCalledWith(3);
  });

  it("names the search box for assistive tech and reports typing back to the parent", () => {
    // The parent derives `availableCauses` from this query (excluding self and
    // cycle-forming picks), so a dropped onQueryChange silently kills search.
    const setCausePickerQuery = vi.fn();
    renderField({ setCausePickerQuery });
    const input = screen.getByRole("textbox", { name: /caused by/i });
    fireEvent.change(input, { target: { value: "vend" } });
    expect(setCausePickerQuery).toHaveBeenCalledWith("vend");
  });

  it("adds the candidate picked from the dropdown", () => {
    const addCausedBy = vi.fn();
    renderField({
      causePickerQuery: "budget",
      availableCauses: [raid(9, { category: "I", title: "Budget freeze" })],
      addCausedBy,
    });
    fireEvent.click(screen.getByRole("button", { name: /budget freeze/i }));
    expect(addCausedBy).toHaveBeenCalledWith(9);
  });

  it("shows the read-only 'caused this' children only for saved items that have any", () => {
    const children = [raid(11, { title: "Downstream slip" })];
    const { unmount } = renderField({ causedChildren: children, isNew: false });
    expect(screen.getByRole("button", { name: /downstream slip/i })).toBeInTheDocument();
    unmount();

    renderField({ causedChildren: children, isNew: true });
    expect(screen.queryByRole("button", { name: /downstream slip/i })).not.toBeInTheDocument();
  });
});
