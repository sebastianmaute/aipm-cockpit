// src/app/backend-truncation-registry.test.ts
//
// Registry guard: every storage backend must publish what its last load()
// discarded to stay inside the document caps.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// ★★★ THE ONE-DOOR-OF-N GUARD. Five load paths feed six write paths, and a
// disclosure that reaches only some of them is worse than none: the backends
// it misses look safe. `lastImportDroppedRows` is the cautionary precedent --
// declared on the shared interface, implemented by two backends, and silently
// absent everywhere else for the whole life of the feature.
//
// This is a SOURCE scan on purpose. Instantiating every backend needs live
// IndexedDB, a Turso client and a SharePoint token; the property we care about
// is "the author wired it up", which the source shows directly.
const BACKENDS = [
  "src/app/local-file-backend.ts",
  "src/app/sharepoint-backend.ts",
  "src/app/browser-backend.ts",
  "src/app/turso-backend.ts",
];

describe("every storage backend publishes load truncation", () => {
  it.each(BACKENDS)("%s assigns lastLoadTruncation", (path) => {
    const src = readFileSync(path, "utf8");
    expect(src).toMatch(/this\.lastLoadTruncation\s*=/);
  });
});
