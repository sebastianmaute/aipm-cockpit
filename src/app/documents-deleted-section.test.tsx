// Component-level cover for the section extracted out of documents-panel.tsx.
//
// ★★★ THESE TWO PROPERTIES WERE ALREADY PINNED, AND MUTATION-PROVED, IN
// `documents-panel.test.tsx` BEFORE THE EXTRACTION — read that file before
// assuming anything here is the only detector. The commit that added this file
// claimed it "adds the tests axe cannot provide"; that was wrong, and a cold
// review caught it. What this file actually buys is a direct mount of the
// component now that it is a module of its own, without the panel's provider
// stack. It is the WEAKER of the two — the panel suite also pins the equality
// boundary (1 live / 1 tombstone), which nothing here reaches, so a
// `>` -> `>=` mutant survives this file alone.
//
// ★★ Both files exist because axe has NO rule that flags two controls sharing
// an accessible name, in any view at any seed size. Documents IS scanned and
// the gate is silent on it regardless.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DocumentsDeletedSection } from "./documents-deleted-section";
import type { DocVersion } from "./document-versions";
import { expectRowUniqueNames } from "../test/row-unique-names";

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
    // ★★ The absolute count FIRST. A Set-size-vs-length assertion is a relative
    // one: with a single row rendered it reduces to 1 === 1, and with every
    // aria-label null it would reduce to 1 === 2 only by luck of the nulls
    // differing. Assert the fixture actually produced two rows before comparing.
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(names.length);
    expectRowUniqueNames({ minRows: 2 });
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
    // ★ A POSITIVE observable in the same test, so this cannot pass against a
    // caution that never renders under any conditions: the section IS shown and
    // its row IS there, only the caution is absent.
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
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
