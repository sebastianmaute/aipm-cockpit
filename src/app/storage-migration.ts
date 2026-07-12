// One-time idempotent rename of the lop-app storage namespace to aipm-cockpit.
// Holds BOTH legacy and new literals on purpose — EXEMPT from the rename sweep.

const LEGACY_LS_PREFIX = "lop-app:";
const NEW_LS_PREFIX = "aipm-cockpit:";

const NONPREFIXED_LS: Readonly<Record<string, string>> = {
  "lop-style": "aipm-cockpit-style",
  "lop-theme": "aipm-cockpit-theme",
  "lop-active-scheme-colors": "aipm-cockpit-active-scheme-colors",
  "lop-active-scheme-structural": "aipm-cockpit-active-scheme-structural",
  "lop-scheme-supports-dark": "aipm-cockpit-scheme-supports-dark",
};

export const IDB_DB_RENAMES: ReadonlyArray<readonly [string, string]> = [
  ["lop-app-secrets", "aipm-cockpit-secrets"],
  ["lop-app", "aipm-cockpit"],
  ["lop-app-project-handles", "aipm-cockpit-project-handles"],
];

function moveKey(oldKey: string, newKey: string): void {
  if (localStorage.getItem(newKey) !== null) {
    localStorage.removeItem(oldKey);
    return;
  }
  const v = localStorage.getItem(oldKey);
  if (v === null) return;
  localStorage.setItem(newKey, v);
  localStorage.removeItem(oldKey);
}

export function migrateLocalStorage(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) keys.push(k);
    }
    for (const k of keys) {
      if (k.startsWith(LEGACY_LS_PREFIX)) {
        moveKey(k, NEW_LS_PREFIX + k.slice(LEGACY_LS_PREFIX.length));
      }
    }
    for (const oldKey of Object.keys(NONPREFIXED_LS)) {
      moveKey(oldKey, NONPREFIXED_LS[oldKey]);
    }
  } catch {
    // private-mode / quota / disabled storage — never throw at boot
  }
}
