// src/app/capped-list-store.ts
//
// Generic per-device "saved views" CRUD skeleton shared by the plain
// `{id, name, ...}` stores (saved views, reports views). Each store repeated the
// same load → validate → cap / mint-id → append → cap / remove-by-id /
// rename-by-id / save shape verbatim; this factory owns that skeleton while each
// store keeps its OWN validation (`sanitizeList`), key, and cap.
//
// Built ON TOP of the `device-store` envelope (SSR guard + defensive read/write)
// — it does NOT re-hand-roll the raw storage I/O. Dependency-light.
//
// View-tagged stores (panel-views) whose cap is PER-view rather than whole-list
// do NOT fit this skeleton and intentionally stay on their own device-store form.

import { readDeviceJson, writeDeviceJson } from "./device-store";

export interface CappedListStore<T extends { id: number; name: string }> {
  /** Read + validate the stored list; cap-slices to the last `max` when
   *  `capOnLoad` was set (else returns the sanitized list as-is). */
  load(): T[];
  /** Mint id = (max existing id) + 1, append the new entry, cap-slice to the
   *  last `max` entries (oldest dropped). */
  add(list: readonly T[], fields: Omit<T, "id">): T[];
  /** Filter out the entry with the given id. */
  remove(list: readonly T[], id: number): T[];
  /** Return a copy with the named entry's `name` replaced (immutable). */
  rename(list: readonly T[], id: number, name: string): T[];
  /** Persist the list verbatim. */
  save(list: readonly T[]): void;
}

export function createCappedListStore<T extends { id: number; name: string }>(
  key: string,
  max: number,
  sanitizeList: (raw: unknown) => T[],
  options: { capOnLoad?: boolean } = {},
): CappedListStore<T> {
  const capOnLoad = options.capOnLoad === true;

  function cap(list: T[]): T[] {
    return list.length > max ? list.slice(list.length - max) : list;
  }

  return {
    load(): T[] {
      const list = sanitizeList(readDeviceJson<unknown>(key, []));
      return capOnLoad ? cap(list) : list;
    },
    add(list: readonly T[], fields: Omit<T, "id">): T[] {
      const id = (list.length ? Math.max(...list.map((v) => v.id)) : 0) + 1;
      return cap([...list, { id, ...fields } as T]);
    },
    remove(list: readonly T[], id: number): T[] {
      return list.filter((v) => v.id !== id);
    },
    rename(list: readonly T[], id: number, name: string): T[] {
      return list.map((v) => (v.id === id ? { ...v, name } : v));
    },
    save(list: readonly T[]): void {
      writeDeviceJson(key, list);
    },
  };
}
