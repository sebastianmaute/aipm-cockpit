import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup, configure } from "@testing-library/react";
import { server } from "./src/test/msw-server";

// ★★ Testing Library's async budget (`waitFor`, `findBy*`) is SEPARATE from
// vitest's `testTimeout`, and raising one does not raise the other. This suite
// already sets testTimeout/hookTimeout to 20s in vitest.config.ts because the
// fast-check property suites plus fake-indexeddb setup can starve a worker
// under full parallel load — but `asyncUtilTimeout` was left at its 1000ms
// default, so any waitFor unlucky enough to be scheduled during that starvation
// failed while the test itself had 19 seconds to spare.
//
// That was not hypothetical: `timelog-panel.test.tsx > surfaces a
// partial-failure toast when Refresh drops some projects` timed out at 1129ms
// on CI and took roughly 3 of every 10 main pipelines down with it, while
// passing 12/12 locally in isolation. The assertion was always correct; only
// the wait budget was wrong.
//
// ★★★ RAISED 5s -> 15s WHEN THE RICH-TEXT EDITOR MOVED BEHIND `next/dynamic`.
// Every editor surface now awaits a `dynamic()` payload, and the FIRST test in a
// worker to reach it pays Tiptap + ProseMirror's whole transform. Measured, not
// anticipated: a full sharded run went 4 failed / 3840 passed across three files
// (`change-edit-modal`, `note-log-panel`, `task-form-modal`), every failure a
// `findByRole` for an editor that had not arrived — and all three files passed
// 62/62 when run alone moments later. Same commit, same tree. That is the
// starvation shape this block already existed for, with a new and much larger
// first-hit cost on top.
//
// ★★ This is the ONLY place the Tiptap-transform wait budget is written. The
// Tiptap-mounting suites used to restate it at each wait; every copy was removed
// together in 0.251.0 because each one merely re-stated this line
// (docs/open-followups.md §193, closed).
//
// ★★ That is a claim about THIS budget, NOT about the literal. `timelog-panel.test.tsx`
// spells 15000 at two of its own `waitFor` calls, for an unrelated reason it documents
// in place (docs/open-followups.md §39 — those two budgets sum past the 20s
// testTimeout, which is the information that comment exists to carry). They are
// deliberately NOT swept in here. ★ A sweep for the `15_000` spelling cannot see
// them, which is how they survived the one that removed the copies above:
//   grep -rn "15000" src --include=*.tsx | grep timeout
//
// ★★★ DO NOT REINTRODUCE A COUNT HERE. The wording this replaced
// named one ("the four lazy-editor suites") and it had already rotted: the suites
// were not four and were not all lazy-editor suites. The set moves whenever a
// Tiptap-mounting test is added, so any number written here is wrong on a schedule.
// The 15s sits under the 20s testTimeout,
// but the margin is thinner than it was: a test with TWO failing waits will now
// hit the test timeout rather than reporting a clean assertion failure. If that
// starts happening, split the test rather than trimming this back — the waits
// are not the problem, the cold transform is.
configure({ asyncUtilTimeout: 15000 });

// jsdom lacks IntersectionObserver (used by the Help scroll-spy) and
// Element.scrollIntoView (used by TOC/deep-link scroll). Provide no-op stubs so
// components that mount these in an effect/handler don't throw under vitest.
if (typeof globalThis.IntersectionObserver === "undefined") {
  class IO {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  globalThis.IntersectionObserver = IO as unknown as typeof IntersectionObserver;
}
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

// Mock Service Worker: intercept real network calls in tests. `error` on an
// unhandled request surfaces accidental live requests / missing handlers.
// Tests that still replace fetch via `vi.stubGlobal` bypass msw entirely and
// are unaffected.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

afterEach(() => {
  cleanup();
  // A handful of server-route tests override `// @vitest-environment node`
  // (jsdom's Blob/FormData/Request don't interoperate with Node's undici
  // multipart parser) — localStorage doesn't exist there, so guard it like
  // the IntersectionObserver stub above.
  if (typeof localStorage !== "undefined") localStorage.clear();
  server.resetHandlers();
});

afterAll(() => server.close());
