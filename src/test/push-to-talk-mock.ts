// The payload for `vi.mock("./use-push-to-talk", ...)`, and NOTHING else.
//
// ★★★ THIS FILE MUST NEVER IMPORT `note-log-panel` (or anything that reaches it).
// A `vi.mock` factory runs while the mocked specifier is being resolved, so any
// module the factory awaits must not itself depend on the mock. It did once —
// the factory imported `note-log-dictation.tsx`, which imports `NoteLogPanel`,
// which imports `./use-push-to-talk` — and that cycle DEADLOCKED collection:
// vitest printed the run header and then hung forever with no test, no timeout
// and no error, because a promise cycle is not a slow operation and nothing in
// the stack is watching for one. It cost a whole debugging round; the file split
// is what makes it impossible rather than merely documented.
import { vi } from "vitest";

/** Every `usePushToTalk` registration made during a test, in mount order, so a
 *  test can invoke the captured `onAppendFinal` the way a real speech engine
 *  reports a finished segment. */
export const pushToTalkCalls: { onAppendFinal: (text: string) => void }[] = [];

/** Factory body for `vi.mock("./use-push-to-talk", ...)`. */
export function pushToTalkMock() {
  return {
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
  };
}
