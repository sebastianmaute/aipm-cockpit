// §740 — the settings a reload must boot from, once written (or cleared), stay written.
//
// Every portfolio switch, migration and factory reset writes settings straight to localStorage
// and then calls `window.location.reload()`. The reload is asynchronous, and useSettings' persist
// effect writes the IN-MEMORY settings on any change in between, so a stale write could land after
// the caller's and win: a portfolio switch measured live came back on "browser" storage 60 ms
// after writing "turso". Sealing makes `writeSettings` a no-op until the reload discards this
// module state. Kept dependency-free so the shared test setup can reset it without loading
// use-settings into every test file.

let sealed = false;

/** Make every later `writeSettings` a no-op until the page reloads. Call it right after the final
 *  settings write (or clear) and immediately before `window.location.reload()`. */
export function sealSettingsUntilReload(): void {
  sealed = true;
}

/** True between `sealSettingsUntilReload` and the reload. */
export function settingsSealedForReload(): boolean {
  return sealed;
}

/** Test-only: undo the seal, which a real reload discards. Reset after every test in
 *  vitest.setup.ts. */
export function __resetSettingsReloadSeal(): void {
  sealed = false;
}
