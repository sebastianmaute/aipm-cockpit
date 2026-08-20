import { act, render, screen } from "@testing-library/react";
import { createRef, StrictMode } from "react";
import { describe, it, expect, beforeAll } from "vitest";
import { installRangePolyfills } from "../test/note-log-dictation";
import { RichTextEditor, type RichTextEditorHandle } from "./rich-text-editor-lazy";

beforeAll(installRangePolyfills);

// The append queue under React StrictMode.
//
// ★★★ THIS IS A CHARACTERIZATION TEST AND IS LABELLED ONE DELIBERATELY. An
// earlier version of this comment asserted the failure it guards against was a
// DUPLICATED transcript — "the second attach would replay the same text again".
// That is false, and it was measured false by instrumenting `attach` and running
// both modes on a cold module:
//     plain       ["obj/1","null/1","obj/1"]           html "<p>existingdictated</p>"
//     StrictMode  ["obj/1","null/1","obj/1","null/1","obj/1"]  same html
// StrictMode adds two more attaches, but the queue depth is 1 at EVERY one of
// them: the extra handles are the dead ones `useImperativeHandle` attaches
// before `editor` exists, they refuse, and `flushPending` puts the text straight
// back. It drains exactly once, at the last attach, in both modes. There is no
// second live handle for a doubled replay to come from.
//
// ★★★ NO MUTANT IS KNOWN THAT THIS FILE KILLS AND `*.queue.test.tsx` DOES NOT.
// Ten were tried — dropping the queue swap, skipping the thrower, dropping the
// requeue, never arming, re-arming, never disarming, always disarming, dropping
// `opts`, forcing `focus:true`, and stopping the flush on a refusal. The one that
// turns this file red (dropping `pending.current = []`) turns the queue suite red
// too, and by an eight-second TIMEOUT rather than an assertion: the dead-handle
// attach re-pushes into the array it is iterating, which is an infinite loop. So
// what this file buys is a tripwire on React's own behaviour — if a future React
// makes StrictMode attach a second LIVE handle, the queue depth stops being 1 at
// every attach and this goes red first. That is worth a file; pretending it
// pins the production code is not.
//
// ★★ SHAPE MATTERS — `wrapper: StrictMode`, never a wrapper function that
// composes `<StrictMode>` inside itself. React's double-invoke walk stops at the
// topmost fiber flagged for PLACEMENT, and on a first mount those are the root's
// direct children only; a composed wrapper puts a fiber above StrictMode and the
// mount is SINGLE-invoked, leaving this test green with nothing under test.
// `src/app/strictmode.meta.test.tsx` states the rule in full — read it there
// rather than trusting this summary.
//
// ★★ Alone in its file for the same reason as the queue suite next door: the
// append has to happen while the `dynamic()` payload is still unresolved, and
// any sibling test that awaits the editor resolves it for the whole module.
describe("the lazy editor's append queue under StrictMode", () => {
  it("carries the queue across the extra attach cycle and drains it exactly once", async () => {
    const ref = createRef<RichTextEditorHandle>();
    const html: string[] = [];
    render(
      <RichTextEditor
        value="<p>existing</p>"
        onChange={(next) => html.push(next)}
        label="Description"
        lang="en-US"
        editorRef={ref}
      />,
      { wrapper: StrictMode },
    );

    expect(ref.current).not.toBeNull();
    expect(screen.queryByRole("textbox", { name: "Description" })).toBeNull();

    act(() => {
      ref.current?.appendText("dictated once");
    });

    const editor = await screen.findByRole("textbox", { name: "Description" }, { timeout: 15_000 });
    expect(editor.textContent).toContain("existing");

    // ★★ COUNT, do not merely look for presence: `toContain` passes on a doubled
    //   replay. The full-document HTML is the only assertion that can tell "once"
    //   from "twice" — and, because it is the whole document, the only one that
    //   can tell an APPEND from a PREPEND, which is the shape the deferred path
    //   got wrong once already.
    expect(html.at(-1)).toBe("<p>existingdictated once</p>");
    expect(editor.textContent?.match(/dictated once/g) ?? []).toHaveLength(1);
  });
});
