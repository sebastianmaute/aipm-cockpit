import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup } from "@testing-library/react";
import { server } from "./src/test/msw-server";

// Mock Service Worker: intercept real network calls in tests. `error` on an
// unhandled request surfaces accidental live requests / missing handlers.
// Tests that still replace fetch via `vi.stubGlobal` bypass msw entirely and
// are unaffected.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

afterEach(() => {
  cleanup();
  localStorage.clear();
  server.resetHandlers();
});

afterAll(() => server.close());
