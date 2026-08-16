// src/app/backend-truncation-registry.test.ts
//
// Registry guard: every storage backend must publish what its last load()
// discarded to stay inside the document caps.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// ★★ PRODUCER-SIDE ONLY, AND AN EARLIER HEADER HERE OVERSTATED THAT BADLY.
// It called itself "THE ONE-DOOR-OF-N GUARD", which is exactly the sentence
// that stops the next reader checking. All this proves is that each of the four
// StorageBackend implementers ASSIGNS `lastLoadTruncation`. It says nothing
// about whether anything READS it -- and when that claim was written, the
// consumer reached ONE load path out of seven while this test sat green. The
// gap was real, shipped, and invisible precisely because of the header.
// The consumer side is now covered by behavioural tests in
// `use-storage-backend.test.tsx` and `use-storage-turso-ops.test.ts`; this file
// is the completeness net for the producer side and nothing more.
//
// `lastImportDroppedRows` is the cautionary precedent -- declared on the shared
// interface, implemented by two of the four backends, and silently absent in
// Turso and IndexedDB for the whole life of the feature.
//
// ★★ WEAK BY CONSTRUCTION, in two ways a reader must not assume away:
//   - the list below is HARDCODED, so a NEW backend is not caught until someone
//     adds it here -- the same shape as the precedent it guards against;
//   - the regex matches ANY `this.lastLoadTruncation =`, including a reset at
//     the top of load(), so a backend that resets but never publishes passes.
//
// ★★ A source scan was chosen for CHEAPNESS, not because instantiation is hard.
// An earlier header claimed it "needs live IndexedDB, a Turso client and a
// SharePoint token" -- that is false, and four sibling files in this directory
// disprove it: `browser-backend.documents.test.ts` (fake-indexeddb),
// `turso-backend.test.ts` (stubbed fetch), `sharepoint-backend.test.ts`
// (a vi.fn token) and `local-file-backend.test.ts` (one `vi.mock("./idb")`)
// all construct their backends today.
//
// ★★ THAT HEADER THEN RETREATED TO A SECOND FALSE CLAIM -- "Only
// LocalFileBackend genuinely resists (a File System Access handle)" -- and it
// is the one worth naming, because it reads as a reason not to try. `idbGet`
// is the SINGLE seam: `local-file-backend.test.ts` mocks `./idb` alone
// (spreading `...actual`) and hands the backend a plain object handle, so
// fs-access, the CSV codec and the sanitizers all run for real. Verified by
// reading that file, not inferred. So NO backend of the four resists, and a
// behavioural test per backend is the upgrade path for ALL of them.
//
// ★ The handle cannot go through the REAL store: IDB structure-clones its
// values and an FsHandle is an object of METHODS, so a round-trip throws
// DataCloneError. That is why the mock is an in-memory Map -- a genuine
// constraint on HOW the seam is stubbed, never a reason the backend is
// untestable, and the sibling's own header states it.
//
// ★★ SCOPE, so this does not become a third overstatement: that sibling is
// behavioural about the IMPORT diagnostics (`lastImportUnterminatedQuote` /
// `lastImportDroppedRows`), NOT about `lastLoadTruncation`, which no
// behavioural per-backend test covers yet. It proves the backend is reachable;
// it does not retire this file's own subject.
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
