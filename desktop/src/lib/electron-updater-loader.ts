// Resolves electron-updater's `autoUpdater` singleton out of whatever shape a dynamic `import()`
// hands back. electron-updater's `out/main.js` defines `autoUpdater` via a dynamic
// `Object.defineProperty(exports, "autoUpdater", { get: () => ... })` -- a lazy per-platform
// singleton (`doLoadAutoUpdater()`) -- rather than a static `exports.autoUpdater = ...` assignment.
// That shape is invisible to Node's cjs-module-lexer (the static scanner ESM interop uses to decide
// a CommonJS module's NAMED exports), so `await import("electron-updater")` exposes `autoUpdater`
// ONLY on `.default.autoUpdater`, never as a named property on the import's own namespace object.
//
// ★★★ MEASURED, not assumed, against the installed package under plain Node 24 (fix round 2, Critical
// 1): `Object.keys(await import("electron-updater"))` never lists "autoUpdater"; `m.default.autoUpdater`
// exists. The earlier code here read `mod.autoUpdater` directly -- always `undefined` under a dynamic
// import in Electron's own runtime -- and the resulting TypeError from wiring an undefined object was
// then caught by the SAME try/catch as the import itself and mislabelled "failed to load", silently
// disabling auto-update in every installed copy while every gate stayed green (tsc only checks the
// TYPE, which is correct; the asar guard proves inclusion, not loading; e2e sets the disable opt-out).
//
// ★★ THAT MEASUREMENT DOES NOT HOLD UNDER VITEST'S OWN MODULE LOADER, which is exactly why this
// function checks BOTH shapes rather than assuming one: `desktop/src/updater-module-shape.test.ts`
// found vitest's CJS interop synthesizes `autoUpdater` as a named export too (its doc comment has the
// measurement and the reasoning). Resolving named-first, default-fallback is correct either way; the
// genuine end-to-end proof that PRODUCTION Electron resolves the real singleton through THIS function
// is the packaged-app launch in task-6-report.md's fix-round-2 section, not a vitest run.
//
// Pure and Electron-free so it is unit-testable on its own (electron-updater-loader.test.ts uses
// plain mock shapes, never the real package).
export function pickAutoUpdater(mod: unknown): unknown {
  const direct = readProp(mod, "autoUpdater");
  if (direct !== undefined) return direct;
  const fromDefault = readProp(readProp(mod, "default"), "autoUpdater");
  if (fromDefault !== undefined) return fromDefault;
  throw new Error(
    "electron-updater: could not find autoUpdater on the imported module (checked both the named export and .default)",
  );
}

function readProp(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  return (value as Record<string, unknown>)[key];
}
