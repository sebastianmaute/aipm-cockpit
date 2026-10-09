import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RaidCausedByField, RaidLinkedTasksField } from "./raid-edit-fields";
import type { RaidItem } from "./types";
import { loadI18n, t } from "./i18n";
import { expectRowUniqueNames } from "../test/row-unique-names";
import { buttonClassFor } from "../test/button-variant";

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
    // role=combobox since the picker gained proper dropdown semantics.
    const input = screen.getByRole("combobox", { name: /caused by/i });
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
    // The dropdown row IS the option now — no nested button inside role=option.
    fireEvent.click(screen.getByRole("option", { name: /budget freeze/i }));
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

describe("RaidCausedByField — every link button has its own name (§672)", () => {
  beforeAll(() => loadI18n("de"));

  // Each cause chip and each "caused this" button is named "<category>#<id> <title>", and its
  // remove button "<clear cause> <category>#<id>". Titles repeat freely, so the fixture gives every
  // item the same title across two categories; the id is what keeps the names apart. The two lists
  // are disjoint, which is what the modal's cycle check guarantees for edits made there.
  const PARENTS = [raid(3, { title: "Vendor delay" }), raid(4, { category: "I", title: "Vendor delay" })];
  const CHILDREN = [raid(8, { title: "Vendor delay" }), raid(9, { category: "I", title: "Vendor delay" })];

  // Without the German dictionary the de case would silently re-run en-US, so pin that it loaded.
  it("renders real German for the de case", () => {
    expect(t("de", "raidCausedByClear")).not.toBe(t("en-US", "raidCausedByClear"));
  });

  it.each(["en-US", "de"] as const)("names every chip, remove button and child link distinctly in %s", (lang) => {
    renderField({ lang, parentItems: PARENTS, causedChildren: CHILDREN });
    // Two chips and their two remove buttons, plus the two child links.
    expectRowUniqueNames({ minControls: PARENTS.length * 2 + CHILDREN.length });
  });
});

// §102 (batch 23): Create mitigation task is the shared Button, secondary at xs.
describe("RaidLinkedTasksField mitigation button on the shared Button", () => {
  it("draws Create mitigation task as secondary xs", () => {
    render(
      <RaidLinkedTasksField lang="en-US" linkedTaskIds={[]} tasks={[]} isNew={false}
        onCreateMitigationTask={vi.fn()} addLinked={vi.fn()} removeLinked={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: t("en-US", "raidCreateMitigationTask") }).className).toBe(
      buttonClassFor({ variant: "secondary", size: "xs" }),
    );
  });
});

// §102 (batch 23, owner decision 2026-10-09): the near-size buttons moved to the shared `xs`.
describe("RaidCausedByField caused-this chips on the shared Button", () => {
  it("draws an item-caused-by-this chip as secondary xs", () => {
    renderField({ causedChildren: [raid(3, { title: "Downstream slip" })] });
    expect(screen.getByRole("button", { name: "R#3 Downstream slip" }).className).toBe(
      buttonClassFor({ variant: "secondary", size: "xs", className: "inline-flex items-center gap-1" }),
    );
  });
});
