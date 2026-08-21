# Color-Scheme Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. `npx tsc --noEmit` + `npm run test:run` after each task. FEATURE branch off `main`: `feat/scheme-phase3-db-branding`. NOT a release until the user says "release".

**Goal:** Store a user's custom color schemes in the project database (Turso) so they follow the user across devices, and let a scheme own its logo + favicon (not just slogan/footer).

**Architecture:** A synchronous localStorage cache/fallback (`lop-app:color-schemes`) is retained so every existing sync reader and the no-flash boot path are untouched; when the project has Turso configured, a global `color_schemes` table (kept OUT of `TABLE_NAMES`) is the cross-device source of truth for the user-scheme LIBRARY, while `activeId` stays per-device. `ColorScheme.branding` already types `{logo?, favicon?, slogan?, footerSlogan?}`; Phase 3 makes all four apply on scheme switch and moves the logo/favicon editor into the scheme editor for branded user schemes.

**Tech Stack:** Next.js (forked) / React / TypeScript, Turso (libSQL over `runTursoPipeline`), Vitest, Playwright axe gate.

## File Structure

- **Create `src/app/color-schemes-store.ts`** — dual-backend async persistence (`COLOR_SCHEMES_TABLE`, `loadSchemesAsync`, `saveSchemesAsync`, `rowsToSchemes`, `migrateLocalToDbIfEmpty`). Mirrors `scheduled-jobs-store.ts`. Coverage-gated → fully unit-tested.
- **Create `src/app/branding-image-input.tsx`** — a shared presentational logo/favicon file input (data-URL validation, preview, remove, error, aria-label). Extracted from the duplicated block in `appearance-section.tsx` so the editor can reuse it without tripping the jscpd duplication gate.
- **Modify `src/app/color-schemes.ts`** — `mergeAppliedBranding` carries logo/favicon; helpers unchanged otherwise (they keep writing the localStorage cache synchronously).
- **Modify `src/app/use-color-schemes.ts`** — take `{ config }`, add a DB-refresh effect + migration trigger.
- **Modify `src/app/color-scheme-editor.tsx`** — accept `config`; persist library mutations to DB via `saveSchemesAsync`; DB-refresh on mount; render logo/favicon inputs (via `BrandingImageInput`) for branded user schemes; extend the empty-branding guard to logo/favicon.
- **Modify `src/app/settings-sections/appearance-section.tsx`** — derive `config` from `settings.integrations.turso`, thread to hook + editor; gate the GLOBAL logo/favicon inputs on `activeIsBuiltin`; render a "stored in project database" hint when `config !== null`; use `BrandingImageInput`.
- **Modify `src/app/i18n.ts` + `i18n.de.ts`** — new strings.
- **Tests** alongside each module.

## Reference patterns (read before you start)

- `src/app/scheduled-jobs-store.ts` — the EXACT dual-backend shape to mirror (DDL `IF NOT EXISTS`, `runTursoPipeline`, wipe-then-reinsert, `rowsTo*` decode, `String(v)` args, localStorage fallback, never-throw).
- `src/app/scheduled-jobs-store.test.ts` — how to `vi.mock("./turso-pipeline")` and assert the emitted SQL statements + `TABLE_NAMES` guard.
- `src/app/color-schemes.ts` — the pure helpers + `cleanScheme` (already sanitizes `branding` via `sanitizeBranding`).
- `src/app/turso-config.ts:69` — `getTursoConfig(databaseUrl, authToken)` returns `TursoConfig | null`.

---

## Task 1: `mergeAppliedBranding` carries logo + favicon

**Files:**
- Modify: `src/app/color-schemes.ts:175-184`
- Test: `src/app/color-schemes.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/app/color-schemes.test.ts`:

```ts
import { mergeAppliedBranding } from "./color-schemes";

describe("mergeAppliedBranding: logo + favicon (Phase 3)", () => {
  it("replaces logo/favicon/slogan/footerSlogan from the scheme", () => {
    const current = { logo: "data:image/png;base64,OLD", slogan: "old" };
    const scheme = {
      logo: "data:image/png;base64,NEW",
      favicon: "data:image/png;base64,FAV",
      slogan: "new",
      footerSlogan: "foot",
    };
    expect(mergeAppliedBranding(current, scheme)).toEqual({
      logo: "data:image/png;base64,NEW",
      favicon: "data:image/png;base64,FAV",
      slogan: "new",
      footerSlogan: "foot",
    });
  });

  it("clears logo/favicon when the scheme has none (branded scheme owns all four)", () => {
    const current = { logo: "data:image/png;base64,OLD", favicon: "data:image/png;base64,OLD" };
    expect(mergeAppliedBranding(current, { slogan: "x" })).toEqual({
      logo: undefined,
      favicon: undefined,
      slogan: "x",
      footerSlogan: undefined,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- color-schemes.test.ts -t "logo + favicon"`
Expected: FAIL (current `mergeAppliedBranding` returns `logo` from `current`, not cleared).

- [ ] **Step 3: Implement**

Replace `src/app/color-schemes.ts:175-184`:

```ts
export function mergeAppliedBranding(
  current: BrandingConfig | undefined,
  scheme: BrandingConfig,
): BrandingConfig {
  return {
    ...(current ?? {}),
    logo: scheme.logo,
    favicon: scheme.favicon,
    slogan: scheme.slogan,
    footerSlogan: scheme.footerSlogan,
  };
}
```

Update the JSDoc above it: schemes now OWN logo + favicon + slogan + footerSlogan (all replaced on apply); the global Branding block edits these only for built-in schemes.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- color-schemes.test.ts -t "logo + favicon"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/color-schemes.ts src/app/color-schemes.test.ts
git commit -m "feat(schemes): mergeAppliedBranding carries logo + favicon"
```

---

## Task 2: Confirm export/import round-trips logo + favicon

`exportScheme` already serializes the whole `branding` object and `importScheme` runs it through `cleanScheme` → `sanitizeBranding` (which keeps raster `data:` logo/favicon, bans SVG). This task is a CHARACTERIZATION test — expect it to pass with NO production change; if it fails, fix `cleanScheme`/`exportScheme` to include branding.

**Files:**
- Test: `src/app/color-schemes.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { exportScheme, importScheme } from "./color-schemes";

describe("export/import round-trip: logo + favicon (Phase 3)", () => {
  it("preserves a raster logo + favicon through export→import", () => {
    const scheme = {
      id: "u-1", name: "Mine", supportsDark: false,
      light: { "--AIPM-green": "#4d7000" },
      branding: {
        logo: "data:image/png;base64,AAAA",
        favicon: "data:image/png;base64,BBBB",
        slogan: "s",
      },
    } as const;
    const back = importScheme(exportScheme(scheme as never));
    expect(back?.branding.logo).toBe("data:image/png;base64,AAAA");
    expect(back?.branding.favicon).toBe("data:image/png;base64,BBBB");
    expect(back?.branding.slogan).toBe("s");
  });
});
```

- [ ] **Step 2: Run**

Run: `npm run test:run -- color-schemes.test.ts -t "round-trip: logo"`
Expected: PASS (no code change). If FAIL, ensure `exportScheme` includes `branding` (it does at `color-schemes.ts:186-198`) and `sanitizeBranding` accepts the data-URL prefix used in the test; adjust the test's mime to one `sanitizeBranding` allows (`png/jpeg/webp/gif`).

- [ ] **Step 3: Commit**

```bash
git add src/app/color-schemes.test.ts
git commit -m "test(schemes): guard logo/favicon export-import round-trip"
```

---

## Task 3: `color-schemes-store.ts` — dual-backend async persistence

**Files:**
- Create: `src/app/color-schemes-store.ts`
- Test: `src/app/color-schemes-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/color-schemes-store.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TABLE_NAMES } from "./turso-schema";

const runTursoPipeline = vi.fn();
vi.mock("./turso-pipeline", () => ({ runTursoPipeline: (...a: unknown[]) => runTursoPipeline(...a) }));

import {
  COLOR_SCHEMES_TABLE, loadSchemesAsync, saveSchemesAsync, rowsToSchemes,
} from "./color-schemes-store";
import type { ColorScheme } from "./color-schemes";

const CFG = { databaseUrl: "libsql://x", authToken: "t" } as never;
const scheme = (id: string): ColorScheme => ({
  id, name: id, supportsDark: false, light: { "--AIPM-green": "#4d7000" }, branding: {},
});

beforeEach(() => {
  runTursoPipeline.mockReset();
  localStorage.clear();
});

describe("color-schemes-store", () => {
  it("keeps color_schemes OUT of TABLE_NAMES", () => {
    expect(TABLE_NAMES).not.toContain(COLOR_SCHEMES_TABLE);
    expect(TABLE_NAMES).not.toContain("color_schemes");
  });

  it("no config → reads/writes localStorage only, no pipeline", async () => {
    await saveSchemesAsync(null, [scheme("u-1")]);
    expect(runTursoPipeline).not.toHaveBeenCalled();
    const back = await loadSchemesAsync(null);
    expect(runTursoPipeline).not.toHaveBeenCalled();
    expect(back.map((s) => s.id)).toEqual(["u-1"]);
  });

  it("config → save emits DDL + DELETE + INSERT per scheme with string args", async () => {
    runTursoPipeline.mockResolvedValue([]);
    await saveSchemesAsync(CFG, [scheme("u-1"), scheme("u-2")]);
    const stmts = runTursoPipeline.mock.calls[0][1] as { sql: string; args?: { value: string }[] }[];
    expect(stmts[0].sql).toContain("CREATE TABLE IF NOT EXISTS color_schemes");
    expect(stmts.some((s) => s.sql.startsWith("DELETE FROM color_schemes"))).toBe(true);
    const inserts = stmts.filter((s) => s.sql.startsWith("INSERT INTO color_schemes"));
    expect(inserts).toHaveLength(2);
    expect(typeof inserts[0].args?.[0].value).toBe("string");
  });

  it("config → load decodes rows, skips unparseable", async () => {
    runTursoPipeline.mockResolvedValue([
      undefined,
      { response: { result: { cols: [{ name: "id" }, { name: "data" }], rows: [
        [{ value: "u-1" }, { value: JSON.stringify(scheme("u-1")) }],
        [{ value: "u-2" }, { value: "{not json" }],
      ] } } },
    ]);
    const out = await loadSchemesAsync(CFG);
    expect(out.map((s) => s.id)).toEqual(["u-1"]);
  });

  it("migration: local user schemes pushed to DB only when DB empty", async () => {
    localStorage.setItem("lop-app:color-schemes", JSON.stringify({ schemes: [scheme("u-1")], activeId: "u-1" }));
    // first pipeline call = load (empty rows), second = migration save
    runTursoPipeline
      .mockResolvedValueOnce([undefined, { response: { result: { cols: [{ name: "id" }, { name: "data" }], rows: [] } } }])
      .mockResolvedValueOnce([]);
    const out = await loadSchemesAsync(CFG);
    expect(out.map((s) => s.id)).toEqual(["u-1"]); // returned the migrated local set
    expect(runTursoPipeline).toHaveBeenCalledTimes(2); // load + migration save
  });
});

describe("rowsToSchemes", () => {
  it("returns [] for undefined result", () => {
    expect(rowsToSchemes(undefined)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- color-schemes-store.test.ts`
Expected: FAIL ("Cannot find module './color-schemes-store'").

- [ ] **Step 3: Implement**

Create `src/app/color-schemes-store.ts`:

```ts
// Dual-backend persistence for the USER color-scheme LIBRARY (mirrors
// scheduled-jobs-store.ts). GLOBAL store — its Turso table MUST stay OUT of
// TABLE_NAMES or the workspace save's per-table DELETE would wipe it.
//   config === null -> localStorage (sync cache, the always-available default)
//   config !== null -> global color_schemes table (cross-device), out of TABLE_NAMES.
// Built-in schemes are code-owned (reconcileBuiltins) and NEVER persisted here.
// activeId is per-device and lives in the localStorage cache only, never the DB.
import { runTursoPipeline } from "./turso-pipeline";
import type { PipelineResultLike, SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";
import { loadSchemes, saveSchemes, type ColorScheme } from "./color-schemes";

export const COLOR_SCHEMES_TABLE = "color_schemes";

const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS ${COLOR_SCHEMES_TABLE} (id TEXT PRIMARY KEY, data TEXT)`,
];
const ddl = (): SqlStmt[] => DDL.map((sql) => ({ sql }));
const txt = (value: string) => ({ type: "text" as const, value });
const schemesSelect = (): SqlStmt[] => [{ sql: `SELECT id, data FROM ${COLOR_SCHEMES_TABLE}` }];

function replaceAll(schemes: readonly ColorScheme[]): SqlStmt[] {
  // small set (<=30), edited whole → wipe-then-reinsert keeps load == save.
  const stmts: SqlStmt[] = [{ sql: `DELETE FROM ${COLOR_SCHEMES_TABLE}` }];
  for (const s of schemes) {
    stmts.push({
      sql: `INSERT INTO ${COLOR_SCHEMES_TABLE} (id, data) VALUES (?, ?)`,
      args: [txt(String(s.id)), txt(JSON.stringify(s))],
    });
  }
  return stmts;
}

export function rowsToSchemes(res: PipelineResultLike | undefined): ColorScheme[] {
  const cols = (res?.response?.result?.cols ?? []).map((c) => c?.name ?? "");
  const dataIdx = cols.indexOf("data");
  const rows = res?.response?.result?.rows ?? [];
  const out: ColorScheme[] = [];
  for (const row of rows) {
    const cell = dataIdx >= 0 ? row[dataIdx] : undefined;
    if (cell == null || cell.value == null) continue;
    try {
      const s = JSON.parse(String(cell.value)) as ColorScheme;
      if (s && typeof s === "object" && typeof s.id === "string" && !s.builtIn) out.push(s);
    } catch {
      /* skip an unparseable row rather than fail the whole load */
    }
  }
  return out;
}

/** Load the user-scheme library. Turso config → DB (cross-device); else the
 *  localStorage cache. Never throws — a pipeline error falls back to the cache. */
export async function loadSchemesAsync(config: TursoConfig | null): Promise<ColorScheme[]> {
  const localUser = loadSchemes().schemes.filter((s) => !s.builtIn);
  if (!config) return localUser;
  try {
    const results = await runTursoPipeline(config, [...ddl(), ...schemesSelect()]);
    const dbUser = rowsToSchemes(results[DDL.length]);
    if (dbUser.length === 0 && localUser.length > 0) {
      // one-time migration: connecting Turso must not make local schemes vanish.
      await saveSchemesAsync(config, localUser);
      return localUser;
    }
    return dbUser;
  } catch {
    return localUser;
  }
}

/** Persist the user-scheme library. Always writes the localStorage cache
 *  (preserving activeId); Turso config → also mirror to the DB. */
export async function saveSchemesAsync(
  config: TursoConfig | null,
  schemes: readonly ColorScheme[],
): Promise<void> {
  const cur = loadSchemes();
  const builtins = cur.schemes.filter((s) => s.builtIn);
  const userOnly = schemes.filter((s) => !s.builtIn);
  saveSchemes({ schemes: [...builtins, ...userOnly], activeId: cur.activeId });
  if (!config) return;
  await runTursoPipeline(config, [...ddl(), ...replaceAll(userOnly)]);
}
```

> Note: `saveSchemes` persists `{schemes, activeId}` to localStorage; we keep any cached built-ins + activeId intact and only swap the user schemes, so the sync cache stays a faithful mirror for `loadSchemes()` sync readers.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- color-schemes-store.test.ts`
Expected: PASS (all cases). If the migration test double-counts, confirm `saveSchemesAsync` issues exactly one pipeline call.

- [ ] **Step 5: Commit**

```bash
git add src/app/color-schemes-store.ts src/app/color-schemes-store.test.ts
git commit -m "feat(schemes): dual-backend color_schemes store (Turso + localStorage cache)"
```

---

## Task 4: (folded into Task 3) TABLE_NAMES guard

The `TABLE_NAMES` guard assertion is already included in `color-schemes-store.test.ts` (Task 3, first `it`). No separate task. Verify `COLOR_SCHEMES_TABLE` never appears in `TABLE_NAMES` in `turso-schema.ts`.

- [ ] Confirm `grep -n "color_schemes" src/app/turso-schema.ts` returns nothing.

---

## Task 5: `useColorSchemes({ config })` — DB refresh + migration trigger

**Files:**
- Modify: `src/app/use-color-schemes.ts`
- Test: none new (coverage-excluded UI glue; behavior verified via appearance-section test in Task 8).

- [ ] **Step 1: Implement**

Rewrite `src/app/use-color-schemes.ts` body to accept config and refresh from DB:

```ts
"use client";
import { useCallback, useEffect, useState } from "react";
import { loadSchemes, saveSchemes, setActive as persistActive, type SchemeStore } from "./color-schemes";
import { loadSchemesAsync } from "./color-schemes-store";
import { activeSchemeOf, reconcileBuiltins } from "./builtin-schemes";
import type { TursoConfig } from "./turso-config";

const SCHEME_CHANGE_EVENT = "lop-scheme-change";

export interface UseColorSchemesArgs { config: TursoConfig | null }
export interface UseColorSchemes {
  store: SchemeStore;
  activeSupportsDark: boolean;
  refresh: () => void;
  selectScheme: (id: string) => void;
}

export function useColorSchemes({ config }: UseColorSchemesArgs): UseColorSchemes {
  const [store, setStore] = useState<SchemeStore>(() => reconcileBuiltins(loadSchemes()));

  const refresh = useCallback(() => setStore(reconcileBuiltins(loadSchemes())), []);

  // DB refresh: when Turso is configured, pull the cross-device user library,
  // mirror it into the sync cache (preserving activeId), and re-render. Migration
  // (local→DB when DB empty) is handled inside loadSchemesAsync.
  const dbKey = config ? `${config.databaseUrl}` : null;
  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    void loadSchemesAsync(config).then((userSchemes) => {
      if (cancelled) return;
      const cur = loadSchemes();
      const merged = { schemes: [...userSchemes], activeId: cur.activeId };
      saveSchemes(merged);
      setStore(reconcileBuiltins(merged));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbKey]);

  const selectScheme = useCallback((id: string) => {
    setStore(reconcileBuiltins(persistActive(id)));
    window.dispatchEvent(new Event(SCHEME_CHANGE_EVENT));
  }, []);

  return { store, activeSupportsDark: activeSchemeOf(store).supportsDark, refresh, selectScheme };
}
```

> `dbKey` is hoisted to a scalar (exhaustive-deps bans `config.databaseUrl` member deps). `saveSchemes(merged)` writes ONLY the user schemes + activeId to the cache; `reconcileBuiltins` re-injects built-ins for the in-memory store.

- [ ] **Step 2: Verify tsc**

Run: `npx tsc --noEmit`
Expected: FAILS at the call site (`appearance-section.tsx` still calls `useColorSchemes()` with no args) — that is fixed in Task 7. Proceed; the pair of tasks compiles together.

- [ ] **Step 3: Commit**

```bash
git add src/app/use-color-schemes.ts
git commit -m "feat(schemes): useColorSchemes DB refresh + migration (config-aware)"
```

---

## Task 6: Editor persists to DB + owns logo/favicon inputs

**Files:**
- Create: `src/app/branding-image-input.tsx`
- Modify: `src/app/color-scheme-editor.tsx`
- Modify: `src/app/settings-sections/appearance-section.tsx` (to reuse the extracted input; full wiring in Task 7)
- Test: `src/app/branding-image-input.test.tsx`

- [ ] **Step 1: Write the failing test for the shared input**

Create `src/app/branding-image-input.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrandingImageInput } from "./branding-image-input";

describe("BrandingImageInput", () => {
  it("renders a labeled file input and a remove button when a value is set", () => {
    render(
      <BrandingImageInput
        label="Logo"
        value="data:image/png;base64,AAAA"
        onChange={vi.fn()}
        onRemove={vi.fn()}
        error={null}
      />,
    );
    expect(screen.getByLabelText("Logo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
  });

  it("shows an error message when error is set", () => {
    render(
      <BrandingImageInput label="Favicon" value="" onChange={vi.fn()} onRemove={vi.fn()} error="bad file" />,
    );
    expect(screen.getByText("bad file")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- branding-image-input.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the shared input**

Create `src/app/branding-image-input.tsx` by extracting the logo/favicon input markup currently inline in `appearance-section.tsx` (the `BRANDING_LOGO_FILE_RE` validated `<input type="file">` + preview + Remove button + error `<p>`). Signature:

```tsx
"use client";
import { type ChangeEvent } from "react";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";

export interface BrandingImageInputProps {
  label: string;               // accessible name for the file input
  removeLabel?: string;        // accessible name for the remove button (default "Remove")
  value: string | undefined;   // current data: URL (or empty)
  onChange: (dataUrl: string) => void;
  onRemove: () => void;
  error: string | null;
  invalidMessage?: string;     // message to raise via onError path (caller owns setError)
  onError?: (msg: string) => void;
}

const FILE_RE = /^data:image\/(png|jpeg|webp|gif);base64,/i;
const MAX_BYTES = 512 * 1024;

export function BrandingImageInput(props: BrandingImageInputProps) {
  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      if (!FILE_RE.test(url) || url.length > MAX_BYTES) {
        props.onError?.(props.invalidMessage ?? "Invalid image");
        return;
      }
      props.onChange(url);
    };
    reader.readAsDataURL(file);
  }
  return (
    <div className="flex flex-col gap-1">
      {props.value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={props.value} alt="" className="h-10 w-auto max-w-[8rem] object-contain" />
      ) : null}
      <div className="flex items-center gap-2">
        <label className={`cursor-pointer rounded-md border border-line px-2 py-1 text-sm ${FOCUS_RING} ${TRANSITION}`}>
          {props.label}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="sr-only"
            aria-label={props.label}
            onChange={onFile}
          />
        </label>
        {props.value ? (
          <button
            type="button"
            className={`rounded-md border border-line px-2 py-1 text-sm ${FOCUS_RING} ${TRANSITION}`}
            onClick={props.onRemove}
          >
            {props.removeLabel ?? "Remove"}
          </button>
        ) : null}
      </div>
      {props.error ? <p className="text-sm text-AIPM-pink-strong" role="alert">{props.error}</p> : null}
    </div>
  );
}
```

> Keep the validation identical to the existing appearance logic (raster mime allowlist, size cap). Verify against the current `appearance-section.tsx` handler and match its cap/messages so behavior is unchanged. Palette-safe classes only.

- [ ] **Step 4: Run the input test**

Run: `npm run test:run -- branding-image-input.test.tsx`
Expected: PASS

- [ ] **Step 5: Editor — config prop, DB persistence, logo/favicon for user schemes**

In `src/app/color-scheme-editor.tsx`:
1. Add `config: TursoConfig | null` to `ColorSchemeEditorProps` and destructure it.
2. Import `saveSchemesAsync, loadSchemesAsync` from `./color-schemes-store` and `BrandingImageInput`.
3. After each library mutation, persist to DB. Wrap the existing `setStore(...)` calls (`apply`, `saveNew`, `rename`, `del`, import handler) so the resulting `next.schemes` are pushed:

```ts
function persist(next: SchemeStore) {
  setStore(next);
  void saveSchemesAsync(config, next.schemes.filter((s) => !s.builtIn));
}
```
Replace `setStore(updateScheme(...))` → `persist(updateScheme(...))`, `setStore(next)` in `saveNew`/import → `persist(next)`, `setStore(removeScheme(...))` → `persist(removeScheme(...))`.

4. DB refresh on mount (editor holds its own store):

```ts
const cfgKey = config ? config.databaseUrl : null;
useEffect(() => {
  if (!config) return;
  let cancelled = false;
  void loadSchemesAsync(config).then((userSchemes) => {
    if (cancelled) return;
    setStore((prev) => reconcileBuiltins({ schemes: userSchemes, activeId: prev.activeId }));
  });
  return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [cfgKey]);
```

5. Extend the empty-branding guard for logo/favicon (so a user scheme with only an image still propagates on saveNew/import):

```ts
if (forceBranding || b.slogan?.trim() || b.footerSlogan?.trim() || b.logo || b.favicon) onApplyBranding?.(b);
```

6. Render logo + favicon inputs for a user (non-built-in) scheme, editing the editor's `branding` state:

```tsx
{active && !isBuiltin ? (
  <>
    <BrandingImageInput
      label={t(lang, "brandingLogo")}
      removeLabel={t(lang, "remove")}
      value={branding.logo}
      onChange={(logo) => setBranding((b) => ({ ...b, logo }))}
      onRemove={() => setBranding((b) => ({ ...b, logo: undefined }))}
      error={null}
      invalidMessage={t(lang, "brandingLogoInvalid")}
      onError={(m) => setImportError(m)}
    />
    <BrandingImageInput
      label={t(lang, "brandingFavicon")}
      removeLabel={t(lang, "remove")}
      value={branding.favicon}
      onChange={(favicon) => setBranding((b) => ({ ...b, favicon }))}
      onRemove={() => setBranding((b) => ({ ...b, favicon: undefined }))}
      error={null}
      invalidMessage={t(lang, "brandingFaviconInvalid")}
      onError={(m) => setImportError(m)}
    />
  </>
) : null}
```

> Use EXISTING i18n keys where present (`brandingLogo`, `brandingFavicon`, `remove`). If any are missing, add in Task 7's i18n step. Reuse the current appearance error keys for `invalidMessage`.

- [ ] **Step 6: tsc + editor still renders**

Run: `npx tsc --noEmit` (will still fail at the appearance call sites until Task 7) then `npm run test:run -- color-scheme-editor` if a test exists.

- [ ] **Step 7: Commit**

```bash
git add src/app/branding-image-input.tsx src/app/branding-image-input.test.tsx src/app/color-scheme-editor.tsx
git commit -m "feat(schemes): editor persists library to DB + owns logo/favicon (shared BrandingImageInput)"
```

---

## Task 7: Appearance section — thread config, gate global logo/favicon, DB hint

**Files:**
- Modify: `src/app/settings-sections/appearance-section.tsx`
- Test: `src/app/settings-sections/appearance-section.test.tsx` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/extend `src/app/settings-sections/appearance-section.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppearanceSection } from "./appearance-section";
import { defaultSettings } from "../settings-types";

// jsdom: no matchMedia — stub for useTheme
beforeAll(() => {
  window.matchMedia ||= (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never;
});

describe("AppearanceSection Phase 3", () => {
  it("shows a 'stored in project database' hint when Turso is configured", () => {
    const settings = {
      ...defaultSettings,
      integrations: { ...defaultSettings.integrations, turso: { databaseUrl: "libsql://x", authToken: "t" } },
    };
    render(<AppearanceSection lang="en-US" settings={settings as never} onChange={vi.fn()} />);
    expect(screen.getByText(/stored in the project database/i)).toBeInTheDocument();
  });

  it("hides the hint when no Turso config", () => {
    render(<AppearanceSection lang="en-US" settings={defaultSettings as never} onChange={vi.fn()} />);
    expect(screen.queryByText(/stored in the project database/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- appearance-section.test.tsx`
Expected: FAIL (hint not rendered / hook arg mismatch).

- [ ] **Step 3: Implement**

In `src/app/settings-sections/appearance-section.tsx`:
1. Import `getTursoConfig` from `../turso-config`.
2. Derive config and pass it in:

```ts
const config = getTursoConfig(
  settings.integrations?.turso?.databaseUrl,
  settings.integrations?.turso?.authToken,
);
const { store, activeSupportsDark, refresh, selectScheme } = useColorSchemes({ config });
```
3. Pass `config` to the editor: `<ColorSchemeEditor ... config={config} />`.
4. Gate the GLOBAL logo/favicon inputs the same way app-name/footer are gated — wrap them in `{activeIsBuiltin && ( ... )}` (a branded user scheme owns its logo/favicon in the editor now). Replace the inline logo/favicon markup with `<BrandingImageInput>` for consistency (reuses the extracted component; keeps the `setBranding` writes to `settings.branding`).
5. Add the DB hint near the scheme editor:

```tsx
{config ? (
  <p className="text-sm text-muted-foreground">{t(lang, "schemeStoredInDb")}</p>
) : null}
```

- [ ] **Step 4: Run tsc + test**

Run: `npx tsc --noEmit` (now clean — call site fixed) then `npm run test:run -- appearance-section.test.tsx`
Expected: tsc exit 0; tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/settings-sections/appearance-section.tsx src/app/settings-sections/appearance-section.test.tsx
git commit -m "feat(schemes): appearance threads Turso config, gates global logo/favicon, DB hint"
```

---

## Task 8: i18n strings (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`

- [ ] **Step 1: Add EN keys**

In `src/app/i18n.ts` add (only those not already present — check first):
- `schemeStoredInDb: "Custom schemes are stored in the project database and shared across your devices."`
- `brandingLogoInvalid` / `brandingFaviconInvalid` — reuse existing appearance invalid-image messages if they already exist; otherwise add `"Logo must be a PNG, JPEG, WebP, or GIF image under 512 KB."` and favicon equivalent.
- Confirm `brandingLogo`, `brandingFavicon`, `remove` already exist (they do in the appearance block) — reuse.

- [ ] **Step 2: Add DE keys via node utf8 write**

The Edit tool corrupts umlauts + curls quotes in `i18n.de.ts` (CRLF file). Add the German strings with a node script anchored on `\r\n`, real umlauts (`\uXXXX` escapes), e.g. `schemeStoredInDb: "Eigene Farbschemata werden in der Projektdatenbank gespeichert und geräteübergreifend geteilt."` (verify wording; use real ä/ü/ß). Follow the `i18n-de-edit-corruption` memory procedure.

- [ ] **Step 3: Verify parity**

Run: `npx tsc --noEmit` (enforces EN/DE key parity) and `npm run test:run -- i18n-encoding.test`
Expected: PASS (no ASCII umlaut substitutions).

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "i18n(schemes): Phase 3 DB hint + branding image strings (EN/DE)"
```

---

## Task 9: Full gate run + axe

**Files:** none (verification).

- [ ] **Step 1: Typecheck + unit**

Run: `npx tsc --noEmit && npm run test:run`
Expected: tsc exit 0; all suites green (coverage floors hold).

- [ ] **Step 2: Build + ratchets**

Run: `npm run build && npm run size:check && npm run dup:check`
Expected: build passes; no NEW >800-line file (watch `color-scheme-editor.tsx` / `appearance-section.tsx` — the `BrandingImageInput` extraction should keep both DOWN); dup under the 1.75 threshold (the shared input removes the appearance/editor logo-input clone).

- [ ] **Step 3: Axe — Settings→Appearance is scanned**

Run: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings"`
Expected: PASS (file inputs carry `aria-label`; hint is plain text; palette-safe).

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: 0 warnings (no unused imports after the moves; exhaustive-deps satisfied via the hoisted `dbKey`/`cfgKey` scalars).

- [ ] **Step 5: Commit any fixups**

```bash
git add -A -- src/app
git commit -m "chore(schemes): Phase 3 gate fixups" || echo "nothing to fix"
```

---

## Verification (end-to-end, manual — before release)

- Connect a project to Turso; create a custom scheme with a logo + favicon + slogan; confirm it applies (sidebar logo + document favicon + slogan change on switch).
- Reload → scheme + branding persist. Open the app on a second device pointed at the same Turso project → the custom scheme appears (cross-device).
- Switch to a built-in scheme → global logo/favicon/app-name inputs reappear; switch back to the user scheme → they hide (exactly one editor per field).
- Disconnect Turso (file mode) → existing local schemes still load (cache); editing works offline.
- Connect Turso for the FIRST time with pre-existing local schemes → they migrate into the DB (don't vanish).
- Export a branded scheme to file, re-import on a fresh profile → logo/favicon survive.

## Constraints recap (CI-enforced)

- `color_schemes` OUT of `TABLE_NAMES` (guard test in `color-schemes-store.test.ts`). Not workspace data → no CSV/MD/golden/export/recovery changes. `SqlArg.value` string-only.
- No new CSP host (Turso allowlisted), no new secret.
- i18n EN/DE parity (tsc); DE via node utf8 write (CRLF, real umlauts).
- Palette/size/dup ratchets green; new `.ts` store is coverage-gated → keep it fully tested.
- Release only on explicit "release".
