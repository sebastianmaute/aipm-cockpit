import { act, render } from "@testing-library/react";
import { createRef, useEffect } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { clearDiagLog, readDiagLog } from "./diagnostics";
import { QUEUE_STALL_MS, RichTextEditor, type RichTextEditorHandle } from "./rich-text-editor-lazy";

// ★★★ THE EDITOR IS STUBBED SO ITS HANDLE CAN REFUSE ON DEMAND, which is the one
// state the real editor cannot be put into from a test. It matters because
// `appendText` returning FALSE is not an error path — it is the NORMAL first
// attach: `useImperativeHandle` in the real module has deps `[editor]` and
// `editor` is null on the first render, so React attaches a DEAD handle, and
// that dead handle refuses everything.
//
// What that reaches, and nothing else in the family does: the flush's decision of
// whether to DISARM the stall timer. With a real editor every flush succeeds, the
// queue always ends empty, and the condition is constant. Three mutants die HERE
// AND NOWHERE ELSE — disarm-always, disarm-never, and dropping `opts` on the live
// path — each killing exactly one test in this file.
// ★★ SCOPED TO WHAT WAS MEASURED: a cold review ran all three against the other
// three lazy-editor suites, the three dictation suites and `rich-text-editor.test`
// — 48 tests, all green under every mutant. An earlier revision said "survives
// every other suite in the repo", which is a claim over ~900 files that nobody ran
// and nobody could cheaply run. None of these is a cosmetic mutant: `armStall` is
// only ever called from `appendText`, so
// disarming after a flush that REFUSED means the stall is never reported unless
// the user happens to dictate again.
//
// ★★★ THE STUB ATTACHES ON A FLAG, NOT ON MOUNT, AND THAT IS LOAD-BEARING. The
// obvious shape — attach in a mount effect and let `dynamic()`'s unresolved
// import provide the pre-mount window — works for the FIRST test in the file and
// silently stops working for every one after it: once any test has imported the
// (mocked) editor module, `dynamic()` resolves in the same commit, the handle
// exists before the test body runs, and the append takes the LIVE path. Measured,
// not reasoned: with that shape the timer armed ONCE across three tests, so the
// second test asserted "no stall was reported" in a run where no stall could ever
// have been reported. It passed with the disarm DELETED. Driving the attach from
// a flag plus a re-render makes each test independent of module warmth, and the
// `expect(stub.calls).toHaveLength(0)` after each append is the guard that says
// the queue was really used.
const stub = vi.hoisted(() => ({
  calls: [] as { text: string; opts?: { focus?: boolean } }[],
  accept: false,
  ready: false,
}));

vi.mock("./rich-text-editor", () => ({
  RichTextEditor: ({
    editorRef,
    value,
  }: {
    editorRef?: (h: { appendText: (t: string, o?: { focus?: boolean }) => boolean } | null) => void;
    value: string;
  }) => {
    useEffect(() => {
      if (!stub.ready) return;
      editorRef?.({
        appendText: (text, opts) => {
          stub.calls.push({ text, opts });
          return stub.accept;
        },
      });
      return () => editorRef?.(null);
      // `value` is in the deps so a rerender with a new one re-runs this effect —
      // that is how a test says "the chunk has arrived now".
    }, [editorRef, value]);
    return <div data-testid="stub-editor" />;
  },
}));

describe("a flush the editor refuses", () => {
  beforeEach(() => {
    stub.calls.length = 0;
    stub.accept = false;
    stub.ready = false;
    clearDiagLog();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    clearDiagLog();
  });

  const stalls = () => readDiagLog().filter((e) => e.code === "richText.appendQueueStalled");

  /** Queue one line while no handle exists, then let the editor attach. */
  async function queueThenAttach(text = "dictated") {
    const ref = createRef<RichTextEditorHandle>();
    const view = render(
      <RichTextEditor value="a" onChange={() => {}} label="Description" lang="en-US" editorRef={ref} />,
    );
    act(() => {
      ref.current?.appendText(text);
    });
    // The append must have QUEUED. If a handle had been live it would have taken
    // the text directly and everything below would be vacuous.
    expect(stub.calls).toHaveLength(0);

    stub.ready = true;
    // AWAITED: on a cold module the mocked import is still pending after the first
    // render, so the stub has not mounted yet and a synchronous rerender would find
    // nothing to re-run. One microtask turn settles it.
    await act(async () => {
      view.rerender(
        <RichTextEditor value="b" onChange={() => {}} label="Description" lang="en-US" editorRef={ref} />,
      );
    });
    return { ref, view };
  }

  it("keeps the stall reportable when the flush leaves the text outstanding", async () => {
    await queueThenAttach();
    expect(stub.calls).toHaveLength(1);
    // ★ The replay never focuses: its moment is chosen by the network, not the
    //   user, so focusing would yank the caret from wherever they moved on to.
    expect(stub.calls[0]?.opts).toEqual({ focus: false });

    act(() => {
      vi.advanceTimersByTime(QUEUE_STALL_MS);
    });
    expect(stalls()).toHaveLength(1);
    expect(stalls()[0]?.fields?.queued).toBe(1);
  });

  it("stops reporting once the flush has actually taken the text", async () => {
    // The other half, and the reason the disarm is conditional rather than
    // absent: a flush that SUCCEEDS must silence the timer, or every editor that
    // ever queued a line would report a stall it does not have.
    stub.accept = true;
    await queueThenAttach();
    expect(stub.calls).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(QUEUE_STALL_MS * 3);
    });
    expect(stalls()).toEqual([]);
  });

  it("forwards the caller's opts on the live path", async () => {
    // ★★ The wrapper is the ONLY editor any consumer can reach, so an arity-1
    //   signature here made the `opts` the handle type advertises unreachable from
    //   the whole app — and it TYPECHECKS, because arity-1 is assignable to
    //   `(text, opts?) => boolean`. No production caller passes `opts` today,
    //   which is exactly why nothing else would notice it being dropped again.
    stub.accept = true;
    const { ref } = await queueThenAttach("queued");
    stub.calls.length = 0;

    act(() => {
      ref.current?.appendText("live", { focus: true });
    });
    expect(stub.calls).toEqual([{ text: "live", opts: { focus: true } }]);
  });
});
