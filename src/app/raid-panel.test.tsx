import React, { useEffect } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, test } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { t } from "./i18n";
import { selectFieldTier } from "../test/field-tier";
import { RaidPanel } from "./raid-panel";
import type { RaidPanelProps } from "./raid-panel";
import type { RaidItem, Resource, Stakeholder } from "./types";
import { indexDocumentsByEntity, type DocEntityRef } from "./document-ref";
import type { ProjectDocument } from "./document-model";
import { WorkspaceTabProvider, useWorkspaceTab } from "./workspace-tab-context";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { useResourcePlanner } from "./use-resource-planner";
import { useUndoStack } from "./undo/use-undo-stack";
import type { ActivityKind } from "./activity-log";
import { expectRowUniqueNames } from "../test/row-unique-names";

vi.mock("./use-settings", () => ({
  useSettings: () => ({
    settings: { integrations: { m365: { enabled: false, sharepoint: false } } },
    setSettings: vi.fn(),
    hydrated: true,
    i18nReady: true,
    lang: "en-US",
  }),
}));
vi.mock("./use-ms-auth", () => ({
  useMsAuth: () => ({
    account: null,
    ready: true,
    signIn: vi.fn(),
    signOut: vi.fn(),
    acquireToken: vi.fn(async () => "tok"),
  }),
}));

function sh(id: number, name: string): Stakeholder {
  return { id, name, category: "Internal", influence: "Medium", interest: "Medium", raci: {} };
}

function makeProps(overrides: Partial<RaidPanelProps> = {}): RaidPanelProps {
  return {
    lang: "en-US",
    tasks: [],
    raid: [],
    today: "2026-05-22",
    filterTaskId: null,
    onClearTaskFilter: vi.fn(),
    onSave: vi.fn(),
    onDelete: vi.fn(),
    onCreateMitigationTask: vi.fn().mockReturnValue(null),
    onJumpToTask: vi.fn(),
    onOpenNotes: vi.fn(),
    resources: [],
    contacts: [],
    onCreateResource: vi.fn(() => 1),
    ...overrides,
  };
}

function res(overrides: Partial<Resource> & Pick<Resource, "id" | "firstName" | "lastName">): Resource {
  return {
    email: undefined,
    roleId: null,
    utilizationMode: "percent",
    utilization: {},
    ...overrides,
  };
}

// --- helpers ---------------------------------------------------------------

// RaidPanel consumes the workspace-tab context (for deep-link open) and the
// edit modal's field-visibility controls read the Workspace/Filters contexts,
// so every render must be wrapped — exactly as the real app does.
function renderPanel(props: RaidPanelProps) {
  return render(
    <FiltersProvider>
      <WorkspaceProvider>
        <WorkspaceTabProvider>
          <RaidPanel {...props} />
        </WorkspaceTabProvider>
      </WorkspaceProvider>
    </FiltersProvider>,
  );
}

function makeRaidItem(overrides: Partial<RaidItem> & Pick<RaidItem, "id" | "title" | "severity">): RaidItem {
  return {
    category: "R",
    status: "Open",
    raisedDate: "2026-05-22",
    linkedTaskIds: [],
    causedByRaidIds: [],
    stakeholderIds: [],
    ...overrides,
  };
}

/** Returns the text of every #id cell in document order. */
function rowIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("td.font-mono.text-muted-foreground"))
    .map((td) => td.textContent?.trim() ?? "")
    .filter((text) => text.startsWith("#"));
}

// --- sort tests -----------------------------------------------------------

describe("RaidPanel sortable column headers", () => {
  const raidItems: RaidItem[] = [
    makeRaidItem({ id: 1, title: "Alpha", severity: "Low" }),
    makeRaidItem({ id: 2, title: "Beta",  severity: "High" }),
    makeRaidItem({ id: 3, title: "Gamma", severity: "Critical" }),
  ];

  it("clicking Severity header once → ascending order (Low first, Critical last)", () => {
    const { container } = renderPanel(makeProps({ raid: raidItems }));
    fireEvent.click(screen.getByRole("button", { name: /^Severity( [▲▼])?$/ }));
    const ids = rowIds(container);
    expect(ids).toEqual(["#1", "#2", "#3"]); // Low(1) → High(2) → Critical(3)
  });

  it("clicking Severity header twice → descending order (Critical first, Low last)", () => {
    const { container } = renderPanel(makeProps({ raid: raidItems }));
    const btn = screen.getByRole("button", { name: /^Severity( [▲▼])?$/ });
    fireEvent.click(btn);
    fireEvent.click(btn);
    const ids = rowIds(container);
    expect(ids).toEqual(["#3", "#2", "#1"]); // Critical(3) → High(2) → Low(1)
  });

  it("clicking Severity header three times → back to default order (severity-rank, open-first)", () => {
    const { container } = renderPanel(makeProps({ raid: raidItems }));
    const btn = screen.getByRole("button", { name: /^Severity( [▲▼])?$/ });
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    // Default sort: open items first by severityRank (Critical=0, High=1, Medium=2, Low=3)
    const ids = rowIds(container);
    expect(ids).toEqual(["#3", "#2", "#1"]);
  });

  it("non-sortable headers (Linked Tasks, Caused By) have no sort button", () => {
    renderPanel(makeProps({ raid: raidItems }));
    expect(
      screen.queryByRole("button", { name: /linked tasks/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /caused by/i }),
    ).toBeNull();
  });

  // axe has NO rule for a missing or wrong aria-sort, in any view at any seed
  // size, so this test is the only coverage this register will ever have.
  it("announces sort state through aria-sort, not through the button name", () => {
    renderPanel(makeProps({ raid: raidItems }));
    const header = () => screen.getByRole("columnheader", { name: /severity/i });
    // The ANCHORED button name is the assertion that matters: while the sort
    // glyph sits INSIDE the name it reads "Severity ▲" once sorted, and an
    // unanchored match would pass either way.
    const btn = () => screen.getByRole("button", { name: /^severity$/i });

    expect(header()).toHaveAttribute("aria-sort", "none");
    fireEvent.click(btn());
    expect(header()).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(btn());
    expect(header()).toHaveAttribute("aria-sort", "descending");
    // Third click returns to unsorted — PanelSort's third state is null.
    fireEvent.click(btn());
    expect(header()).toHaveAttribute("aria-sort", "none");
  });

  // WCAG 2.5.3 label-in-name: the column's VISIBLE text is "#", so "#" must be
  // CONTAINED in its accessible name. An aria-label of "ID" replaced the name
  // outright, leaving the visible label nowhere in it. axe cannot see this —
  // label-content-name-mismatch is experimental (excluded by default) and does
  // not apply to this role anyway — so a unit test is the only possible detector.
  it("names the id column by its visible # label, keeping the meaning on hover", () => {
    renderPanel(makeProps({ raid: raidItems }));
    const btn = screen.getByRole("button", { name: "#" });
    expect(btn.textContent).toContain("#");
    expect(btn).toHaveAttribute("title", t("en-US", "id"));
  });

  // The explicit <RaidSortKey> generic on useSortHeaderProps stops a GARBAGE
  // sortCol, but it cannot stop a SWAP between two real columns: paste
  // sortCol="severity" onto the Status header and every key is still a valid
  // RaidSortKey, it typechecks, that column silently missorts, and no gate in
  // this repo can see it. Seven near-identical copy-pasted call sites make that
  // the live risk here.
  //
  // The detector falls out of the primitive's own `active` rule
  // (`sortKey === sortCol && sortDir !== "off"`): two headers sharing one
  // sortCol both light up on a single click. So after clicking a column, EXACTLY
  // one header may report a non-"none" aria-sort, and it must be that column's.
  it("wires each sortable header to its own column, not a neighbour's", () => {
    renderPanel(makeProps({ raid: raidItems }));
    // Scoped to the register table: a <th> rendered anywhere else on the panel
    // would silently inflate the count and make the length check meaningless.
    const table = screen.getByRole("button", { name: "#" }).closest("table")!;
    const sorted = () =>
      within(table)
        .getAllByRole("columnheader")
        .filter((th) => (th.getAttribute("aria-sort") ?? "none") !== "none");

    // A string `name` is an EXACT match, so each lookup also pins that header's
    // label key — a header wired to the wrong i18n string fails here too. The
    // labels stay glyph-free because the sort arrow is aria-hidden.
    const columns: readonly (readonly [string, string])[] = [
      ["id", "#"],
      ["category", t("en-US", "raidCategory")],
      ["title", t("en-US", "raidTitle")],
      ["severity", t("en-US", "raidSeverity")],
      ["status", t("en-US", "raidStatus")],
      ["owner", t("en-US", "raidOwner")],
      ["targetDate", t("en-US", "raidTargetDate")],
    ];
    for (const [key, label] of columns) {
      // toggleSort resets to "asc" whenever the KEY changes, so one pass over the
      // seven never re-enters the asc→desc→null cycle and needs no re-render.
      fireEvent.click(within(table).getByRole("button", { name: label }));
      // Re-queried after the click rather than reused: a stale node would make
      // the identity check compare against something no longer in the document.
      const own = within(table).getByRole("button", { name: label }).closest("th");
      expect(sorted(), `clicking ${key} lit up the wrong number of headers`).toHaveLength(1);
      expect(sorted()[0], `clicking ${key} sorted a different column`).toBe(own);
      expect(own).toHaveAttribute("aria-sort", "ascending");
    }
  });
});

describe("RaidPanel tooltips", () => {
  it("gives the RAID search box a descriptive tooltip", () => {
    renderPanel(makeProps());
    expect(screen.getByPlaceholderText(/search title, owner/i)).toHaveAttribute(
      "title",
      "Filter the register to items whose title, owner, or description match your text.",
    );
  });
});

describe("RaidPanel inline add row", () => {
  it("inline add row is present when RAID list is empty", () => {
    renderPanel(makeProps());
    const addBtns = screen.getAllByRole("button", { name: t("en-US", "raidAddItem") });
    expect(addBtns.length).toBeGreaterThanOrEqual(1);
  });

  it("inline add row is present when RAID list is non-empty", () => {
    const item = {
      id: 1, category: "R" as const, title: "Test risk",
      severity: "Medium" as const, status: "Open" as const,
      raisedDate: "2026-05-22", linkedTaskIds: [],
      causedByRaidIds: [],
      stakeholderIds: [],
    };
    renderPanel(makeProps({ raid: [item] }));
    // ★ The inline row's accessible name is now qualified by the category it
    // will create the item in (WCAG 2.4.6 fix — it used to collide with the
    // toolbar Add button, which always creates a Risk, whenever the table has
    // rows; the category filter here is "All" so the row falls back to "R").
    const inline = screen.getByRole("button", {
      name: `${t("en-US", "raidAddItem")} – ${t("en-US", "raidCategoryR")}`,
    });
    expect(inline).toBeInTheDocument();
  });

  it("clicking inline add row when category filter is 'All' opens modal with category R", () => {
    renderPanel(makeProps());
    const addBtns = screen.getAllByRole("button", { name: t("en-US", "raidAddItem") });
    fireEvent.click(addBtns[addBtns.length - 1]);
    // The Category radiogroup is inside the modal. We scope with `within` to
    // avoid the label-wrapping name-computation quirk in JSDOM: the first radio
    // button's accessible name is prefixed with the wrapping <label> text, so
    // querying by name "Risk" fails. Instead we verify the checked radio's
    // text content equals the expected category label.
    const categoryGroup = screen.getByRole("radiogroup", {
      name: t("en-US", "raidCategory"),
    });
    const checkedRadio = within(categoryGroup).getByRole("radio", {
      checked: true,
    });
    expect(checkedRadio).toHaveTextContent(t("en-US", "raidCategoryR"));
  });

  it("clicking inline add row when category filter is 'A' opens modal with category A", () => {
    renderPanel(makeProps());
    const categorySelect = screen.getByDisplayValue(t("en-US", "raidCategoryAll"));
    fireEvent.change(categorySelect, { target: { value: "A" } });
    const addBtns = screen.getAllByRole("button", { name: t("en-US", "raidAddItem") });
    fireEvent.click(addBtns[addBtns.length - 1]);
    const categoryGroup = screen.getByRole("radiogroup", {
      name: t("en-US", "raidCategory"),
    });
    const checkedRadio = within(categoryGroup).getByRole("radio", {
      checked: true,
    });
    expect(checkedRadio).toHaveTextContent(t("en-US", "raidCategoryA"));
  });
});

describe("RaidPanel deep-link open", () => {
  it("opens the edit modal for a pending deep-linked RAID item, then clears it", () => {
    const raid: RaidItem[] = [
      makeRaidItem({ id: 5, title: "Deep linked risk", severity: "High" }),
    ];
    let pendingAfter: unknown = "unset";
    function Trigger() {
      const { requestOpen, pendingOpen } = useWorkspaceTab();
      pendingAfter = pendingOpen;
      return (
        <button type="button" onClick={() => requestOpen("raid", 5)}>
          go
        </button>
      );
    }
    render(
      <FiltersProvider>
        <WorkspaceProvider>
          <WorkspaceTabProvider>
            <Trigger />
            <RaidPanel {...makeProps({ raid })} />
          </WorkspaceTabProvider>
        </WorkspaceProvider>
      </FiltersProvider>,
    );

    // Modal closed initially.
    expect(screen.queryByRole("dialog", { name: t("en-US", "raidEditItem", 5) })).toBeNull();

    fireEvent.click(screen.getByText("go"));

    // The edit modal for item #5 is now open.
    expect(
      screen.getByRole("dialog", { name: t("en-US", "raidEditItem", 5) }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("Deep linked risk")).toBeInTheDocument();

    // pendingOpen has been cleared.
    expect(pendingAfter).toBeNull();
  });
});

describe("RaidPanel — stakeholders", () => {
  it("edits linked stakeholders when the stakeholders module is enabled", () => {
    const onSave = vi.fn();
    const raid: RaidItem[] = [makeRaidItem({ id: 1, title: "Risk one", severity: "High" })];
    renderPanel(makeProps({ raid, onSave, stakeholdersEnabled: true, stakeholders: [sh(3, "Dana"), sh(7, "Lee")] }));
    fireEvent.click(screen.getByText("Risk one"));
    // Linked stakeholders is a Full-only field; the modal defaults to Advanced,
    // so switch the tier control to Full to reveal the stakeholder picker.
    selectFieldTier("fieldViewFull");
    fireEvent.click(screen.getByLabelText("Dana"));
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "raidSave") }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ stakeholderIds: [3] }), false);
  });

  it("hides the stakeholder picker when the module is disabled", () => {
    const raid: RaidItem[] = [makeRaidItem({ id: 1, title: "Risk one", severity: "High" })];
    renderPanel(makeProps({ raid, stakeholdersEnabled: false, stakeholders: [sh(3, "Dana")] }));
    fireEvent.click(screen.getByText("Risk one"));
    expect(screen.queryByText(t("en-US", "fieldStakeholders"))).not.toBeInTheDocument();
  });
});

describe("RaidPanel — owner ResourcePicker", () => {
  it("picking a registry resource for owner stamps ownerResourceId on save", () => {
    const onSave = vi.fn();
    const raid: RaidItem[] = [makeRaidItem({ id: 1, title: "Risk one", severity: "High" })];
    const resources: Resource[] = [
      res({ id: 1, firstName: "Sample", lastName: "Dummy", email: "Sample@x.com" }),
    ];
    renderPanel(makeProps({ raid, onSave, resources }));
    fireEvent.click(screen.getByText("Risk one"));

    // The owner field is now a ResourcePicker combobox. Focus + type to surface
    // the "Alex Example" registry suggestion, then pick it.
    // ★ Named, not "the only combobox in the dialog": the linked-tasks link
    // picker is a combobox too now, so an unnamed query is ambiguous.
    const owner = within(
      screen.getByRole("dialog", { name: t("en-US", "raidEditItem", 1) }),
    ).getByRole("combobox", { name: new RegExp(t("en-US", "raidOwner"), "i") });
    fireEvent.focus(owner);
    fireEvent.change(owner, { target: { value: "Sample" } });
    fireEvent.mouseDown(screen.getByText("Alex Example"));

    fireEvent.click(screen.getByRole("button", { name: t("en-US", "raidSave") }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ ownerResourceId: 1, owner: "Alex Example" }),
      false,
    );
  });
});

test("raid toolbar: add-item precedes search; no open-report button", () => {
  // Toolbar markup lives in raid-panel-toolbar.tsx after the Phase 3 split
  // (mirrors the gantt-chrome markup-order source test).
  const src = readFileSync(join(__dirname, "raid-panel-toolbar.tsx"), "utf8");
  const addIdx = src.indexOf("onClick={onAddNew}");
  // The search box was migrated to the shared <PaneSearchInput> primitive
  // (no more raw `type="search"` literal here); anchor on the component name.
  const searchIdx = src.indexOf("<PaneSearchInput");
  expect(addIdx).toBeGreaterThan(-1);
  expect(searchIdx).toBeGreaterThan(-1);
  expect(addIdx).toBeLessThan(searchIdx);
  expect(src).not.toMatch(/raidReportOpenReport\b/);
});
test("raid pane uses VIEW_PANE_RESIZABLE_CLASS", () => {
  // The pane shell (incl. VIEW_PANE_RESIZABLE_CLASS) was extracted to the shared
  // PanelTableScaffold; raid-panel renders through it. Assert both: raid-panel wires
  // the scaffold, and the scaffold carries the standard resizable class.
  expect(readFileSync(join(__dirname, "raid-panel.tsx"), "utf8")).toMatch(/PanelTableScaffold/);
  expect(readFileSync(join(__dirname, "panel-table-scaffold.tsx"), "utf8")).toMatch(/VIEW_PANE_RESIZABLE_CLASS/);
});

describe("RaidPanel — document links", () => {
  it("edit modal renders the Documents area (SharePoint gate hint when m365 is off)", () => {
    const raid: RaidItem[] = [makeRaidItem({ id: 1, title: "Doc risk", severity: "High" })];
    renderPanel(makeProps({ raid }));
    fireEvent.click(screen.getByText("Doc risk"));
    expect(screen.getByText(t("en-US", "documents"))).toBeInTheDocument();
    expect(
      screen.getByText(/enable microsoft 365/i),
    ).toBeInTheDocument();
  });

  it("new RAID draft initialised with knowledgeLinks: []", () => {
    const onSave = vi.fn();
    renderPanel(makeProps({ onSave }));
    const addBtns = screen.getAllByRole("button", { name: t("en-US", "raidAddItem") });
    fireEvent.click(addBtns[0]);
    // Fill required title and save
    fireEvent.change(screen.getByPlaceholderText(t("en-US", "raidPlaceholderTitle")), {
      target: { value: "New item" },
    });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "raidSave") }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ knowledgeLinks: [] }),
      true,
    );
  });
});

describe("RAID column visibility", () => {
  it("hides the Owner column (header + cell) when unticked in the column config popover", () => {
    const raid = [makeRaidItem({ id: 1, title: "Vendor risk", severity: "High", owner: "Priya Nadkarni" })];
    const { container } = renderPanel(makeProps({ raid }));

    // Owner value visible initially (in the owner cell span — the owner filter
    // <option> also carries the name, so scope to the cell span).
    expect(screen.getByText("Priya Nadkarni", { selector: "span" })).toBeInTheDocument();

    // Open the column config popover and untick "Owner".
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "colConfigTitle") }));
    const dialog = screen.getByRole("dialog", { name: t("en-US", "colConfigTitle") });
    fireEvent.click(within(dialog).getByLabelText(t("en-US", "raidOwner")));

    // Owner cell gone; the table still renders the remaining columns.
    expect(screen.queryByText("Priya Nadkarni", { selector: "span" })).not.toBeInTheDocument();
    expect(rowIds(container)).toEqual(["#1"]);
  });

  it("the inline add-row spans the full table width (select + all visible columns)", () => {
    const raid = [makeRaidItem({ id: 1, title: "Vendor risk" })];
    const { container } = renderPanel(makeProps({ raid }));
    const headerCount = container.querySelectorAll("thead th").length; // select + visible data cols
    // The inline add row's name is qualified by the category it creates
    // (WCAG 2.4.6 — see the disambiguating comment in raid-panel-rows.tsx),
    // so it is now findable by name alone. No category filter is set, so it
    // falls back to "R".
    const addTd = screen
      .getByRole("button", { name: `${t("en-US", "raidAddItem")} – ${t("en-US", "raidCategoryR")}` })
      .closest("td");
    expect(addTd).toBeTruthy();
    expect(addTd!.colSpan).toBe(headerCount);
  });
});

describe("RAID owner column — live resource name (stale-cache fix)", () => {
  it("renders the linked resource's CURRENT name, not the stale cached owner string", () => {
    const raid = [
      makeRaidItem({ id: 1, title: "Vendor risk", severity: "High", owner: "Old Name", ownerResourceId: 7 }),
    ];
    const resources: Resource[] = [res({ id: 7, firstName: "Live", lastName: "Owner" })];
    renderPanel(makeProps({ raid, resources }));
    expect(screen.getByText("Live Owner", { selector: "span" })).toBeInTheDocument();
    expect(screen.queryByText("Old Name")).toBeNull();
  });

  it("falls back to the cached owner string when the ownerResourceId is unset/unlinked", () => {
    const raid = [
      makeRaidItem({ id: 1, title: "Vendor risk", severity: "High", owner: "Freetext Owner", ownerResourceId: null }),
    ];
    renderPanel(makeProps({ raid, resources: [] }));
    expect(screen.getByText("Freetext Owner", { selector: "span" })).toBeInTheDocument();
  });
});

describe("RAID bulk edit", () => {
  it("applies a bulk severity change to the selected row via onSave", () => {
    const onSave = vi.fn();
    const raid = [makeRaidItem({ id: 1, title: "Vendor risk", severity: "Low" })];
    renderPanel(makeProps({ raid, onSave }));

    // select the row
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "selectItem", "Vendor risk") }));
    // open the bulk panel
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "bulkEdit") }));
    // enable Severity + set it to High (the bulk select shares its name with the
    // toolbar filter — disambiguate by the bulk control's id)
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "raidSeverity") }));
    const bulkSeverity = screen
      .getAllByRole("combobox", { name: t("en-US", "raidSeverity") })
      .find((el) => el.id === "bulk-severity")!;
    fireEvent.change(bulkSeverity, { target: { value: "High" } });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "bulkApplyCount", "1") }));

    expect(onSave).toHaveBeenCalledTimes(1);
    // Bulk apply passes suppressFieldUndo so the looped save skips per-field
    // undo capture: the panel captures the whole op ITSELF, as one set of
    // {before, after} field patches handed to onCaptureBulk (pinned by the test
    // below). Without the flag every row would also be captured a second time by
    // the save handler.
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, severity: "High" }),
      undefined,
      { suppressFieldUndo: true },
    );
  });

  // The capture is the ONLY input to the bulk undo, and nothing pinned it from a
  // panel. The panel hoists `buildBulkFieldEdits(rows)` above the optional
  // `onCaptureBulk?.(build())` call so the builder runs even unwired. Owner is the
  // discriminating field here — one bulk pick writes THREE keys, which must land
  // in ONE patch so an undo reverts the identity as a unit.
  it("captures the owner triple as one patch per changed row, and neither captures NOR saves a row the pick did not change", () => {
    const onSave = vi.fn<(item: RaidItem, isNew?: boolean, opts?: { suppressFieldUndo?: boolean }) => void>();
    const onCaptureBulk =
      vi.fn<(edits: readonly { id: number; before: Partial<RaidItem>; after: Partial<RaidItem> }[]) => void>();
    const resources = [res({ id: 7, firstName: "Ann", lastName: "Lee", email: "ann@example.com" })];
    const raid = [
      // Unowned: every owner key is ABSENT, so `before` carries three explicit
      // undefineds — that is what lets the undo restore "absent".
      makeRaidItem({ id: 1, title: "Vendor risk", severity: "High" }),
      // Owned by someone else: `before` is fully populated.
      makeRaidItem({
        id: 2,
        title: "Late delivery",
        severity: "Medium",
        owner: "Old Owner",
        ownerEmail: "old@example.com",
        ownerResourceId: 9,
      }),
      // ★★★ THE WITNESS, and without it the two id assertions below cannot
      // fail. ALREADY Ann on all three keys the owner pick writes — `owner`
      // (`resourceDisplayName` → "Ann Lee"), `ownerEmail` and `ownerResourceId`
      // — so its `after` is value-equal to its `before` on every key the apply
      // touches, `buildBulkFieldEdits` emits nothing for it, and the panel must
      // drop it from the save loop as well. With only the two changing rows,
      // saved-ids and captured-ids would agree whether or not the panel derives
      // its write set from the capture.
      makeRaidItem({
        id: 3,
        title: "Scope creep",
        severity: "Low",
        owner: "Ann Lee",
        ownerEmail: "ann@example.com",
        ownerResourceId: 7,
      }),
    ];
    renderPanel(makeProps({ raid, resources, onSave, onCaptureBulk }));

    for (const title of ["Vendor risk", "Late delivery", "Scope creep"]) {
      fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "selectItem", title) }));
    }
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "bulkEdit") }));
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "raidOwner") }));
    const bulkOwner = screen
      .getAllByRole("combobox", { name: t("en-US", "raidOwner") })
      .find((el) => el.id === "bulk-owner")!;
    fireEvent.change(bulkOwner, { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "bulkApplyCount", "3") }));

    expect(onCaptureBulk).toHaveBeenCalledTimes(1);
    const edits = onCaptureBulk.mock.calls[0][0];
    const saved = new Map<number, RaidItem>(onSave.mock.calls.map(([row]) => [row.id, row] as const));

    // THREE rows were selected and offered to the apply; the same two come out
    // of both sides. This assertion used to read `[1, 2, 3]` on the left — the
    // panel captured over the FILTERED list while saving every selected row, so
    // "Scope creep" was saved with no undo entry behind it (a fresh
    // `localModifiedAt` and a `raid.updated` the undo could not reverse). A
    // whole-row capture, meanwhile, would emit three entries on the right, each
    // carrying title, severity, category and the rest.
    expect([...saved.keys()].sort()).toEqual([1, 2]);
    expect(edits.map((e) => e.id).sort()).toEqual([1, 2]);

    // `after` is what the save actually wrote — every captured key, every row.
    for (const e of edits) {
      const row = saved.get(e.id)!;
      for (const [key, value] of Object.entries(e.after)) {
        expect(value).toEqual(row[key as keyof RaidItem]);
      }
    }

    const assigned = { owner: "Ann Lee", ownerEmail: "ann@example.com", ownerResourceId: 7 };

    const unowned = edits.find((e) => e.id === 1)!;
    expect(Object.keys(unowned.before).sort()).toEqual(["owner", "ownerEmail", "ownerResourceId"]);
    expect(unowned.before.owner).toBeUndefined();
    expect(unowned.before.ownerEmail).toBeUndefined();
    expect(unowned.before.ownerResourceId).toBeUndefined();
    expect(unowned.after).toEqual(assigned);

    const reassigned = edits.find((e) => e.id === 2)!;
    expect(reassigned.before).toEqual({ owner: "Old Owner", ownerEmail: "old@example.com", ownerResourceId: 9 });
    expect(reassigned.after).toEqual(assigned);

    // STATEMENT ORDER ONLY. This pins that the capture call precedes the first
    // save; it does NOT pin the rationale in the panel's "Capture BEFORE the
    // saves" comment. `rows` — both halves of every {before, after} — is
    // materialised before either step, so moving the capture below the loop would
    // leave the payload above byte-identical. Nothing here can express that
    // rationale, and no test in this file claims to.
    expect(onCaptureBulk.mock.invocationCallOrder[0]).toBeLessThan(onSave.mock.invocationCallOrder[0]);
  });
});

// --- bulk-edit undo through the REAL panel → hook → stack chain -------------

describe("RAID bulk edit undo — real useResourcePlanner + real useUndoStack", () => {
  /** The stamp every seeded row starts with.
   *  ★★★ ANTI-VACUITY, and the reason this field rather than a business one:
   *  NOTHING but a save can move `localModifiedAt`, so an assertion on it cannot
   *  be carried by a second mechanism. It is in `NEVER_CAPTURE`
   *  (`undo/field-groups.ts`), so no capture ever holds it and no undo ever
   *  restores it; it is NOT on `WRITE_THROUGH_FIELDS`
   *  (`undo/use-undo-stack.ts`), so no whole-row backstop preserves it either.
   *  `handleSaveRaidItem` overwrites it with `new Date().toISOString()` on EVERY
   *  save. A row still carrying this value was never handed to the save. */
  const SEED_STAMP = "2020-01-01T00:00:00.000Z";

  const noop = () => {};
  const NO_HOLIDAYS: ReadonlySet<string> = new Set<string>();

  function Seeder({ seed }: { seed: readonly RaidItem[] }) {
    const { setRaid } = useWorkspace();
    useEffect(() => {
      setRaid([...seed]);
    }, [seed, setRaid]);
    return null;
  }

  /** Reads LIVE workspace state rather than the rendered table: the table never
   *  shows `localModifiedAt`, and reading a row off DOM text would also depend
   *  on row order, which the severity change perturbs (the default sort ranks
   *  by severity). */
  function Probe({ id }: { id: number }) {
    const { raid } = useWorkspace();
    const r = raid.find((x) => x.id === id);
    return (
      <>
        <span data-testid={`severity-${id}`}>{r?.severity ?? ""}</span>
        <span data-testid={`stamp-${id}`}>{r?.localModifiedAt ?? ""}</span>
      </>
    );
  }

  /**
   * Mounts a REAL `useResourcePlanner` and a REAL `useUndoStack` behind the
   * panel, so genuine `buildBulkFieldEdits` output flows into a genuine
   * `captureFieldRows` and the undo reverts real workspace state.
   *
   * ★★ THE SEAM NOTHING ELSE COVERS. The panel's own bulk tests assert the
   * payload against a MOCKED `onCaptureBulk`, and
   * `use-resource-planner.undo.test.tsx` calls `captureRaidBulkUndo` DIRECTLY
   * with a hand-written patch array — so a defect between them (the wrong
   * callback threaded, or the panel handing over the wrong `rows`) is invisible
   * to both layers. Modelled on `milestones-panel.test.tsx`'s "Milestones bulk
   * edit undo", which is the one register where this chain already ran for real.
   *
   * ★ The stack gets its OWN `logActivity` (a no-op): `commitUndo` logs an
   * "undo" entry through the stack's deps, which would otherwise land in the
   * `raid.updated` assertions below.
   */
  function Harness({
    seed,
    logActivity,
  }: {
    seed: readonly RaidItem[];
    logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  }) {
    const undoApi = useUndoStack({
      lang: "en-US",
      logActivity: noop,
      showToast: noop,
      showToastAction: noop,
    });
    const planner = useResourcePlanner({
      lang: "en-US",
      today: "2026-05-22",
      logActivity,
      showToast: noop,
      workdayHours: 8,
      holidaySet: NO_HOLIDAYS,
      captureFieldRows: undoApi.captureFieldRows,
    });
    const { raid } = useWorkspace();
    return (
      <>
        <Seeder seed={seed} />
        <RaidPanel
          {...makeProps({
            raid,
            onSave: planner.handleSaveRaidItem,
            onCaptureBulk: planner.captureRaidBulkUndo,
          })}
        />
        <Probe id={1} />
        <Probe id={2} />
        <Probe id={3} />
        <button type="button" onClick={() => undoApi.undo()}>
          TEST_UNDO
        </button>
      </>
    );
  }

  function renderHarness(seed: readonly RaidItem[], logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void) {
    return render(
      <FiltersProvider>
        <WorkspaceProvider>
          <WorkspaceTabProvider>
            <Harness seed={seed} logActivity={logActivity} />
          </WorkspaceTabProvider>
        </WorkspaceProvider>
      </FiltersProvider>,
    );
  }

  it("saves and reverts only the rows the patch moved, leaving a row already at the target byte-identical", () => {
    const logActivity = vi.fn<(kind: ActivityKind, ...args: (string | number)[]) => void>();
    const seed = [
      makeRaidItem({ id: 1, title: "Vendor risk", severity: "Low", localModifiedAt: SEED_STAMP }),
      makeRaidItem({ id: 2, title: "Late delivery", severity: "Medium", localModifiedAt: SEED_STAMP }),
      // ALREADY High — `severity` is the only key the patch writes when Severity
      // is the only ticked field (the owner and targetDate branches are gated on
      // `changes.<key> !== undefined`), so this row's diff is empty.
      makeRaidItem({ id: 3, title: "Scope creep", severity: "High", localModifiedAt: SEED_STAMP }),
    ];
    renderHarness(seed, logActivity);

    for (const title of ["Vendor risk", "Late delivery", "Scope creep"]) {
      fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "selectItem", title) }));
    }
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "bulkEdit") }));
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "raidSeverity") }));
    const bulkSeverity = screen
      .getAllByRole("combobox", { name: t("en-US", "raidSeverity") })
      .find((el) => el.id === "bulk-severity")!;
    fireEvent.change(bulkSeverity, { target: { value: "High" } });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "bulkApplyCount", "3") }));

    // The two rows with somewhere to move were written — a fresh stamp is the
    // proof the save ran, and it is what makes the row-3 assertion meaningful.
    expect(screen.getByTestId("severity-1").textContent).toBe("High");
    expect(screen.getByTestId("severity-2").textContent).toBe("High");
    expect(screen.getByTestId("stamp-1").textContent).not.toBe(SEED_STAMP);
    expect(screen.getByTestId("stamp-2").textContent).not.toBe(SEED_STAMP);

    // ...and row 3 was never written at all. Its FIELDS would look identical
    // either way — only the stamp and the audit trail can tell a skipped save
    // from a redundant one.
    expect(screen.getByTestId("severity-3").textContent).toBe("High");
    expect(screen.getByTestId("stamp-3").textContent).toBe(SEED_STAMP);
    expect(
      logActivity.mock.calls.filter((c) => c[0] === "raid.updated").map((c) => c[1]).sort(),
    ).toEqual([1, 2]);

    fireEvent.click(screen.getByRole("button", { name: "TEST_UNDO" }));

    // The undo reached real workspace state through the real `captureFieldRows`
    // — with a broken wire (no `onCaptureBulk`, or the wrong callback) the
    // capture would be dropped and these two assertions would still read "High".
    expect(screen.getByTestId("severity-1").textContent).toBe("Low");
    expect(screen.getByTestId("severity-2").textContent).toBe("Medium");

    // Row 3 is where it started, on both sides of the undo.
    expect(screen.getByTestId("severity-3").textContent).toBe("High");
    expect(screen.getByTestId("stamp-3").textContent).toBe(SEED_STAMP);
  });
});

describe("RaidPanel — inline Ask-Claude edit (SP2)", () => {
  const aiLabel = `${t("en-US", "inlineAiEdit")} – Vendor risk`;

  it("renders a row-unique ✨ button when onAiEdit + aiEditEnabled(true) are given", () => {
    const onAiEdit = vi.fn();
    const raid = [makeRaidItem({ id: 1, title: "Vendor risk", severity: "High" })];
    renderPanel(makeProps({ raid, onAiEdit, aiEditEnabled: () => true }));
    fireEvent.click(screen.getByRole("button", { name: aiLabel }));
    expect(onAiEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it("hides the ✨ button when aiEditEnabled returns false", () => {
    const raid = [makeRaidItem({ id: 1, title: "Vendor risk", severity: "High" })];
    renderPanel(makeProps({ raid, onAiEdit: vi.fn(), aiEditEnabled: () => false }));
    expect(screen.queryByRole("button", { name: aiLabel })).toBeNull();
  });

  it("hides the ✨ button when onAiEdit is absent", () => {
    const raid = [makeRaidItem({ id: 1, title: "Vendor risk", severity: "High" })];
    renderPanel(makeProps({ raid }));
    expect(screen.queryByRole("button", { name: aiLabel })).toBeNull();
  });
});

describe("RaidPanel — Outlook calendar toggle (SP2)", () => {
  const calLabel = `${t("en-US", "calendarSyncEnable")} – ${t("en-US", "calendarSyncEntityRaid")}`;

  it("renders the toggle when m365 is configured and a handler is given", () => {
    renderPanel(makeProps({ m365Configured: true, onToggleCalendar: vi.fn() }));
    expect(screen.getByRole("button", { name: calLabel })).toBeInTheDocument();
  });

  it("does NOT render the toggle without m365Configured", () => {
    renderPanel(makeProps({ m365Configured: false, onToggleCalendar: vi.fn() }));
    expect(screen.queryByRole("button", { name: calLabel })).toBeNull();
  });

  it("does NOT render the toggle in a popout", () => {
    renderPanel(makeProps({ m365Configured: true, isPopout: true, onToggleCalendar: vi.fn() }));
    expect(screen.queryByRole("button", { name: calLabel })).toBeNull();
  });

  it("calls onToggleCalendar(true) when the enable toggle is pressed", () => {
    const onToggleCalendar = vi.fn();
    renderPanel(makeProps({ m365Configured: true, onToggleCalendar }));
    fireEvent.click(screen.getByRole("button", { name: calLabel }));
    expect(onToggleCalendar).toHaveBeenCalledWith(true);
  });

  it("shows the Push button only when calendarEnabled and calls onPushCalendar", () => {
    const onPushCalendar = vi.fn();
    const { rerender } = renderPanel(
      makeProps({ m365Configured: true, onToggleCalendar: vi.fn(), calendarEnabled: false, onPushCalendar }),
    );
    expect(screen.queryByRole("button", { name: t("en-US", "calendarPush") })).toBeNull();

    rerender(
      <FiltersProvider>
        <WorkspaceProvider>
          <WorkspaceTabProvider>
            <RaidPanel
              {...makeProps({ m365Configured: true, onToggleCalendar: vi.fn(), calendarEnabled: true, onPushCalendar })}
            />
          </WorkspaceTabProvider>
        </WorkspaceProvider>
      </FiltersProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "calendarPush") }));
    expect(onPushCalendar).toHaveBeenCalledTimes(1);
  });

  it("styles the Push button neutrally (matches the milestone push, not the old accent style)", () => {
    renderPanel(
      makeProps({ m365Configured: true, onToggleCalendar: vi.fn(), calendarEnabled: true, onPushCalendar: vi.fn() }),
    );
    const push = screen.getByRole("button", { name: t("en-US", "calendarPush") });
    expect(push.className).toContain("border-line");
    expect(push.className).toContain("text-foreground");
    expect(push.className).not.toContain("border-ui-dark-blue");
    // Leading icon present + decorative (does not bleed into the accessible name).
    expect(push.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  });

  it("shows the Pull button only when calendarEnabled and onPullCalendar, and calls it", () => {
    const onPullCalendar = vi.fn();
    // Absent without onPullCalendar even when calendarEnabled.
    const { rerender } = renderPanel(
      makeProps({ m365Configured: true, onToggleCalendar: vi.fn(), calendarEnabled: true }),
    );
    expect(screen.queryByRole("button", { name: t("en-US", "calendarPull") })).toBeNull();

    rerender(
      <FiltersProvider>
        <WorkspaceProvider>
          <WorkspaceTabProvider>
            <RaidPanel
              {...makeProps({ m365Configured: true, onToggleCalendar: vi.fn(), calendarEnabled: true, onPullCalendar })}
            />
          </WorkspaceTabProvider>
        </WorkspaceProvider>
      </FiltersProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "calendarPull") }));
    expect(onPullCalendar).toHaveBeenCalledTimes(1);
  });
});

describe("RaidPanel send-inquiry (owner)", () => {
  it("renders a row-unique Send inquiry button for an active item and calls onSendInquiry with that item", () => {
    const onSendInquiry = vi.fn();
    const item = makeRaidItem({ id: 7, title: "Capacity risk", severity: "High", owner: "Alice Owner", ownerEmail: "alice@test.com" });
    renderPanel(makeProps({ raid: [item], onSendInquiry }));
    const btn = screen.getByRole("button", { name: `${t("en-US", "sendInquiry")} – Capacity risk` });
    fireEvent.click(btn);
    expect(onSendInquiry).toHaveBeenCalledTimes(1);
    expect(onSendInquiry).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
  });

  it("hides the Send inquiry button for a closed (review-inactive) item", () => {
    const onSendInquiry = vi.fn();
    const item = makeRaidItem({ id: 8, title: "Closed one", severity: "Low", status: "Closed", closedDate: "2026-05-01", owner: "Bob" });
    renderPanel(makeProps({ raid: [item], onSendInquiry }));
    expect(screen.queryByRole("button", { name: `${t("en-US", "sendInquiry")} – Closed one` })).toBeNull();
  });

  it("omits the button entirely when onSendInquiry is absent (popout)", () => {
    const item = makeRaidItem({ id: 9, title: "No handler", severity: "High", owner: "Cara" });
    renderPanel(makeProps({ raid: [item] }));
    expect(screen.queryByRole("button", { name: new RegExp(t("en-US", "sendInquiry")) })).toBeNull();
  });
});

describe("RaidPanel owner filter", () => {
  it("selecting an owner narrows the rows to that owner", () => {
    const items: RaidItem[] = [
      makeRaidItem({ id: 1, title: "Alpha", severity: "High", owner: "Alice Owner" }),
      makeRaidItem({ id: 2, title: "Beta", severity: "High", owner: "Bob Boss" }),
    ];
    const { container } = renderPanel(makeProps({ raid: items }));
    // Both rows visible initially.
    expect(rowIds(container)).toEqual(["#1", "#2"]);
    const ownerSelect = screen.getByRole("combobox", { name: t("en-US", "raidOwner") });
    fireEvent.change(ownerSelect, { target: { value: "Alice Owner" } });
    expect(rowIds(container)).toEqual(["#1"]);
  });

  it("filters by the linked resource's LIVE name, not the stale cached owner", () => {
    const resources: Resource[] = [res({ id: 5, firstName: "Live", lastName: "Owner" })];
    const items: RaidItem[] = [
      makeRaidItem({ id: 3, title: "Gamma", severity: "High", owner: "Stale Name", ownerResourceId: 5 }),
      makeRaidItem({ id: 4, title: "Delta", severity: "High", owner: "Someone Else" }),
    ];
    const { container } = renderPanel(makeProps({ raid: items, resources }));
    const ownerSelect = screen.getByRole("combobox", { name: t("en-US", "raidOwner") });
    fireEvent.change(ownerSelect, { target: { value: "Live Owner" } });
    expect(rowIds(container)).toEqual(["#3"]);
  });
});

describe("RAID severity dot RAG tokens", () => {
  it("uses canonical --rag-* tokens (Critical=red, Medium=amber, Low=green), not raw brand classes", () => {
    const raid: RaidItem[] = [
      makeRaidItem({ id: 1, title: "Crit", severity: "Critical" }),
      makeRaidItem({ id: 2, title: "Med", severity: "Medium" }),
      makeRaidItem({ id: 3, title: "Lo", severity: "Low" }),
    ];
    const { container } = renderPanel(makeProps({ raid }));
    const cls = Array.from(container.querySelectorAll("tbody span.rounded-full")).map((d) => d.className);
    expect(cls.some((c) => c.includes("bg-[var(--rag-red)]"))).toBe(true);
    expect(cls.some((c) => c.includes("bg-[var(--rag-amber)]"))).toBe(true);
    expect(cls.some((c) => c.includes("bg-[var(--rag-green)]"))).toBe(true);
    expect(cls.some((c) => c.includes("bg-ui-purple"))).toBe(false);
  });
});

describe("RaidPanel search over a rich description", () => {
  it("matches the words, not the markup", () => {
    const raid: RaidItem[] = [
      makeRaidItem({
        id: 1,
        title: "Slip risk",
        severity: "Medium",
        description: "<p>slipped <strong>badly</strong></p>",
      }),
    ];
    renderPanel(makeProps({ raid }));
    const box = screen.getByPlaceholderText(/search title, owner/i);

    fireEvent.change(box, { target: { value: "strong" } });
    expect(screen.queryByText("Slip risk")).toBeNull();

    fireEvent.change(box, { target: { value: "badly" } });
    expect(screen.getByText("Slip risk")).toBeInTheDocument();
  });

  // The mitigation is a SECOND rich entry in the same haystack — a description
  // that is plain text keeps this test honest about which entry it proves.
  it("matches the mitigation words, not its markup", () => {
    const raid: RaidItem[] = [
      makeRaidItem({
        id: 1,
        title: "Vendor risk",
        severity: "Medium",
        description: "plain text",
        mitigation: "<p>escalate <strong>now</strong></p>",
      }),
    ];
    renderPanel(makeProps({ raid }));
    const box = screen.getByPlaceholderText(/search title, owner/i);

    fireEvent.change(box, { target: { value: "strong" } });
    expect(screen.queryByText("Vendor risk")).toBeNull();

    fireEvent.change(box, { target: { value: "escalate" } });
    expect(screen.getByText("Vendor risk")).toBeInTheDocument();
  });
});

// --- linked-documents badge ------------------------------------------------

describe("RaidPanel linked-documents badge", () => {
  /** Renders `activeTab` so the badge click is asserted on OBSERVABLE STATE —
   *  the view the app actually switched to — not on a spied callback. */
  function ActiveTabProbe() {
    const { activeTab, pendingDocEntityFilter } = useWorkspaceTab();
    return (
      <>
        <span data-testid="active-tab">{activeTab}</span>
        {/* ★★ The KIND matters and was unpinned: asserting only that the view
            became "documents" is green even when a panel passes the WRONG kind
            (the copy-paste available across three near-identical call sites
            written in one sitting), which would filter the pane to nothing. */}
        <span data-testid="pending-doc-filter">
          {pendingDocEntityFilter ? `${pendingDocEntityFilter.kind}:${pendingDocEntityFilter.id}` : "none"}
        </span>
      </>
    );
  }

  function renderWithProbe(props: RaidPanelProps) {
    return render(
      <FiltersProvider>
        <WorkspaceProvider>
          <WorkspaceTabProvider>
            <ActiveTabProbe />
            <RaidPanel {...props} />
          </WorkspaceTabProvider>
        </WorkspaceProvider>
      </FiltersProvider>,
    );
  }

  function doc(id: number, links: DocEntityRef[]): ProjectDocument {
    return { id, title: `Doc ${id}`, blocks: [], createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z", linkedEntities: links };
  }

  // THREE rows on purpose. Two of them carry a badge, so a name that omitted the
  // row qualifier would collide (WCAG 2.4.6) — a unit test rendering ≥2 rows is
  // the ONLY detector for that, axe has no rule for it at any seed size. Their
  // counts DIFFER (2 vs 1) so a hardcoded count cannot pass either, and the
  // third row is unreferenced so a lookup ignoring the key would show a badge.
  const raid: RaidItem[] = [
    makeRaidItem({ id: 1, title: "Alpha", severity: "High" }),
    makeRaidItem({ id: 2, title: "Beta", severity: "Low" }),
    makeRaidItem({ id: 3, title: "Gamma", severity: "Low" }),
  ];
  const documentsByEntity = indexDocumentsByEntity([
    doc(10, [{ kind: "raid", id: 1 }, { kind: "raid", id: 2 }]),
    doc(11, [{ kind: "raid", id: 1 }]),
    // A milestone link with the SAME numeric id: ids collide across kinds, so a
    // key built from the id alone would inflate Alpha's count to 3.
    doc(12, [{ kind: "milestone", id: 1 }]),
  ]);

  it("badges only the referenced rows, with the real count and a row-unique name", () => {
    renderWithProbe(makeProps({ raid, documentsByEntity }));
    const badges = screen.getAllByRole("button", { name: /^Referenced by/ });
    expect(badges.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Referenced by 2 document(s) – Alpha",
      "Referenced by 1 document(s) – Beta",
    ]);
    expectRowUniqueNames({ minRows: 21 });
  });

  it("clicking the badge switches the app to the Documents view", () => {
    renderWithProbe(makeProps({ raid, documentsByEntity }));
    expect(screen.getByTestId("active-tab").textContent).toBe("dashboard");
    fireEvent.click(screen.getByRole("button", { name: "Referenced by 2 document(s) – Alpha" }));
    expect(screen.getByTestId("active-tab").textContent).toBe("documents");
    expect(screen.getByTestId("pending-doc-filter").textContent).toBe("raid:1");
  });
});
