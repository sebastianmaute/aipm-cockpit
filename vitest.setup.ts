import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup } from "@testing-library/react";
import { server } from "./src/test/msw-server";

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
