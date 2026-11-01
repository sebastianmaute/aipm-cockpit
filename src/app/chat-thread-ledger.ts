// src/app/chat-thread-ledger.ts — what this browser knows about each saved chat thread, per Turso
// database. Pure: no React, no I/O, no clock.
//
// Every fact is keyed by the database URL AND the thread id, because a thread id is only unique
// within one database (a fork or a restore can hold the same id elsewhere):
//   - stored: the row is known to exist in that database (a load read it, or a save of it landed).
//     Such a thread is only ever UPDATEd, so a chat erased or deleted elsewhere is never inserted again.
//   - gone:   the row was found gone there, or stamped with an owner this browser no longer is, or a
//     save could not confirm it is there. useChatThreads takes it off the list and closes it on screen,
//     and its end-of-turn save checks this flag (for the database the turn started in), so the
//     transcript is not saved again under its id or a new one. The flag is per database: the same id
//     in another database is not gone.
//   - source: the database the in-memory copy came from (a load showed it, or it was minted here while
//     that database was current). A thread is written only to its source database. An id has at most
//     one source: recording a new one replaces the old.

/** The ledger's facts for one database. */
interface DatabaseFacts {
  stored: Set<string>;
  gone: Set<string>;
  source: Set<string>;
}

export interface ChatThreadLedger {
  /** A load of `url` returned these threads: each is stored there and came from there. */
  recordLoaded(url: string, ids: readonly string[]): void;
  /** Thread `id` is stored in `url` (a save of it landed there). */
  markStored(url: string, id: string): void;
  isStored(url: string, id: string): boolean;
  /** Thread `id` is gone from `url` (or no longer this browser's there, or unconfirmed). */
  markGone(url: string, id: string): void;
  isGone(url: string, id: string): boolean;
  /** The in-memory thread `id` came from `url`; any other database's claim on the id is dropped. */
  recordSource(url: string, id: string): void;
  /** Whether the in-memory thread `id` came from `url`. */
  cameFrom(url: string, id: string): boolean;
  /** The database the in-memory thread `id` came from, or null when that is not known. */
  sourceOf(id: string): string | null;
}

export function createChatThreadLedger(): ChatThreadLedger {
  const byUrl = new Map<string, DatabaseFacts>();

  function facts(url: string): DatabaseFacts {
    let known = byUrl.get(url);
    if (!known) {
      known = { stored: new Set(), gone: new Set(), source: new Set() };
      byUrl.set(url, known);
    }
    return known;
  }

  function recordSource(url: string, id: string): void {
    for (const [other, known] of byUrl) {
      if (other !== url) known.source.delete(id);
    }
    facts(url).source.add(id);
  }

  function sourceOf(id: string): string | null {
    for (const [url, known] of byUrl) {
      if (known.source.has(id)) return url;
    }
    return null;
  }

  return {
    recordLoaded(url, ids) {
      for (const id of ids) {
        facts(url).stored.add(id);
        recordSource(url, id);
      }
    },
    markStored: (url, id) => void facts(url).stored.add(id),
    isStored: (url, id) => byUrl.get(url)?.stored.has(id) ?? false,
    markGone: (url, id) => void facts(url).gone.add(id),
    isGone: (url, id) => byUrl.get(url)?.gone.has(id) ?? false,
    recordSource,
    cameFrom: (url, id) => byUrl.get(url)?.source.has(id) ?? false,
    sourceOf,
  };
}
