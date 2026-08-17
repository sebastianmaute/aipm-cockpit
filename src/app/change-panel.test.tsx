import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { useEffect, useRef, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { WorkspaceTabProvider, useWorkspaceTab } from "./workspace-tab-context";
import { ChangePanel } from "./change-panel";
import { indexDocumentsByEntity, type DocEntityRef } from "./document-ref";
import type { ProjectDocument } from "./document-model";
import { applyTier } from "./field-visibility";
import { t } from "./i18n";
import type { ChangeItem } from "./types";

function ci(over: Partial<ChangeItem>): ChangeItem {
  return { id: 1, title: "t", description: "", type: "Scope", status: "Proposed", raisedDate: "2026-06-01", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [], ...over };
}
const base = {
  lang: "en-US" as const, tasks: [], raid: [],
  changes: [ci({ id: 1, title: "Alpha scope", type: "Scope", status: "Proposed" }), ci({ id: 2, title: "Beta cost", type: "Cost", status: "Approved" })],
  today: "2026-06-10", onSave: vi.fn(), onDelete: vi.fn(), onStatusChange: vi.fn(),
};

// The embedded ChangeEditModal renders ModalFieldControls, which reads
// field visibility from the Workspace/Filters contexts.
function Providers({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <WorkspaceTabProvider>{children}</WorkspaceTabProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}

/** Seeds the workspace field-visibility config once on mount (e.g. Full view). */
function Seed({ tier }: { tier: "full" }) {
  const { setFieldVisibility } = useWorkspace();
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    setFieldVisibility(() => ({ change: applyTier("change", tier) }));
  }, [setFieldVisibility, tier]);
  return null;
}

describe("ChangePanel", () => {
  // jsdom has no layout engine and does not define scrollIntoView, so vi.spyOn
  // can't wrap it. The deep-link flash hook calls it on the matching row — assign a
  // stub before each test and restore the original (undefined) after, so it never
  // crashes the render and never leaks into later tests.
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it("renders a row per change", () => {
    const { getByText } = render(<ChangePanel {...base} />, { wrapper: Providers });
    expect(getByText("Alpha scope")).toBeTruthy();
    expect(getByText("Beta cost")).toBeTruthy();
  });
  it("has an add button", () => {
    const { getByRole } = render(<ChangePanel {...base} />, { wrapper: Providers });
    expect(getByRole("button", { name: /add/i })).toBeTruthy();
  });
  it("opens the editor when a row is clicked", () => {
    const { getByText, getByDisplayValue } = render(<ChangePanel {...base} />, { wrapper: Providers });
    fireEvent.click(getByText("Alpha scope"));
    expect(getByDisplayValue("Alpha scope")).toBeTruthy();
  });
  it("impact RAG dot uses canonical --rag-* tokens (High=red, Medium=amber), not raw brand classes", () => {
    const changes = [ci({ id: 1, title: "A", impact: "High" }), ci({ id: 2, title: "B", impact: "Medium" })];
    const { container } = render(<ChangePanel {...base} changes={changes} />, { wrapper: Providers });
    const cls = Array.from(container.querySelectorAll("span.rounded-full")).map((d) => d.className);
    expect(cls.some((c) => c.includes("bg-[var(--rag-red)]"))).toBe(true);
    expect(cls.some((c) => c.includes("bg-[var(--rag-amber)]"))).toBe(true);
    expect(cls.some((c) => c.includes("bg-ui-purple"))).toBe(false);
  });
  it("tags every change row with its id via data-deeplink-row (deep-link flash wiring)", () => {
    const { container } = render(<ChangePanel {...base} />, { wrapper: Providers });
    const rows = container.querySelectorAll("[data-deeplink-row]");
    expect(rows.length).toBe(base.changes.length);
    const ids = Array.from(rows).map((r) => r.getAttribute("data-deeplink-row"));
    expect(ids).toContain(String(base.changes[0].id));
  });
  // The haystack projects the rich description through descriptionText, so the
  // tag names are NOT searchable. Only this row is seeded, so nothing else can
  // satisfy either query.
  it("searches the rich description by its words, not its markup", () => {
    const changes = [ci({ id: 1, title: "Widget rework", description: "<p>scope <strong>creep</strong></p>" })];
    const { getByLabelText, getByText, queryByText } = render(
      <ChangePanel {...base} changes={changes} />,
      { wrapper: Providers },
    );
    const box = getByLabelText(t("en-US", "changeFilterSearch"));

    fireEvent.change(box, { target: { value: "strong" } });
    expect(queryByText("Widget rework")).toBeNull();

    fireEvent.change(box, { target: { value: "creep" } });
    expect(getByText("Widget rework")).toBeTruthy();
  });
});

describe("ChangePanel — inline status select", () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  // TWO rows, so a name that omitted the row qualifier would collide (WCAG
  // 2.4.6) — axe has no rule for duplicate accessible names at any seed size,
  // so a unit test rendering >=2 rows is the only possible detector.
  const rowLabel = (title: string) => `${t("en-US", "changeFieldStatus")} – ${title}`;

  it("renders a row-unique status select per row, showing that row's status", () => {
    const { getByRole } = render(<ChangePanel {...base} />, { wrapper: Providers });
    expect((getByRole("combobox", { name: rowLabel("Alpha scope") }) as HTMLSelectElement).value).toBe("Proposed");
    expect((getByRole("combobox", { name: rowLabel("Beta cost") }) as HTMLSelectElement).value).toBe("Approved");
  });

  it("reports the picked status to onStatusChange with the row id", () => {
    const onStatusChange = vi.fn();
    const { getByRole } = render(
      <ChangePanel {...base} onStatusChange={onStatusChange} />,
      { wrapper: Providers },
    );
    fireEvent.change(getByRole("combobox", { name: rowLabel("Alpha scope") }), {
      target: { value: "Approved" },
    });
    expect(onStatusChange).toHaveBeenCalledWith(1, "Approved");
  });

  // The row's onClick opens the editor. A real user CLICKS the select to open
  // it, so that click must not reach the row — hence stopPropagation on the
  // <td>. Firing only `change` would never exercise the row handler at all and
  // the assertion would hold with the guard deleted (mutation-checked: removing
  // the handler turns this test red, the `change`-only variant stays green).
  it("does not open the row editor when the status select is clicked", () => {
    const { getByRole, queryByDisplayValue } = render(<ChangePanel {...base} />, { wrapper: Providers });
    const select = getByRole("combobox", { name: rowLabel("Alpha scope") });
    fireEvent.click(select);
    expect(queryByDisplayValue("Alpha scope")).toBeNull();
    fireEvent.change(select, { target: { value: "Rejected" } });
    expect(queryByDisplayValue("Alpha scope")).toBeNull();
  });
});

describe("ChangePanel — raidEnabled", () => {
  // The Linked-RAID editor lives in the Full-only `links` group, so seed Full tier.
  it("hides the RAID link control when raidEnabled is false", () => {
    const { getByText, queryByText } = render(
      <>
        <Seed tier="full" />
        <ChangePanel {...base} raidEnabled={false} />
      </>,
      { wrapper: Providers },
    );
    fireEvent.click(getByText("Alpha scope"));
    expect(queryByText("Linked RAID items")).toBeNull();
  });

  it("shows the RAID link control when raidEnabled is true (default)", () => {
    const { getByText } = render(
      <>
        <Seed tier="full" />
        <ChangePanel {...base} />
      </>,
      { wrapper: Providers },
    );
    fireEvent.click(getByText("Alpha scope"));
    expect(getByText("Linked RAID items")).toBeTruthy();
  });
});

describe("ChangePanel — Outlook calendar toggle (SP3)", () => {
  const calLabel = `${t("en-US", "calendarSyncEnable")} – ${t("en-US", "calendarSyncEntityChange")}`;

  it("renders the toggle when m365Configured and a handler is given", () => {
    const { getByRole } = render(
      <ChangePanel {...base} m365Configured onToggleCalendar={vi.fn()} />,
      { wrapper: Providers },
    );
    expect(getByRole("button", { name: calLabel })).toBeTruthy();
  });

  it("labels the toggle for change decisions", () => {
    const { getByRole } = render(
      <ChangePanel {...base} m365Configured onToggleCalendar={vi.fn()} />,
      { wrapper: Providers },
    );
    expect(getByRole("button", { name: /change decisions/i })).toBeTruthy();
  });

  it("does NOT render the toggle without m365Configured", () => {
    const { queryByRole } = render(
      <ChangePanel {...base} m365Configured={false} onToggleCalendar={vi.fn()} />,
      { wrapper: Providers },
    );
    expect(queryByRole("button", { name: calLabel })).toBeNull();
  });

  it("does NOT render the toggle in a popout", () => {
    const { queryByRole } = render(
      <ChangePanel {...base} m365Configured isPopout onToggleCalendar={vi.fn()} />,
      { wrapper: Providers },
    );
    expect(queryByRole("button", { name: calLabel })).toBeNull();
  });

  it("calls onToggleCalendar(true) when the enable toggle is pressed", () => {
    const onToggleCalendar = vi.fn();
    const { getByRole } = render(
      <ChangePanel {...base} m365Configured onToggleCalendar={onToggleCalendar} />,
      { wrapper: Providers },
    );
    fireEvent.click(getByRole("button", { name: calLabel }));
    expect(onToggleCalendar).toHaveBeenCalledWith(true);
  });

  it("shows the Push button only when calendarEnabled and calls onPushCalendar", () => {
    const onPushCalendar = vi.fn();
    const { queryByRole } = render(
      <ChangePanel {...base} m365Configured onToggleCalendar={vi.fn()} calendarEnabled={false} onPushCalendar={onPushCalendar} />,
      { wrapper: Providers },
    );
    expect(queryByRole("button", { name: t("en-US", "calendarPush") })).toBeNull();

    const { getByRole } = render(
      <ChangePanel {...base} m365Configured onToggleCalendar={vi.fn()} calendarEnabled onPushCalendar={onPushCalendar} />,
      { wrapper: Providers },
    );
    fireEvent.click(getByRole("button", { name: t("en-US", "calendarPush") }));
    expect(onPushCalendar).toHaveBeenCalledTimes(1);
  });

  it("shows the Pull button only when calendarEnabled and onPullCalendar, and calls it", () => {
    const onPullCalendar = vi.fn();
    // Absent without onPullCalendar even when calendarEnabled.
    const { queryByRole } = render(
      <ChangePanel {...base} m365Configured onToggleCalendar={vi.fn()} calendarEnabled />,
      { wrapper: Providers },
    );
    expect(queryByRole("button", { name: t("en-US", "calendarPull") })).toBeNull();

    const { getByRole } = render(
      <ChangePanel {...base} m365Configured onToggleCalendar={vi.fn()} calendarEnabled onPullCalendar={onPullCalendar} />,
      { wrapper: Providers },
    );
    fireEvent.click(getByRole("button", { name: t("en-US", "calendarPull") }));
    expect(onPullCalendar).toHaveBeenCalledTimes(1);
  });
});

describe("ChangePanel — inline Ask-Claude (SP2)", () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  const aiLabel = (title: string) => `${t("en-US", "inlineAiEdit")} – ${title}`;

  it("renders a row-unique ✨ Ask-Claude button when onAiEdit + aiEditEnabled(true)", () => {
    const onAiEdit = vi.fn();
    const { getByRole } = render(
      <ChangePanel {...base} onAiEdit={onAiEdit} aiEditEnabled={() => true} />,
      { wrapper: Providers },
    );
    const btn = getByRole("button", { name: aiLabel("Alpha scope") });
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(onAiEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 1, title: "Alpha scope" }));
  });

  it("does NOT render the button when aiEditEnabled returns false", () => {
    const { queryByRole } = render(
      <ChangePanel {...base} onAiEdit={vi.fn()} aiEditEnabled={() => false} />,
      { wrapper: Providers },
    );
    expect(queryByRole("button", { name: aiLabel("Alpha scope") })).toBeNull();
  });

  it("does NOT render the button without an onAiEdit handler", () => {
    const { queryByRole } = render(
      <ChangePanel {...base} aiEditEnabled={() => true} />,
      { wrapper: Providers },
    );
    expect(queryByRole("button", { name: aiLabel("Alpha scope") })).toBeNull();
  });
});

describe("Changes bulk edit", () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it("applies a bulk status change to the selected row via onSave", () => {
    const onSave = vi.fn();
    const changes = [ci({ id: 1, title: "Alpha scope", status: "Proposed" })];
    const { getByRole, getAllByRole } = render(
      <ChangePanel {...base} changes={changes} onSave={onSave} />,
      { wrapper: Providers },
    );

    // select the row
    fireEvent.click(getByRole("checkbox", { name: t("en-US", "selectItem", "Alpha scope") }));
    // open the bulk panel
    fireEvent.click(getByRole("button", { name: t("en-US", "bulkEdit") }));
    // enable Status + set it to Approved (the bulk select shares its name with the
    // toolbar filter — disambiguate by the bulk control's id)
    fireEvent.click(getByRole("checkbox", { name: t("en-US", "changeFieldStatus") }));
    const bulkStatus = getAllByRole("combobox", { name: t("en-US", "changeFieldStatus") })
      .find((el) => el.id === "bulk-status")!;
    fireEvent.change(bulkStatus, { target: { value: "Approved" } });
    fireEvent.click(getByRole("button", { name: t("en-US", "bulkApplyCount", "1") }));

    expect(onSave).toHaveBeenCalledTimes(1);
    // Bulk apply passes suppressFieldUndo so the looped save skips per-field
    // undo capture (the whole-row bulk.edit entry already covers it).
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, status: "Approved" }),
      undefined,
      { suppressFieldUndo: true },
    );
  });
});

// --- linked-documents badge ------------------------------------------------

describe("ChangePanel linked-documents badge", () => {
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

  function doc(id: number, links: DocEntityRef[]): ProjectDocument {
    return { id, title: `Doc ${id}`, blocks: [], createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z", linkedEntities: links };
  }

  // THREE rows on purpose. Two carry a badge, so a name that omitted the row
  // qualifier would collide (WCAG 2.4.6) — a unit test rendering >=2 rows is the
  // ONLY detector, axe has no rule for it at any seed size. Their counts DIFFER
  // (2 vs 1) so a hardcoded count cannot pass, and the third row is unreferenced
  // so a lookup ignoring the key would badge it too.
  const changes = [
    ci({ id: 1, title: "Alpha scope" }),
    ci({ id: 2, title: "Beta cost" }),
    ci({ id: 3, title: "Gamma quality" }),
  ];
  const documentsByEntity = indexDocumentsByEntity([
    doc(10, [{ kind: "change", id: 1 }, { kind: "change", id: 2 }]),
    doc(11, [{ kind: "change", id: 1 }]),
    // Same numeric id, different kind: ids collide across kinds, so a key built
    // from the id alone would inflate Alpha's count to 3.
    doc(12, [{ kind: "raid", id: 1 }]),
  ]);

  function renderWithProbe() {
    return render(
      <Providers>
        <ActiveTabProbe />
        <ChangePanel {...base} changes={changes} documentsByEntity={documentsByEntity} />
      </Providers>,
    );
  }

  it("badges only the referenced rows, with the real count and a row-unique name", () => {
    const { getAllByRole } = renderWithProbe();
    const badges = getAllByRole("button", { name: /^Referenced by/ });
    expect(badges.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Referenced by 2 document(s) – Alpha scope",
      "Referenced by 1 document(s) – Beta cost",
    ]);
  });

  it("clicking the badge switches the app to the Documents view", () => {
    const { getByRole, getByTestId } = renderWithProbe();
    expect(getByTestId("active-tab").textContent).toBe("dashboard");
    fireEvent.click(getByRole("button", { name: "Referenced by 2 document(s) – Alpha scope" }));
    expect(getByTestId("active-tab").textContent).toBe("documents");
    expect(getByTestId("pending-doc-filter").textContent).toBe("change:1");
  });
});
