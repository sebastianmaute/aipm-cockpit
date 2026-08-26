import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VersionDiffView } from "./version-diff-view";
import type { VersionChange } from "./version-diff";
import { changeKey } from "./version-restore";
import { expectRowUniqueNames } from "../test/row-unique-names";

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
  it("reveals field before/after when a modified record is expanded", () => {
    render(<VersionDiffView lang="en-US" changes={changes} />);
    fireEvent.click(screen.getByText("Design sign-off"));
    expect(screen.getByText(/Old/)).toBeInTheDocument();
    expect(screen.getByText(/New/)).toBeInTheDocument();
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
    // ★ NOT `expectRowUniqueNames({roles:["button"]})` here: the inline layout's
    // per-row DISCLOSURE button takes its name from the row's own content, so two
    // same-named records collide there too — a THIRD, pre-existing defect this
    // change does not close (reported, not silently in scope). Asserting the two
    // restore names directly pins what this change DOES fix without the
    // whole-document helper tripping over the disclosure buttons. The sideBySide
    // test below runs the real helper, in a branch with no other buttons.
    expect(screen.getByRole("button", { name: "Restore this – Q3 report (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore this – Q3 report (2)" })).toBeInTheDocument();
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
});
