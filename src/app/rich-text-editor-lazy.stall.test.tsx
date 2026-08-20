import { act, render } from "@testing-library/react";
import { createRef } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { clearDiagLog, readDiagLog } from "./diagnostics";
import { QUEUE_STALL_MS, RichTextEditor, type RichTextEditorHandle } from "./rich-text-editor-lazy";

// ★★★ A CHUNK THAT NEVER ARRIVES. The mock's factory returns a promise that is
// never settled, so `dynamic()`'s `import()` hangs for the life of the test and
// the wrapper is stuck on its fallback — exactly the state a failed or blocked
// chunk fetch leaves the user in. Every other suite in this family races the
// chunk and wins by a microtask; this one is the only place the LOSING side is
// reachable at all.
//
// ★★ It must therefore be ALONE IN ITS FILE, and for a stronger reason than the
// queue suite's: `vi.mock` is hoisted to the top of the MODULE, so it applies to
// every test here. There is no such thing as a sibling in this file that gets a
// working editor.
vi.mock("./rich-text-editor", () => new Promise<never>(() => {}));

describe("a queued append whose chunk never arrives", () => {
  beforeEach(() => {
    clearDiagLog();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    clearDiagLog();
  });

  function mount() {
    const ref = createRef<RichTextEditorHandle>();
    const view = render(
      <RichTextEditor value="" onChange={() => {}} label="Description" lang="en-US" editorRef={ref} />,
    );
    return { ref, view };
  }

  const stalls = () => readDiagLog().filter((e) => e.code === "richText.appendQueueStalled");

  it("is reported, rather than held in silence forever", () => {
    // ★★★ THE WHOLE POINT OF THE REPORT. The queue is deliberately UNBOUNDED —
    //   a cap could only be enforced by dropping, which is the silent data loss
    //   the queue exists to prevent — so "the chunk never came" has to surface
    //   SOMEWHERE or the transcript is gone with nothing to show for it. The
    //   diagnostic ring is that somewhere; it rides out in the support bundle.
    const { ref } = mount();
    act(() => {
      ref.current?.appendText("stranded transcript");
    });

    // Nothing yet: the queue is doing its job for as long as the chunk might
    // still be in flight. A report before the threshold is a false alarm on
    // every ordinary slow connection.
    expect(stalls()).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(QUEUE_STALL_MS);
    });
    expect(stalls()).toHaveLength(1);
    expect(stalls()[0]?.fields?.queued).toBe(1);
  });

  it("reports once per editor, however long the user keeps talking", () => {
    // ★★ Re-arming would emit a warning every QUEUE_STALL_MS for as long as
    //   dictation continues, and the ring is capped — a stall that reports
    //   itself forty times evicts every other event in the bundle, which is a
    //   worse outcome than the one report this asserts.
    const { ref } = mount();
    act(() => {
      ref.current?.appendText("first");
    });
    act(() => {
      vi.advanceTimersByTime(QUEUE_STALL_MS);
    });
    act(() => {
      ref.current?.appendText("second");
    });
    act(() => {
      vi.advanceTimersByTime(QUEUE_STALL_MS * 5);
    });
    expect(stalls()).toHaveLength(1);
  });

  it("is not reported when the editor unmounts first", () => {
    // ★★★ A QUEUE DISCARDED BY UNMOUNT IS CORRECT, NOT A LOSS. Cancelling an
    //   edit on a note row unmounts the editor and drops the queue on purpose —
    //   that is the reason the queue lives at this layer rather than the
    //   consumer's (see the ★★★ block on the component). Reporting it would
    //   name the user's own decision as a defect, and the diagnostics ring is
    //   only worth reading while everything in it is real.
    const { ref, view } = mount();
    act(() => {
      ref.current?.appendText("abandoned");
    });
    act(() => {
      view.unmount();
    });
    act(() => {
      vi.advanceTimersByTime(QUEUE_STALL_MS * 3);
    });
    expect(stalls()).toHaveLength(0);
  });
});
