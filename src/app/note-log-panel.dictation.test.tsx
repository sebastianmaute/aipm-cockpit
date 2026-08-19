import { act, render, screen } from "@testing-library/react";
import { describe, it, expect, beforeAll, vi } from "vitest";
import { NoteLogPanel } from "./note-log-panel";
import { t } from "./i18n";
import type { Resource } from "./types";

// Capture every usePushToTalk registration so a test can invoke the captured
// `onAppendFinal` directly, the way a real engine reports a finished segment.
// Same shape as task-form-fields.dictation.test.tsx, plus the arg capture.
const pushToTalkCalls: { onAppendFinal: (text: string) => void }[] = [];
vi.mock("./use-push-to-talk", () => ({
  usePushToTalk: (args: { onAppendFinal: (text: string) => void }) => {
    pushToTalkCalls.push(args);
    return {
      listening: false,
      transcribing: false,
      supported: true,
      buttonHandlers: {},
      toggle: () => {},
      press: vi.fn(),
      release: vi.fn(),
    };
  },
}));

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });
});

const EN = "en-US" as const;
const RESOURCES: Resource[] = [
  { id: 1, firstName: "Alice", lastName: "Anders", roleId: null, utilizationMode: "percent", utilization: {} },
];

function renderPanel() {
  pushToTalkCalls.length = 0;
  render(
    <NoteLogPanel
      entries={[]}
      onAdd={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      self={1}
      resources={RESOURCES}
      lang={EN}
      labelSuffix={null}
    />,
  );
  // The composer's mic is the first (and, with no entries, only) registration.
  const reg = pushToTalkCalls[0];
  expect(reg, "no usePushToTalk registration captured").toBeTruthy();
  return reg;
}

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
    const reg = renderPanel();

    // Nothing has mounted the editor yet: the boundary is still painting its
    // fallback, so this is exactly the pre-handle state.
    expect(screen.queryByRole("textbox", { name: t(EN, "noteLogPlaceholder") })).toBeNull();
    act(() => reg.onAppendFinal("dictated before mount"));

    const editor = await screen.findByRole("textbox", { name: t(EN, "noteLogPlaceholder") });
    expect(editor.textContent).toContain("dictated before mount");
  });

  it("still appends normally once the editor is mounted", async () => {
    const reg = renderPanel();
    const editor = await screen.findByRole("textbox", { name: t(EN, "noteLogPlaceholder") });

    act(() => reg.onAppendFinal("dictated after mount"));
    expect(editor.textContent).toContain("dictated after mount");
  });
});
