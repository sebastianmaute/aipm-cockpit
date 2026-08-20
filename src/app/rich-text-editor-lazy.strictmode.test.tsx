import { act, render, screen } from "@testing-library/react";
import { createRef, StrictMode } from "react";
import { describe, it, expect, beforeAll } from "vitest";
import { installRangePolyfills } from "../test/note-log-dictation";
import { RichTextEditor, type RichTextEditorHandle } from "./rich-text-editor-lazy";

beforeAll(installRangePolyfills);

// The append queue under React StrictMode — the one execution mode where the
// flush can run more than once, and the one nothing pinned.
//
// ★★★ THE FAILURE THIS EXISTS FOR IS A DUPLICATED TRANSCRIPT, not a lost one.
// StrictMode mounts, unmounts and remounts, so `useImperativeHandle` in
// `rich-text-editor.tsx` detaches with `null` and re-attaches — meaning `attach`
// runs at least twice against the same queue. If the flush read `pending.current`
// without swapping in a fresh array first, the second attach would replay the
// same text into the editor again and the user's dictated sentence would appear
// twice. Dev-only, and therefore exactly the kind of thing that ships.
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
  it("replays text queued before the chunk resolved exactly once", async () => {
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
    //   replay, which is the whole defect this file is about. The full-document
    //   HTML is the only assertion that can tell "once" from "twice".
    expect(html.at(-1)).toBe("<p>existingdictated once</p>");
    expect(editor.textContent?.match(/dictated once/g) ?? []).toHaveLength(1);
  });
});
