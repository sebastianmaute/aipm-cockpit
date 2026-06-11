import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VersionDiffView } from "./version-diff-view";
import type { VersionChange } from "./version-diff";

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
});
