import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VersionDiffView } from "./version-diff-view";
import { diffWorkspaces, type VersionChange } from "./version-diff";
import { changeKey } from "./version-restore";
import { expectRowUniqueNames } from "../test/row-unique-names";
import { ws, roleRec, disciplineRec, gradeRec } from "../test/workspace-records";

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
  // ★★ THE BEFORE-CLICK ASSERTION IS THE LOAD-BEARING ONE. Without it this test
  // passes with `toggle()` deleted, because it only ever looks after the click.
  // It survived a round trip through a `hidden`-toggled panel (where it had to
  // be `not.toBeVisible()`); the panel is conditionally rendered again, so
  // absence is the right claim — but keep SOME before-click assertion whichever
  // shape the panel takes.
  it("reveals field before/after when a modified record is expanded", () => {
    render(<VersionDiffView lang="en-US" changes={changes} />);
    expect(screen.queryByText(/Old/)).toBeNull();
    fireEvent.click(screen.getByText("Design sign-off"));
    expect(screen.getByText(/Old/)).toBeVisible();
    expect(screen.getByText(/New/)).toBeVisible();
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
    // worse than either alone.
    fireEvent.click(screen.getByText("Q3 report"));
    expect(screen.getByText(/Title:/)).toBeVisible(); // the row really expanded
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

  // ★★★ `aria-hidden="true"` ON THE TYPE BADGE IS LOAD-BEARING FOR WCAG 2.5.3,
  // and nothing pinned it — the code comment beside it reads as protection and
  // stops the audit, which is exactly the false-coverage shape. Deleting the
  // attribute leaves every accessible name untouched (the aria-label wins), so
  // every other test in this file stays GREEN while a colliding row breaks 2.5.3:
  // the visible label becomes "Q3 report Modified" while the name is
  // "Modified – Q3 report (1)", and the visible text is then no longer contained
  // in the name. Assert the PROPERTY (containment over visible text, with
  // aria-hidden subtrees removed as axe does), not the attribute — an attribute
  // check passes for a name shape that violates the criterion anyway.
  it("keeps each row's visible label contained in its accessible name (WCAG 2.5.3)", () => {
    const changes: VersionChange[] = [1, 2].map((id) => ({
      collection: "documents", collectionLabel: "Documents", kind: "list" as const,
      recordId: id, recordLabel: "Q3 report", type: "modified" as const,
      fields: [{ field: "title", label: "Title", before: "a", after: "b" }],
      restorable: false as const,
    }));
    render(<VersionDiffView lang="en-US" changes={changes} selectable selection={{}}
      onToggleRecord={() => {}} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    for (const btn of buttons) {
      const clone = btn.cloneNode(true) as HTMLElement;
      for (const hidden of clone.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
      const visible = (clone.textContent ?? "").trim();
      const name = btn.getAttribute("aria-label") ?? "";
      expect(visible).not.toBe(""); // a vacuous pass if the row rendered no text
      // 2.5.3 is containment, case-INSENSITIVE and position-independent.
      expect(name.toLowerCase()).toContain(visible.toLowerCase());
    }
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
    fireEvent.click(screen.getByText("Alpha"));
    fireEvent.click(screen.getByText("Beta"));
    // Both really expanded: 2 record checkboxes + 2 field checkboxes.
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

  it("marks the disclosure expanded only once it is open", () => {
    render(<VersionDiffView lang="en-US" changes={[expandable]} />);
    const btn = screen.getByRole("button", { name: /Design sign-off/ });
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
    btns.forEach((b) => fireEvent.click(b));
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
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-controls");

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
