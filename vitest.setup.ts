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
// 5s is far above the observed overrun and still well inside the 20s
// testTimeout, so a genuinely broken expectation still fails within its test
// rather than hanging the run.
configure({ asyncUtilTimeout: 5000 });

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
