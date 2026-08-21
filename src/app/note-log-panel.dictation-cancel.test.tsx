import { act, fireEvent, screen } from "@testing-library/react";
import { describe, it, expect, beforeAll, vi } from "vitest";
import {
  installRangePolyfills,
  pushToTalkCalls,
  renderNotePanel,
  EN,
} from "../test/note-log-dictation";
import { t } from "./i18n";
import type { NoteLogEntry } from "./types";

vi.mock("./use-push-to-talk", async () => {
  const { pushToTalkMock: mock } = await import("../test/push-to-talk-mock");
  return mock();
});

beforeAll(installRangePolyfills);

// Per-row controls carry row-unique accessible names; the editor does not.
const EDIT_BUTTON = `${t(EN, "edit")} \u2013 #1`;

const ENTRY: NoteLogEntry = {
  id: 1,
  timestamp: "2026-01-01T00:00:00.000Z",
  html: "<p>stored body</p>",
  text: "stored body",
  authorResourceId: 1,
};

// ★★★ THE DEFECT THIS PINS WAS A DATA-INTEGRITY ONE, NOT A LOST-TRANSCRIPT ONE,
// and it was created by the first fix for the lost transcript. That fix put the
// append queue in `note-log-panel.tsx` at ROW scope, while the editor it feeds
// lives inside the row's `editing ?` branch. Dictate into an edit, abandon it
// with Cancel, and the queue outlived the editor: re-opening that row flushed
// the abandoned transcript into the STORED note. The queue now lives in
// `rich-text-editor-lazy.tsx`, so it cannot outlive the editor it is for.
//
// ★★ Alone in its file for the same reason as its siblings: the transcript must
// be delivered while the boundary is still unresolved, or the append goes
// straight through a live handle and nothing is ever queued — which passes
// whatever the queue does.
//
// ★ The mutant: hoist `pending` out of `RichTextEditor` in
// `rich-text-editor-lazy.tsx` (module scope, or back to the consumer). The
// transcript then survives the unmount and reappears below.
describe("an abandoned edit does not resurrect its dictation", () => {
  it("drops a queued transcript when the edit is cancelled", async () => {
    renderNotePanel([ENTRY]);

    fireEvent.click(screen.getByRole("button", { name: EDIT_BUTTON }));
    // The row's registration is the last one made: the panel renders the
    // composer's mic before the row's on every pass.
    const row = pushToTalkCalls[pushToTalkCalls.length - 1];
    // ★★ ASSERT THE PREMISE. This test only says anything if the transcript is
    // QUEUED — i.e. the `dynamic()` payload is still unresolved and there is no
    // live handle to take it. It holds today only because no microtask drains
    // between the synchronous `fireEvent` calls above, which is a property of the
    // harness, not of the code under test. If that ever changes the append goes
    // through a live handle, Cancel discards it anyway, and the test passes for
    // the wrong reason with the module-scope mutant alive — the exact vacuity
    // already measured once on the assertion below.
    expect(screen.queryByRole("textbox", { name: t(EN, "edit") })).toBeNull();
    act(() => row.onAppendFinal("abandoned transcript"));

    fireEvent.click(screen.getByRole("button", { name: t(EN, "cancel") }));
    fireEvent.click(screen.getByRole("button", { name: EDIT_BUTTON }));

    const editor = await screen.findByRole("textbox", { name: t(EN, "edit") });
    // Positive observable first: absence alone would also be satisfied by an
    // editor that failed to render its stored content at all.
    expect(editor.textContent).toContain("stored body");
    // ★★★ ASSERT OVER THE WHOLE DOCUMENT, NOT THIS ROW. A queue that outlives its
    // editor flushes into whichever editor ATTACHES NEXT, which is not necessarily
    // the one being re-opened. Measured, not reasoned: against the module-scope
    // mutant this test was written for, the transcript replayed into the COMPOSER's
    // editor and a row-scoped assertion passed — the mutant SURVIVED and the test
    // certified the defect it exists to catch. The row-scoped form is the vacuous
    // one; do not narrow this back.
    expect(document.body.textContent).not.toContain("abandoned transcript");
  });
});
