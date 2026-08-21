# Turso (libSQL) Storage Backend — Design

**Date:** 2026-05-29
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/0.25.0-turso-storage`
**Context:** Sub-project **T1** — the final piece of the original 5-sub-project Microsoft 365 + Turso request. Independent of MSAL/M365. Adds a new `StorageBackend` (mirrors M2's SharePoint `sp-json` backend) that reads/writes the Workspace JSON blob to a Turso (libSQL) database over the raw HTTP pipeline API. Ships as **0.25.0 "Jemisin"** with a new highlight key. After this, the original request is complete (only S4 — PDF export — remains deferred).

## Goal

Let a user store their entire lop-app Workspace in a Turso database. A new `turso` `StorageKind` joins the existing picker (`browser`, `local-*`, `sp-*`); selecting it reads/writes the workspace as a single JSON blob row via Turso's HTTP pipeline endpoint. Connection (DB URL + auth token) is configured in Settings → Integrations (env-var override), and the Turso toggle — currently gated "coming soon" — becomes interactive.

## Non-goals

- No relational schema — the whole Workspace is one JSON blob in one row (consistent with `local-json` / `sp-json` / browser backends). No per-entity tables, no SQL migrations.
- No `@libsql/client` dependency — hand-rolled `fetch` to the HTTP pipeline API (decision: raw HTTP, consistent with M2/M3/M4).
- No row-level concurrency / optimistic locking — **last-write-wins**, same as the SharePoint backend.
- No multi-database / branch support — a single configured database.
- No server-side proxy — see Security.

## Security (important, documented)

lop-app is a **pure client app with no server**. A browser-side Turso backend therefore means the auth token **necessarily lives in the browser** — in `localStorage` (Settings path) or inlined into the client bundle (`NEXT_PUBLIC_*` env vars are embedded at build time and are NOT secret). There is no architecture in which the token stays server-only here. This mirrors the existing Jira API-token pattern (already persisted in settings). The mitigation we document for the user: **use a scoped Turso token** (single database, least privilege). The spec does not attempt to hide the token; it makes the exposure explicit.

## Architecture

Three units plus wiring — the same shape as M2.

### 1. `src/app/turso-config.ts` (new, pure resolver — like `msal-config.ts`)

```ts
export interface TursoConfig {
  /** HTTPS pipeline base, e.g. "https://db-org.turso.io" (no trailing slash). */
  httpUrl: string;
  authToken: string;
}

/** Resolve Turso connection. Env vars win; Settings values fall back.
 *  Returns null when URL or token is missing, or the URL is unusable. */
export function getTursoConfig(
  settingsUrl?: string,
  settingsToken?: string,
): TursoConfig | null;
```

- Reads `process.env.NEXT_PUBLIC_TURSO_DATABASE_URL` / `NEXT_PUBLIC_TURSO_AUTH_TOKEN`; falls back to the passed settings values.
- URL normalization via a helper `toHttpUrl(raw): string | null`:
  - `libsql://host[/path]` → `https://host[/path]` (strip trailing slash).
  - `https://host` → passed through (strip trailing slash).
  - `http://` or any other scheme / unparseable → `null`.
- Returns `null` if the resolved url is `null` or token is empty (so the backend is "not ready" without throwing at construction).
- Pure + trivially testable (set/clear env, call).

### 2. `src/app/turso-backend.ts` (new — `class TursoBackend implements StorageBackend`)

```ts
import {
  StorageNotReadyError, emptyWorkspace, jsonToWorkspace, workspaceToJson,
  type StorageBackend, type Workspace,
} from "./storage";
import type { TursoConfig } from "./turso-config";

const TABLE_DDL =
  "CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY, data TEXT NOT NULL)";

export class TursoBackend implements StorageBackend {
  readonly kind = "turso" as const;
  constructor(private config: TursoConfig | null) {}

  async isReady(): Promise<boolean> { return this.config !== null; }
  async describe(): Promise<string | null> {
    if (!this.config) return null;
    try { return `Turso: ${new URL(this.config.httpUrl).host}`; }
    catch { return "Turso"; }
  }
  async load(): Promise<Workspace> { /* see below */ }
  async save(workspace: Workspace): Promise<void> { /* see below */ }
  private async runPipeline(stmts: PipelineStmt[]): Promise<PipelineResult[]> { /* see below */ }
}
```

- `load()`: `runPipeline([ddl, { sql: "SELECT data FROM workspace WHERE id = 1" }])`. Read the SELECT result's rows; if no rows → `emptyWorkspace()`; else extract the text cell value → `jsonToWorkspace(value)` (the canonical sanitizing parser — NOT a raw cast). A malformed/garbage blob is handled by `jsonToWorkspace` (returns empty).
- `save(workspace)`: `runPipeline([ddl, { sql: "INSERT INTO workspace (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data", args: [textArg(workspaceToJson(workspace))] }])`. First save auto-creates the table.
- `runPipeline(stmts)`:
  - Throws `StorageNotReadyError("configure Turso first")` when `config` is null.
  - `POST ${config.httpUrl}/v2/pipeline`, headers `{ Authorization: "Bearer "+token, "Content-Type": "application/json" }`, body `{ requests: [...stmts.map(execute), { type: "close" }] }`.
  - `401` → `StorageNotReadyError("Turso auth token rejected. Check the token in Settings.")`.
  - non-ok → `Error("Turso returned ${status}. Try again later.")`.
  - parse JSON; if any element of `results` has `type === "error"` → `Error("Turso error: " + result.error.message)`.
  - returns the `results` array for callers to read.
- Helpers (module-private): `textArg(value)` → `{ type: "text", value }`; `execute(stmt)` → `{ type: "execute", stmt }`; a `firstRowText(results, i)` reader that defensively walks `results[i].response.result.rows[0][0].value` returning `null` when any hop is missing.

**libSQL HTTP pipeline shapes** (for the implementer):
```jsonc
// request body
{ "requests": [
    { "type": "execute", "stmt": { "sql": "…", "args": [ { "type": "text", "value": "…" } ] } },
    { "type": "close" }
] }
// success response
{ "results": [
    { "type": "ok", "response": { "type": "execute",
        "result": { "cols": [{"name":"data"}], "rows": [ [ { "type": "text", "value": "{…json…}" } ] ] } } },
    { "type": "ok", "response": { "type": "close" } }
] }
// per-statement failure element
{ "type": "error", "error": { "message": "…", "code": "…" } }
```

### 3. Wiring

- **`storage.ts`**:
  - `StorageKind` += `"turso"`; `StorageConfig` += `{ kind: "turso" }` (no per-config fields — connection lives in settings).
  - `CreateBackendDeps` += `tursoConfig?: TursoConfig | null`.
  - `createBackend`: `case "turso": return new TursoBackend(deps.tursoConfig ?? null);` (null → not-ready, surfaced via async load/save — same shape as M2's `acquireToken ?? (() => null)`).
  - Import `TursoBackend` + `TursoConfig` at top.
- **`use-storage-backend.ts`**: resolve `const tursoConfig = getTursoConfig(settings.integrations?.turso?.databaseUrl, settings.integrations?.turso?.authToken);` and pass `{ ...existing deps, tursoConfig }` into `createBackend`. Add to the `useMemo` deps.
- **`settings-menu.tsx`**:
  - `TursoIntegrationsSettings` → `{ enabled: boolean; databaseUrl?: string; authToken?: string }` (+ sanitizer reads the two optional strings).
  - Replace the disabled Turso `<label>` with an interactive checkbox (`updateTurso({ enabled })`). When enabled, render a bordered sub-block (like M1's M365 block) with **Database URL** and **Auth token** inputs — each hidden when its env var is set (`NEXT_PUBLIC_TURSO_DATABASE_URL` / `NEXT_PUBLIC_TURSO_AUTH_TOKEN`). Auth token input uses `type="password"`.
  - Add an `updateTurso(patch)` helper mirroring `updateM365`.
- **`storage-config.tsx`**: add a **Turso** option to the Storage Kind picker. Gated/disabled unless `tursoEnabled` (a new prop from settings) AND the config resolves (URL+token present) — mirrors the sp-* `spGateOk` gating. When the option is unavailable, show the same kind of hint used for SharePoint ("Enable Turso in Settings", "Configure Turso URL + token"). Selecting it sets `onChange({ kind: "turso" })`.

### What ships when the toggle is OFF

`turso.enabled` false → the Turso option is disabled in the picker; `getTursoConfig` is only consulted when building the backend; no network calls. Cold start unchanged.

### Edge cases

- **First use (empty DB):** `load()` sees zero rows → `emptyWorkspace()`. First `save()` runs `CREATE TABLE IF NOT EXISTS` then upsert.
- **URL with trailing slash / `libsql://` scheme:** normalized by `toHttpUrl`. `libsql://` and `https://` both work; other schemes → not ready.
- **Token rejected / expired:** 401 → `StorageNotReadyError` with an actionable hint.
- **Malformed stored blob:** `jsonToWorkspace` returns an empty workspace rather than throwing (same as local-json).
- **Config present but DB unreachable / network error:** `fetch` rejects → propagates; the storage layer surfaces the existing generic error path (same as other backends). (Optionally wrap to `Error("Turso unreachable")` — implementer's discretion, mirror sp-backend which lets network rejections propagate.)
- **Token never in URL** — always the `Authorization` header.

## Data flow

```
Settings → enable Turso, enter Database URL + Auth token (or set NEXT_PUBLIC_TURSO_* env)
  ↓
Storage Configuration → pick "Turso"
  ↓
useStorageBackend → getTursoConfig(settings | env) → createBackend({kind:"turso"}, { tursoConfig })
  ↓ load()/save()
POST {httpUrl}/v2/pipeline  (Authorization: Bearer <token>)
  CREATE TABLE IF NOT EXISTS workspace(id,data) ; SELECT|UPSERT ; close
  ↓
workspaceToJson(ws)  ⇄  jsonToWorkspace(row.data)   // canonical sanitizing round-trip
```

## i18n keys (EN + DE)

| Key | EN | DE |
|---|---|---|
| `integrationsTurso` | (exists) | (exists) |
| `integrationsTursoHint` | "Store your workspace in a Turso (libSQL) database. The auth token is stored in this browser — use a scoped token." | "Speichern Sie Ihren Workspace in einer Turso-(libSQL-)Datenbank. Das Auth-Token wird in diesem Browser gespeichert – verwenden Sie ein eingeschränktes Token." |
| `integrationsTursoUrl` | "Database URL" | "Datenbank-URL" |
| `integrationsTursoUrlPlaceholder` | "libsql://your-db.turso.io" | "libsql://ihre-db.turso.io" |
| `integrationsTursoToken` | "Auth token" | "Auth-Token" |
| `integrationsTursoTokenPlaceholder` | "Turso database token" | "Turso-Datenbank-Token" |
| `storageTurso` | "Turso database" | "Turso-Datenbank" |
| `storageTursoNeedsToggle` | "Enable Turso in Settings → Integrations." | "Turso unter Einstellungen → Integrationen aktivieren." |
| `storageTursoNeedsConfig` | "Enter the Turso URL and token in Settings." | "Turso-URL und -Token in den Einstellungen eingeben." |
| `storageTursoDescribe` | "Turso database" | "Turso-Datenbank" |
| `storageTursoAuthRejected` | "Turso auth token rejected. Check the token in Settings." | "Turso-Auth-Token abgelehnt. Token in den Einstellungen prüfen." |
| `versionHighlightTursoStorage` | "Store your workspace in a Turso (libSQL) database: enable Turso in Settings, add your database URL + token, then pick Turso in Storage Configuration." | "Workspace in einer Turso-(libSQL-)Datenbank speichern: Turso in den Einstellungen aktivieren, Datenbank-URL + Token hinzufügen und in der Speicherkonfiguration „Turso" auswählen." |

(`StorageNotReadyError`/`Error` messages thrown by the backend are surfaced by the existing storage error UI; the `storageTurso*` keys cover the UI-facing hints in the picker + toast.)

## Testing

### Unit — `turso-config.test.ts` (new)
- Env vars present → returns them; env absent + settings present → settings; either missing → `null`.
- `libsql://x.turso.io/` → `https://x.turso.io`; `https://x.turso.io` passthrough; `http://…`/garbage → `null`.

### Unit — `turso-backend.test.ts` (new, mock `fetch`)
- `load` on empty DB (SELECT returns no rows) → `emptyWorkspace()`.
- `load` round-trips a stored blob (mock SELECT row with `workspaceToJson(ws)`) → equals `ws` after `jsonToWorkspace`.
- `save` posts a pipeline whose statements include the `CREATE TABLE IF NOT EXISTS` and the upsert with a `{type:"text"}` arg equal to `workspaceToJson(ws)`.
- 401 → `StorageNotReadyError`; a `results[]` element with `type:"error"` → `Error`; `isReady()` false when constructed with `null`, true with config.
- `Authorization: Bearer <token>` header present; request URL is exactly `${httpUrl}/v2/pipeline` (no token in URL).

### Unit — `settings-menu.test.tsx` (extend)
- Turso toggle interactive + persists `integrations.turso.enabled`; URL + token inputs appear when enabled; each input hidden when its env var is `vi.stubEnv`-set.

### Unit — `storage-config.test.tsx` (extend)
- Turso option disabled when `tursoEnabled` false; enabled + selectable when `tursoEnabled` true and config resolves; selecting calls `onChange({ kind: "turso" })`.

### Gates
- `npx tsc --noEmit` 0; `npm run lint` 0; full suite green (existing 1035 + new); coverage ≥ current.

## Release

Minor → **0.25.0 "Jemisin"**. New highlight key `versionHighlightTursoStorage`.

- `src/app/version.ts`: `APP_VERSION = "0.25.0"`; keep `APP_BUILD_DATE = "2026-05-29"`; add 0.25.0 top comment; append `"versionHighlightTursoStorage"` as the LAST `APP_HIGHLIGHT_KEYS` entry.
- `src/app/i18n.ts` + `i18n.de.ts`: all new keys above + the highlight key. (Heed the `i18n.de.ts` ASCII-delimiter gotcha — verify after editing.)
- `CHANGELOG.md`: `[0.25.0] — 2026-05-29 "Jemisin"` — Added (Turso storage backend; single-blob; HTTP pipeline; env-or-settings config) + Changed (Turso sub-toggle interactive — **the original Microsoft 365 + Turso request is now complete**).
- **No new dependencies**; no DESIGN-TOKENS change.

## Plan shape (preview — `writing-plans` expands)

1. `turso-config.ts` resolver (env-or-settings + URL normalization) + tests.
2. `turso-backend.ts` (`TursoBackend` + `runPipeline` + load/save/isReady/describe) + tests (mock fetch).
3. `storage.ts` wiring (StorageKind/StorageConfig/CreateBackendDeps/createBackend) — small, type-checked.
4. `TursoIntegrationsSettings` extension + interactive toggle + URL/token inputs in `settings-menu.tsx` + tests.
5. `storage-config.tsx` Turso picker option (gated) + `use-storage-backend.ts` deps resolution + tests.
6. i18n EN + DE.
7. Release 0.25.0 (version.ts, CHANGELOG).

## What this closes

After 0.25.0, **T1 is done and the entire original 5-part Microsoft 365 + Turso request is complete** (M1 auth, M2 SharePoint storage, M3 Outlook contacts, M4 Outlook calendar, T1 Turso storage). Only **S4 (PDF export)** remains deferred from the earlier batch.
