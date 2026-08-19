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

describe("useDocumentEditor — appendBlock", () => {
  // ★★★ AN APPEND NEVER COALESCES INTO A PRECEDING RUN. Creating a block is a
  //  structural change and the pre-append state is what a user reverting an
  //  accidental add wants back, so the mutation carries NO coalesce field and
  //  document-mutations.ts writes the before-image unconditionally.
  it("emits an append with no coalesce flag", () => {
    const mutateDocuments = mockMutate();
    const { result: hook } = renderHook(() =>
      useDocumentEditor({ documentId: 1, versions: [], mutateDocuments, now: () => NOW }),
    );
    hook.current.appendBlock({ type: "paragraph", html: "<p>seed</p>" });
    const sent = mutateDocuments.mock.calls[0][0];
    expect(sent).toMatchObject({ kind: "ops", id: 1, ops: [{ op: "append" }] });
    expect(sent).not.toHaveProperty("coalesce");
  });

  // Same guard as commitBlock: a closure minted for a document that is no
  // longer selected must abandon rather than land on whichever is selected now.
  it("abandons an append from a closure minted for a document that is no longer selected", () => {
    const mutateDocuments = mockMutate();
    const { result: hook, rerender } = renderHook(
      ({ documentId }: { documentId: number }) =>
        useDocumentEditor({ documentId, versions: [], mutateDocuments, now: () => NOW }),
      { initialProps: { documentId: 1 } },
    );
    const staleAppend = hook.current.appendBlock;
    rerender({ documentId: 2 });
    expect(staleAppend({ type: "paragraph", html: "<p>seed</p>" })).toBeUndefined();
    expect(mutateDocuments).not.toHaveBeenCalled();
  });
});

// ★★★ `appendBlock`'s OWN anchor advance, which nothing reached. Its
//  `if (result.minted) lastMintedRef.current = result.minted;` is the same line
//  `commitBlock` carries, but the module-level `mockMutate` hardcodes
//  `minted: null`, so every existing test drove the FALSE arm only — the append
//  could have advanced no anchor at all and the file stayed green.
//
//  It matters because an append deliberately mints a before-image
//  unconditionally (no `coalesce` field), and the typing that follows is meant
//  to FOLD INTO that version rather than mint a second one capturing a
//  half-written placeholder. Without the advance the next edit sees a null
//  anchor, refuses to coalesce, and spends a second of the document's
//  MAX_VERSIONS_PER_DOC (20) slots.
describe("useDocumentEditor — an append becomes the coalescing anchor", () => {
  const V: DocVersion = {
    id: 7,
    documentId: 1,
    title: "d",
    blocks: [],
    savedAt: NOW,
    source: "user",
    op: "update",
  };

  it("folds the edit that follows an append into the append's own version", () => {
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

    hook.current.appendBlock({ type: "paragraph", html: "<p>new</p>" });
    // ★ The append itself must carry NO coalesce field — it is a structural
    //  change and its before-image is the pre-append state.
    expect(mutateDocuments.mock.calls[0][0]).not.toHaveProperty("coalesce");

    hook.current.commitBlock(0, { type: "heading", level: 1, text: "typed after" });
    expect(mutateDocuments.mock.calls[1][0]).toMatchObject({ coalesce: true });
  });
});
