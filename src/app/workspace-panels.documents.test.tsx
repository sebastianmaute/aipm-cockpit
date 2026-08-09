// src/app/workspace-panels.documents.test.tsx
//
// ★★★ WIRING-level guard for `DocumentsTabPanel`. It exists because the panel's
// OWN tests structurally cannot catch the bug it guards: they render
// `DocumentsPanel` directly and pass `isReadOnly` themselves, so an
// unpassed prop at the CALL SITE is invisible to every one of them. That is
// exactly how this repo shipped an Escape-dismissal a11y fix that was correct,
// tested, and completely inert because the call site never enabled it.
//
// So this asserts on WHAT THE CALL SITE PASSES, by stubbing the panel and
// recording its props. `next/dynamic` is stubbed too: the real one resolves
// asynchronously and `ssr:false` means it never renders in jsdom, which is why
// no existing test in this repo asserts a lazy panel's content.

import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { lazy, Suspense, type ComponentType } from "react";
import type { DocMutation, DocResult } from "./document-mutations";
import type { DocVersionSource } from "./document-versions";

// Stand `dynamic()` up as React.lazy + Suspense.
// ★★ The loader MUST stay deferred until render. An eager `loader()` here runs
// EVERY panel's import in workspace-panels.tsx — chat-panel and friends — whose
// promises then settle after the environment is torn down, producing
// `EnvironmentTeardownError` unhandled rejections. Those do not fail any test:
// the run reports "4 passed" and still exits 1 ("Errors 2 errors"), which is
// the green-tests-failing-run shape this repo has hit before. React.lazy defers
// the import to first render, so only the panel under test loads.
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<ComponentType<Record<string, unknown>>>) => {
    const Lazy = lazy(() => loader().then((m) => ({ default: m })));
    return function Dyn(props: Record<string, unknown>) {
      return (
        <Suspense fallback={null}>
          <Lazy {...props} />
        </Suspense>
      );
    };
  },
}));

/** ★ The pane's own key. NOT `aipm-cockpit:documents-size-full`, which belongs
 *  to knowledge-panel.tsx — that feature was called "Documents" before the
 *  Knowledge rename, so the near-miss is easy to write and impossible to see. */
const SIZE_KEY = "aipm-cockpit:documents-pane-size";

const seen: Record<string, unknown>[] = [];
vi.mock("./documents-panel", () => ({
  DocumentsPanel: (props: Record<string, unknown>) => {
    seen.push(props);
    return <div data-testid="documents-panel-stub" />;
  },
}));

import { DocumentsTabPanel } from "./workspace-panels";
import { WorkspaceProvider } from "./workspace-context";
import { FiltersProvider } from "./filters-context";

function renderTab(isPopout: boolean) {
  seen.length = 0;
  // `test:shuffle` reorders tests within a file, so the size key one case
  // seeds must not leak into the next.
  window.localStorage.removeItem(SIZE_KEY);
  return render(
    <FiltersProvider>
      <WorkspaceProvider>
        <DocumentsTabPanel className="c" lang="en-US" isPopout={isPopout} />
      </WorkspaceProvider>
    </FiltersProvider>,
  );
}

describe("DocumentsTabPanel — call-site wiring", () => {
  it("renders the documents tabpanel container", async () => {
    renderTab(false);
    expect(await screen.findByTestId("documents-panel-stub")).toBeInTheDocument();
    expect(document.getElementById("panel-documents")).toHaveAttribute("role", "tabpanel");
  });

  it("passes isReadOnly=true in a POPOUT — the guard is live, not merely present", async () => {
    // ★ Drop `isReadOnly={isPopout}` at the call site and this fails. Nothing in
    // documents-panel.test.tsx can, because it supplies the prop itself.
    renderTab(true);
    await screen.findByTestId("documents-panel-stub");
    expect(seen.at(-1)).toMatchObject({ isReadOnly: true });
  });

  it("passes isReadOnly=false in the main window", async () => {
    // The control: without it, hard-coding `isReadOnly` to a constant `true`
    // would satisfy the test above while disabling the main window entirely.
    renderTab(false);
    await screen.findByTestId("documents-panel-stub");
    expect(seen.at(-1)).toMatchObject({ isReadOnly: false });
  });

  it("passes a REAL onResetSize — the reset-size control is not a false affordance", async () => {
    // ★★ The toolbar has always drawn a reset-size button. The prop was
    // optional, the panel fell back to `onResetSize ?? (() => {})`, and this
    // call site never passed it — so the control was inert twice over. Nothing
    // in documents-panel.test.tsx can catch that: it supplies the prop itself.
    //
    // ★★★ ASSERT WHAT IT DOES, NOT ITS TYPE. The prop is required now, so tsc
    // already rejects an omission — and `typeof … === "function"` adds nothing
    // beyond tsc, because the cheapest way to satisfy a required prop is the
    // very `() => {}` placeholder this defect consisted of. Driving the handler
    // and checking the persisted size is gone is the only assertion a
    // placeholder fails.
    renderTab(false);
    await screen.findByTestId("documents-panel-stub");
    // Seeded AFTER the render: `renderTab` clears the key so no case leaks into
    // another under `test:shuffle`, and the handler's contract is to clear the
    // persisted size whenever it is called — not only at mount.
    window.localStorage.setItem(SIZE_KEY, JSON.stringify({ width: 900, height: 400 }));
    (seen.at(-1)!.onResetSize as () => void)();
    expect(window.localStorage.getItem(SIZE_KEY)).toBeNull();
  });

  it("renders the resizable pane the reset control resets", async () => {
    // ★ The other half. A handler with nothing resizable behind it still does
    // nothing — `useResizable`'s reset clears inline width/height on the
    // element its ref is attached to, so that element has to exist and carry
    // the `resize` affordance. Asserted on the rendered class rather than the
    // constant's full text so it survives an unrelated token being added.
    renderTab(false);
    await screen.findByTestId("documents-panel-stub");
    const pane = document.getElementById("panel-documents")!.firstElementChild;
    expect(pane).not.toBeNull();
    expect(pane!.className).toContain("resize");
  });

  it("passes the live workspace as `ws` and threads documents + mutateDocuments", async () => {
    // `ws` feeds dataSection resolution in the preview; `documents`/
    // `mutateDocuments` are the state seam. A prop threaded but never passed is
    // the mirror image of the isReadOnly bug.
    //
    // ★★★ DRIVE IT, DON'T TYPE-CHECK IT. `typeof … === "function"` is what the
    // `setDocuments` version of this case asserted, and it is satisfied by the
    // cheapest possible wrong answer: a `() => {}` placeholder, or a locally
    // built stand-in that writes `documents` and forgets `documentVersions` —
    // exactly the half-implemented mutation path this prop exists to prevent.
    // Calling it and watching the pane's own `documents` prop grow on the next
    // render is the assertion a placeholder fails.
    renderTab(false);
    await screen.findByTestId("documents-panel-stub");
    const props = seen.at(-1)!;
    expect(Array.isArray(props.documents)).toBe(true);
    expect(props.documents).toHaveLength(0);
    // Structurally a Workspace: the required collections must be present, or the
    // preview silently renders empty dataSections.
    expect(props.ws).toMatchObject({
      tasks: expect.any(Array),
      raid: expect.any(Array),
      resources: expect.any(Array),
    });

    const mutate = props.mutateDocuments as (m: DocMutation, s: DocVersionSource) => DocResult;
    expect(typeof mutate).toBe("function");
    // ★ A holder object, not a `let`: TS narrows a `let` assigned only inside a
    // callback back to its initialiser, so `result!.changed` would be an error
    // on `never`. A property's DECLARED type survives the same flow analysis.
    const captured: { result?: DocResult } = {};
    act(() => {
      captured.result = mutate({ kind: "create", title: "Wired" }, "user");
    });
    expect(captured.result?.changed).toBe(true);
    await waitFor(() =>
      expect(seen.at(-1)!.documents).toEqual([expect.objectContaining({ title: "Wired" })]),
    );
  });

  it("threads LIVE documentVersions, not a placeholder", async () => {
    // ★★★ SAME BAR AS THE CASE ABOVE — drive it, don't type-check it. The
    // history modal is fed entirely by this prop, and the two cheapest wrong
    // answers both satisfy tsc and any shape assertion: a literal `[]`, or
    // `ws.documents`-shaped stand-in. Both would render an empty history
    // forever while every other test stayed green, which is precisely the
    // failure mode that made this a prop rather than a read off `ws` (the
    // pane's own live harness passes a static `emptyWorkspace()` as `ws`).
    //
    // So: mutate twice through the seam and watch the BEFORE-IMAGE arrive. A
    // create writes no version (nothing was replaced); the rename that follows
    // writes exactly one, carrying the PRE-rename title.
    renderTab(false);
    await screen.findByTestId("documents-panel-stub");
    const mutate = seen.at(-1)!.mutateDocuments as (
      m: DocMutation,
      s: DocVersionSource,
    ) => DocResult;

    expect(seen.at(-1)!.documentVersions).toEqual([]);

    const captured: { result?: DocResult } = {};
    act(() => {
      captured.result = mutate({ kind: "create", title: "Before" }, "user");
    });
    const id = captured.result?.documentId;
    expect(typeof id).toBe("number");
    // Still empty: a create replaces nothing, so it snapshots nothing. This
    // also proves the assertion below is not passing on a prop that simply
    // mirrors `documents`.
    await waitFor(() => expect(seen.at(-1)!.documents).toHaveLength(1));
    expect(seen.at(-1)!.documentVersions).toEqual([]);

    act(() => {
      mutate({ kind: "rename", id: id as number, title: "After" }, "user");
    });

    await waitFor(() =>
      expect(seen.at(-1)!.documentVersions).toEqual([
        expect.objectContaining({ title: "Before", op: "rename", source: "user" }),
      ]),
    );
  });
});
