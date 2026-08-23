import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DocumentsDeletedSection } from "./documents-deleted-section";
import type { DocVersion } from "./document-versions";

function version(over: Partial<DocVersion> = {}): DocVersion {
  return {
    id: 1,
    documentId: 1,
    title: "Plan",
    blocks: [],
    savedAt: "2026-08-01T09:00:00.000Z",
    source: "user",
    op: "delete",
    ...over,
  };
}

describe("DocumentsDeletedSection", () => {
  it("gives every Restore button a row-unique accessible name", () => {
    // Two tombstones sharing a title AND a timestamp -- the measured real-data
    // collision: two mutations in one tick share `savedAt`, two successive
    // `ops` writes share a title. Only the version id cannot collide.
    render(
      <DocumentsDeletedSection
        lang="en-US"
        deleted={[
          version({ id: 1, title: "Plan", savedAt: "2026-08-01T09:00:00.000Z" }),
          version({ id: 2, title: "Plan", savedAt: "2026-08-01T09:00:00.000Z" }),
        ]}
        documentCount={5}
        onRestore={vi.fn()}
      />,
    );
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(names.length);
  });

  it("cautions when more documents are deleted than survive, and never hides a row", () => {
    render(
      <DocumentsDeletedSection
        lang="en-US"
        deleted={[version({ id: 1 }), version({ id: 2 }), version({ id: 3 })]}
        documentCount={1}
        onRestore={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
    // Positive observable: the warning must not become a row cap. A user who
    // really did delete most of their documents must still be able to restore
    // them, so all three rows stay.
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("does not caution when the deleted count is plausible", () => {
    render(
      <DocumentsDeletedSection
        lang="en-US"
        deleted={[version({ id: 1 })]}
        documentCount={5}
        onRestore={vi.fn()}
      />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("calls onRestore with the version id, not the document id", () => {
    const onRestore = vi.fn();
    render(
      <DocumentsDeletedSection
        lang="en-US"
        deleted={[version({ id: 42, documentId: 7 })]}
        documentCount={5}
        onRestore={onRestore}
      />,
    );
    screen.getByRole("button").click();
    expect(onRestore).toHaveBeenCalledWith(42);
  });
});
