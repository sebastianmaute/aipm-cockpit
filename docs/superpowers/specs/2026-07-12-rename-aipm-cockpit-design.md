# Rename `lop-app` → `aipm-cockpit` — Design Spec

> **Status:** approved design, 2026-07-12. Feature branch `refactor/rename-aipm-cockpit` off clean `main` (0.184.0 "North").
> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. TDD, task-per-commit, `npx tsc --noEmit` + `npm run test:run` after each. NOT a release until the user says "release".

## Goal

Rename the application from `lop-app` to `aipm-cockpit` across every surface — npm package, code/docs, user-facing brand, and the persisted storage namespace — while **carrying every existing user's local data forward** via a flawless one-time boot migration. Repo-dir + GitLab-path rename are human-executed steps documented here.

## Decisions (locked)

- **Namespace:** `aipm-cockpit:` (localStorage prefix); IDB DBs `aipm-cockpit` / `aipm-cockpit-secrets` / `aipm-cockpit-project-handles`; boot keys `aipm-cockpit-style` / `-theme` / `-active-scheme-colors` / `-active-scheme-structural` / `-scheme-supports-dark`.
- **IDB:** copy-migrate all 3 DBs (incl. the non-extractable device CryptoKey), read-back-verify before deleting old.
- **Brand:** manifest `name`/`short_name`/`description` + `layout.tsx` `title` → **"AIPM Cockpit"**.

## Naming map (authoritative)

| Surface | Current | New | Migration? |
|---|---|---|---|
| npm `package.json` `name` | `lop-app` | `aipm-cockpit` | n/a |
| localStorage prefix (~70 keys) | `lop-app:*` | `aipm-cockpit:*` | **yes** (localStorage copy loop) |
| Boot/persisted scheme keys (5) | `lop-style`, `lop-theme`, `lop-active-scheme-colors`, `lop-active-scheme-structural`, `lop-scheme-supports-dark` | `aipm-cockpit-*` | **yes** (explicit list in migration) |
| IndexedDB DBs (3) | `lop-app`, `lop-app-secrets`, `lop-app-project-handles` | `aipm-cockpit`, `aipm-cockpit-secrets`, `aipm-cockpit-project-handles` | **yes** (IDB copy-migrate) |
| Runtime CustomEvents | `lop-style-change`, `lop-theme-change`, `lop-scheme-change`, `lop-secret-unreadable`, `lop-settings-write-failed` | `aipm-cockpit-*` | no (runtime; pure rename) |
| BroadcastChannel | `lop-app:sync` | `aipm-cockpit:sync` | no (runtime) |
| Notification tag | `lop-digest` | `aipm-cockpit-digest` | no (runtime) |
| CSS marker class | `lop-thead` | `aipm-cockpit-thead` | no (class name) |
| Popout `window.name` | `lop-popout-*` | `aipm-cockpit-popout-*` | no (runtime) |
| Brand display | manifest name "List of Open Points Tracker" / "LOP Tracker"; `layout.tsx` title | "AIPM Cockpit" | n/a |

### Explicitly NOT renamed (data/format-compat)

- **`# LOP Tasks` markdown header** (`markdown-codecs-core.ts` encoder + `markdown-codecs-decode.ts` decoder regex `/^#\s+LOP\s+Tasks\b/`). It is a **byte-stable storage-format token**, golden-pinned; user-owned `.md` project files have NO boot-migration path, so renaming it would fail to parse every existing markdown project. It is an internal format marker, not brand-facing. **Left as `# LOP Tasks`.**
- **`LOP-101` etc. in `__fixtures__` / sample data** — fictional Jira issue keys, not brand. Untouched.
- **`DEFAULT_FOOTER_SLOGAN`** — generic tagline, no "LOP" substring. Untouched.

## Component design

### `storage-migration.ts` (new, pure, i18n-free)

Idempotent — every step guarded on target-absent so a partial/interrupted run resumes cleanly and a re-run is a no-op.

```
LEGACY_LS_PREFIX = "lop-app:"; NEW_LS_PREFIX = "aipm-cockpit:"
NONPREFIXED_LS = { "lop-style":"aipm-cockpit-style", "lop-theme":"aipm-cockpit-theme",
  "lop-active-scheme-colors":"aipm-cockpit-active-scheme-colors",
  "lop-active-scheme-structural":"aipm-cockpit-active-scheme-structural",
  "lop-scheme-supports-dark":"aipm-cockpit-scheme-supports-dark" }
IDB_DBS = [["lop-app","aipm-cockpit"],["lop-app-secrets","aipm-cockpit-secrets"],
  ["lop-app-project-handles","aipm-cockpit-project-handles"]]
```

- **`migrateLocalStorage()`** — synchronous. Snapshot keys first (index-shift safe, mirrors `app-reset.ts`). For each `lop-app:`-prefixed key → target = `aipm-cockpit:` + rest; for each entry in `NONPREFIXED_LS` → its mapped target. If `target` absent and `old` present: `setItem(target, getItem(old)); removeItem(old)`. Wrapped in try/catch (private-mode / quota) — never throws.
- **`migrateIndexedDb()`** — async, returns `Promise<void>`. Per `[old,new]`: if `new` exists (has stores) → skip. Else if `old` exists → `copyDatabase(old,new)`; **read-back verify** (record counts per store match) → `deleteDatabase(old)`. On any failure: leave `old` intact, do NOT delete, log via `logDiag("warn", …)` (no secret in the payload). Secrets DB is copied FIRST.
- **`copyDatabase(old,new)`** — open `old`, enumerate `objectStoreNames`, capture each store's `keyPath`/`autoIncrement` + all records (keys + values; the device `CryptoKey` is a structured-cloneable value and survives). Open `new` at v1 with `onupgradeneeded` creating identical stores, then write every record. The device key is a non-extractable `CryptoKey` — it clones opaquely; we never read its bytes.

### Boot script (`boot-theme-script.ts`)

The no-flash IIFE currently reads `lop-style`/`lop-theme`/`lop-active-scheme-colors`/`-structural`/`lop-scheme-supports-dark` pre-paint. Change: **inline the synchronous localStorage rename at the top of the IIFE** (same guarded copy for the 5 scheme keys + the `lop-app:`→`aipm-cockpit:` loop), THEN read the new keys. Keeps the pre-paint no-flash contract under the new names. `layout-boot-script.test.ts` **pins the exact `NO_FLASH_THEME_SCRIPT` string + runtime-evals it** → update that guard in lockstep.

### App-init wiring

`migrateIndexedDb()` is awaited early in the load path **before `hydrateSecretsInto`** (secrets resolve from the new DB) and before the workspace `load()`. Copy-fail degrades to the existing "IndexedDB/WebCrypto unavailable → in-memory" contract (never crash). `migrateLocalStorage()` also called defensively at app init (boot already ran it; the guard makes it a no-op) so SSR/first-client-render and tests that don't run the boot IIFE still migrate.

### Constant + literal renames

- `app-reset.ts`: `LOP_APP_PREFIX = "lop-app:"` → `"aipm-cockpit:"`; `CONFIG_DBS = ["lop-app-secrets","lop-app-project-handles"]` → `aipm-cockpit-*`. (Post-migration only new keys exist, so the sweep targets new names.)
- `style-ci.ts` `STYLE_STORAGE_KEY`, `theme.ts` `THEME_STORAGE_KEY`, `scheme-apply.ts` `ACTIVE_SCHEME_COLORS_KEY`/`SCHEME_SUPPORTS_DARK_KEY`/`ACTIVE_SCHEME_STRUCTURAL_KEY`.
- ~70 inline `"lop-app:…"` literals across `src/app` (`useResizable`/`useDraggable` size keys, store keys, `broadcast-sync` channel, etc.) **and their test literals** — parallel, file-disjoint rename.
- Event strings `lop-*-change` / `lop-secret-unreadable` / `lop-settings-write-failed`, `lop-digest` tag, `lop-thead` class (globals.css + `TABLE_HEAD_CLASS` + `shell-palette-guard`/`palette-chrome-sweep` references), `lop-popout-*` window.name.

### Brand

- `public/manifest.webmanifest`: `name` → "AIPM Cockpit", `short_name` → "AIPM Cockpit", `description` → updated one-liner.
- `src/app/layout.tsx`: `metadata.title` → "AIPM Cockpit".
- `package.json` `name` → `aipm-cockpit`.

### Docs

`AGENTS.md`, `CLAUDE.md`, `README`/`docs` references; memory pointers (post-merge).

## Build order (subagent-driven, TDD)

1. `storage-migration.ts` localStorage half + RED tests (prefix loop, non-prefixed map, idempotency, target-absent guard, private-mode try/catch).
2. IDB copy-migrate half + tests (fake-indexeddb): copies stores/records, **device-key value survives**, verify-before-delete, skip-if-new-exists, fail⇒old-preserved.
3. Wire into boot IIFE + app-init; update the pinned `layout-boot-script.test.ts` eval guard.
4. Rename constants (`app-reset`, `style-ci`, `theme`, `scheme-apply`) + all `lop-app:*` / `lop-*` literals across src + every test literal (parallel by file-disjointness; controller commits).
5. Brand: manifest + layout title + package.json name.
6. Docs: AGENTS.md / CLAUDE.md / memory.
7. Full gates.

## Human-executed steps (documented, not in the code branch)

```bash
# after the code MR merges + session ends
# 1. local dir
mv /c/Projects/lop-app /c/Projects/aipm-cockpit
# 2. GitLab project path (<group>/<subgroup>/lop-app -> aipm-cockpit)
glab api -X PUT projects/<PROJECT_ID> -f path=aipm-cockpit    # or GitLab UI → Settings → Advanced → Change path
# 3. update remote
git remote set-url origin git@gitlab.example.com:<group>/<subgroup>/aipm-cockpit.git
```

## Security / constraints

- **Device-key DB copy MUST be flawless.** Copy `lop-app-secrets` first, read-back-verify, only then delete old. Failure keeps old + degrades to in-memory (existing contract) — sealed secrets never silently lost. Never log/echo secret bytes or the CryptoKey.
- **Idempotent + target-absent guards** — partial runs resume; re-runs no-op; never double-copy over a newer target.
- **Byte-stable serializers untouched** (`# LOP Tasks` header kept) — no golden regen, existing `.md`/`.csv` files still parse.
- **Boot-script guard** (`layout-boot-script.test.ts`) updated in lockstep with the boot string.
- **i18n:** no new persisted key; brand strings are not i18n. If any new UI string is added, EN+DE parity (edit `i18n.de.ts` via node utf8 write, real umlauts).
- **Lint `--max-warnings=0`:** an unused old constant/import after a rename is FATAL — re-check after each extract.

## Verification

- `npx tsc --noEmit`; `npm run test:run`; `npm run build`; `npm run size:check`; `npm run dup:check`; `npm run lint`.
- `npx playwright test e2e/a11y.spec.ts --project=chromium` (5-combo scheme axe still green — boot keys renamed).
- **Migration manual check:** seed old `lop-app:*` keys + old IDB DBs (incl. a sealed secret), load once → new keys/DBs present, old gone, sealed secret still decrypts, schemes/settings/saved-views intact; reload → no re-migrate churn.
