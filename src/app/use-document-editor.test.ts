import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDocumentEditor } from "./use-document-editor";
import type { DocMutation, DocResult } from "./document-mutations";
import type { DocVersion } from "./document-versions";

const NOW = "2026-08-18T10:00:00.000Z";

function result(): DocResult {
  return { documents: [], versions: [], changed: true, rejected: [], documentId: 1, minted: null };
}

// ★ Lint watch (see the plan's T8 note): CI runs `eslint --max-warnings=0`
//  with no `argsIgnorePattern`, so a named-but-unused `(_m)` param is fatal.
//  Typed explicitly via the generic instead, so `.mock.calls[0][0]` keeps its
//  real tuple shape without the callback needing to name the arg.
function mockMutate() {
  return vi.fn<(m: DocMutation) => DocResult>(() => result());
}

describe("useDocumentEditor — the document-switch guard", () => {
  // ★★★ THE ONLY TEST THAT CAN KILL THIS GUARD. At the panel level the block
  //  editor's unmount CLEANUP runs before the parent's [documentId] effect, so
  //  `currentDocIdRef` still holds the OLD id and the guard never fires — the
  //  panel test passes with the guard deleted. Driving the hook directly is
  //  what makes a genuinely STALE commitBlock closure reachable: capture it for
  //  document 1, rerender at document 2 (letting the effect run), then call the
  //  closure that document 1 minted.
  it("abandons a commit from a closure minted for a document that is no longer selected", () => {
    const mutateDocuments = mockMutate();
    const { result: hook, rerender } = renderHook(
      ({ documentId }: { documentId: number }) =>
        useDocumentEditor({ documentId, versions: [], mutateDocuments, now: () => NOW }),
      { initialProps: { documentId: 1 } },
    );
    const staleCommit = hook.current.commitBlock;

    rerender({ documentId: 2 });

    expect(staleCommit(0, { type: "heading", level: 1, text: "x" })).toBeUndefined();
    expect(mutateDocuments).not.toHaveBeenCalled();
  });

  it("commits normally through a closure minted for the selected document", () => {
    const mutateDocuments = mockMutate();
    const { result: hook } = renderHook(() =>
      useDocumentEditor({ documentId: 1, versions: [], mutateDocuments, now: () => NOW }),
    );
    hook.current.commitBlock(0, { type: "heading", level: 1, text: "x" });
    expect(mutateDocuments).toHaveBeenCalledTimes(1);
    expect(mutateDocuments.mock.calls[0][0]).toMatchObject({ kind: "ops", id: 1 });
  });
});

// ★★★ THE COALESCING-ANCHOR GUARD — `if (result.minted) lastMintedRef.current =
//  result.minted;` (use-document-editor.ts). Both tests below drive the SAME
//  source line: a null-minted RESULT (whether the write coalesced or was
//  refused outright) must leave a previously-set anchor exactly where it is,
//  never null it out. `DocResult.minted` is `null` in BOTH cases — a coalesced
//  write mints nothing on purpose, and `unchanged()` (document-mutations.ts)
//  always returns `minted: null` on a refusal — so an unconditional assignment
//  breaks both scenarios identically. They are kept as two tests because they
//  are two DIFFERENT reachable production paths (an ordinary coalescing run,
//  vs. a concurrent-writer refusal — a deleted document or a block-delete
//  making the replace index out of range), not because the guard differs.
//
//  ★ Two calls cannot express this: the assertion has to be about a call whose
//  `coalesce` argument is computed from state a PRIOR call left behind. Call 1
//  mints a real anchor; call 2 is the null-minted write under test; call 3 is
//  the observation, and it only sees `coalesce:true` if call 2 left the anchor
//  alone (shouldCoalesce refuses outright the moment `anchor` is null).
describe("useDocumentEditor — the coalescing anchor survives a null-minted result", () => {
  const V_ANCHOR: DocVersion = {
    id: 42,
    documentId: 1,
    title: "d",
    blocks: [],
    savedAt: NOW,
    source: "user",
    op: "update",
  };

  function mintingResult(): DocResult {
    return {
      documents: [],
      versions: [V_ANCHOR],
      changed: true,
      rejected: [],
      documentId: 1,
      minted: { id: 42, savedAt: NOW },
    };
  }

  it("keeps the anchor after a COALESCED write that mints nothing", () => {
    const versions = [V_ANCHOR];
    const mutateDocuments = vi.fn<(m: DocMutation) => DocResult>();
    mutateDocuments.mockReturnValueOnce(mintingResult());
    mutateDocuments.mockReturnValueOnce({
      documents: [],
      versions,
      changed: true,
      rejected: [],
      documentId: 1,
      minted: null,
    });
    mutateDocuments.mockReturnValueOnce({
      documents: [],
      versions,
      changed: true,
      rejected: [],
      documentId: 1,
      minted: null,
    });
    const { result: hook } = renderHook(() =>
      useDocumentEditor({ documentId: 1, versions, mutateDocuments, now: () => NOW }),
    );

    hook.current.commitBlock(0, { type: "heading", level: 1, text: "a" }); // mints the anchor
    hook.current.commitBlock(0, { type: "heading", level: 1, text: "b" }); // coalesced, mints nothing
    hook.current.commitBlock(0, { type: "heading", level: 1, text: "c" }); // observes the anchor

    expect(mutateDocuments.mock.calls[2][0]).toMatchObject({ coalesce: true });
  });

  it("keeps the anchor after a REFUSED commit (same guard, the other reachable path)", () => {
    const versions = [V_ANCHOR];
    const mutateDocuments = vi.fn<(m: DocMutation) => DocResult>();
    mutateDocuments.mockReturnValueOnce(mintingResult());
    mutateDocuments.mockReturnValueOnce({
      documents: [],
      versions,
      changed: false,
      rejected: ["document #1 not found"],
      documentId: null,
      minted: null,
    });
    mutateDocuments.mockReturnValueOnce({
      documents: [],
      versions,
      changed: true,
      rejected: [],
      documentId: 1,
      minted: null,
    });
    const { result: hook } = renderHook(() =>
      useDocumentEditor({ documentId: 1, versions, mutateDocuments, now: () => NOW }),
    );

    hook.current.commitBlock(0, { type: "heading", level: 1, text: "a" }); // mints the anchor
    hook.current.commitBlock(0, { type: "heading", level: 1, text: "b" }); // refused by a concurrent writer
    hook.current.commitBlock(0, { type: "heading", level: 1, text: "c" }); // observes the anchor

    expect(mutateDocuments.mock.calls[2][0]).toMatchObject({ coalesce: true });
  });
});

// ★★★ `structuralOp`'s OWN anchor advance. Its
//  `if (result.minted) lastMintedRef.current = result.minted;` is the same line
//  `commitBlock` carries, and the module-level `mockMutate` hardcodes
//  `minted: null` — so any test using THAT mock drives the FALSE arm only, and a
//  structural op could advance no anchor at all while the file stayed green.
//  ★★ TWO tests reach the TRUE arm, not one, and an earlier revision of this
//   line said "which nothing else reaches". The other is "emits a move carrying
//   the coalesce decision, and folds a run of them" further down, whose second
//   move can only decide `coalesce: true` because this assignment ran on the
//   first. Both mock a real `minted` pair; neither uses `mockMutate`.
//
//  It matters because an `insert` deliberately mints a before-image
//  unconditionally (no `coalesce` field), and the typing that follows is meant
//  to FOLD INTO that version rather than mint a second one capturing a
//  half-written placeholder. Without the advance the next edit sees a null
//  anchor, refuses to coalesce, and spends a second of the document's
//  MAX_VERSIONS_PER_DOC (20) slots.
//
//  ★ This used to drive `appendBlock`, which was removed with the `onAppendBlock`
//   prop: the empty state now routes through `structural.insert(0, …)`, which is
//   equivalent on a list with no positions and cannot be dropped without a tsc
//   error. The line under test is the same one.
describe("useDocumentEditor — a structural insert becomes the coalescing anchor", () => {
  const V: DocVersion = {
    id: 7,
    documentId: 1,
    title: "d",
    blocks: [],
    savedAt: NOW,
    source: "user",
    op: "update",
  };

  it("folds the edit that follows an insert into the insert's own version", () => {
    const versions = [V];
    const mutateDocuments = vi.fn<(m: DocMutation) => DocResult>(() => ({
      documents: [],
      versions,
      changed: true,
      rejected: [],
      documentId: 1,
      minted: { id: 7, savedAt: NOW },
    }));
    const { result: hook } = renderHook(() =>
      useDocumentEditor({ documentId: 1, versions, mutateDocuments, now: () => NOW }),
    );

    hook.current.structural.insert(0, { type: "paragraph", html: "<p>new</p>" });
    // ★ The insert itself must carry NO coalesce field — it changes what the
    //  document CONTAINS and its before-image is the pre-insert state.
    expect(mutateDocuments.mock.calls[0][0]).not.toHaveProperty("coalesce");

    hook.current.commitBlock(0, { type: "heading", level: 1, text: "typed after" });
    expect(mutateDocuments.mock.calls[1][0]).toMatchObject({ coalesce: true });
  });
});

// ★★★ THE COALESCE SPLIT, and it is a SPLIT — an earlier revision of this file
//  asserted the omission for all THREE structural ops, which was the defect:
//  document-mutations.ts reads `m.coalesce ? undefined : snapshot(...)`, so
//  `insert` and `remove` omitting the field records a before-image per op,
//  which is right (either changes what the document CONTAINS). `move` doing the
//  same burned one of MAX_VERSIONS_PER_DOC (20) slots PER ARROW-KEY PRESS —
//  and the keyboard path moves a block one position at a time — so walking a
//  block up from position 12 evicted the pre-session before-image and every
//  AI-authored version with it, with no undo anywhere in documents.
//  See `structuralOp`'s comment in use-document-editor.ts.
describe("useDocumentEditor — structural ops", () => {
  it("emits an insert with no coalesce flag", () => {
    const mutateDocuments = mockMutate();
    const { result: hook } = renderHook(() =>
      useDocumentEditor({ documentId: 1, versions: [], mutateDocuments, now: () => NOW }),
    );
    hook.current.structural.insert(0, { type: "paragraph", html: "<p>seed</p>" });
    const sent = mutateDocuments.mock.calls[0][0];
    expect(sent).toMatchObject({ kind: "ops", id: 1, ops: [{ op: "insert" }] });
    expect(sent).not.toHaveProperty("coalesce");
  });

  it("emits a remove with no coalesce flag", () => {
    const mutateDocuments = mockMutate();
    const { result: hook } = renderHook(() =>
      useDocumentEditor({ documentId: 1, versions: [], mutateDocuments, now: () => NOW }),
    );
    hook.current.structural.remove(0);
    const sent = mutateDocuments.mock.calls[0][0];
    expect(sent).toMatchObject({ kind: "ops", id: 1, ops: [{ op: "delete" }] });
    expect(sent).not.toHaveProperty("coalesce");
  });

  // ★★★ THE ONE OP THAT CARRIES THE FIELD. A reorder loses no content and its
  //  inverse is another reorder, so a RUN of presses must fold into one
  //  before-image. Both directions are asserted from ONE fixture: the first
  //  move has no anchor yet and so decides `false`, and — because this mock
  //  returns a real `minted` pair (unlike the module-level `mockMutate`) — it
  //  becomes the run's anchor, so the second move decides `true`.
  //  ★ `toMatchObject({ coalesce: false })` is the assertion that kills the
  //   revert: dropping the `true` argument at the `move` call site makes
  //   `structuralOp` OMIT the field, and a missing key reads as `undefined`,
  //   which matches neither branch. `not.toHaveProperty` alone would pass.
  it("emits a move carrying the coalesce decision, and folds a run of them", () => {
    const versions: DocVersion[] = [
      { id: 9, documentId: 1, title: "d", blocks: [], savedAt: NOW, source: "user", op: "update" },
    ];
    const mutateDocuments = vi.fn<(m: DocMutation) => DocResult>(() => ({
      documents: [],
      versions,
      changed: true,
      rejected: [],
      documentId: 1,
      minted: { id: 9, savedAt: NOW },
    }));
    const { result: hook } = renderHook(() =>
      useDocumentEditor({ documentId: 1, versions, mutateDocuments, now: () => NOW }),
    );

    hook.current.structural.move(0, 1);
    expect(mutateDocuments.mock.calls[0][0]).toMatchObject({
      kind: "ops",
      id: 1,
      ops: [{ op: "move" }],
      coalesce: false,
    });

    hook.current.structural.move(1, 2);
    expect(mutateDocuments.mock.calls[1][0]).toMatchObject({ ops: [{ op: "move" }], coalesce: true });

    // ★ The other two stay OUT of the run in the SAME fixture — with an anchor
    //  now set and the window open, an `insert`/`remove` that had been wired
    //  the same way would come back `coalesce: true` here.
    hook.current.structural.insert(0, { type: "paragraph", html: "<p>x</p>" });
    expect(mutateDocuments.mock.calls[2][0]).not.toHaveProperty("coalesce");
    hook.current.structural.remove(0);
    expect(mutateDocuments.mock.calls[3][0]).not.toHaveProperty("coalesce");
  });

  // Same guard as commitBlock: a closure minted for a document
  // that is no longer selected must abandon rather than land on whichever is
  // selected now.
  it("abandons a structural op from a closure minted for a document that is no longer selected", () => {
    const mutateDocuments = mockMutate();
    const { result: hook, rerender } = renderHook(
      ({ documentId }: { documentId: number }) =>
        useDocumentEditor({ documentId, versions: [], mutateDocuments, now: () => NOW }),
      { initialProps: { documentId: 1 } },
    );
    const staleStructural = hook.current.structural;
    rerender({ documentId: 2 });
    expect(staleStructural.insert(0, { type: "paragraph", html: "<p>seed</p>" })).toBeUndefined();
    expect(mutateDocuments).not.toHaveBeenCalled();
  });
});
