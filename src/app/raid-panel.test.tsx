import React from "react";
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
import { WorkspaceProvider } from "./workspace-context";

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
    const addBtns = screen.getAllByRole("button", { name: t("en-US", "raidAddItem") });
    expect(addBtns.length).toBeGreaterThanOrEqual(1);
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
    // RAID renders several "Add item" buttons (toolbar + the in-table add row);
    // pick the one that lives inside a <td> (the inline add row).
    const addTd = screen
      .getAllByRole("button", { name: t("en-US", "raidAddItem") })
      .map((b) => b.closest("td"))
      .find((td) => td !== null);
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
    // undo capture (the whole-row bulk.edit entry already covers it).
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, severity: "High" }),
      undefined,
      { suppressFieldUndo: true },
    );
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
    const { activeTab } = useWorkspaceTab();
    return <span data-testid="active-tab">{activeTab}</span>;
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
  });

  it("clicking the badge switches the app to the Documents view", () => {
    renderWithProbe(makeProps({ raid, documentsByEntity }));
    expect(screen.getByTestId("active-tab").textContent).toBe("dashboard");
    fireEvent.click(screen.getByRole("button", { name: "Referenced by 2 document(s) – Alpha" }));
    expect(screen.getByTestId("active-tab").textContent).toBe("documents");
  });
});
