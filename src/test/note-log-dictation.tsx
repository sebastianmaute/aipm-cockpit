// Shared harness for the note-log dictation suites.
//
// ★★★ THOSE SUITES ARE DELIBERATELY ONE TEST PER FILE, and this helper exists so
// that splitting them costs nothing. `dynamic()` builds its `React.lazy` ONCE per
// MODULE evaluation, so the first test in a file that awaits the editor resolves
// the shared payload and every later render in that file mounts the editor
// SYNCHRONOUSLY. A test whose premise is "the editor has not arrived yet" is then
// asserting against an editor that is already there — and `test:shuffle` (a
// blocking gate) shuffles WITHIN a file, so the same suite passes or fails by
// order. A file boundary is the only cheap way to get a fresh boundary; vitest
// gives each test FILE its own module registry.
//
// ★★★ `vi.mock` CANNOT LIVE HERE, AND ITS PAYLOAD CANNOT EITHER. The call is
// hoisted to the top of the file that makes it and its specifier resolves
// relative to that file, so each suite keeps its own three-line
// `vi.mock("./use-push-to-talk", ...)`. The FACTORY, though, must reach only
// `push-to-talk-mock.ts` — never this file. This module imports `NoteLogPanel`,
// which imports `./use-push-to-talk`, so a factory awaiting THIS module waits on
// a graph that waits on the factory. That deadlock hangs collection silently:
// no test, no timeout, no error. See the header of `push-to-talk-mock.ts`.
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { pushToTalkCalls } from "./push-to-talk-mock";
import { NoteLogPanel } from "../app/note-log-panel";
import type { NoteLogEntry, Resource } from "../app/types";

// Re-exported for the suites' BODIES (never for a `vi.mock` factory — see above).
export { pushToTalkCalls } from "./push-to-talk-mock";

/** ProseMirror measures ranges on mount; jsdom implements neither method. */
export function installRangePolyfills() {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getBoundingClientRect = () => ({
    width: 0,
    height: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
}

export const EN = "en-US" as const;

export const RESOURCES: Resource[] = [
  { id: 1, firstName: "Alice", lastName: "Anders", roleId: null, utilizationMode: "percent", utilization: {} },
];

export interface RenderedNotePanel {
  /** The composer's mic registration — the first one mounted. */
  composer: { onAppendFinal: (text: string) => void };
  onEdit: ReturnType<typeof vi.fn>;
}

/** Render a `NoteLogPanel` and return the composer's dictation registration.
 *  With entries present, each row mounts its own registration AFTER the
 *  composer's, so `pushToTalkCalls[0]` is always the composer. */
export function renderNotePanel(entries: NoteLogEntry[] = []): RenderedNotePanel {
  pushToTalkCalls.length = 0;
  const onEdit = vi.fn();
  render(
    <NoteLogPanel
      entries={entries}
      onAdd={vi.fn()}
      onEdit={onEdit}
      onDelete={vi.fn()}
      self={1}
      resources={RESOURCES}
      lang={EN}
      labelSuffix={null}
    />,
  );
  const composer = pushToTalkCalls[0];
  if (!composer) throw new Error("no usePushToTalk registration captured");
  return { composer, onEdit };
}
