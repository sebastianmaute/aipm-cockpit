import type { ReactElement, ReactNode } from "react";
import { useEffect } from "react";
import { render as rtlRender, renderHook, act, screen, fireEvent, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ResourceDirectory } from "./resource-directory";
import { ResourcesReportPanel } from "./resources-report";
import { ConfirmProvider } from "./confirm-dialog";
import { WorkspaceTabProvider, useWorkspaceTab } from "./workspace-tab-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { FiltersProvider } from "./filters-context";
import { useResourceDirectory } from "./use-resource-directory";
import type { Resource, ResourcePlan } from "./types";
import { t, loadI18n } from "./i18n";
import { expectRowUniqueNames } from "../test/row-unique-names";

// ResourceDirectory now consumes the workspace-tab context (deep-link open —
// see the "ResourceDirectory deep-link open" describe below), so every render
// needs a WorkspaceTabProvider ancestor, exactly as the real app provides one.
// Shadow RTL's `render` so every existing call site in this file gets that for
// free, without touching each one individually.
function render(ui: ReactElement) {
  return rtlRender(<WorkspaceTabProvider>{ui}</WorkspaceTabProvider>);
}

/** Test-only deep-link trigger: fires `requestOpen("resources", id)` on click
 *  and renders the live `pendingOpen` value as text, so a test can assert on
 *  it via the DOM rather than reassigning an outer-scope variable during
 *  render (banned by `react-hooks/globals` — components must stay pure). */
function DeepLinkTrigger({ id }: { id: number }) {
  const { requestOpen, pendingOpen } = useWorkspaceTab();
  return (
    <>
      <button type="button" onClick={() => requestOpen("resources", id)}>
        go
      </button>
      <span data-testid="pending-open">{pendingOpen ? `${pendingOpen.view}:${pendingOpen.id}` : "null"}</span>
    </>
  );
}

const rs: Resource[] = [{ id: 1, firstName: "Sample", lastName: "Dummy", title: "Architect", roleId: null, utilizationMode: "percent", utilization: {} }];

const twoResources: Resource[] = [
  { id: 1, firstName: "Zoe", lastName: "Adams", title: "PM", roleId: null, utilizationMode: "percent", utilization: {} },
  { id: 2, firstName: "Amy", lastName: "Bell", title: "Dev", roleId: null, utilizationMode: "percent", utilization: {} },
];

const common = {
  lang: "en-US" as const,
  roles: [],
  disciplines: [],
  grades: [],
  onAssignRoleById: vi.fn(),
  onEditResource: vi.fn(),
  onAddResource: vi.fn(),
  onAddAbsence: vi.fn(),
};

describe("ResourceDirectory", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fires onEditResource when the name is clicked", () => {
    const onEdit = vi.fn();
    render(<ResourceDirectory lang="en-US" resources={rs} roles={[]} disciplines={[]} grades={[]} onAssignRoleById={vi.fn()} onEditResource={onEdit} onAddResource={vi.fn()} onAddAbsence={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Alex Example" }));
    expect(onEdit).toHaveBeenCalledWith(rs[0]);
  });
  it("fires onAddResource from the add button", () => {
    const onAdd = vi.fn();
    render(<ResourceDirectory lang="en-US" resources={rs} roles={[]} disciplines={[]} grades={[]} onAssignRoleById={vi.fn()} onEditResource={vi.fn()} onAddResource={onAdd} onAddAbsence={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /add resource/i }));
    // Must be called with NO argument — forwarding the click event as `seed`
    // pollutes the resource draft with a PointerEvent and crashes BroadcastChannel.
    expect(onAdd).toHaveBeenCalledWith();
  });
  it("fires onAddAbsence from the Add Absence button", () => {
    const onAdd = vi.fn();
    render(<ResourceDirectory lang="en-US" resources={rs} roles={[]} disciplines={[]} grades={[]} onAssignRoleById={vi.fn()} onEditResource={vi.fn()} onAddResource={vi.fn()} onAddAbsence={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "resourcesAddAbsence") }));
    // Must be called with NO argument — forwarding the click event as `seed`
    // pollutes the absence draft with a PointerEvent and crashes BroadcastChannel.
    expect(onAdd).toHaveBeenCalledWith();
  });

  it("filters rows by the search box", () => {
    render(<ResourceDirectory {...common} resources={twoResources} />);
    fireEvent.change(screen.getByPlaceholderText(/filter by/i), { target: { value: "amy" } });
    expect(screen.queryByText("Zoe Adams")).toBeNull();
    expect(screen.getByText("Amy Bell")).toBeInTheDocument();
  });

  it("sorts by name when the Name header is clicked", () => {
    render(<ResourceDirectory {...common} resources={twoResources} />);
    // Click the sort button in the Name (Assignee) column header. Its accessible
    // name is now the VISIBLE label — "Sort by Assignee" moved to the title.
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "assignee") }));
    const rows = screen.getAllByRole("row").slice(1); // skip header
    expect(within(rows[0]).getByText("Amy Bell")).toBeInTheDocument();
  });

  it("reverses to descending on a second click of the same header", () => {
    render(<ResourceDirectory {...common} resources={twoResources} />);
    const nameHeader = screen.getByRole("button", { name: t("en-US", "assignee") });
    fireEvent.click(nameHeader); // asc → Amy first
    fireEvent.click(nameHeader); // desc → Zoe first
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Zoe Adams")).toBeInTheDocument();
  });

  it("clicking a directory row opens the editor (RAID-style row click)", () => {
    const onEdit = vi.fn();
    render(<ResourceDirectory lang="en-US" resources={rs} roles={[]} disciplines={[]} grades={[]} onAssignRoleById={vi.fn()} onEditResource={onEdit} onAddResource={vi.fn()} onAddAbsence={vi.fn()} />);
    const row = screen.getByRole("button", { name: "Alex Example" }).closest("tr")!;
    expect(row.className).toContain("cursor-pointer");
    expect(row.className).toContain("hover:bg-surface-muted");
    fireEvent.click(row);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(rs[0]);
  });

  it("clicking the name button fires onEditResource exactly once (stopPropagation prevents double-fire)", () => {
    const onEdit = vi.fn();
    render(<ResourceDirectory lang="en-US" resources={rs} roles={[]} disciplines={[]} grades={[]} onAssignRoleById={vi.fn()} onEditResource={onEdit} onAddResource={vi.fn()} onAddAbsence={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Alex Example" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("assigns a role via the single picker and does NOT open the editor (stopPropagation)", () => {
    const onEdit = vi.fn();
    const onAssign = vi.fn();
    render(
      <ResourceDirectory
        lang="en-US"
        resources={rs}
        roles={[{ id: 5, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }]}
        disciplines={[{ id: 1, name: "Engineering" }]}
        grades={[{ id: 1, name: "Senior" }]}
        onAssignRoleById={onAssign}
        onEditResource={onEdit}
        onAddResource={vi.fn()}
        onAddAbsence={vi.fn()}
      />,
    );
    const select = screen.getByRole("combobox", { name: "Role for Alex Example" });
    fireEvent.click(select);
    fireEvent.change(select, { target: { value: "5" } });
    expect(onAssign).toHaveBeenCalledWith(1, 5);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("renders primary + additional emails as copy buttons and copies on click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    // ★★ NOT `Object.assign`, and this is order-dependence, not style.
    // `userEvent.setup()` (used by a later test in this file) installs
    // `navigator.clipboard` as a GETTER-ONLY accessor. Once it has, an
    // assignment throws "Cannot set property clipboard of #<Navigator> which
    // has only a getter" — so this test passes or fails purely on whether it
    // runs before or after that one. Test order WITHIN a file is randomised by
    // `npm run test:shuffle` (the only local reproduction of CI's BLOCKING
    // unit-tests-shuffled job), so that order is not fixed: this file was green
    // at seed 1 with 22 tests and went RED at 24, when adding two tests shifted
    // the permutation. `defineProperty` with `configurable` redefines the
    // accessor whichever ran first, so it is order-proof in both directions.
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    const withEmails: Resource[] = [
      { id: 1, firstName: "Ada", lastName: "Byte", email: "ada@x.com", emails: ["ada.alt@y.com"], roleId: null, utilizationMode: "percent", utilization: {} },
    ];
    render(<ResourceDirectory {...common} resources={withEmails} />);
    const primary = screen.getByRole("button", { name: "Copy ada@x.com" });
    const alt = screen.getByRole("button", { name: "Copy ada.alt@y.com" });
    expect(alt).toBeInTheDocument();
    fireEvent.click(primary);
    expect(writeText).toHaveBeenCalledWith("ada@x.com");
    fireEvent.click(alt);
    expect(writeText).toHaveBeenCalledWith("ada.alt@y.com");
  });

  // ★★ A DATA DEFECT WEARING A NAMING DEFECT'S CLOTHES. `emails` may repeat the
  // primary `email` — nothing dedupes the two lists — so one row rendered the
  // same address twice, as two buttons with the same accessible name AND the
  // same React `key`. Cross-ROW sharing of a mailbox is a different matter and
  // deliberately left alone: both buttons then copy the identical string, which
  // is genuinely same-purpose, and WCAG 2.4.6 permits a shared name for that.
  // Only the within-row repeat is a bug.
  it("renders one copy button per distinct address when email and emails overlap", () => {
    const overlapping: Resource[] = [
      { id: 1, firstName: "Ops", lastName: "Desk", email: "ops@acme.com", emails: ["ops@acme.com"], roleId: null, utilizationMode: "percent", utilization: {} },
    ];
    render(<ResourceDirectory {...common} resources={overlapping} />);
    expect(screen.getAllByRole("button", { name: "Copy ops@acme.com" })).toHaveLength(1);
  });

  // ★★ CASE- AND WHITESPACE-INSENSITIVE, matching how this repo already decides
  // email IDENTITY everywhere it matters — `resource-foundation.ts` indexes
  // resources by `(r.email ?? "").trim().toLowerCase()`, and
  // `use-resource-directory.ts` (the hook behind THIS panel) keys its own
  // add/remove diff the same way. `sanitizeEmail` is `sanitizeText`, which does
  // not case-fold, so the variance is live rather than theoretical. The DISPLAY
  // keeps the first occurrence verbatim: the user reads the address as stored.
  it("treats a case- or whitespace-variant address as the same address", () => {
    const variants: Resource[] = [
      { id: 1, firstName: "Ops", lastName: "Desk", email: "Ops@Acme.com", emails: [" ops@acme.com ", "night@acme.com"], roleId: null, utilizationMode: "percent", utilization: {} },
    ];
    render(<ResourceDirectory {...common} resources={variants} />);
    // One button for the mailbox, however it was spelled, and the primary's
    // own spelling is the one shown.
    expect(screen.getAllByRole("button", { name: /^Copy\s+ops@acme\.com$/i })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Copy Ops@Acme.com" })).toBeInTheDocument();
    // ★ The counter-assertion: a genuinely different address is NOT collapsed.
    expect(screen.getByRole("button", { name: "Copy night@acme.com" })).toBeInTheDocument();
  });

  it("shows no checkbox column without bulk handlers", () => {
    render(<ResourceDirectory {...common} resources={twoResources} />);
    expect(screen.queryByRole("checkbox", { name: /select all/i })).toBeNull();
  });

  it("selecting rows shows the bulk bar; bulk-edit applies a patch to the selection", () => {
    const onBulkEdit = vi.fn();
    render(
      <ResourceDirectory
        {...common}
        resources={twoResources}
        roles={[{ id: 5, disciplineId: 1, gradeId: 1, internalRate: 0, externalRate: 0 }]}
        disciplines={[{ id: 1, name: "Eng" }]}
        grades={[{ id: 1, name: "Senior" }]}
        onBulkEditResources={onBulkEdit}
        onBulkDeleteResources={vi.fn()}
      />,
    );
    // Select all visible → bulk bar appears.
    fireEvent.click(screen.getByRole("checkbox", { name: /select all/i }));
    fireEvent.click(screen.getByRole("button", { name: /^bulk edit$/i }));
    // Enable the External field (its enable checkbox), set it to External, apply.
    fireEvent.click(screen.getByRole("checkbox", { name: /external resource/i }));
    fireEvent.change(screen.getByRole("combobox", { name: /external resource/i }), { target: { value: "yes" } });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(onBulkEdit).toHaveBeenCalledTimes(1);
    const [ids, patch] = onBulkEdit.mock.calls[0];
    expect(ids.sort()).toEqual([1, 2]);
    expect(patch).toMatchObject({ isExternal: true });
  });

  it("bulk delete confirms then calls onBulkDeleteResources", async () => {
    const onBulkDelete = vi.fn();
    render(
      <ConfirmProvider lang="en-US">
        <ResourceDirectory {...common} resources={twoResources} onBulkEditResources={vi.fn()} onBulkDeleteResources={onBulkDelete} />
      </ConfirmProvider>,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /select all/i }));
    fireEvent.click(screen.getByRole("button", { name: /delete selected/i }));
    // Branded confirm dialog → warns the cascade also removes calendar entries.
    expect(await screen.findByText(/calendar entries \(absences and shifts\) will also be removed/i)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /^confirm$/i }));
    await waitFor(() => expect(onBulkDelete).toHaveBeenCalledWith(expect.arrayContaining([1, 2])));
  });

  it("gives the directory search box a descriptive tooltip", () => {
    render(<ResourceDirectory {...common} resources={rs} />);
    expect(screen.getByPlaceholderText(/filter by name, title/i)).toHaveAttribute(
      "title",
      "Filter the directory to people whose name, title, department, or email match your text.",
    );
  });

  it("renders Import from Outlook only when onImportOutlook is provided", () => {
    const onImport = vi.fn();
    const { rerender } = render(
      <ResourceDirectory lang="en-US" resources={rs} roles={[]} disciplines={[]} grades={[]}
        onAssignRoleById={vi.fn()} onEditResource={vi.fn()} onAddResource={vi.fn()} onAddAbsence={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: t("en-US", "outlookImportButton") })).toBeNull();
    rerender(
      <WorkspaceTabProvider>
        <ResourceDirectory lang="en-US" resources={rs} roles={[]} disciplines={[]} grades={[]}
          onAssignRoleById={vi.fn()} onEditResource={vi.fn()} onAddResource={vi.fn()} onAddAbsence={vi.fn()} onImportOutlook={onImport} />
      </WorkspaceTabProvider>,
    );
    const btn = screen.getByRole("button", { name: t("en-US", "outlookImportButton") });
    fireEvent.click(btn);
    expect(onImport).toHaveBeenCalled();
  });

  it("renders an icon inside the Pull contacts and Hide external controls", () => {
    render(<ResourceDirectory {...common} resources={rs} onImportOutlook={vi.fn()} />);
    const pull = screen.getByRole("button", { name: t("en-US", "outlookImportButton") });
    expect(pull.querySelector("svg")).toBeTruthy();
    const hide = screen.getByRole("button", { name: t("en-US", "resourceHideExternal") });
    expect(hide.querySelector("svg")).toBeTruthy();
  });

  it("hides external resources when 'Hide external' is toggled, and persists the choice", () => {
    localStorage.removeItem("aipm-cockpit:directory-hide-external");
    const mixed: Resource[] = [
      { id: 1, firstName: "In", lastName: "Ternal", roleId: null, utilizationMode: "percent", utilization: {} },
      { id: 2, firstName: "Ex", lastName: "Ternal", roleId: null, utilizationMode: "percent", utilization: {}, isExternal: true },
    ];
    render(<ResourceDirectory {...common} resources={mixed} />);
    expect(screen.getByText("Ex Ternal")).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: t("en-US", "resourceHideExternal") });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(screen.queryByText("Ex Ternal")).toBeNull();
    expect(screen.getByText("In Ternal")).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem("aipm-cockpit:directory-hide-external")).toBe("true");
    localStorage.removeItem("aipm-cockpit:directory-hide-external");
  });

  // ★ `readDeviceJson` hands back whatever JSON.parse produced — its type
  // argument is a claim, not a check — and `ToggleButton` renders `aria-pressed`
  // verbatim, so a stored `"true"` (string) would announce `aria-pressed="true"`
  // off a value that is not a boolean. Mirrors the resources-panel guard: both
  // sites read `=== true`, and both need pinning or only one stays fixed.
  it("treats a non-boolean stored value as off", () => {
    localStorage.setItem("aipm-cockpit:directory-hide-external", '"true"');
    const mixed: Resource[] = [
      { id: 1, firstName: "In", lastName: "Ternal", roleId: null, utilizationMode: "percent", utilization: {} },
      { id: 2, firstName: "Ex", lastName: "Ternal", roleId: null, utilizationMode: "percent", utilization: {}, isExternal: true },
    ];
    render(<ResourceDirectory {...common} resources={mixed} />);
    expect(screen.getByRole("button", { name: t("en-US", "resourceHideExternal") }))
      .toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Ex Ternal")).toBeInTheDocument();
    localStorage.removeItem("aipm-cockpit:directory-hide-external");
  });

  it("clears the search box from a labelled button", async () => {
    const user = userEvent.setup();
    render(<ResourceDirectory {...common} resources={rs} />);
    const field = screen.getByRole("searchbox", {
      name: t("en-US", "directorySearchPlaceholder"),
    }) as HTMLInputElement;
    await user.type(field, "jira");
    expect(field.value).toBe("jira");
    await user.click(
      screen.getByRole("button", {
        name: `${t("en-US", "clear")} – ${t("en-US", "directorySearchPlaceholder")}`,
      }),
    );
    expect(field.value).toBe("");
  });

  // §247/§248: the role select's aria-label was hardcoded English built from
  // the raw display name (`Role for ${resourceDisplayName(resource)}`), and
  // the row checkbox read the raw name too — so two resources sharing a
  // display name rendered identical accessible names on BOTH controls, and
  // the name button had no aria-label at all (its accessible name fell back
  // to its content, the same raw name). `roles` names every control type the
  // row renders: the name button, the row checkbox, and the role <select>
  // (a combobox). Whole-document scope: this pane's toolbar carries no
  // control reusing a per-row name, so nothing here can mask a broken row.
  //
  // Mutation-proved: role select -> old `` `Role for ${resourceDisplayName(resource)}` `` gives "Role for Dana Ames" x2.
  // Mutation-proved: name button -> aria-label removed entirely gives "Dana Ames" x2.
  // Mutation-proved: row checkbox -> raw `resourceDisplayName(r)` gives "Select Dana Ames" x2.
  it("keeps every per-row control distinct when two resources share a display name", () => {
    const dupes: Resource[] = [
      { id: 1, firstName: "Dana", lastName: "Ames", roleId: null, utilizationMode: "percent", utilization: {} },
      { id: 2, firstName: "Dana", lastName: "Ames", roleId: null, utilizationMode: "percent", utilization: {} },
    ];
    render(
      <ResourceDirectory
        {...common}
        resources={dupes}
        roles={[{ id: 5, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }]}
        disciplines={[{ id: 1, name: "Engineering" }]}
        grades={[{ id: 1, name: "Senior" }]}
        onBulkEditResources={vi.fn()}
        onBulkDeleteResources={vi.fn()}
      />,
    );
    // Measured (`expectRowUniqueNames` with minControls set high, then read the
    // printed list): 6 toolbar buttons (Add resource, Add absence, Hide
    // external, Print, reset-columns, reset-size) + 7 sortable column headers
    // + 2 name buttons + 1 select-all checkbox + 2 row checkboxes + 2 role
    // comboboxes = 20.
    expectRowUniqueNames({
      minControls: 20,
      roles: ["button", "checkbox", "combobox"],
      requireCollisionSeed: true,
    });
  });

  it("translates the role select's accessible name", async () => {
    await loadI18n("de");
    const rDe: Resource[] = [
      { id: 1, firstName: "Sample", lastName: "Dummy", roleId: null, utilizationMode: "percent", utilization: {} },
    ];
    render(
      <ResourceDirectory
        {...common}
        lang="de"
        resources={rDe}
      />,
    );
    expect(screen.queryByRole("combobox", { name: /^Role for/ })).toBeNull();
    expect(screen.getByRole("combobox", { name: /^Rolle für/ })).toBeInTheDocument();
  });
});

describe("ResourceDirectory sortable column headers", () => {
  // This table announced its sort state NOWHERE: seven hand-rolled headers and
  // zero aria-sort attributes, the state carried only as a glyph inside each
  // button's accessible name. axe has NO rule for a missing aria-sort, in any
  // view at any seed size, so this test is the only detector that will ever exist.
  it("announces sort state through aria-sort, which it did not carry at all before", () => {
    render(<ResourceDirectory {...common} resources={twoResources} />);
    // Unsorted on mount: sortKey is "" and matches no column. Every sortable
    // header must SAY so rather than leave the attribute off entirely — no
    // column may claim a sort it does not have. (The bulk-select th renders
    // only when a bulk handler is passed, and `common` passes none.)
    for (const th of screen.getAllByRole("columnheader")) {
      expect(th).toHaveAttribute("aria-sort", "none");
    }
    // The EXACT string name is the assertion that matters: while the sort glyph
    // sits inside the accessible name this reads "Department ▲" once sorted, and
    // a substring match would pass either way.
    const btn = () => screen.getByRole("button", { name: t("en-US", "resourceColDepartment") });
    const header = () => screen.getByRole("columnheader", { name: /department/i });
    fireEvent.click(btn());
    expect(header()).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(btn());
    expect(header()).toHaveAttribute("aria-sort", "descending");
  });

  // The explicit <SortKey> generic on useSortHeaderProps stops a GARBAGE sortCol,
  // but it cannot stop a SWAP between two real columns: paste sortCol="email"
  // onto the Phone header and every key is still a valid SortKey, it typechecks,
  // that column silently missorts, and no gate in this repo can see it. Seven
  // near-identical copy-pasted call sites make that the live risk here.
  //
  // The detector falls out of the primitive's own `active` rule
  // (`sortKey === sortCol && sortDir !== "off"`): two headers sharing one sortCol
  // both light up on a single click. So after clicking a column, EXACTLY one
  // header may report a non-"none" aria-sort, and it must be that column's own.
  // The count alone would miss a swap onto a hidden column; the identity alone
  // would miss the duplicate — both halves are needed.
  it("wires each sortable header to its own column, not a neighbour's", () => {
    render(<ResourceDirectory {...common} resources={twoResources} />);
    // Scoped to the directory table: a <th> rendered anywhere else on the pane
    // would inflate the count and make the length check meaningless.
    const table = screen.getByRole("button", { name: t("en-US", "assignee") }).closest("table")!;
    const sorted = () =>
      within(table)
        .getAllByRole("columnheader")
        .filter((th) => (th.getAttribute("aria-sort") ?? "none") !== "none");

    // A string `name` is an EXACT match, so each lookup also pins that header's
    // label key — a header wired to the wrong i18n string fails here too. The
    // labels stay glyph-free because the sort arrow is aria-hidden.
    const columns: readonly (readonly [string, string])[] = [
      ["name", t("en-US", "assignee")],
      ["role", t("en-US", "role")],
      ["title", t("en-US", "resourceColTitle")],
      ["department", t("en-US", "resourceColDepartment")],
      ["phone", t("en-US", "resourceColPhone")],
      ["email", t("en-US", "email")],
      ["birthday", t("en-US", "resourceColBirthday")],
    ];
    for (const [key, label] of columns) {
      // toggleSort resets the direction to "asc" whenever the KEY changes, so one
      // pass over the seven never re-enters the asc/desc flip.
      fireEvent.click(within(table).getByRole("button", { name: label }));
      // Re-queried after the click rather than reused: a stale node would make
      // the identity check compare against something no longer in the document.
      const own = within(table).getByRole("button", { name: label }).closest("th");
      expect(sorted(), `clicking ${key} lit up the wrong number of headers`).toHaveLength(1);
      expect(sorted()[0], `clicking ${key} sorted a different column`).toBe(own);
      expect(own).toHaveAttribute("aria-sort", "ascending");
    }
  });
  // ★★★ The e2e header-row-uniformity spec CANNOT see this cell. It is gated on
  // `bulkEnabled = !!onBulkEditResources`, and the e2e seed passes no such
  // handler, so the cell never renders there and a dropped `font-medium` measures
  // as a uniform row. Measured: mutating it left that spec green at 37 cells, all
  // 500. This is the only detector for that one cell.
  //
  // ★ A class assertion is weaker than the computed weight the e2e spec reads —
  // it cannot prove what the browser renders — but it does detect the regression
  // it exists for: the primitive emits `font-medium` and Tailwind preflight leaves
  // a raw `<th>` at the UA `bold`, so a row mixing them renders at two weights.
  it("keeps the bulk-select header on the same weight as the converted ones", () => {
    render(
      <ResourceDirectory
        {...common}
        resources={twoResources}
        onBulkEditResources={vi.fn()}
      />,
    );
    const headers = screen.getAllByRole("columnheader");
    // Positive observable: the bulk column is what makes this row longer than the
    // seven sortable headers, so its absence must fail here rather than pass.
    expect(headers.length).toBeGreaterThan(7);
    for (const th of headers) {
      expect(th.className, `header "${th.textContent?.trim()}" is off the row weight`)
        .toContain("font-medium");
    }
  });
});

// §362: a guardrail insight's deep link (`requestOpen("resources", id)`) used
// to arm pendingOpen with no consumer — the view switched but the person was
// never revealed. These pin the consumer half; the redirect half (Resources
// report tab -> this Directory sub-tab) is pinned in resources-report.test.tsx.
describe("ResourceDirectory deep-link open", () => {
  it("opens the edit modal for a pending deep-linked resource, then clears the request", () => {
    const onEdit = vi.fn();
    rtlRender(
      <WorkspaceTabProvider>
        <DeepLinkTrigger id={1} />
        <ResourceDirectory {...common} resources={rs} onEditResource={onEdit} />
      </WorkspaceTabProvider>,
    );

    fireEvent.click(screen.getByText("go"));

    expect(onEdit).toHaveBeenCalledWith(rs[0]);
    expect(screen.getByTestId("pending-open")).toHaveTextContent("null");
  });

  it("honours a pending request already armed before this component mounted (remount-swallow guard)", () => {
    const onEdit = vi.fn();
    function Trigger() {
      const { requestOpen } = useWorkspaceTab();
      return (
        <button type="button" onClick={() => requestOpen("resources", 1)}>
          go
        </button>
      );
    }
    function Harness({ mountDirectory }: { mountDirectory: boolean }) {
      return (
        <>
          <Trigger />
          {mountDirectory && <ResourceDirectory {...common} resources={rs} onEditResource={onEdit} />}
        </>
      );
    }
    const { rerender } = rtlRender(
      <WorkspaceTabProvider><Harness mountDirectory={false} /></WorkspaceTabProvider>,
    );
    // Arm pendingOpen while ResourceDirectory is NOT mounted (e.g. the request
    // landed while some other Resources sub-tab was active).
    fireEvent.click(screen.getByText("go"));
    expect(onEdit).not.toHaveBeenCalled();

    // ResourceDirectory mounts fresh; a seeded-from-live-prop "handled" ref
    // would read pendingOpen as already-acted-on and swallow it. It must not.
    rerender(<WorkspaceTabProvider><Harness mountDirectory={true} /></WorkspaceTabProvider>);
    expect(onEdit).toHaveBeenCalledWith(rs[0]);
  });

  it("consumes an unknown resource id silently, without opening anything", () => {
    const onEdit = vi.fn();
    rtlRender(
      <WorkspaceTabProvider>
        <DeepLinkTrigger id={999} />
        <ResourceDirectory {...common} resources={rs} onEditResource={onEdit} />
      </WorkspaceTabProvider>,
    );

    fireEvent.click(screen.getByText("go"));

    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByTestId("pending-open")).toHaveTextContent("null");
  });
});

// I1 (fix round 1): the two describe blocks above pin each host in isolation —
// this pins the SEAM between them. Nothing forced resources-report.tsx's
// redirect effect and resource-directory.tsx's consumer effect to agree that
// pendingOpen must survive the redirect; a redirect that also cleared it (or
// cleared on any tab change) would leave every test above green while the
// real, end-to-end deep link stayed dead — the per-task-checks-miss-the-seam
// shape the review flagged as I1. This mounts BOTH panels behind the SAME
// `activeTab` gate workspace-section.tsx uses, so the redirect must actually
// hand a live pendingOpen to the Directory consumer for this to pass.
const testPlan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-01-31", granularity: "month", currency: "USD" };

function ActiveTabHarness({ onEdit, resources = rs }: { onEdit: (r: Resource) => void; resources?: Resource[] }) {
  const { activeTab } = useWorkspaceTab();
  if (activeTab === "resources") {
    return (
      <ResourcesReportPanel
        lang="en-US"
        resources={resources}
        roles={[]}
        disciplines={[]}
        grades={[]}
        plan={testPlan}
        absences={[]}
        holidaySet={new Set()}
        workdayHours={8}
      />
    );
  }
  if (activeTab === "directory") {
    return <ResourceDirectory {...common} resources={resources} onEditResource={onEdit} />;
  }
  return null;
}

// §540: `handleEditResource`'s guard lives in `useResourceDirectory`, whose
// `editingResource` state sits ABOVE the `ResourceDirectory` remount driven by
// the tab switch in `ActiveTabHarness` (see the guard's own comment in
// use-resource-directory.ts). This harness owns a REAL `useResourceDirectory`
// instance and threads its `handleEditResource` down as `ActiveTabHarness`'s
// `onEdit` — mirroring production, where `onEditResource` IS `handleEditResource`
// (threaded through task-manager.tsx / workspace-section.tsx) — so the guard
// under test is the real one, not a stand-in.
//
// `onOpen` fires from an EFFECT (not a render-time reconcile — calling an
// external callback is a legitimate effect; only DERIVING LOCAL STATE from a
// changed prop belongs in render, per AGENTS.md) whenever the hook's
// `editingResource` WRAPPER object changes identity and the result is an EDIT
// (not an ADD draft). The wrapper, not `.resource`, is the load-bearing
// observable: `resource-directory.tsx`'s `.find()` returns the SAME array
// element on every repeat regardless of the guard, so `.resource` alone stays
// stable either way and cannot tell a guarded repeat from an unguarded one
// (measured — an earlier draft of this harness kept that check and stayed
// green with the guard deleted). The WRAPPER reference is what the guard
// actually controls: React only bails a `setEditingResource` update, and
// skips re-rendering this component (and firing its effects) at all, when the
// updater returns the EXACT SAME wrapper — which is precisely what keeps
// `onOpen` from firing again on an unguarded call's fresh `{resource, isNew}`
// object.
//
// `onRawEdit`, when passed, is called on EVERY dispatch into
// `handleEditResource` regardless of the guard — a positive observable that a
// repeated deep link actually reached the handler twice, so a call-count
// assertion on `onOpen` alone can't misread "the second dispatch never
// happened" as "the guard collapsed it" (absence-needs-a-positive-observable).
//
// `data-testid="editing-resource-id"` exposes the live draft/edit id so a
// test can PIN a premise it depends on (e.g. the ADD-draft test's engineered
// id collision) instead of asserting it only in a comment.
function GuardedDirectoryHarness({
  onOpen,
  onRawEdit,
  resources = rs,
}: {
  onOpen: (r: Resource) => void;
  onRawEdit?: (r: Resource) => void;
  resources?: Resource[];
}) {
  const { setResources } = useWorkspace();
  const directory = useResourceDirectory({
    lang: "en-US",
    logActivity: vi.fn(),
    showToast: vi.fn(),
    logUpdate: vi.fn(),
  });
  useEffect(() => {
    if (directory.editingResource && !directory.editingResource.isNew) onOpen(directory.editingResource.resource);
  }, [directory.editingResource, onOpen]);
  const handleEdit = (r: Resource) => {
    onRawEdit?.(r);
    directory.handleEditResource(r);
  };
  return (
    <>
      {/* Seeds ws.resources with id 1. mintId is a SESSION-scoped module-level
          high-water mark (not max(list)+1), so this only deterministically
          hands the next draft id 2 while nothing else in this file has minted
          a "resource" id first — true today, but not guaranteed by mintId's
          own contract. The ADD-draft test below PINS the resulting id via
          `editing-resource-id` rather than assuming it. */}
      <button
        type="button"
        onClick={() => setResources([{ id: 1, firstName: "Seed", lastName: "R", roleId: null, utilizationMode: "percent", utilization: {} }])}
      >
        seed-ws-resources
      </button>
      <button type="button" onClick={() => directory.handleOpenAddResource()}>
        open-add
      </button>
      <span data-testid="editing-resource-id">
        {directory.editingResource ? String(directory.editingResource.resource.id) : "none"}
      </span>
      <ActiveTabHarness onEdit={handleEdit} resources={resources} />
    </>
  );
}

describe("§362 deep-link seam: ResourcesReportPanel redirect -> ResourceDirectory consumer", () => {
  it("end to end: a resource deep-link lands on the Resources report, redirects to Directory, and opens the editor", () => {
    const onEdit = vi.fn();
    rtlRender(
      <WorkspaceTabProvider>
        <DeepLinkTrigger id={1} />
        <ActiveTabHarness onEdit={onEdit} />
      </WorkspaceTabProvider>,
    );

    fireEvent.click(screen.getByText("go"));

    expect(onEdit).toHaveBeenCalledWith(rs[0]);
    expect(screen.getByTestId("pending-open")).toHaveTextContent("null");
  });

  // §540: every producer of this deep link tags the request "resources", so
  // `requestOpen` flips `activeTab` through "resources" first and back to
  // "directory", forcing ResourceDirectory through an unmount/remount before
  // any per-mount ref could see a repeat. This test goes through that SAME
  // real hop (ActiveTabHarness, not a statically-mounted ResourceDirectory) —
  // the guard has to live in useResourceDirectory's `editingResource` state,
  // which sits above the remount (GuardedDirectoryHarness owns that hook
  // instance and does not remount when the tab does).
  it("does not re-fire the edit handler for a repeated deep-link to the resource whose editor is already open", () => {
    const onOpen = vi.fn();
    const rawEdit = vi.fn();
    rtlRender(
      <FiltersProvider>
        <WorkspaceProvider>
          <WorkspaceTabProvider>
            <DeepLinkTrigger id={1} />
            <GuardedDirectoryHarness onOpen={onOpen} onRawEdit={rawEdit} />
          </WorkspaceTabProvider>
        </WorkspaceProvider>
      </FiltersProvider>,
    );

    fireEvent.click(screen.getByText("go")); // opens id 1 (through the real resources -> directory hop)
    fireEvent.click(screen.getByText("go")); // a second request for the same id

    // Positive observable that the second dispatch genuinely reached the
    // handler (absence-needs-a-positive-observable): `onOpen` alone reading 1
    // cannot distinguish "the guard collapsed a real repeat" from "the second
    // requestOpen -> consumer-effect hop never fired at all". Pinning the raw
    // call count at 2 rules out the latter.
    expect(rawEdit).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(rs[0]);
  });

  // Review Focus (§540): the guard's `!prev.isNew` conjunct must not swallow a
  // deep link that arrives while an unsaved ADD draft is open. Seeding ws
  // resources with id 1 is intended to force `mintId` to hand the draft id 2
  // — the SAME id as the deep-link target below — so an id match alone
  // (dropping the `!prev.isNew` conjunct; §540 mutation table row 1) is what
  // would incorrectly suppress this open, not an id mismatch. That collision
  // is PINNED below via `editing-resource-id` rather than assumed: mintId is
  // a session-scoped module-level high-water mark, not max(list)+1, so the
  // draft landing on id 2 also depends on nothing else in this file having
  // minted a "resource" id first — true today, but not something mintId's
  // own contract guarantees against e.g. a reordering under `test:shuffle`.
  it("still honours a deep link to another resource while an unsaved ADD draft is open", () => {
    const onOpen = vi.fn();
    rtlRender(
      <FiltersProvider>
        <WorkspaceProvider>
          <WorkspaceTabProvider>
            <DeepLinkTrigger id={2} />
            <GuardedDirectoryHarness onOpen={onOpen} resources={twoResources} />
          </WorkspaceTabProvider>
        </WorkspaceProvider>
      </FiltersProvider>,
    );

    fireEvent.click(screen.getByText("seed-ws-resources"));
    fireEvent.click(screen.getByText("open-add")); // handleOpenAddResource: { isNew: true }

    // Pin the id collision this test's non-vacuity depends on (see the
    // comment above) instead of only asserting it in prose: if `mintId` ever
    // hands the draft a different id, this fails loudly here rather than the
    // mutant-row-1 coverage silently going vacuous below.
    expect(screen.getByTestId("editing-resource-id")).toHaveTextContent("2");

    fireEvent.click(screen.getByText("go")); // deep link to id 2 — a DIFFERENT, already-saved resource

    // `toHaveBeenLastCalledWith(twoResources[1])` (exact object identity),
    // not `objectContaining({ id: 2 })` — the latter can't distinguish the
    // id-2 ADD draft from the id-2 STORED row, which is exactly the
    // collision this test engineers.
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenLastCalledWith(twoResources[1]);
  });
});

describe("§540 mutation guard: editingResource identity survives a same-id repeat", () => {
  // §540 mutation table row 3: a guard returning `{ ...prev }` instead of
  // `prev` unchanged defeats React's setState bail-out and hands
  // ResourceEditModal (app-modals.tsx, `resource={editingResource.resource}`)
  // a fresh wrapper on every repeat. ★ MEASURED, not merely reasoned: the
  // DOM-based "does not re-fire" test above also catches this mutant, because
  // its `onOpen` watcher keys on the `editingResource` WRAPPER's identity
  // (necessary — the wrapper is the only thing an id-vs-reference comparison
  // mutant, row 2, can be told apart by; see that test's own comment). This
  // renderHook test is still worth keeping: it pins the exact mechanism
  // (React's setState bail-out returning the SAME object) directly, without
  // going through the tab-remount harness, and independently of whatever
  // observable the DOM harness happens to use.
  it("returns the exact editingResource object on a repeated handleEditResource call for the same id", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <FiltersProvider>
        <WorkspaceProvider>{children}</WorkspaceProvider>
      </FiltersProvider>
    );
    const { result } = renderHook(
      () => useResourceDirectory({ lang: "en-US", logActivity: vi.fn(), showToast: vi.fn(), logUpdate: vi.fn() }),
      { wrapper },
    );

    act(() => { result.current.handleEditResource(rs[0]); });
    const opened = result.current.editingResource;

    act(() => { result.current.handleEditResource(rs[0]); });

    expect(result.current.editingResource).toBe(opened);
  });
});
