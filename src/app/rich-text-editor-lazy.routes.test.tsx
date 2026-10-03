import { act, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, it, expect, beforeAll } from "vitest";
import { installRangePolyfills } from "../test/note-log-dictation";
import { RichTextEditor, type RichTextEditorHandle } from "./rich-text-editor-lazy";

beforeAll(installRangePolyfills);

// §196 — the property §192 exists to establish: a dictated line lands in the
// SAME place whether it reached the editor through the lazy wrapper's QUEUE
// (appended before the chunk resolved, replayed at attach) or LIVE against an
// already-mounted one.
//
// ★★★ ALONE IN ITS FILE, and for the same reason as `rich-text-editor-lazy.queue
// .test.tsx`: the queued append must happen while the `dynamic()` payload is
// unresolved, and a sibling test that awaits the editor resolves it for the whole
// module. Both editors sit behind that ONE boundary, so B is live the moment A's
// chunk arrives — which is what lets a single test hold both routes.
//
// ★ Why the sibling file cannot say this: its replay leaves the caret at the end
// of the document, so a live append AFTER it lands at the end under the pre-§192
// code too. Divergence needs the live append to come FIRST on a never-focused
// editor; here editor B is that case.
//
// ★ Mutants this kills (each measured by the review that filed §196): the full
// §192 revert, an inverted position ternary, and `everFocused` forced true.
describe("the lazy editor — queued and live appends agree", () => {
  it("produces identical HTML for an append queued before load and one made live after", async () => {
    const refA = createRef<RichTextEditorHandle>();
    const refB = createRef<RichTextEditorHandle>();
    const htmlA: string[] = [];
    const htmlB: string[] = [];
    render(
      <>
        <RichTextEditor
          value="<p>existing</p>"
          onChange={(next) => htmlA.push(next)}
          label="Queued"
          lang="en-US"
          editorRef={refA}
        />
        <RichTextEditor
          value="<p>existing</p>"
          onChange={(next) => htmlB.push(next)}
          label="Live"
          lang="en-US"
          editorRef={refB}
        />
      </>,
    );

    // Chunk unresolved: neither editor is mounted, so this append is QUEUED.
    expect(screen.queryByRole("textbox", { name: "Queued" })).toBeNull();
    act(() => {
      refA.current?.appendText(" appended", { focus: false });
    });

    // Resolve the chunk, then append to the other editor LIVE (opts undefined).
    await screen.findByRole("textbox", { name: "Queued" });
    await screen.findByRole("textbox", { name: "Live" });
    act(() => {
      refB.current?.appendText(" appended");
    });

    expect(htmlA.at(-1)).toBe("<p>existing appended</p>");
    expect(htmlB.at(-1)).toBe(htmlA.at(-1));
  });
});
