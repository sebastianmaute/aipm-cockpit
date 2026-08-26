import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import { useEffect, useRef, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { WorkspaceTabProvider, useWorkspaceTab } from "./workspace-tab-context";
import { ChangePanel } from "./change-panel";
import { useChangeLog } from "./use-change-log";
import { useUndoStack } from "./undo/use-undo-stack";
import type { ActivityKind } from "./activity-log";
import { indexDocumentsByEntity, type DocEntityRef } from "./document-ref";
import type { ProjectDocument } from "./document-model";
import { applyTier } from "./field-visibility";
import { t } from "./i18n";
import type { ChangeItem, ChangeStatus, NoteLogEntry } from "./types";
import { expectRowUniqueNames } from "../test/row-unique-names";

function ci(over: Partial<ChangeItem>): ChangeItem {
  return { id: 1, title: "t", description: "", type: "Scope", status: "Proposed", raisedDate: "2026-06-01", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [], ...over };
}
const base = {
  lang: "en-US" as const, tasks: [], raid: [],
  changes: [ci({ id: 1, title: "Alpha scope", type: "Scope", status: "Proposed" }), ci({ id: 2, title: "Beta cost", type: "Cost", status: "Approved" })],
  today: "2026-06-10", onSave: vi.fn(), onDelete: vi.fn(), onStatusChange: vi.fn(), onOpenNotes: vi.fn(),
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

  // axe has NO rule for a missing or wrong aria-sort, in any view at any seed
  // size, so this test is the only coverage the sort state will ever have.
  it("announces sort state through aria-sort, not through the button name", () => {
    const { getByRole } = render(<ChangePanel {...base} />, { wrapper: Providers });
    expect(getByRole("columnheader", { name: /title/i })).toHaveAttribute("aria-sort", "none");

    // The anchored name is the assertion that matters: while the sort glyph sits
    // INSIDE the button, the name reads "Title ▲" once sorted and this fails.
    fireEvent.click(getByRole("button", { name: /^title$/i }));
    expect(getByRole("columnheader", { name: /title/i })).toHaveAttribute("aria-sort", "ascending");

    fireEvent.click(getByRole("button", { name: /^title$/i }));
    expect(getByRole("columnheader", { name: /title/i })).toHaveAttribute("aria-sort", "descending");

    // Third click returns to unsorted — the third state of PanelSort is null.
    fireEvent.click(getByRole("button", { name: /^title$/i }));
    expect(getByRole("columnheader", { name: /title/i })).toHaveAttribute("aria-sort", "none");

    // The glyph stays VISIBLE but is out of the accessible name.
    expect(getByRole("button", { name: /^title$/i })).toBeInTheDocument();
  });

  // The explicit <ChangeSortKey> generic on useSortHeaderProps stops a GARBAGE
  // sortCol, but it cannot stop one REAL column's key pasted onto another header:
  // every key is still a valid ChangeSortKey, `npx tsc --noEmit` exits 0, that
  // column silently missorts, and no gate in this repo can see it. Seven
  // near-identical call sites make that the live risk here.
  //
  // The detector falls out of the primitive's own `active` rule
  // (`sortKey === sortCol && sortDir !== "off"`): two headers sharing one sortCol
  // both light up on a single click. So after clicking a column, EXACTLY one
  // header may report a non-"none" aria-sort, and it must be that column's own.
  // The count alone would miss a paste onto a HIDDEN column; the identity alone
  // would miss the duplicate — both halves are needed.
  //
  // ★ KNOWN LIMIT: this catches a PASTE (which leaves a duplicate), not a full
  //   EXCHANGE of two headers' keys. An exchange leaves no duplicate, so exactly
  //   one header still lights up and it is still the one the label lookup finds.
  it("wires each sortable header to its own column, not a neighbour's", () => {
    const { getByRole } = render(<ChangePanel {...base} />, { wrapper: Providers });
    // Scoped to the header ROW, not the table: body cells carry buttons too, and
    // an unscoped lookup could resolve a column label to a row control. Anchored
    // on the "#" header, so the scope is this table's row and no other.
    const headerRow = getByRole("button", { name: "#" }).closest("tr") as HTMLElement;
    const sorted = () =>
      Array.from(headerRow.querySelectorAll("th")).filter(
        (th) => (th.getAttribute("aria-sort") ?? "none") !== "none",
      );
    // Matched by BUTTON, then up to the <th>. Matching a <th> by name would break
    // on `impact`, whose InfoTooltip text is absorbed into the header's own name.
    const headerFor = (label: string) =>
      within(headerRow).getByRole("button", { name: label }).closest("th");

    // A string `name` is an EXACT match, so each lookup also pins that column's
    // i18n label key — a header wired to the wrong string fails here too, which
    // nothing else in this suite checks.
    // ★ "#" is deliberate for `id`: the VISIBLE label is "#" and "ID" lives in the
    //   title. That is the WCAG 2.5.3 label-in-name fix, not a typo.
    const columns = [
      ["id", "#"],
      ["type", t("en-US", "changeFieldType")],
      ["title", t("en-US", "changeFieldTitle")],
      ["impact", t("en-US", "changeFieldImpact")],
      ["status", t("en-US", "changeFieldStatus")],
      ["requestedBy", t("en-US", "changeFieldRequestedBy")],
      ["raisedDate", t("en-US", "changeFieldRaisedDate")],
    ] as const;

    // Positive observable: all seven render, and none claims a sort yet.
    for (const [, label] of columns) expect(headerFor(label)).toHaveAttribute("aria-sort", "none");
    expect(sorted()).toHaveLength(0);

    for (const [key, label] of columns) {
      // toggleSort cycles asc → desc → null, but it resets to "asc" whenever the
      // KEY changes, so one pass over seven distinct columns never re-enters it.
      fireEvent.click(within(headerRow).getByRole("button", { name: label }));
      // Re-queried AFTER the click. Comparing against a node captured before it
      // could be comparing against something detached, which would make the
      // identity half unfalsifiable.
      const own = headerFor(label);
      expect(sorted(), `clicking ${key} lit up the wrong number of headers`).toHaveLength(1);
      expect(sorted()[0], `clicking ${key} sorted a different column`).toBe(own);
      expect(own).toHaveAttribute("aria-sort", "ascending");
    }
  });

  // WCAG 2.5.3 label-in-name: the column's visible text is "#", so "#" must be
  // CONTAINED in its accessible name. An aria-label of "ID" replaced the name
  // outright and the visible label was nowhere in it. axe cannot see this —
  // label-content-name-mismatch is experimental (excluded by default) and does
  // not apply to this role anyway, so a unit test is the only possible detector.
  it("names the id column by its visible # label, keeping the meaning on hover", () => {
    const { getByRole } = render(<ChangePanel {...base} />, { wrapper: Providers });
    const btn = getByRole("button", { name: "#" });
    expect(btn.textContent).toContain("#");
    expect(btn).toHaveAttribute("title", t("en-US", "id"));
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
    expectRowUniqueNames({ minControls: 5, roles: ["combobox"] });
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

describe("ChangePanel — note-log badge", () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  function note(id: number): NoteLogEntry {
    return { id, timestamp: "2026-06-01T09:00:00.000Z", html: `<p>n${id}</p>`, text: `n${id}` };
  }
  const notesLabel = (title: string) => `${t("en-US", "noteLogTitle")} – ${title}`;

  // TWO rows on purpose, with DIFFERENT counts. axe-core has no rule flagging
  // two controls that share an accessible name under any of the four WCAG tags
  // the e2e gate requests, at any seed size — so a multi-row unit test is the
  // ONLY possible detector of that WCAG 2.4.6 collision, and one row cannot
  // express it at any assertion count. Differing counts also stop a hardcoded
  // count from passing.
  const changes = [
    ci({ id: 1, title: "Scope cut", noteLog: [note(1), note(2)] }),
    ci({ id: 2, title: "Budget uplift", noteLog: [note(1)] }),
  ];

  it("renders a row-unique notes badge carrying the entry count", () => {
    const onOpenNotes = vi.fn();
    const { getByRole } = render(
      <ChangePanel {...base} changes={changes} onOpenNotes={onOpenNotes} />,
      { wrapper: Providers },
    );
    const btn = getByRole("button", { name: notesLabel("Scope cut") });
    expect(btn.textContent).toContain("2");
    fireEvent.click(btn);
    expect(onOpenNotes).toHaveBeenCalledWith(1);

    // The second row proves the names do not collide.
    const other = getByRole("button", { name: notesLabel("Budget uplift") });
    expect(other.textContent).toContain("1");
    fireEvent.click(other);
    expect(onOpenNotes).toHaveBeenCalledWith(2);
    expectRowUniqueNames({ minControls: 17 });
  });

  it("renders a zero badge for a change with no log", () => {
    const { getByRole } = render(
      <ChangePanel {...base} changes={[ci({ id: 9, title: "No notes yet" })]} />,
      { wrapper: Providers },
    );
    expect(getByRole("button", { name: notesLabel("No notes yet") }).textContent).toContain("0");
  });

  // The row's onClick opens the editor. A real user CLICKS the badge, so that
  // click must not reach the row — hence stopPropagation on the <td>, exactly
  // as the status cell beside it does.
  it("does not open the row editor when the notes badge is clicked", () => {
    const { getByRole, queryByDisplayValue } = render(
      <ChangePanel {...base} changes={changes} />,
      { wrapper: Providers },
    );
    fireEvent.click(getByRole("button", { name: notesLabel("Scope cut") }));
    expect(queryByDisplayValue("Scope cut")).toBeNull();
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
    expectRowUniqueNames({ minControls: 19 });
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
    // undo capture: the panel captures the whole op ITSELF, as one set of
    // {before, after} field patches handed to onCaptureBulk (pinned by the test
    // below). Without the flag every row would also be captured a second time by
    // the save handler.
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, status: "Approved" }),
      undefined,
      { suppressFieldUndo: true },
    );
  });

  // The capture is the ONLY input to the bulk undo, and nothing pinned it from a
  // panel: `onCaptureBulk?.(buildBulkFieldEdits(rows))` is an OPTIONAL call, so a
  // suite that never passes the prop does not even RUN the builder. Assert the
  // real payload, per row, against what the saves actually wrote.
  it("captures one patch per changed row, and neither captures NOR saves a row already holding every value the patch sets", () => {
    const onSave = vi.fn<(item: ChangeItem, isNew?: boolean, opts?: { suppressFieldUndo?: boolean }) => void>();
    const onCaptureBulk =
      vi.fn<(edits: readonly { id: number; before: Partial<ChangeItem>; after: Partial<ChangeItem> }[]) => void>();
    const changes = [
      // No decisionDate — approving STAMPS one, so this row's patch carries BOTH
      // keys and its `before.decisionDate` is an explicit undefined (that is what
      // makes the undo able to restore "absent").
      ci({ id: 1, title: "Alpha scope", status: "Proposed" }),
      // Already decided on an earlier date — applyChangeStatus keeps it
      // (`item.decisionDate ?? today`), so decisionDate does NOT change here and
      // must stay OUT of the patch.
      ci({ id: 2, title: "Beta cost", status: "Rejected", decisionDate: "2026-06-05" }),
      // ★★★ THE WITNESS, and without it the two id assertions below cannot fail.
      // `applyChangeStatus` writes exactly two keys — `status`, and
      // `decisionDate` (`item.decisionDate ?? today` on a non-pending status,
      // change-log.ts) — and this row already holds the target value of BOTH, so
      // its `after` is value-equal to its `before` on every key the apply
      // touches. `buildBulkFieldEdits` therefore emits nothing for it, and with
      // the two rows above changing on at least one key each, saved-ids and
      // captured-ids agree ONLY when the panel derives its write set from the
      // capture. Note the decisionDate: a row merely already at status
      // "Approved" but with NO decisionDate would be STAMPED with `today` and so
      // would still change — it would prove nothing.
      ci({ id: 3, title: "Gamma risk", status: "Approved", decisionDate: "2026-06-05" }),
    ];
    const { getByRole, getAllByRole } = render(
      <ChangePanel {...base} changes={changes} onSave={onSave} onCaptureBulk={onCaptureBulk} />,
      { wrapper: Providers },
    );

    for (const title of ["Alpha scope", "Beta cost", "Gamma risk"]) {
      fireEvent.click(getByRole("checkbox", { name: t("en-US", "selectItem", title) }));
    }
    fireEvent.click(getByRole("button", { name: t("en-US", "bulkEdit") }));
    fireEvent.click(getByRole("checkbox", { name: t("en-US", "changeFieldStatus") }));
    const bulkStatus = getAllByRole("combobox", { name: t("en-US", "changeFieldStatus") })
      .find((el) => el.id === "bulk-status")!;
    fireEvent.change(bulkStatus, { target: { value: "Approved" } });
    fireEvent.click(getByRole("button", { name: t("en-US", "bulkApplyCount", "3") }));

    expect(onCaptureBulk).toHaveBeenCalledTimes(1);
    const edits = onCaptureBulk.mock.calls[0][0];
    const saved = new Map<number, ChangeItem>(onSave.mock.calls.map(([row]) => [row.id, row] as const));

    // The capture covers exactly the rows the panel saved — THREE rows were
    // selected and offered to the apply, and the same two come out of both
    // sides. `Gamma risk` is dropped by `buildBulkFieldEdits` (empty diff) and
    // must therefore be dropped by the save loop too: saving it anyway stamps a
    // fresh `localModifiedAt` and logs a `change.updated` that no undo entry can
    // reverse, which is the whole defect this pins.
    expect([...saved.keys()].sort()).toEqual([1, 2]);
    expect(edits.map((e) => e.id).sort()).toEqual([1, 2]);

    // `after` is what the save actually wrote — every captured key, every row.
    for (const e of edits) {
      const row = saved.get(e.id)!;
      for (const [key, value] of Object.entries(e.after)) {
        expect(value).toEqual(row[key as keyof ChangeItem]);
      }
    }

    const first = edits.find((e) => e.id === 1)!;
    expect(Object.keys(first.before).sort()).toEqual(["decisionDate", "status"]);
    expect(first.before.status).toBe("Proposed");
    expect(first.before.decisionDate).toBeUndefined();
    expect(first.after).toEqual({ status: "Approved", decisionDate: base.today });

    const second = edits.find((e) => e.id === 2)!;
    // Only `status` moved, so the patch is status-only: undoing this row cannot
    // rewrite a decisionDate the bulk edit never touched. This is also what
    // separates a real patch from a whole-row capture — a whole-row capture would
    // carry title/type/raisedDate here too.
    expect(Object.keys(second.before)).toEqual(["status"]);
    expect(second.before).toEqual({ status: "Rejected" });
    expect(second.after).toEqual({ status: "Approved" });

    // STATEMENT ORDER ONLY. This pins that the capture call precedes the first
    // save; it does NOT pin the rationale in the panel's "Capture BEFORE the
    // saves" comment. `rows` — both halves of every {before, after} — is
    // materialised before either step, so moving the capture below the loop would
    // leave the payload above byte-identical. Nothing here can express that
    // rationale, and no test in this file claims to.
    expect(onCaptureBulk.mock.invocationCallOrder[0]).toBeLessThan(onSave.mock.invocationCallOrder[0]);
  });

  /** Sets `status` on the bulk panel and applies it to the one selected row. */
  function bulkSetStatus(
    changes: readonly ChangeItem[],
    value: ChangeStatus,
    onSave: (item: ChangeItem, isNew?: boolean, opts?: { suppressFieldUndo?: boolean }) => void,
  ) {
    const { getByRole, getAllByRole } = render(
      <ChangePanel {...base} changes={changes} onSave={onSave} />,
      { wrapper: Providers },
    );
    fireEvent.click(getByRole("checkbox", { name: t("en-US", "selectItem", changes[0].title) }));
    fireEvent.click(getByRole("button", { name: t("en-US", "bulkEdit") }));
    fireEvent.click(getByRole("checkbox", { name: t("en-US", "changeFieldStatus") }));
    const bulkStatus = getAllByRole("combobox", { name: t("en-US", "changeFieldStatus") })
      .find((el) => el.id === "bulk-status")!;
    fireEvent.change(bulkStatus, { target: { value } });
    fireEvent.click(getByRole("button", { name: t("en-US", "bulkApplyCount", "1") }));
  }

  // The bulk patch used to set `status` RAW, so a bulk approve stored Approved
  // with NO decisionDate — and `use-calendar-integrations` filters the Outlook
  // decision-date push on `!!c.decisionDate`, silently excluding those rows.
  it("bulk status change stamps decisionDate (routes through applyChangeStatus)", () => {
    const onSave = vi.fn();
    bulkSetStatus([ci({ id: 1, title: "Alpha scope", status: "Proposed" })], "Approved", onSave);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ id: 1, status: "Approved", decisionDate: base.today });
  });

  // The reverse half of the same invariant: the row select clears the date on a
  // return to pending, and a raw bulk patch left it stale.
  it("bulk status change back to a pending status clears a stale decisionDate", () => {
    const onSave = vi.fn();
    const seeded = ci({ id: 1, title: "Alpha scope", status: "Approved", decisionDate: "2026-06-05" });
    bulkSetStatus([seeded], "Under Review", onSave);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].status).toBe("Under Review");
    expect(onSave.mock.calls[0][0].decisionDate).toBeUndefined();
  });
});

// --- bulk-edit undo through the REAL panel → hook → stack chain -------------

describe("Changes bulk edit undo — real useChangeLog + real useUndoStack", () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  /** The stamp every seeded row starts with.
   *  ★★★ ANTI-VACUITY, and the reason this field rather than a business one:
   *  NOTHING but a save can move `localModifiedAt`, so an assertion on it cannot
   *  be carried by a second mechanism. It is in `NEVER_CAPTURE`
   *  (`undo/field-groups.ts`), so no capture ever holds it and no undo ever
   *  restores it; it is NOT on `WRITE_THROUGH_FIELDS`
   *  (`undo/use-undo-stack.ts`), so no whole-row backstop preserves it either.
   *  `handleSaveChange` overwrites it with `new Date().toISOString()` on EVERY
   *  update. A row still carrying this value was never handed to the save. */
  const SEED_STAMP = "2020-01-01T00:00:00.000Z";

  const noop = () => {};

  function Seeder({ seed }: { seed: readonly ChangeItem[] }) {
    const { setChanges } = useWorkspace();
    useEffect(() => {
      setChanges([...seed]);
    }, [seed, setChanges]);
    return null;
  }

  /** Reads LIVE workspace state rather than the rendered table: the table shows
   *  neither `localModifiedAt` nor `decisionDate`, and reading a row off DOM
   *  text would also depend on sort order, which the status change perturbs. */
  function Probe({ id }: { id: number }) {
    const { changes } = useWorkspace();
    const c = changes.find((x) => x.id === id);
    return (
      <>
        <span data-testid={`status-${id}`}>{c?.status ?? ""}</span>
        <span data-testid={`decision-${id}`}>{c?.decisionDate ?? ""}</span>
        <span data-testid={`stamp-${id}`}>{c?.localModifiedAt ?? ""}</span>
      </>
    );
  }

  /**
   * Mounts a REAL `useChangeLog` and a REAL `useUndoStack` behind the panel, so
   * genuine `buildBulkFieldEdits` output flows into a genuine `captureFieldRows`
   * and the undo reverts real workspace state.
   *
   * ★★ THE SEAM NOTHING ELSE COVERS. The panel's own bulk tests assert the
   * payload against a MOCKED `onCaptureBulk`, and `use-change-log.test.tsx`
   * calls the capture hook DIRECTLY with a hand-written patch array — so a
   * defect between them (the wrong callback threaded, or the panel handing over
   * the wrong `rows`) is invisible to both layers. Modelled on
   * `milestones-panel.test.tsx`'s "Milestones bulk edit undo", which is the one
   * register where this chain already ran for real.
   *
   * ★ The stack gets its OWN `logActivity` (a no-op): `commitUndo` logs an
   * "undo" entry through the stack's deps, which would otherwise land in the
   * `change.updated` assertions below.
   */
  function Harness({
    seed,
    logActivity,
  }: {
    seed: readonly ChangeItem[];
    logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  }) {
    const undoApi = useUndoStack({
      lang: "en-US",
      logActivity: noop,
      showToast: noop,
      showToastAction: noop,
    });
    const changeLog = useChangeLog({
      today: base.today,
      lang: "en-US",
      logActivity,
      captureFieldRows: undoApi.captureFieldRows,
    });
    return (
      <>
        <Seeder seed={seed} />
        <ChangePanel
          {...base}
          changes={changeLog.changes}
          onSave={changeLog.handleSaveChange}
          onCaptureBulk={changeLog.captureBulkUndo}
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

  it("saves and reverts only the rows the patch moved, leaving a row already at the target byte-identical", () => {
    const logActivity = vi.fn<(kind: ActivityKind, ...args: (string | number)[]) => void>();
    const seed = [
      ci({ id: 1, title: "Alpha scope", status: "Proposed", localModifiedAt: SEED_STAMP }),
      ci({ id: 2, title: "Beta cost", status: "Rejected", decisionDate: "2026-06-05", localModifiedAt: SEED_STAMP }),
      // Already Approved AND already decided — the two keys `applyChangeStatus`
      // writes both already hold the target value, so this row's diff is empty.
      ci({ id: 3, title: "Gamma risk", status: "Approved", decisionDate: "2026-06-05", localModifiedAt: SEED_STAMP }),
    ];
    const { getByRole, getAllByRole, getByTestId } = render(
      <Harness seed={seed} logActivity={logActivity} />,
      { wrapper: Providers },
    );

    for (const title of ["Alpha scope", "Beta cost", "Gamma risk"]) {
      fireEvent.click(getByRole("checkbox", { name: t("en-US", "selectItem", title) }));
    }
    fireEvent.click(getByRole("button", { name: t("en-US", "bulkEdit") }));
    fireEvent.click(getByRole("checkbox", { name: t("en-US", "changeFieldStatus") }));
    const bulkStatus = getAllByRole("combobox", { name: t("en-US", "changeFieldStatus") })
      .find((el) => el.id === "bulk-status")!;
    fireEvent.change(bulkStatus, { target: { value: "Approved" } });
    fireEvent.click(getByRole("button", { name: t("en-US", "bulkApplyCount", "3") }));

    // The two rows with somewhere to move were written — a fresh stamp is the
    // proof the save ran, and it is what makes the row-3 assertion meaningful.
    expect(getByTestId("status-1").textContent).toBe("Approved");
    expect(getByTestId("decision-1").textContent).toBe(base.today);
    expect(getByTestId("status-2").textContent).toBe("Approved");
    expect(getByTestId("stamp-1").textContent).not.toBe(SEED_STAMP);
    expect(getByTestId("stamp-2").textContent).not.toBe(SEED_STAMP);

    // ...and row 3 was never written at all. Its FIELDS would look identical
    // either way — only the stamp and the audit trail can tell a skipped save
    // from a redundant one.
    expect(getByTestId("stamp-3").textContent).toBe(SEED_STAMP);
    expect(
      logActivity.mock.calls.filter((c) => c[0] === "change.updated").map((c) => c[1]).sort(),
    ).toEqual([1, 2]);

    fireEvent.click(getByRole("button", { name: "TEST_UNDO" }));

    // The undo reached real workspace state through the real `captureFieldRows`
    // — with a broken wire (no `onCaptureBulk`, or the wrong callback) the
    // capture would be dropped and these four assertions would all still read
    // the applied values.
    expect(getByTestId("status-1").textContent).toBe("Proposed");
    expect(getByTestId("decision-1").textContent).toBe("");
    expect(getByTestId("status-2").textContent).toBe("Rejected");
    // Only `status` was captured for row 2, so the undo cannot rewrite a
    // decisionDate the bulk edit never touched.
    expect(getByTestId("decision-2").textContent).toBe("2026-06-05");

    // Row 3 is where it started, on both sides of the undo.
    expect(getByTestId("status-3").textContent).toBe("Approved");
    expect(getByTestId("decision-3").textContent).toBe("2026-06-05");
    expect(getByTestId("stamp-3").textContent).toBe(SEED_STAMP);
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
    expectRowUniqueNames({ minControls: 20 });
  });

  it("clicking the badge switches the app to the Documents view", () => {
    const { getByRole, getByTestId } = renderWithProbe();
    expect(getByTestId("active-tab").textContent).toBe("dashboard");
    fireEvent.click(getByRole("button", { name: "Referenced by 2 document(s) – Alpha scope" }));
    expect(getByTestId("active-tab").textContent).toBe("documents");
    expect(getByTestId("pending-doc-filter").textContent).toBe("change:1");
  });
});

// --- row-unique names across every per-row control -------------------------

describe("ChangePanel — row-unique names when two rows share a title", () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  function note(id: number): NoteLogEntry {
    return { id, timestamp: "2026-06-01T09:00:00.000Z", html: `<p>n${id}</p>`, text: `n${id}` };
  }

  function doc(id: number, links: DocEntityRef[]): ProjectDocument {
    return { id, title: `Doc ${id}`, blocks: [], createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z", linkedEntities: links };
  }

  // TWO rows sharing the SAME title. The selectItem checkbox, InlineAiEditButton,
  // DocumentBadge and NotesBadgeButton all keyed their accessible name on the raw
  // item.title, so every one of these four per-row controls collided across the
  // pair — InlineAiEditButton composes its own label internally
  // (`${inlineAiEdit} – ${label}`), so passing the raw field collides exactly as
  // the checkbox does, and the same is true of DocumentBadge/NotesBadgeButton's
  // `entityTitle`/`entityName` props. requireCollisionSeed proves the fixture
  // actually seeds that collision, not merely that the panel renders.
  it("keeps every per-row control distinct when two changes share a title", () => {
    const changes = [
      ci({ id: 1, title: "Scope change", noteLog: [note(1)] }),
      ci({ id: 2, title: "Scope change", noteLog: [note(1)] }),
    ];
    const documentsByEntity = indexDocumentsByEntity([
      doc(10, [{ kind: "change", id: 1 }]),
      doc(11, [{ kind: "change", id: 2 }]),
    ]);
    const { container } = render(
      <ChangePanel
        {...base}
        changes={changes}
        documentsByEntity={documentsByEntity}
        onAiEdit={vi.fn()}
        aiEditEnabled={() => true}
      />,
      { wrapper: Providers },
    );
    expectRowUniqueNames({
      minControls: 2,
      scope: container,
      roles: ["button", "checkbox"],
      requireCollisionSeed: true,
    });
  });
});
