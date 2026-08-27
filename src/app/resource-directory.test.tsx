import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ResourceDirectory } from "./resource-directory";
import { ConfirmProvider } from "./confirm-dialog";
import type { Resource } from "./types";
import { t, loadI18n } from "./i18n";
import { expectRowUniqueNames } from "../test/row-unique-names";

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
    Object.assign(navigator, { clipboard: { writeText } });
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
      <ResourceDirectory lang="en-US" resources={rs} roles={[]} disciplines={[]} grades={[]}
        onAssignRoleById={vi.fn()} onEditResource={vi.fn()} onAddResource={vi.fn()} onAddAbsence={vi.fn()} onImportOutlook={onImport} />,
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
