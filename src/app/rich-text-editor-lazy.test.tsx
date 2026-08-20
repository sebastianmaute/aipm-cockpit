import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeAll } from "vitest";
import { stripComments } from "../test/strip-comments";
import { RichTextEditor, RichTextEditorFallback, flushPending } from "./rich-text-editor-lazy";

// This module exists to make exactly one `dynamic()` call, so what has to be
// pinned is that call's THREE decisions: it loads the real editor, it shows the
// fallback while doing so, and it never renders on the server.
//
// ★★★ THE FALLBACK-SHAPE TESTS BELOW ARE NOT THAT, and an earlier version of this
// file was only those. All three of `loading: RichTextEditorFallback` deleted,
// `ssr: false` flipped to `true`, and the `import()` retargeted survived the
// whole suite — for a 48-line module whose entire job is those three tokens.
// The contract block comes first now because it is the one that would go red.
// ProseMirror touches layout APIs jsdom lacks; stub them so a REAL editor can
// mount here. Without these the boundary never swaps and the test below fails
// looking like a broken import — mirrors note-log-panel.test.tsx.
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });
});

describe("the dynamic() boundary", () => {
  const SRC = readFileSync("src/app/rich-text-editor-lazy.tsx", "utf8");

  it("paints the fallback first, then swaps in the real editor", async () => {
    render(<RichTextEditor value="<p>hi</p>" onChange={() => {}} label="Description" lang="en-US" />);

    // ★★ Synchronous, deliberately: this is the assertion that dies if `loading:`
    //   is dropped. A `dynamic()` with no `loading` renders NULL while the chunk
    //   resolves, so `container` would hold no shimmer — and every fallback-shape
    //   test below would still pass, because they render the component directly
    //   rather than through the boundary.
    expect(document.querySelector(".animate-pulse")).not.toBeNull();
    expect(screen.queryByRole("textbox", { name: "Description" })).toBeNull();

    // ★ And this half dies if the `import()` is retargeted: the fallback would
    //   never be replaced by a real ProseMirror textbox.
    expect(await screen.findByRole("textbox", { name: "Description" })).toBeTruthy();
    expect(document.querySelector(".animate-pulse")).toBeNull();
  });

  it("never renders on the server", () => {
    // ★★ A SOURCE assertion because `ssr` has NO jsdom observable — vitest never
    //   server-renders, so `ssr: true` behaves identically here and the flip is
    //   invisible to every behavioural test that could be written. The real cost
    //   is paid in production: `useEditor` would run during SSR and
    //   `readCspNonce()` with it (see the ★★ block in `csp-nonce.ts`, whose
    //   `typeof document` guard is now the ONLY thing standing behind this line).
    // ★★★ STRIP THE COMMENTS FIRST. A first cut asserted
    //   `toContain("ssr: false")` against the raw source and SURVIVED the
    //   `ssr: true` mutant, because the module's own header discusses
    //   `ssr: false` in prose — the assertion was reading the comment. Measured,
    //   not reasoned: the mutated file passed 5/5. Any source assertion over a
    //   file that documents itself has this failure mode.
    // ★★ Its replacement pinned the exact one-line spelling
    //   `{ ssr: false, loading: RichTextEditorFallback }`, which killed the
    //   mutant but went red the moment the options object was reformatted onto
    //   three lines — a test that fails on prettier is a test that gets deleted.
    //   Stripping comments and matching per-key survives reflow AND cannot read
    //   prose.
    const CODE = stripComments(SRC);
    expect(CODE).toMatch(/ssr:\s*false/);
    expect(CODE).toMatch(/loading:\s*RichTextEditorFallback/);
    // The needle must not have been read out of prose: no comment survives here.
    // ★★ This line is only as strong as the stripper behind it, and the local
    //   one it used to call was NOT strong enough — it blanked a `//` comment
    //   only when the comment STARTED a line, so a trailing `code(); // …★…`
    //   sailed through and this very assertion could have been satisfied by
    //   prose. It now calls the shared scanner in `src/test/strip-comments.ts`,
    //   which tracks strings instead of guessing at line shape.
    expect(CODE).not.toContain("★");
  });
});

// What is tested BELOW is the fallback COMPONENT, rendered directly: it must
// shimmer like every other lazy surface in the app, and it must stay out of the
// accessibility tree (the surrounding form labels the field; a decorative
// placeholder announcing itself would be noise).
//
// ★ Two of these three pin `skeleton.tsx`, not this module — `animate-pulse` and
// `aria-hidden` are both emitted by `Skeleton`, so no one-token mutation to
// `rich-text-editor-lazy.tsx` can kill them. They are kept here rather than moved
// because there is no `skeleton.test.tsx` and this is the only direct coverage
// that component has; they DO catch a revert to the old hand-rolled
// `<div className="min-h-40 rounded-md border border-line bg-surface-muted" />`.
describe("RichTextEditorFallback", () => {
  it("shimmers, so a loading editor reads like a loading panel", () => {
    const { container } = render(<RichTextEditorFallback />);
    const el = container.firstElementChild;
    expect(el?.className).toContain("animate-pulse");
  });

  it("is decorative — hidden from assistive technology", () => {
    const { container } = render(<RichTextEditorFallback />);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });

  // ★ Named for what it CHECKS, not for what the height is meant to achieve.
  //   jsdom has no layout, so nothing here can observe a layout shift; whether
  //   160px actually matches toolbar + content is unmeasured, and the two
  //   size-to-content consumers (`milestone-edit-modal`, the draggable
  //   `TaskFormModal`) will still resize on the swap.
  it("declares the reserved-height and field-outline classes", () => {
    const cls = render(<RichTextEditorFallback />).container.firstElementChild?.className ?? "";
    expect(cls).toContain("min-h-40");
    // ★ The border is what the two pre-existing hand-rolled fallbacks drew and
    //   `Skeleton` does not, so without it the placeholder stops reading as a field.
    expect(cls).toContain("border-line");
  });
});

// The replay itself, driven directly with a fake handle.
//
// ★★★ THE THROW PATH IS WHY THIS IS A MODULE-SCOPE FUNCTION. Reaching it through
// React would mean making a real ProseMirror transaction fail on demand; here it
// is three lines. The behaviour it pins is not obvious and was wrong until it was
// written down: the caller has ALREADY swapped the queue out of its pending array
// before calling, so anything the loop does not reach is unreachable by every
// later attach. One append that throws used to discard every transcript BEHIND
// it — silently, with the editor still on screen.
describe("flushPending", () => {
  /** A handle whose `appendText` is scripted per call: `true` accepts, `false`
   *  refuses, an Error is thrown. */
  function fakeHandle(script: (true | false | Error)[]) {
    const seen: { text: string; focus: boolean | undefined }[] = [];
    let n = 0;
    return {
      seen,
      handle: {
        appendText(text: string, opts?: { focus?: boolean }) {
          seen.push({ text, focus: opts?.focus });
          const outcome = script[n++] ?? true;
          if (outcome instanceof Error) throw outcome;
          return outcome;
        },
      },
    };
  }

  it("leaves nothing behind when every append is accepted", () => {
    const { handle, seen } = fakeHandle([true, true]);
    const sink: string[] = [];
    flushPending(handle, ["one", "two"], sink);
    expect(sink).toEqual([]);
    expect(seen.map((s) => s.text)).toEqual(["one", "two"]);
  });

  it("replays with focus: false, so the caret is not yanked mid-sentence", () => {
    // The replay happens at a moment the NETWORK chose, not the user. Focusing
    // then steals the caret from wherever they have moved on to.
    const { handle, seen } = fakeHandle([true]);
    flushPending(handle, ["one"], []);
    expect(seen[0]?.focus).toBe(false);
  });

  it("keeps a refused item queued, and keeps going", () => {
    const { handle } = fakeHandle([false, true]);
    const sink: string[] = [];
    flushPending(handle, ["refused", "accepted"], sink);
    expect(sink).toEqual(["refused"]);
  });

  it("re-queues the thrower AND everything behind it, and rethrows", () => {
    // ★★ THE ITEM THAT THREW IS RE-QUEUED, NOT SKIPPED. A Tiptap command
    //   dispatches one transaction, so a throw means it never applied — skipping
    //   it would trade a duplicate risk that does not exist for a loss that does.
    const { handle } = fakeHandle([true, new Error("transaction failed")]);
    const sink: string[] = [];
    expect(() => flushPending(handle, ["landed", "threw", "behind"], sink)).toThrow(
      "transaction failed",
    );
    expect(sink).toEqual(["threw", "behind"]);
  });

  it("carries a refusal from before the throw through as well", () => {
    // Both sources of "still outstanding" end up in the same sink, in order.
    const { handle } = fakeHandle([false, new Error("boom")]);
    const sink: string[] = [];
    expect(() => flushPending(handle, ["refused", "threw", "behind"], sink)).toThrow("boom");
    expect(sink).toEqual(["refused", "threw", "behind"]);
  });
});
