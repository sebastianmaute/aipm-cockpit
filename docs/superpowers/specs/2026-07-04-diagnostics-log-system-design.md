# Diagnostic Log System (Sub-project B) — Design

**Goal:** A structured, secrets-free diagnostic log that a user can export when they hit an issue, for a developer or agent to analyse — unifying the scattered `dataloss-forensics` ring, uncaught errors, storage/sync failures, and key state transitions into one channel.

**Context:** Part of a three-feature thread (B diagnostic log → A guard transparency → C push-to-talk dictation). B is the foundation: A's guard-bails will emit into B; `dataloss-forensics.ts` folds into B. This spec covers B only.

**Approved decisions:**
- Exposure: in-app panel + export bundle (+ a `window.__lopDiag()` devtools global).
- Scope: errors/warnings **and** key state transitions (loads, saves, project/backend switches).
- Redaction: structural — never log secrets; log ids/counts/types/codes/timings; **no free-text content** (task names, notes, emails).
- Architecture: unified diagnostic ring + emit API (Approach 1) + uncaught-error handlers.
- Placement: **Settings → "Diagnostics" section** (System group), also linked from `/recovery`.

---

## Architecture

One-way flow, no React state churn:

```
emit sites  ──logDiag(level, code, fields)──▶  redact  ──▶  capped ring (localStorage: lop-app:diag-log)
                                                                    │
                                          DiagnosticsPanel / window.__lopDiag() / buildDiagnosticBundle()  ◀──┘
```

- **Per-device, out of workspace data.** Key `lop-app:diag-log` → swept by `clearAppConfig`'s `lop-app:*` removal; never in workspace exports, Turso, CSV/MD, or recovery `CONFIG_KEYS`.
- **Never holds secrets.** Redaction happens at write time (`logDiag`), so even a mis-typed emit call cannot persist a secret.
- **Never throws into the app.** Every public function is fully `try/catch`-wrapped (mirrors `dataloss-forensics`).

## Modules

### `diagnostics.ts` (pure, i18n-free core)

```ts
export type DiagLevel = "error" | "warn" | "info";
export interface DiagEvent {
  at: string;            // ISO timestamp
  level: DiagLevel;
  code: string;          // stable dotted code, e.g. "storage.saveFailed", "dataloss.wipeRefused"
  fields?: Record<string, string | number | boolean>; // structured only, redacted
}

export function logDiag(level: DiagLevel, code: string, fields?: Record<string, unknown>): void;
export function readDiagLog(): DiagEvent[];        // newest-first
export function clearDiagLog(): void;
export function buildDiagnosticBundle(): string;   // JSON: { version, generatedAt, env, events }
```

- `DIAG_MAX = 200` (ring cap; newest-first `[entry, ...prev].slice(0, DIAG_MAX)`).
- `logDiag` timestamps with `new Date().toISOString()` (plain fn — not a render body, safe).
- Module-level side effect (guarded by `typeof window`): assigns `window.__lopDiag = readDiagLog`.
- `buildDiagnosticBundle` env block: `APP_VERSION`, `navigator.userAgent`, `navigator.platform`, storage backend **kind** only (`"turso"|"browser"|"local-file"|…`) — **no** URLs, tokens, project ids, or workspace content.

### `diagnostics-redact.ts` (pure, tested hardest)

```ts
export function redactFields(fields?: Record<string, unknown>): Record<string, string | number | boolean> | undefined;
```

- **Secret-key denylist** (case-insensitive substring match): `apikey`, `authtoken`, `apitoken`, `token`, `passphrase`, `password`, `secret`, `authorization`, `bearer` → value replaced with `"[redacted]"`.
- **Type filter:** keep only `string | number | boolean`. Objects/arrays/functions → dropped (prevents accidental workspace-object dumps). A kept `string` is length-capped (`FIELD_MAX = 200`) to avoid free-text floods.
- Returns `undefined` for empty/absent input.

### Uncaught-error handlers (`diagnostics-boot.ts`)

- `registerDiagnosticsGlobalHandlers()` — idempotent; adds `window.onerror` and `window.addEventListener("unhandledrejection")` → `logDiag("error", "uncaught", { message, source })` with a truncated/redacted message. Registered once from a client boot component (`service-worker-registrar`-style or the existing app boot). Never swallows the original handler (chains).

### `DiagnosticsPanel` (presentational, `diagnostics-panel.tsx`)

- Reads `readDiagLog()` on mount + a manual **Refresh**.
- Table: time · level (colour dot via RAG-neutral tokens) · code · fields (compact JSON).
- Buttons: **Copy bundle** (clipboard), **Download bundle** (`.json` via a blob), **Clear**.
- i18n EN+DE for all labels. Palette-safe (AIPM tokens only). Empty state via `EmptyState`.
- Mounted as a **Settings → General/System "Diagnostics" section** (`settings-sections/diagnostics-section.tsx`); a link/section also surfaced on `/recovery`.

## Emit sites wired in B

- **Fold `dataloss-forensics`:** its `recordDataLossEvent` calls become `logDiag`. Codes: `dataloss.wipeRefused` (L3/B refuse), `dataloss.loadEmptyKept` (L2), `dataloss.reloadEmpty`. Keep `window.__lopDataLossLog` as an alias returning the `code.startsWith("dataloss")` slice (back-compat).
- **Storage outcomes:** `reportStorageOutcome`/save-effect/load-effect error paths → `logDiag("error", "storage.*", { kind, hint })`.
- **Key transitions:** load applied, save persisted, project switch, backend change → `logDiag("info", "storage.loaded"|"storage.saved"|"project.switched"|"backend.changed", { projectId?, recordCount?, collections? })` (ids/counts only).
- **Sync catches:** calendar/Jira/timelog push-pull failures already caught → add `logDiag("warn", "sync.*", { entity, status })`.

(Guard-bail transparency across the 496 bare-return sites is **sub-project A**; B only provides `logDiag`.)

## Data model / storage boundary

- `lop-app:diag-log` = `DiagEvent[]` (newest-first, ≤200). Per-device. Validated load (`Array.isArray`, else `[]`).
- OUT of: workspace JSON/CSV/MD exports, Turso (`TABLE_NAMES`), recovery `CONFIG_KEYS`. Swept by `clearAppConfig`.
- Never contains: secrets, tokens, URLs, free-text workspace content.

## Error handling

- All `diagnostics.ts` / `diagnostics-redact.ts` functions swallow their own errors (a broken log must never break the app or a save).
- Bundle download/copy failures show a toast; they don't throw.

## Testing

- **`diagnostics-redact.test.ts`** (hardest): secret-key denylist redacts (incl. nested-key substring like `anthropicApiKey`); non-primitive values dropped; string length cap; empty→undefined.
- **`diagnostics.test.ts`:** append newest-first + timestamp; cap at 200; malformed storage → `[]`, never throws; `buildDiagnosticBundle` contains version+events and **no** denylisted values (assert a seeded secret field is `[redacted]` in the bundle).
- **Fold check:** `dataloss` codes still recorded; `window.__lopDataLossLog()` still returns only the dataloss slice.
- **Panel:** renders events, Copy/Download/Clear wired, empty state, i18n keys present (tsc parity).

## Out of scope (this sub-project)

- Guard-bail audit + wiring (sub-project A).
- Push-to-talk dictation (sub-project C).
- Server-side log aggregation / remote upload (local export only).
- Log levels config UI / filtering beyond the panel table (YAGNI).
