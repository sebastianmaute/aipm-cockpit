import { readFileSync } from "node:fs";
import { act, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { describe, it, expect, beforeAll } from "vitest";
import { installRangePolyfills } from "../test/note-log-dictation";
import { RichTextEditor, type RichTextEditorHandle } from "./rich-text-editor-lazy";

beforeAll(installRangePolyfills);

// The queue at its own layer. `note-log-panel.dictation.test.tsx` proves the
// same property end-to-end through one consumer; this proves it for the
// component all nine consumers render, which is the layer that has to hold when
// a ninth is added.
//
// ★★ Alone in its file, like the note-log dictation suites: the append must
// happen while the `dynamic()` payload is unresolved, and any sibling test that
// awaits the editor resolves it for the whole module. See the ★★★ block in
// `src/test/note-log-dictation.tsx`. The one sibling below is admissible
// BECAUSE IT NEVER RENDERS — it reads a config file and nothing else, so no
// order it can be shuffled into resolves the chunk.
//
// ★ The mutant: drop `pending.current.push(text)` from the handle in
// `rich-text-editor-lazy.tsx`. The text is then appended into a null inner
// handle, reported as accepted, and never seen again — the original bug.
describe("the lazy editor's append queue", () => {
  it("holds text appended before the chunk resolves and replays it on arrival", async () => {
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
    );

    // The handle exists immediately — the wrapper is eager — while the editor
    // behind it does not. That asymmetry is the whole reason the queue is here.
    expect(ref.current).not.toBeNull();
    expect(screen.queryByRole("textbox", { name: "Description" })).toBeNull();

    act(() => {
      ref.current?.appendText("queued while loading");
    });

    const editor = await screen.findByRole("textbox", { name: "Description" });
    expect(editor.textContent).toContain("existing");
    expect(editor.textContent).toContain("queued while loading");

    // ★★★ ASSERT THE BLOCK STRUCTURE, NOT JUST THE TEXT. `textContent` is blind to
    // what the deferred-append path can get wrong, and asserting it alone left the
    // ONE line this wave adds to the raw editor completely unpinned:
    //   · appending at `doc.content.size` (a DOC-level position, after the last
    //     block) makes ProseMirror wrap the text in a NEW paragraph, so an empty
    //     composer persists a stray leading `<p></p>`. See `appendPos`.
    // That mutant keeps every `textContent` assertion above green and changes this
    // one, which is the whole reason it is here. Do not weaken it back to text.
    expect(html.at(-1)).toBe("<p>existingqueued while loading</p>");

    // ★★★ THE SECOND MUTANT THIS BLOCK USED TO NAME IS DEAD, and it was killed
    //   deliberately. It read: "dropping `{ focus: false }` routes the replay
    //   through focus() + insertContent, which inserts at the SELECTION — i.e. it
    //   PREPENDS." §192 split position from focus, so `opts` no longer decides
    //   position and that mutant now changes NOTHING about the HTML. Measured, not
    //   assumed: with the argument dropped this file stayed GREEN.
    // ★★ Dropping it is still a real defect — the replay would FOCUS the editor at
    //   a moment the NETWORK chose, stealing the caret from wherever the user
    //   actually is. So the assertion moved from position to focus. This is the
    //   only thing in the suite that kills that mutant now.
    // ★★ It is also the only thing in the REPO that kills the handle's own
    //   `if (opts?.focus !== false)` guard: after §192, `opts.focus` is observable
    //   only through focus, never through the asserted HTML, so deleting that guard
    //   leaves every test in rich-text-editor.test.tsx green.
    expect(document.activeElement).not.toBe(editor);

    // ★★★ THE TWO ROUTES AGREE — this is what §192 is actually about. Above, the
    //   text went through the QUEUE (appended before the chunk resolved, replayed
    //   on arrival). Here the same call runs LIVE against the same never-focused
    //   editor. Before the fix these produced different documents and which one a
    //   user got was decided by network timing; now they cannot diverge.
    // ★★ Do not split this into a second `it` in this file: only the FIRST test in
    //   a file gets an unresolved `dynamic()` import, so a second one would resolve
    //   the chunk up front and never exercise the queued half at all.
    act(() => {
      ref.current?.appendText(" live");
    });
    await waitFor(() => expect(html.at(-1)).toBe("<p>existingqueued while loading live</p>"));
  });

  // ★★★ THE PREMISE ABOVE IS A PROPERTY OF THE RUNNER, NOT OF THIS FILE, AND
  // NOTHING ELSE WOULD SAY SO IF IT CHANGED. "Alone in its file" only buys an
  // unresolved chunk while vitest gives each test FILE a fresh module registry.
  // Turn isolation off — `isolate: false`, at the top level or inside
  // `poolOptions.forks` — and whichever file loaded the editor first leaves it
  // resolved for every file after it. The pre-mount window then never exists,
  // `queryByRole(...)` finds the editor, and the append lands directly instead of
  // queueing: THE QUEUE IS NO LONGER UNDER TEST, and the run stays green while
  // pinning nothing. Four suites rest on this — this file plus the three
  // `note-log-panel.dictation*` ones.
  //
  // ★ A source assertion because the property has no in-process observable:
  // `isolate` is not on `import.meta.env`, and by the time a test body runs, its
  // own registry has already been built either way.
  //
  // ★★ TWO FILES AND THREE SPELLINGS, none of which is hypothetical tidiness:
  // isolation can be turned off in `vitest.config.ts` OR on the command line, and
  // every entry point that runs this suite (`test:run`, `test:shuffle`,
  // `test:coverage`) lives in `package.json` — a `--no-isolate` added there is
  // exactly as fatal to the premise and would sail past a config-only check.
  // JSON quotes the key, so the pattern has to tolerate them.
  it("depends on vitest file isolation, which nothing may disable", () => {
    for (const file of ["vitest.config.ts", "package.json"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/["']?isolate["']?\s*:\s*false/);
      expect(source, file).not.toMatch(/--no-isolate/);
    }
  });
});
