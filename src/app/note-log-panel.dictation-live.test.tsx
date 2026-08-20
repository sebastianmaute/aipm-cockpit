import { act, screen } from "@testing-library/react";
import { describe, it, expect, beforeAll, vi } from "vitest";
import { installRangePolyfills, renderNotePanel, EN } from "../test/note-log-dictation";
import { t } from "./i18n";

vi.mock("./use-push-to-talk", async () => {
  const { pushToTalkMock: mock } = await import("../test/push-to-talk-mock");
  return mock();
});

beforeAll(installRangePolyfills);

// The other half of the pair split out of `note-log-panel.dictation.test.tsx`:
// the queue must not swallow the ordinary case. It lives in its own file only
// because its sibling's premise is "the editor has not arrived yet" and awaiting
// the editor here would resolve the shared `dynamic()` payload for the whole
// file — see the ★★★ block over there.
describe("note-log dictation once the editor is live", () => {
  it("still appends normally once the editor is mounted", async () => {
    const { composer } = renderNotePanel();
    const editor = await screen.findByRole("textbox", { name: t(EN, "noteLogPlaceholder") });

    act(() => composer.onAppendFinal("dictated after mount"));
    expect(editor.textContent).toContain("dictated after mount");
  });
});
