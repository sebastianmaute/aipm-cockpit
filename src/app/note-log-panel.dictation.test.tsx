import { act, screen } from "@testing-library/react";
import { describe, it, expect, beforeAll, vi } from "vitest";
import { installRangePolyfills, renderNotePanel, EN } from "../test/note-log-dictation";
import { t } from "./i18n";

vi.mock("./use-push-to-talk", async () => {
  const { pushToTalkMock: mock } = await import("../test/push-to-talk-mock");
  return mock();
});

beforeAll(installRangePolyfills);

// ★★★ ONE TEST, ONE FILE — AND THAT IS THE FIX, NOT AN ACCIDENT OF LAYOUT.
// This assertion's premise is that the editor has NOT arrived yet, and
// `dynamic()` builds its `React.lazy` ONCE per MODULE evaluation: any sibling
// test in this file that awaits the editor resolves the shared payload, after
// which `render()` mounts a real ProseMirror textbox synchronously and the
// `toBeNull()` below fails. `test:shuffle` (BLOCKING in CI) shuffles WITHIN a
// file, so a two-test version of this file passes or fails by order — both
// orders were green when it shipped, which is why it was invisible. The sibling
// cases live in `note-log-panel.dictation-live.test.tsx` and
// `note-log-panel.dictation-cancel.test.tsx`; vitest gives each FILE its own
// module registry, so each gets an unresolved boundary.
//
// ★★★ THE ONLY TEST THAT CAN SEE THE BUG IT PINS, and the fixture is what makes
// it able to: the transcript is delivered BEFORE the editor exists. Assert after
// the editor has mounted and the buffer is bypassed entirely — the raw
// `editorRef.current?.appendText(txt)` this replaced passes such a test too.
//
// ★★ The window is real, not theoretical. The mic is a SIBLING of the editor in
// the composer, so it paints and is operable immediately, while the editor now
// arrives over the network behind `rich-text-editor-lazy.tsx`. Before that it was
// still non-zero — `useEditor` runs with `immediatelyRender: false`.
describe("note-log dictation vs. the lazily-loaded editor", () => {
  it("keeps a transcript that arrives before the editor has mounted", async () => {
    const { composer } = renderNotePanel();

    // Nothing has mounted the editor yet: the boundary is still painting its
    // fallback, so this is exactly the pre-handle state.
    expect(screen.queryByRole("textbox", { name: t(EN, "noteLogPlaceholder") })).toBeNull();
    act(() => composer.onAppendFinal("dictated before mount"));

    const editor = await screen.findByRole("textbox", { name: t(EN, "noteLogPlaceholder") });
    expect(editor.textContent).toContain("dictated before mount");
  });
});
