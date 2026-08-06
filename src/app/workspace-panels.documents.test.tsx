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

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { lazy, Suspense, type ComponentType } from "react";

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

  it("passes the live workspace as `ws` and threads documents + setDocuments", async () => {
    // `ws` feeds dataSection resolution in the preview; `documents`/`setDocuments`
    // are the state seam. A prop threaded but never passed is the mirror image
    // of the isReadOnly bug.
    renderTab(false);
    await screen.findByTestId("documents-panel-stub");
    const props = seen.at(-1)!;
    expect(Array.isArray(props.documents)).toBe(true);
    expect(typeof props.setDocuments).toBe("function");
    // Structurally a Workspace: the required collections must be present, or the
    // preview silently renders empty dataSections.
    expect(props.ws).toMatchObject({
      tasks: expect.any(Array),
      raid: expect.any(Array),
      resources: expect.any(Array),
    });
  });
});
