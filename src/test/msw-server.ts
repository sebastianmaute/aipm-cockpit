import { setupServer } from "msw/node";

// Shared Mock Service Worker server for unit/integration tests. Lifecycle
// (listen / resetHandlers / close) is wired globally in ../../vitest.setup.ts;
// individual tests register request handlers with `server.use(http.get(...))`.
//
// This replaces hand-rolled `vi.stubGlobal("fetch", …)` mocks for code that
// talks to real endpoints (ECB, Microsoft Graph, Turso, Anthropic): msw
// intercepts at the network layer, so requests get real Response semantics and
// tests assert on the intercepted Request instead of a fetch spy.
export const server = setupServer();
