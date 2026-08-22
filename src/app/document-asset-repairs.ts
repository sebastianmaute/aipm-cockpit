// src/app/document-asset-repairs.ts — a one-number module store announcing
// "asset BYTES changed for a row whose METADATA did not".
//
// ★★★ WHY A MODULE STORE AND NOT A PROP. The producer is `useDocumentAssets`,
// called in `documents-asset-section.tsx`; the consumer is `DocumentPreview`,
// rendered by `document-edit-mode.tsx`. They are SIBLINGS under
// `documents-panel.tsx`, so a nonce prop has to be lifted into that panel's
// state and threaded back down through two children — and `documents-panel.tsx`
// sits at EXACTLY its 800-line budget (`scripts/check-file-sizes.mjs` counts
// `split("\n").length`, i.e. `wc -l` + 1, and 800 is the cap with zero
// headroom), so those lines do not exist. Same shape, same reason, as
// `chat-threads-registry.ts`; the older precedent both of them cite is
// `project-appearance-prefs.ts`.
//
// ★★★ THE OTHER CANDIDATE WAS WORSE AND THE REASON IS NOT COSMETIC. The obvious
// fix is to have a repair commit a fresh `documentAssets` ARRAY IDENTITY so the
// preview's effect re-runs. That works, and it also triggers a full debounced
// workspace save: `use-storage-backend.ts`'s save effect takes `documentAssets`
// in its dependency array and compares it by reference, with no content check
// anywhere in the body — so a content-identical bump writes every table on the
// backend. It is the wrong channel: the workspace slice did NOT change, and
// saying it did to move a byte-store signal is what makes the save spurious.
// This store carries the signal on its own wire.
//
// ★★ THE COUNTER IS THE WHOLE API. Consumers only ever compare it to the value
// they last saw (a React effect dependency), so it needs no payload, no id set
// and no eviction — a monotonic number cannot go stale and cannot leak one
// project's ids into another's read. It is deliberately NOT scoped per project:
// a repair is rare and user-initiated, and re-resolving one extra preview costs
// a blob-URL round trip, whereas a per-project key would have to be kept in
// agreement with the byte store's partition key by every caller
// (`chat-threads-registry.ts` records what that costs when a publisher and a
// key disagree).

let generation = 0;
const listeners = new Set<() => void>();

/** Announce that bytes now exist for a row that was marked dangling. Called
 *  from `use-document-assets.ts`'s upload success path, and ONLY when the row
 *  was actually dangling beforehand — a first-time upload changes the metadata
 *  slice, which every consumer is already watching. */
export function notifyAssetRepaired(): void {
  generation += 1;
  for (const listener of listeners) listener();
}

/** `useSyncExternalStore`'s subscribe. */
export function subscribeAssetRepairs(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

/** `useSyncExternalStore`'s getSnapshot. A NUMBER, deliberately: React compares
 *  snapshots with `Object.is`, so a primitive needs neither a cached snapshot
 *  object nor an equality function — the two pieces `project-appearance-prefs.ts`
 *  needs and this does not. */
export function getAssetRepairGeneration(): number {
  return generation;
}

/** `useSyncExternalStore`'s getServerSnapshot. A CONSTANT, not `generation`:
 *  module state on a server is shared across requests, so reading the live
 *  counter would make one request's repair leak into another's markup. Nothing
 *  renders from this value — it only feeds effect dependency arrays, and effects
 *  do not run on the server — so a constant is exactly right. */
export function getServerAssetRepairGeneration(): number {
  return 0;
}
