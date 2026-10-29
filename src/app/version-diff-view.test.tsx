import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { INLINE_OPEN_LIMIT, VersionDiffView } from "./version-diff-view";
import { diffWorkspaces, type VersionChange } from "./version-diff";
import { changeKey } from "./version-restore";
import { expectRowUniqueNames } from "../test/row-unique-names";
import { expectLabelInName } from "../test/label-in-name";
import { loadI18n } from "./i18n";
import { ws, roleRec, disciplineRec, gradeRec } from "../test/workspace-records";
import { buttonClassFor } from "../test/button-variant";

const changes: VersionChange[] = [
  { collection: "tasks", collectionLabel: "Tasks", kind: "list", recordId: 1, recordLabel: "Design sign-off",
    type: "modified", fields: [{ field: "title", label: "Title", before: "Old", after: "New" }] },
  { collection: "raid", collectionLabel: "RAID", kind: "list", recordId: 9, recordLabel: "Vendor delay",
    type: "removed", fields: [] },
];

describe("VersionDiffView", () => {
  it("groups changes by collection and shows record labels", () => {
    render(<VersionDiffView lang="en-US" changes={changes} />);
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("Design sign-off")).toBeInTheDocument();
    expect(screen.getByText("Vendor delay")).toBeInTheDocument();
  });
  // §776 — a compare must show what changed without a click. ★★ THE BEFORE-CLICK
  // ASSERTION IS THE LOAD-BEARING ONE: it is the owner's request. The click half
  // pins that the toggle still works (it fails with `toggle()` deleted); the
  // panel is conditionally rendered, so a closed row has no field text at all.
  it("shows a modified record's before and after with no click, and the toggle hides them", () => {
    render(<VersionDiffView lang="en-US" changes={changes} />);
    expect(screen.getByText("Old")).toBeVisible();
    expect(screen.getByText("New")).toBeVisible();
    expect(screen.getByText("Fields changed: 1")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Design sign-off"));
    expect(screen.queryByText("Old")).toBeNull();
    fireEvent.click(screen.getByText("Design sign-off"));
    expect(screen.getByText("Old")).toBeVisible();
  });

  it("keeps added and removed records closed, each with its toggle (§776)", () => {
    const mixed: VersionChange[] = [
      { collection: "tasks", collectionLabel: "Tasks", kind: "list", recordId: 2, recordLabel: "New task",
        type: "added", fields: [{ field: "title", label: "Title", before: undefined, after: "Fresh" }] },
      { collection: "tasks", collectionLabel: "Tasks", kind: "list", recordId: 3, recordLabel: "Old task",
        type: "removed", fields: [{ field: "title", label: "Title", before: "Gone", after: undefined }] },
    ];
    render(<VersionDiffView lang="en-US" changes={mixed} />);
    expect(screen.getByText("Added")).toBeInTheDocument();
    expect(screen.getByText("Removed")).toBeInTheDocument();
    expect(screen.queryByText("Fresh")).toBeNull();
    expect(screen.queryByText("Gone")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Added – New task" }));
    expect(screen.getByText("Fresh")).toBeVisible();
    expect(screen.getByText("—")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Removed – Old task" }));
    expect(screen.getByText("Gone")).toBeVisible();
  });

  it(`opens only the first ${INLINE_OPEN_LIMIT} modified records; the rest open on a click (§776)`, () => {
    const many: VersionChange[] = Array.from({ length: INLINE_OPEN_LIMIT + 1 }, (_, i) => ({
      collection: "tasks", collectionLabel: "Tasks", kind: "list" as const, recordId: i + 1,
      recordLabel: `Task ${i + 1}`, type: "modified" as const,
      fields: [{ field: "title", label: "Title", before: `old ${i + 1}`, after: `new ${i + 1}` }],
    }));
    render(<VersionDiffView lang="en-US" changes={many} />);
    expect(screen.getAllByText(/^Title:$/)).toHaveLength(INLINE_OPEN_LIMIT);
    expect(screen.getByText(`new ${INLINE_OPEN_LIMIT}`)).toBeVisible();
    const last = screen.getByRole("button", { name: `Modified – Task ${INLINE_OPEN_LIMIT + 1}` });
    expect(last).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(`new ${INLINE_OPEN_LIMIT + 1}`)).toBeNull();
    fireEvent.click(last);
    expect(screen.getByText(`new ${INLINE_OPEN_LIMIT + 1}`)).toBeVisible();
  });

  it("opens the first records in the order they render, grouped by collection (§776)", () => {
    // Interleaved input: rendering groups Tasks before Milestones, so the open
    // rows must be the first Tasks rows, not the first items of `changes`.
    const row = (collection: "tasks" | "milestones", id: number): VersionChange => ({
      collection, collectionLabel: collection === "tasks" ? "Tasks" : "Milestones", kind: "list", recordId: id,
      recordLabel: `${collection} ${id}`, type: "modified",
      fields: [{ field: "title", label: "Title", before: `b${collection}${id}`, after: `a${collection}${id}` }],
    });
    const interleaved = Array.from({ length: INLINE_OPEN_LIMIT }, (_, i) => [row("tasks", i + 1), row("milestones", i + 1)]).flat();
    render(<VersionDiffView lang="en-US" changes={interleaved} />);
    for (let i = 1; i <= INLINE_OPEN_LIMIT; i += 1) expect(screen.getByText(`atasks${i}`)).toBeVisible();
    expect(screen.queryByText("amilestones1")).toBeNull();
  });

  it("counts changed fields on modified rows only (§776)", () => {
    const added: VersionChange = { collection: "tasks", collectionLabel: "Tasks", kind: "list", recordId: 2,
      recordLabel: "New task", type: "added", fields: [{ field: "title", label: "Title", before: undefined, after: "x" }] };
    render(<VersionDiffView lang="en-US" changes={[...changes, added]} />);
    expect(screen.getAllByText(/^Fields changed:/)).toHaveLength(1);
  });

  it("draws a chevron in an expandable record's button only, turned while open (§776)", () => {
    render(<VersionDiffView lang="en-US" changes={changes} />);
    const open = screen.getByRole("button", { name: "Modified – Design sign-off" });
    const chevron = open.querySelector("svg");
    expect(chevron).not.toBeNull();
    expect(chevron!.getAttribute("aria-hidden")).toBe("true");
    expect(chevron!.getAttribute("class")!.split(/\s+/)).toContain("rotate-90");
    fireEvent.click(open);
    expect(open.querySelector("svg")!.getAttribute("class")!.split(/\s+/)).not.toContain("rotate-90");
    expect(screen.getByRole("button", { name: "Removed – Vendor delay" }).querySelector("svg")).toBeNull();
  });

  it("shows rich text and object values readably in both layouts (§776)", () => {
    const rich: VersionChange[] = [{
      collection: "milestones", collectionLabel: "Milestones", kind: "list", recordId: 5, recordLabel: "Go-live",
      type: "modified", fields: [
        { field: "description", label: "Description", before: "<p>Draft <strong>scope</strong></p>", after: "<p>Final scope</p>" },
        { field: "raci", label: "RACI", before: { "10": "R" }, after: { "10": "A", "11": "C" } },
      ],
    }];
    for (const layout of ["inline", "sideBySide"] as const) {
      const { unmount, container } = render(<VersionDiffView lang="en-US" changes={rich} layout={layout} />);
      expect(screen.getByText("Draft scope")).toBeVisible();
      expect(screen.getByText("Final scope")).toBeVisible();
      expect(screen.getByText("10: R")).toBeVisible();
      expect(screen.getByText("10: A, 11: C")).toBeVisible();
      expect(container.textContent).not.toMatch(/<p>|\{"10"/);
      unmount();
    }
  });
  it("shows an empty state when there are no changes", () => {
    render(<VersionDiffView lang="en-US" changes={[]} />);
    expect(screen.getByText(/No differences/)).toBeInTheDocument();
  });
  it("renders record + field checkboxes in selectable mode and reports toggles", () => {
    const onToggleRecord = vi.fn();
    const onToggleField = vi.fn();
    render(
      <VersionDiffView lang="en-US" changes={changes} selectable selection={{}}
        onToggleRecord={onToggleRecord} onToggleField={onToggleField} />,
    );
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.length).toBeGreaterThan(0);
    fireEvent.click(boxes[0]);
    expect(onToggleRecord).toHaveBeenCalledWith(changeKey("tasks", 1));
  });
  it("renders NO checkboxes when not selectable (read-only default)", () => {
    render(<VersionDiffView lang="en-US" changes={changes} />);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("renders a non-restorable row without a checkbox or a restore button", () => {
    const changes: VersionChange[] = [{
      collection: "documents", collectionLabel: "Documents", kind: "list",
      recordId: 1, recordLabel: "Q3 report", type: "modified",
      fields: [{ field: "title", label: "Title", before: "a", after: "b" }],
      restorable: false,
    }];
    render(<VersionDiffView lang="en-US" changes={changes} selectable selection={{}}
      onToggleRecord={() => {}} onRestoreRecord={() => {}} />);
    // Selecting it would be a silent no-op: applyRestore skips the collection.
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /restore/i })).toBeNull();
    expect(screen.getByText(/managed per document/i)).toBeInTheDocument();
  });

  it("renders no FIELD checkboxes when a non-restorable row is expanded", () => {
    const changes: VersionChange[] = [{
      collection: "documents", collectionLabel: "Documents", kind: "list",
      recordId: 1, recordLabel: "Q3 report", type: "modified",
      fields: [{ field: "title", label: "Title", before: "a", after: "b" }],
      restorable: false,
    }];
    render(<VersionDiffView lang="en-US" changes={changes} selectable selection={{}}
      onToggleRecord={() => {}} onToggleField={() => {}} />);
    // Expanding must not reintroduce what the collapsed row correctly withheld:
    // a per-FIELD tick on a skipped collection is the same silent no-op, and a
    // row whose expansion contradicts its own "managed per document" hint is
    // worse than either alone. A modified row starts open (§776).
    expect(screen.getByText(/Title:/)).toBeVisible(); // the row really is expanded
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  // ★★★ THE SHAPE THAT WAS UNWRITEABLE UNTIL 0.260.x, and the reason it matters
  // most: a NON-restorable row renders no checkbox and no restore button, so the
  // disclosure button is the row's ONLY control — the sole thing carrying a
  // row-unique name. While that button built its name token-FIRST, the trailing
  // ` (N)` this helper strips (`OCCURRENCE_SUFFIX`) sat mid-string, so
  // `requireCollisionSeed: true` threw "the fixture seeded no two rows sharing a
  // display name" against a fixture that seeds precisely that. The collision is
  // real in production data: two documents may share a title.
  it("gives two same-named NON-restorable records distinct disclosure-button names", () => {
    const changes: VersionChange[] = [1, 2].map((id) => ({
      collection: "documents", collectionLabel: "Documents", kind: "list" as const,
      recordId: id, recordLabel: "Q3 report", type: "modified" as const,
      fields: [{ field: "title", label: "Title", before: "a", after: "b" }],
      restorable: false as const,
    }));
    render(<VersionDiffView lang="en-US" changes={changes} selectable selection={{}}
      onToggleRecord={() => {}} onRestoreRecord={() => {}} />);
    // The disclosure button really is the only control on these rows.
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(2);
    expectRowUniqueNames({ roles: ["button"], minControls: 2, requireCollisionSeed: true });
  });

  // ★★★ WCAG 2.5.3 — the type badge must sit OUTSIDE the record button. This
  // test once removed `aria-hidden` subtrees before comparing, on the belief that
  // axe does; axe 4.14 compares ON-SCREEN text, so an aria-hidden badge inside
  // the button made its visible text "Q3 reportModified" against the name
  // "Modified – Q3 report (1)" — a violation the old test passed. Asserted with
  // the shared helper (on-screen text, word containment), both languages, on a
  // colliding pair and a lone row. Mutation: move the badge back inside → red.
  it.each(["en-US", "de"] as const)("keeps each row's visible label contained in its accessible name (WCAG 2.5.3, %s)", async (lang) => {
    await loadI18n(lang);
    const changes: VersionChange[] = [1, 2, 3].map((id) => ({
      collection: "documents", collectionLabel: "Documents", kind: "list" as const,
      recordId: id, recordLabel: id === 3 ? "Design SSO" : "Q3 report", type: "modified" as const,
      fields: [{ field: "title", label: "Title", before: "a", after: "b" }],
      restorable: false as const,
    }));
    render(<VersionDiffView lang={lang} changes={changes} selectable selection={{}}
      onToggleRecord={() => {}} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);
    for (const btn of buttons) expectLabelInName(btn);
  });

  // The type badge left the button's TEXT but not its click target: it sat inside
  // the button before, so clicking "Modified" opened the row, and still does —
  // the button's after: overlay covers the relative wrapper that holds both.
  // jsdom has no layout, so the structure and classes are the observable.
  // Mutation: drop the overlay classes, or move the badge out of the wrapper → red.
  it("keeps the type badge inside the record button's click target", () => {
    const change: VersionChange = {
      collection: "tasks", collectionLabel: "Tasks", kind: "list",
      recordId: 1, recordLabel: "Design SSO", type: "modified",
      fields: [{ field: "title", label: "Title", before: "a", after: "b" }],
    };
    render(<VersionDiffView lang="en-US" changes={[change]} />);
    const btn = screen.getByRole("button", { name: /Design SSO/ });
    const badge = screen.getByText("Modified");
    expect(btn.contains(badge)).toBe(false);
    expect(badge.parentElement).toBe(btn.parentElement);
    expect(btn.parentElement!.className.split(/\s+/)).toContain("relative");
    expect(btn.className.split(/\s+/)).toEqual(expect.arrayContaining(["after:absolute", "after:inset-0"]));
  });

  it("gives two same-named records distinct checkbox names", () => {
    const row = (id: number): VersionChange => ({
      collection: "documents", collectionLabel: "Documents", kind: "list",
      recordId: id, recordLabel: "Q3 report", type: "modified",
      fields: [{ field: "title", label: "Title", before: "a", after: "b" }],
    });
    render(<VersionDiffView lang="en-US" changes={[row(1), row(2)]} selectable selection={{}}
      onToggleRecord={() => {}} />);
    expectRowUniqueNames({ roles: ["checkbox"], minControls: 2, requireCollisionSeed: true });
  });

  it("gives two same-named records distinct restore-button names (inline)", () => {
    const row = (id: number): VersionChange => ({
      collection: "tasks", collectionLabel: "Tasks", kind: "list",
      recordId: id, recordLabel: "Q3 report", type: "modified",
      fields: [{ field: "title", label: "Title", before: "a", after: "b" }],
    });
    render(<VersionDiffView lang="en-US" changes={[row(1), row(2)]} onRestoreRecord={() => {}} />);
    // ★★ The whole-document helper is the right assertion here, and it only
    // became safe once the per-row DISCLOSURE button was ALSO named from the row
    // token. That button takes its name from its own content, so before that fix
    // two same-named records collided on it and this call failed on a pair the
    // restore buttons had nothing to do with. Both of the row's buttons now
    // carry the token, so a green run here means every control in the row is
    // distinct — including any control added later, which is why this is
    // stronger than asserting the two names by hand.
    expectRowUniqueNames({ roles: ["button"], minControls: 2, requireCollisionSeed: true });
  });

  // ★★★ CROSS-COLLECTION, which is the case every other collision test here
  // misses. Each of these names is UNIQUE inside its own group, so a token map
  // built per group emits both BARE — and both groups render at once, so the
  // document carries two checkboxes and two restore buttons named identically.
  // Rebuild the map per group and this goes red with
  // `"Select – Go-live" x2, "Restore this – Go-live" x2`.
  it("distinguishes two records that share a name across DIFFERENT collections", () => {
    const cross: VersionChange[] = [
      { collection: "tasks", collectionLabel: "Tasks", kind: "list", recordId: 1,
        recordLabel: "Go-live", type: "modified",
        fields: [{ field: "title", label: "Title", before: "a", after: "b" }] },
      { collection: "milestones", collectionLabel: "Milestones", kind: "list", recordId: 1,
        recordLabel: "Go-live", type: "modified",
        fields: [{ field: "name", label: "Name", before: "a", after: "b" }] },
    ];
    render(<VersionDiffView lang="en-US" changes={cross} selectable selection={{}}
      onToggleRecord={() => {}} onRestoreRecord={() => {}} />);
    expectRowUniqueNames({
      roles: ["checkbox", "button"], minControls: 4, requireCollisionSeed: true,
    });
  });

  it("distinguishes two records sharing a name across collections in the side-by-side layout", () => {
    const cross: VersionChange[] = [
      { collection: "tasks", collectionLabel: "Tasks", kind: "list", recordId: 1,
        recordLabel: "Go-live", type: "modified",
        fields: [{ field: "title", label: "Title", before: "a", after: "b" }] },
      { collection: "milestones", collectionLabel: "Milestones", kind: "list", recordId: 1,
        recordLabel: "Go-live", type: "modified",
        fields: [{ field: "name", label: "Name", before: "a", after: "b" }] },
    ];
    render(<VersionDiffView lang="en-US" changes={cross} layout="sideBySide"
      onRestoreRecord={() => {}} />);
    // This branch has its OWN group map, so it needed the same hoist — the
    // record name is a plain span here, making the restore buttons the only
    // controls and the whole-document scope exact.
    expectRowUniqueNames({ roles: ["button"], minControls: 2, requireCollisionSeed: true });
  });

  // ★★ The per-FIELD checkboxes, one level down (register §257). Several records
  // can be expanded at the same time, and a field label ("Title") is shared by
  // construction across records — so naming the checkbox `f.label` alone put two
  // controls called "Title" in one document. Revert the field naming to the bare
  // `f.label` and this goes red with `"Title" x2`.
  it("distinguishes the per-field checkboxes of two simultaneously expanded records", () => {
    const row = (id: number, name: string): VersionChange => ({
      collection: "tasks", collectionLabel: "Tasks", kind: "list", recordId: id,
      recordLabel: name, type: "modified",
      fields: [{ field: "title", label: "Title", before: "a", after: "b" }],
    });
    render(<VersionDiffView lang="en-US" changes={[row(1, "Alpha"), row(2, "Beta")]}
      selectable selection={{}} onToggleRecord={() => {}} onToggleField={() => {}} />);
    // Both really expanded (modified rows start open, §776): 2 record checkboxes + 2 field checkboxes.
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
    expectRowUniqueNames({ roles: ["checkbox"], minControls: 4 });
    // ...and named from their OWN row, not merely made unique some other way.
    expect(screen.getByRole("checkbox", { name: /Title.*Alpha/ })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Title.*Beta/ })).toBeInTheDocument();
  });

  it("renders a non-restorable side-by-side row without a restore button", () => {
    const changes: VersionChange[] = [{
      collection: "documents", collectionLabel: "Documents", kind: "list",
      recordId: 1, recordLabel: "Q3 report", type: "modified",
      fields: [{ field: "title", label: "Title", before: "a", after: "b" }],
      restorable: false,
    }];
    render(<VersionDiffView lang="en-US" changes={changes} layout="sideBySide"
      onRestoreRecord={() => {}} />);
    expect(screen.queryByRole("button", { name: /restore/i })).toBeNull();
    expect(screen.getByText(/managed per document/i)).toBeInTheDocument();
  });

  it("gives two same-named records distinct restore-button names (side by side)", () => {
    const row = (id: number): VersionChange => ({
      collection: "tasks", collectionLabel: "Tasks", kind: "list",
      recordId: id, recordLabel: "Q3 report", type: "modified",
      fields: [{ field: "title", label: "Title", before: "a", after: "b" }],
    });
    render(<VersionDiffView lang="en-US" changes={[row(1), row(2)]} layout="sideBySide"
      onRestoreRecord={() => {}} />);
    // The record name is a plain span in this branch, so the restore buttons are
    // the ONLY controls — the helper's whole-document scope is exact here.
    expectRowUniqueNames({ roles: ["button"], minControls: 2, requireCollisionSeed: true });
  });

  // ★★★ REPAIRING THE FIVE BROKEN `nameField`s CREATED THIS HAZARD. `#id` is
  // unique by construction; a NAME is not. Two roles are discipline x grade, so
  // two distinct rows genuinely label identically — and a task's `taskName` is
  // free text, so two tasks can share one too. `buildRowTokens` already numbers
  // colliding rows, but nothing had ever exercised it on a collision the DIFF
  // itself produces: every other collision test in this file hands the view a
  // hand-written `recordLabel`. This one goes through `diffWorkspaces`, so it
  // fails if the repair stops composing a role label as well as if the
  // tokeniser stops numbering.
  // axe cannot see two controls sharing an accessible name in ANY view at ANY
  // seed size, so this unit test is the only detector that can exist.
  it("keeps row controls distinct when the diff labels two roles identically", () => {
    const fixed = { disciplines: [disciplineRec(1, "Dev")], grades: [gradeRec(1, "Senior")] };
    const changes = diffWorkspaces(
      ws({ ...fixed, roles: [roleRec(1, "Old"), roleRec(2, "Old")] }),
      ws({ ...fixed, roles: [roleRec(1, "New"), roleRec(2, "New")] }),
    ).filter((c) => c.collection === "roles");
    // The collision is REAL and produced by the diff, not asserted into being.
    expect(changes).toHaveLength(2);
    expect(changes.map((c) => c.recordLabel))
      .toEqual(["Discipline Dev Grade Senior", "Discipline Dev Grade Senior"]);
    render(<VersionDiffView lang="en-US" changes={changes} selectable selection={{}}
      onToggleRecord={() => {}} onRestoreRecord={() => {}} />);
    expectRowUniqueNames({ roles: ["checkbox", "button"], minControls: 4, requireCollisionSeed: true });
  });

  // ★★★ Do NOT assert accessible names here — they already route through
  // `tokens`/`rowLabel` and are unique BEFORE this fix. What was broken is the
  // VISIBLE text: both layouts rendered the bare `c.recordLabel` in the
  // `span.text-foreground` record-label span, so two records sharing a
  // `recordLabel` rendered two visually identical rows even though their
  // aria-labels already differed. Assert on RENDERED TEXT, per layout, so a
  // fix touching only one of the two sites still leaves this red.
  function diffWithTwoChangesSharing(label: string): VersionChange[] {
    return [1, 2].map((id) => ({
      collection: "tasks", collectionLabel: "Tasks", kind: "list" as const,
      recordId: id, recordLabel: label, type: "modified" as const,
      fields: [{ field: "title", label: "Title", before: "a", after: "b" }],
    }));
  }

  it("renders two visually distinct rows when two records share a recordLabel (§305)", () => {
    const diff = diffWithTwoChangesSharing("Design review");

    const inline = render(<VersionDiffView lang="en-US" changes={diff} />);
    const inlineShown = [...inline.container.querySelectorAll("span.text-foreground")]
      .map((el) => el.textContent?.trim())
      .filter((s): s is string => s === "Design review" || /^Design review \(\d+\)$/.test(s));
    expect(inlineShown.length).toBeGreaterThanOrEqual(2);
    expect(new Set(inlineShown).size).toBe(inlineShown.length);
    inline.unmount();

    const sideBySide = render(<VersionDiffView lang="en-US" changes={diff} layout="sideBySide" />);
    const sideBySideShown = [...sideBySide.container.querySelectorAll("span.text-foreground")]
      .map((el) => el.textContent?.trim())
      .filter((s): s is string => s === "Design review" || /^Design review \(\d+\)$/.test(s));
    expect(sideBySideShown.length).toBeGreaterThanOrEqual(2);
    expect(new Set(sideBySideShown).size).toBe(sideBySideShown.length);
  });
});

// ★★ THE DISCLOSURE CONTRACT. `aria-expanded` alone is cheap and half-useless:
// it announces a state without saying what the state belongs to. The pair is
// what a screen-reader user navigates by, and both halves have a way of being
// silently wrong here — `aria-controls` pointing at an id that is not in the
// document (axe `aria-valid-attr-value`, tag wcag2a, so this one a scan COULD
// catch — but History is Turso-gated and absent from `A11Y_VIEWS`, so no scan
// ever reaches it), and `aria-expanded` on a row that has no panel to open.
describe("VersionDiffView disclosure semantics", () => {
  const expandable: VersionChange = {
    collection: "tasks", collectionLabel: "Tasks", kind: "list", recordId: 1,
    recordLabel: "Design sign-off", type: "modified",
    fields: [{ field: "title", label: "Title", before: "Old", after: "New" }],
  };
  const empty: VersionChange = {
    collection: "raid", collectionLabel: "RAID", kind: "list", recordId: 9,
    recordLabel: "Vendor delay", type: "removed", fields: [],
  };

  it("marks the disclosure expanded while it is open (a modified row starts open, §776)", () => {
    render(<VersionDiffView lang="en-US" changes={[expandable]} />);
    const btn = screen.getByRole("button", { name: /Design sign-off/ });
    expect(btn).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
  });

  // ★★★ THE COLLAPSED HALF IS THE POINT. `aria-controls` naming an id that is
  // not in the document is an axe `aria-valid-attr-value` failure (tag wcag2a),
  // and the panel is only rendered while open — so the attribute has to come
  // and go with it. Assert BOTH states or the pairing is unpinned in the
  // direction that actually breaks.
  it("names the panel in aria-controls only while it exists", () => {
    render(<VersionDiffView lang="en-US" changes={[expandable]} />);
    const btn = screen.getByRole("button", { name: /Design sign-off/ });
    // Starts open (§776); closed, the attribute goes; open again, it returns.
    fireEvent.click(btn);
    expect(btn).not.toHaveAttribute("aria-controls");
    fireEvent.click(btn);
    const id = btn.getAttribute("aria-controls");
    expect(id).toBeTruthy();
    // ★ `getElementById`, NOT `querySelector("#" + id)`. React 19.2 emits
    // `_r_l_`-style ids that happen to be selector-safe, but React 18 emitted
    // `:r0:` — a colon is a legal HTML id and an illegal bare CSS selector — and
    // nothing here pins the React major. `getElementById` takes the id
    // literally, so it is correct under either.
    expect(document.getElementById(id!)).not.toBeNull();
    // ...and it goes away again with the panel.
    fireEvent.click(btn);
    expect(btn).not.toHaveAttribute("aria-controls");
  });

  it("gives two simultaneously expanded rows distinct panel ids", () => {
    const row = (id: number): VersionChange => ({ ...expandable, recordId: id });
    render(<VersionDiffView lang="en-US" changes={[row(1), row(2)]} />);
    const btns = screen.getAllByRole("button");
    expect(btns).toHaveLength(2);
    // Both start open (§776).
    const ids = btns.map((b) => b.getAttribute("aria-controls"));
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(2);
    // Both ids resolve — a unique-but-dangling pair would pass the line above.
    for (const id of ids) expect(document.getElementById(id!)).not.toBeNull();
  });

  // ★★ A row with no field changes renders NO panel, so both attributes must be
  // absent. `aria-controls` would dangle; `aria-expanded="false"` would promise
  // a disclosure that the click handler (gated on `expandable`) never opens.
  // ★★★ THIS TEST PINS THE `aria-expanded` HALF ONLY, and the reason is worth
  // reading before trusting it. `aria-controls` is `expandable && open.has(k)`,
  // and a never-clicked row cannot be in `open` — so its assertion below passes
  // for a SECOND, independent reason and survives deleting the `expandable`
  // conjunct. It genuinely pinned that conjunct while the attribute was
  // `expandable ? … : undefined`; narrowing the attribute silently converted a
  // real assertion into a coincidental one. The next test supplies the input
  // that tells the two apart.
  it("puts neither attribute on a row that has no fields to disclose", () => {
    render(<VersionDiffView lang="en-US" changes={[empty]} />);
    const btn = screen.getByRole("button", { name: /Vendor delay/ });
    expect(btn).not.toHaveAttribute("aria-expanded");
    expect(btn).not.toHaveAttribute("aria-controls");
  });

  // ★★★ THE INPUT THE SUITE DID NOT HAVE. A surviving mutant is a QUESTION —
  // "equivalent mutant" and "missing test" look identical from the harness —
  // and here the answer is "missing test": dropping `expandable &&` from
  // `aria-controls` left the whole suite green, yet the conjunct is load-bearing
  // for a real input. `open` can hold a key whose row is no longer expandable
  // only if `changes` changes WITHOUT a remount. `HistoryPanel` makes that
  // impossible via `key={compareNonce}` — but this component is EXPORTED and
  // takes `changes` as a plain prop, so any other consumer re-rendering under a
  // stable key can reach it. The row then keeps `aria-controls` naming a panel
  // that the (still correct) `expandable && open.has(k)` render refuses to
  // produce: the dangling IDREF this whole design exists to prevent
  // (axe `aria-valid-attr-value`, wcag2a).
  it("drops aria-controls when an OPEN row loses its fields without a remount", () => {
    const withFields: VersionChange = { ...expandable, recordId: 7 };
    const { rerender } = render(<VersionDiffView lang="en-US" changes={[withFields]} />);
    const btn = screen.getByRole("button", { name: /Design sign-off/ });
    expect(btn).toHaveAttribute("aria-controls"); // starts open (§776)

    // Same recordId, so the same `changeKey` — the row stays in `open`.
    rerender(<VersionDiffView lang="en-US" changes={[{ ...withFields, fields: [] }]} />);
    expect(screen.getByRole("button", { name: /Design sign-off/ }))
      .not.toHaveAttribute("aria-controls");
    // ...and the panel really is gone, so a lingering attribute would dangle
    // rather than merely be redundant.
    expect(screen.queryByText(/Title:/)).toBeNull();
  });

  // ★★ The hint is the answer to "why is there no restore button on this row?",
  // and on a non-restorable row the disclosure button is the row's ONLY control
  // — so without the association a screen-reader user reaches the control and
  // never meets the explanation sitting beside it.
  it("describes a non-restorable row's control with the managed-per-document hint", () => {
    const doc: VersionChange = {
      collection: "documents", collectionLabel: "Documents", kind: "list",
      recordId: 1, recordLabel: "Q3 report", type: "modified",
      fields: [{ field: "title", label: "Title", before: "a", after: "b" }],
      restorable: false,
    };
    render(<VersionDiffView lang="en-US" changes={[doc]} selectable onRestoreRecord={() => {}} />);
    const btn = screen.getByRole("button", { name: /Q3 report/ });
    const describedBy = btn.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(/managed per document/i);
  });

  it("leaves a RESTORABLE row undescribed — it renders no hint to point at", () => {
    render(<VersionDiffView lang="en-US" changes={[expandable]} selectable onRestoreRecord={() => {}} />);
    // ★ Anchored on the TYPE prefix, not the bare record label: a restorable row
    // also renders a "Restore this – Design sign-off" button, so the loose
    // pattern matches two controls and throws.
    expect(screen.getByRole("button", { name: /^Modified/ }))
      .not.toHaveAttribute("aria-describedby");
  });

  // ★ The owner's ref guard is what makes a double restore impossible; this
  // prop is the affordance. Both matter, and only this half is testable here.
  it("disables the per-record restore button while a restore is running", () => {
    render(<VersionDiffView lang="en-US" changes={[expandable]} onRestoreRecord={() => {}} restoreBusy />);
    expect(screen.getByRole("button", { name: /Restore this/i })).toBeDisabled();
  });
});

// §102 (batch 23, owner decision 2026-10-09): the near-size buttons moved to the shared `xs`.
describe("VersionDiffView Restore this on the shared Button", () => {
  it("draws Restore this as secondary xs in both layouts", () => {
    const { unmount } = render(<VersionDiffView lang="en-US" changes={changes} layout="sideBySide" onRestoreRecord={() => {}} />);
    expect(screen.getByRole("button", { name: /^Restore this – Design sign-off/ }).className).toBe(
      buttonClassFor({ variant: "secondary", size: "xs", className: "shrink-0" }),
    );
    unmount();
    render(<VersionDiffView lang="en-US" changes={changes} onRestoreRecord={() => {}} />);
    expect(screen.getByRole("button", { name: /^Restore this – Design sign-off/ }).className).toBe(
      buttonClassFor({ variant: "secondary", size: "xs", className: "ml-2 shrink-0" }),
    );
  });
});
