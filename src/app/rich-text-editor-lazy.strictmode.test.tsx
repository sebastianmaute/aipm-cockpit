import { act, render, screen } from "@testing-library/react";
import { createRef, StrictMode, useCallback } from "react";
import { describe, it, expect, vi } from "vitest";
import { RichTextEditor, type RichTextEditorHandle } from "./rich-text-editor-lazy";

// ★★★ THE EDITOR IS MOCKED SO EVERY `appendText` IS OBSERVABLE, and that is the
// whole difference between this file and the one 0.250.0 deleted. That one
// rendered the REAL editor and asserted the final HTML — but `attach` returns
// early on an empty queue, so a second live attach produced byte-identical
// output whether the queue had been swapped out or not. It could not observe the
// condition it existed to guard. `docs/open-followups.md` §194 filed the
// replacement: assert the ORDERED CALL LOG instead, which counts flushes rather
// than looking at their result.
//
// ★ Shape: a callback ref on the mock's host element, returning a cleanup — the
//   React-19 equivalent of what `useImperativeHandle` does for the real editor
//   (hand the parent a handle on attach, null it on detach).
const mock = vi.hoisted(() => ({
  appendCalls: [] as { text: string; opts?: { focus?: boolean } }[],
  attachLog: [] as string[],
}));

vi.mock("./rich-text-editor", () => {
  // ★★ THE REF CALLBACK MUST BE STABLE, and this is about the PREMISE assertion at
  //   the bottom of the test, not about the mutant. React detaches and reattaches a
  //   callback ref whose IDENTITY changed, so an inline arrow here logs
  //   attach/detach/attach on ANY re-render — StrictMode or not. The premise would
  //   then go red on some unrelated extra render and read as "the double invoke
  //   stopped reaching this tree" when nothing about StrictMode had changed.
  //   Measured 2026-08-20, not assumed: unstabilised, one extra `rerender` with a
  //   fresh element takes the log from `attach, detach, attach` to `attach, detach,
  //   attach, detach, attach`; with this `useCallback` the same extra render adds
  //   NOTHING and the double invoke is still observed.
  // ★ `editorRef` is the wrapper's `attach`, which is itself a `useCallback`, so
  //   this dep does not defeat the memo.
  // ★ Declared as a named function rather than an arrow in the returned object so
  //   the hook lint recognises it as a component.
  function RichTextEditor({
    editorRef,
    label,
  }: {
    editorRef?: (h: { appendText: (t: string, o?: { focus?: boolean }) => boolean } | null) => void;
    label: string;
  }) {
    const attachRef = useCallback(() => {
      mock.attachLog.push("attach");
      editorRef?.({
        appendText: (text, opts) => {
          mock.appendCalls.push({ text, opts });
          return true;
        },
      });
      return () => {
        mock.attachLog.push("detach");
        editorRef?.(null);
      };
    }, [editorRef]);
    return <div role="textbox" aria-label={label} ref={attachRef} />;
  }
  return { RichTextEditor };
});

describe("the lazy editor's append queue under StrictMode", () => {
  // ★★★ TEST #1 IN THIS FILE, AND IT MUST STAY THAT WAY. Only the first test in a
  //   file gets an UNRESOLVED `dynamic()` import; any earlier test that awaits the
  //   editor resolves the chunk for the whole module, and this test then never
  //   queues anything. A second queue-dependent case needs its own file.
  // ★★★ StrictMode is supplied as `wrapper`, NOT composed inside one. Read
  //   `strictmode.meta.test.tsx` before changing that — it is the file that states
  //   the rule (the double invoke fires at the topmost fiber flagged for
  //   PLACEMENT, and only if StrictMode sits at or above it).
  // ★★ WHICH COROLLARY GOVERNS HERE IS **NOT** THE MOUNT-COMMIT ONE, and writing
  //   "a nested StrictMode would be vacuous" here would be a restatement that does
  //   not apply to this shape. The editor mounts on a LATER commit — the first
  //   commit renders `RichTextEditorFallback` because the `dynamic()` payload is
  //   still pending — so COROLLARY 2 is what fires: by then neither the wrapper nor
  //   StrictMode is placed, the walk recurses through both, and the newly mounted
  //   editor is double-invoked. Measured 2026-08-20, not reasoned: with the wrapper
  //   composed as `({children}) => <StrictMode>{children}</StrictMode>` the attach
  //   log below was STILL `attach, detach, attach`. `wrapper: StrictMode` is kept
  //   anyway because it satisfies both corollaries and cannot rot into the vacuous
  //   shape if this test is ever changed to mount the editor on the first commit.
  it("flushes a queued append exactly once across the double-attach", async () => {
    mock.appendCalls.length = 0;
    mock.attachLog.length = 0;
    const ref = createRef<RichTextEditorHandle>();
    render(
      <RichTextEditor
        value="<p>existing</p>"
        onChange={() => {}}
        label="Description"
        lang="en-US"
        editorRef={ref}
      />,
      { wrapper: StrictMode },
    );

    // The append must land in the QUEUE. If the chunk had already resolved the
    // handle would take the text directly and everything below would be vacuous.
    expect(screen.queryByRole("textbox", { name: "Description" })).toBeNull();
    act(() => {
      ref.current?.appendText("queued while loading");
    });
    expect(mock.appendCalls).toHaveLength(0);

    await screen.findByRole("textbox", { name: "Description" });

    // ★★★ THE ORDERED CALL LOG IS THE POINT. The deleted version of this file
    //   asserted final HTML, which `attach`'s early return on an empty queue makes
    //   identical whether the queue is flushed once or twice — so it could not
    //   observe the condition it existed to guard.
    // ★★ The mutant: delete `pending.current = []` from `attach` in
    //   `rich-text-editor-lazy.tsx`. The same queue then flushes on the second
    //   attach too and this array holds the text TWICE. That mutant dies ONLY under
    //   StrictMode — a single attach never re-enters — which is what makes the
    //   wrapper above load-bearing rather than decorative.
    // ★★ MEASURED 2026-08-20, both halves, because only the second one is evidence
    //   that the wrapper is doing the work. WITH the wrapper the mutant is RED here
    //   and nowhere else in the line: `expected [ 'queued while loading', …(1) ] to
    //   deeply equal [ 'queued while loading' ]`. WITHOUT it the mutant SURVIVES —
    //   the two assertions on this and the next line both PASS (the run then fails
    //   only on the harness-premise line below, which is a statement about the
    //   wrapper, not about the mutant; suppress that line and the run exits 0).
    expect(mock.appendCalls.map((c) => c.text)).toEqual(["queued while loading"]);
    expect(mock.appendCalls[0]?.opts).toEqual({ focus: false });

    // ★★★ THE HARNESS PREMISE, ASSERTED LAST ON PURPOSE. Everything above is
    //   equally green when StrictMode does nothing at all — one attach flushes once
    //   whether or not the queue was swapped — so without this line the test is the
    //   deleted one wearing a different assertion. It goes red the moment the
    //   double-invoke stops reaching this tree (a React change, a wrapper shape
    //   that silences it), which is the signal that the mutant above has stopped
    //   being killable here.
    // ★ Last rather than first so a red run stays diagnostic: vitest stops at the
    //   first failed assertion, so a failure HERE proves the two above passed.
    expect(mock.attachLog).toEqual(["attach", "detach", "attach"]);
  });
});
