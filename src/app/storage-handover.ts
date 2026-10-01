// src/app/storage-handover.ts
//
// §4 §645 — the ONE hand-over from an op's own backend instance to the live one. A project op
// (switch, open, create, demo, conversion) loads or writes through an instance of its own, then
// points the app at that target, and the live instance built for it skips its load. Backends are
// FAIL CLOSED, so without this the live instance knows no revision and refuses its first save.
import type { StorageBackend } from "./workspace";

type WithAdoptFrom = StorageBackend & { adoptFrom?: (other: StorageBackend) => void };

/**
 * Give `live` what `from` learned about their shared target. Same class: `adoptFrom`, which also
 * carries a local file's BOUND handle (so another tab rewriting the shared handle slot cannot
 * redirect this window's save, §645) and IndexedDB's per-store baselines. Otherwise the revision
 * alone, when `from` knows one. A `null` revision is left unknown: fabricating one would defeat the
 * fail-closed rule.
 */
export function handOverRevision(live: StorageBackend, from: StorageBackend): void {
  if (live === from) return;
  const adoptFrom = (live as WithAdoptFrom).adoptFrom;
  if (typeof adoptFrom === "function" && Object.getPrototypeOf(live) === Object.getPrototypeOf(from)) {
    adoptFrom.call(live, from);
    return;
  }
  const revision = from.revision?.() ?? null;
  if (revision !== null) live.adoptRevision?.(revision);
}
