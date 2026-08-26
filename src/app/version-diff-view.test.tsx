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
    expect(screen.getByText(/Title:/)).toBeInTheDocument(); // the row really expanded
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
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
