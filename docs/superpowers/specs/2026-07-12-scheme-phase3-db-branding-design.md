# Color-Scheme Phase 3 — DB-backed schemes + per-scheme logo/favicon

**Date:** 2026-07-12
**Builds on:** Phase 1 (0.182.0 "Reynolds", scheme engine + built-in dark-capable Harbor/Meridian/Umber) and Phase 2 (0.183.0 "Palmer", AIPM/Mockup folded in as read-only built-ins, `data-style` collapsed, structural token group).

## Goal

Close the two remaining parts of the original request: **load/save color schemes from the project database** (Turso) so a user's custom schemes follow them across devices, and **let a scheme own its logo + favicon** (today a scheme owns only slogan/footerSlogan; logo/favicon are global).

## Non-goals (YAGNI)

- Dark-capable USER schemes (built-ins carry both maps; user schemes stay light-only — separate future slice).
- Explicit per-scheme publish/pull UI (rejected — auto dual-backend chosen).
- DB-sole storage with no local fallback (rejected — offline-fragile).
- Sharing schemes across DIFFERENT Turso projects / a user-level (non-project) scheme DB.

## Decisions (confirmed with user)

1. **DB sync model = auto dual-backend.** When the project has Turso configured, the user-scheme LIBRARY lives in a global `color_schemes` table (cross-device); otherwise localStorage. `activeId` + the no-flash boot keys stay per-device. Mirrors the existing `operating_guides` / `scheduled_jobs` pattern.
2. **Scheme branding = logo + favicon + slogan + footerSlogan.** Applying a branded scheme replaces all four; the global Branding block's logo/favicon inputs hide for a branded user scheme and show for built-ins — exactly mirroring current slogan/footer behavior.

## Architecture

### Data model

- New global Turso table `color_schemes (id TEXT PRIMARY KEY, data TEXT)`. One row per USER scheme; the whole `ColorScheme` object is the JSON blob in `data` (so adding a branding field never needs a column migration). Built-in schemes are code-owned and NEVER persisted to the table (reconcileBuiltins injects them from `builtin-schemes.ts`).
- **`color_schemes` MUST stay OUT of `TABLE_NAMES`** — otherwise the workspace save's per-table DELETE wipes it. A guard test enforces this (mirrors the existing `scheduled_jobs`/`operating_guides` guard).
- `ColorScheme.branding` already typed as `BrandingConfig` (`{logo?, favicon?, slogan?, footerSlogan?}`); no type change. What changes is which fields are *applied* and *editable per scheme*.

### Persistence — synchronous cache + async DB truth

- localStorage `lop-app:color-schemes` REMAINS, holding `{schemes, activeId}`, and serves as a **synchronous cache/fallback**. This is the key to preserving no-flash: every existing sync reader (`loadSchemes`, `use-style` `syncScheme`, boot migration) keeps working unchanged, reading last-known library + `activeId`.
- `tursoConfig === null` → localStorage IS the store (today's behavior, unchanged).
- `tursoConfig !== null` → DB `color_schemes` is the cross-device source of truth for the LIBRARY. `activeId` stays per-device in localStorage (a device preference, like which scheme this device paints).
- **Load** (`loadSchemesAsync(config)`): return the sync cache immediately for first paint; if `config`, run `DDL + SELECT`, decode rows → user schemes, and mirror the result into the localStorage cache, then signal a refresh so the editor re-renders. Never throw — an unparseable row is skipped; a failed pipeline falls back to the cache.
- **Save** (`saveSchemesAsync(config, schemes)`): always write the localStorage cache; if `config`, also run `DDL + DELETE + INSERT*` (wipe-then-reinsert — the set is ≤30 and edited as a whole). `SqlArg.value` is string-only.
- **Migration:** on the first Turso-backed load, if the DB is empty AND the local cache has ≥1 user scheme, push the local user schemes into the DB once (so connecting Turso doesn't make a user's existing schemes appear to vanish). Built-ins are never pushed.

### No-flash / apply path (unchanged mechanics)

- `boot-theme-script.ts` reads the boot keys (`lop-active-scheme-colors`, `lop-active-scheme-structural`, `lop-scheme-supports-dark`, `lop-style`, `lop-theme`) pre-paint — NOT the library. Untouched.
- `use-style` `syncScheme` resolves the active scheme from the **sync cache** and applies inline + mirrors boot keys. Untouched for built-ins and for user schemes present in the cache. When a Turso DB refresh brings a NEWER version of the active user scheme, `syncScheme` re-resolves and re-applies (same code path as any scheme edit). No paint gap because the boot keys already hold the last resolved colors.
- `reconcileBuiltins` remains the SOLE validator of `activeId` against the merged (built-in + user) list. `loadSchemes`/`setActive` still must NOT validate.

### Branding extension (logo + favicon)

- `mergeAppliedBranding(current, scheme)` extends to carry `logo` and `favicon` in addition to `slogan`/`footerSlogan`: a branded scheme's apply REPLACES all four; a built-in (which owns no branding) leaves the global values in place.
- `exportScheme` includes `branding` already (whole object) — logo/favicon ride along automatically; confirm the export/import round-trip preserves them (they pass `sanitizeBranding` on import: raster `data:` image only, SVG banned, size-capped).
- Appearance UI: the logo + favicon inputs currently in the global Branding block move INTO the scheme editor for a branded user scheme (alongside slogan/footer). For built-in schemes (which own no branding) the global logo/favicon/app-name/footer inputs show, exactly as slogan/footer do today (`activeIsBuiltin` gate already exists).

## Components / files

- **New `color-schemes-store.ts`** — dual-backend async persistence: `loadSchemesAsync(config)`, `saveSchemesAsync(config, schemes)`, DB row decode (`rowsToSchemes`), one-time migration helper. Mirrors `scheduled-jobs-store.ts` structure. This `.ts` is coverage-GATED → fully unit-tested. Exports `COLOR_SCHEMES_TABLE`.
- **`color-schemes.ts`** — keeps the pure helpers (`cleanScheme`, `nextUserId`, `addScheme`/`updateScheme`/`removeScheme`/`setActive` on the local cache, `exportScheme`, `importScheme`, `mergeAppliedBranding`). `exportScheme` already serializes `branding`; extend `mergeAppliedBranding` to include logo/favicon. The mutators keep writing the localStorage cache synchronously; the async DB write is layered by the hook.
- **`use-color-schemes.ts`** (coverage-excluded selection hook) — becomes async-aware: seed from sync cache, run a DB-refresh effect gated on `tursoConfig`, thread `saveSchemesAsync` through the mutators so an edit persists to both cache and DB. Owns the migration trigger.
- **`appearance-section.tsx` / `color-scheme-editor.tsx`** — move logo/favicon inputs into the branded-scheme editor; show a "stored in the project database" hint when Turso is the backend. Keep the `activeIsBuiltin` gate for the global branding inputs.
- **`TABLE_NAMES` guard test** — add `color_schemes` to the "must stay out" assertions.

## Data flow

```
Appearance edit (add/update/remove/apply scheme)
  → color-schemes.ts mutator (writes localStorage cache, returns store)
  → use-color-schemes: saveSchemesAsync(tursoConfig, schemes)  [DB when configured]
  → dispatch lop-scheme-change → use-style syncScheme (resolve active from cache, apply inline, mirror boot keys)

Mount / project load
  → loadSchemes() sync cache → immediate paint (boot keys already applied pre-paint)
  → use-color-schemes effect: loadSchemesAsync(tursoConfig)
       → SELECT color_schemes → decode → mirror into cache → (migrate if DB empty & local non-empty) → re-render
```

## Error handling

- DB unreachable / pipeline error on load → fall back to the sync cache (never blank the library, never crash). Unparseable row → skipped.
- DB write failure on save → the localStorage cache still holds the edit; surface via the existing guard-feedback/toast pattern used by other Turso writes (advisory, non-blocking). Never log/echo the authToken.
- `activeId` referencing a scheme absent from both cache and DB → `reconcileBuiltins` resolves to the Harbor default (existing behavior).

## Testing

- `color-schemes-store.test.ts`: localStorage path (no config); Turso path emits `DDL + SELECT` on load and `DDL + DELETE + INSERT*` on save; `rowsToSchemes` decodes/skips bad rows; migration pushes local→DB only when DB empty & local non-empty; string-only SqlArg.
- `color-schemes.test.ts`: `mergeAppliedBranding` now carries logo/favicon; `exportScheme`/`importScheme` round-trip logo/favicon through `sanitizeBranding`.
- `use-color-schemes` behavior (light, as it's coverage-excluded): sync-cache-first, DB refresh reconciles, edit persists to DB.
- `appearance-section` test: branded user scheme shows logo/favicon inputs in the editor and hides the global ones; built-in shows global; Turso hint renders. Settings→General/Appearance is axe-scanned — keep labels/aria intact.
- `TABLE_NAMES` guard: `color_schemes` absent.

## Constraints (CI-enforced)

- `color_schemes` OUT of `TABLE_NAMES` (guard test). Not workspace data → out of user exports, CSV/MD codecs, golden fixtures, recovery `CONFIG_KEYS`. The localStorage cache is swept by `clearAppConfig`'s `lop-app:*` sweep; DB rows persist across a local reset (cross-device by design, mirrors other global Turso stores).
- No new CSP host (Turso already allowlisted), no new secret.
- i18n EN+DE parity for any new strings (edit `i18n.de.ts` via node utf8 write, CRLF anchors, real umlauts).
- Palette/size/dup ratchets: new `.ts` store is data/logic (no palette classes); watch `appearance-section.tsx`/`color-scheme-editor.tsx` size if inputs move in.
- Release only on explicit "release".
