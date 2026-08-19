import { act, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, it, expect, beforeAll } from "vitest";
import { installRangePolyfills } from "../test/note-log-dictation";
import { RichTextEditor, type RichTextEditorHandle } from "./rich-text-editor-lazy";

beforeAll(installRangePolyfills);

// The queue at its own layer. `note-log-panel.dictation.test.tsx` proves the
// same property end-to-end through one consumer; this proves it for the
// component all eight consumers render, which is the layer that has to hold when
// a ninth is added.
//
// ★★ Alone in its file, like the note-log dictation suites: the append must
// happen while the `dynamic()` payload is unresolved, and any sibling test that
// awaits the editor resolves it for the whole module. See the ★★★ block in
// `src/test/note-log-dictation.tsx`.
//
// ★ The mutant: drop `pending.current.push(text)` from the handle in
// `rich-text-editor-lazy.tsx`. The text is then appended into a null inner
// handle, reported as accepted, and never seen again — the original bug.
describe("the lazy editor's append queue", () => {
  it("holds text appended before the chunk resolves and replays it on arrival", async () => {
    const ref = createRef<RichTextEditorHandle>();
    render(
      <RichTextEditor
        value="<p>existing</p>"
        onChange={() => {}}
        label="Description"
        lang="en-US"
        editorRef={ref}
      />,
    );

    // The handle exists immediately — the wrapper is eager — while the editor
    // behind it does not. That asymmetry is the whole reason the queue is here.
    expect(ref.current).not.toBeNull();
    expect(screen.queryByRole("textbox", { name: "Description" })).toBeNull();

    act(() => {
      ref.current?.appendText("queued while loading");
    });

    const editor = await screen.findByRole("textbox", { name: "Description" }, { timeout: 15_000 });
    expect(editor.textContent).toContain("existing");
    expect(editor.textContent).toContain("queued while loading");
  });
});
