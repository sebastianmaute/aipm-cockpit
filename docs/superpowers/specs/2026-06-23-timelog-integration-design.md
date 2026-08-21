# Timelog Integration — Design

**Date:** 2026-06-23
**Status:** Approved (design); pending implementation plan.

## Goal

Consume actual time bookings from the company timekeeping tool (Timelog) so the app
can compute win/loss and other time-linked KPIs. Match Timelog identities (people and
projects) to app entities with auto-matching plus manual correction, where a manual
link always overrides an auto link. The integration is enable/disable-able and
configurable (host, tenant, auth) in the Settings → Integrations group.

## Source of truth: timelog-mcp

Reference: `gitlab.example.com/<group>/<subgroup>/timelog-mcp` — an MCP stdio server
that auto-generates tools from the Timelog Web API v1 Swagger. The app is **browser-only**
and cannot run a stdio MCP process, so timelog-mcp is the **API reference**, not a runtime
dependency. The app replicates the relevant REST subset.

Timelog REST API facts (confirmed from the Swagger):
- Base: `https://{host}/{tenant}/api/v1/...` (default `app2.timelog.com` / `Acme`).
  The personal-access-token suffix `-N` maps to `appN`.
- Auth: `Authorization: Bearer <personal-access-token>`.
- Response envelope (TAF): lists are `{ Entities: [{ Properties: {...} }], Properties: { TotalRecord, TotalPage, PageNumber } }`;
  single objects are `{ Properties: {...} }`.
- **Most time-registration reads are self-scoped** (act as the token owner).
  Cross-employee reads require a privileged token via the approval endpoints.

Endpoints used:
- `GET /v1/user` → `UserApiReadModel { UserID, ID, FirstName, LastName, Initials, IsActive, UserType, Email }` — org user list (identity source).
- `GET /v1/user-setting` → `UserSettingApiReadModel` incl. `Privileges` (`PrivilegeApiReadModel { RegistrationAllTasks, ... }`) — capability probe.
- `GET /v1/time-tracking-item/get-by-date?startDate&endDate` → `TimeTrackingItemApiReadModel { ProjectID, ProjectName, ProjectNo, TaskID, TaskName, UserID, Date, Hours, BillableHours, IsBillable, IsFixedPrice, Status, ... }` — **self-scoped**, project-attributed actual hours.
- `GET /v1/approval/timesheets/get-status-by-period-with-rejected-time-tracking-items?employeeUserId&startDate&endDate` — **privileged**, per-employee time items (org-wide path).
- `GET /v1/time-registration-financial-data/get-by-date-range?startDate&endDate` → `TimeRegistrationFinancialDataApiReadModel { UserID, Date, TotalActualHour, TotalBillableHour, TotalBillableAmount, BillableCurrencyABB }` — **self-scoped**, per-user/date aggregate (billable-amount cross-check; no project split).

## Key landing point: actuals already exist

The budget engine (`budget-report.ts`) already has `BucketAllocation.actualHours` (per-period
booked-hours ledger) driving `winLossHours` and `winLossValue` in `BucketReport`:
- `winLossHours = budgetHours + spilloverInHours − actualHours`
- `winLossValue` — fixed-price: `revenue − cost`; T&M: `budgetValue − consumedValue`

Today `actualHours` is manual. This feature **auto-populates it from Timelog** (via an
explicit opt-in action) and surfaces booked-vs-budget KPIs. No new win/loss math.

## Decisions (locked)

- **Data scope:** support both — org-wide where the token is privileged, degrade to
  self-only otherwise.
- **Actuals destination:** a non-destructive **overlay store** plus an explicit
  "Apply to budget" action; budget `actualHours` is never silently overwritten.
- **Match depth:** people **and** projects (Timelog User→Resource, Timelog Project→budget bucket).
- **Delivery:** full feature, one MR.
- **Surface:** a dedicated `timelog` nav view (matching tables + KPI panel); KPIs also
  echo into the Budget report. Added to the axe `A11Y_VIEWS` gate.
- **Sync trigger:** manual button only (no auto/scheduled fetch this slice — avoids
  billed/background surprises; mirrors Jira manual-sync precedent).

## Architecture (units)

### 1. Server proxy (SSRF-guarded)
- `src/app/api/timelog/route.ts` + `src/app/api/timelog/_helpers.ts`, mirroring
  `api/jira/_helpers.ts`.
- Allowlist: host must match `*.timelog.com` (covers `app1`–`appN`); HTTPS-only;
  private-IP / IPv6-mapped block; 10s `AbortSignal.timeout`; rate-limit; error sanitized
  to HTTP-status digits only (never token or upstream body).
- Browser passes `{ host, tenant, token, path, query }` in the POST body per request;
  token is used to build the upstream `Authorization: Bearer` header and is **never
  persisted server-side**.
- CSP: **no edit** — browser→`/api/timelog` is same-origin; the server makes the upstream
  call (identical to the Jira proxy).

### 2. Wire layer — `src/app/timelog-api.ts`
Typed browser client over the proxy. Functions:
- `listUsers(creds)` → `TimelogUser[]`
- `getPrivileges(creds)` → `{ registrationAllTasks: boolean }`
- `listTimeItemsSelf(creds, startDate, endDate)` → `TimelogTimeItem[]`
- `listEmployeeTimeItems(creds, employeeUserId, startDate, endDate)` → `TimelogTimeItem[]` (privileged)
- `getFinancialDataSelf(creds, startDate, endDate)` → `TimelogFinancialDay[]`
- `unwrapTaf(json)` helper (Entities/Properties → clean array/object).
- `TimelogError` carrying HTTP-status digits only.

### 3. Config (per-device) — `settings.timelog`
```ts
type TimelogScopeMode = "auto" | "self" | "org";
type TimelogConfig = {
  enabled: boolean;
  host: string;        // e.g. "app2.timelog.com"
  tenant: string;      // e.g. "Acme"
  email: string;       // identifying, plaintext
  apiToken: string;    // sealed secret (blanked on disk)
  scopeMode: TimelogScopeMode;
  tokenInvalidAt?: string; // ISO; set on 401/403, cleared on next success
};
```
- New `SecretId "timelogApiToken"` → the six lockstep edits in `secrets.ts`/`use-secrets.ts`
  (SecretId union, `isSealedSecret` allowlist, `readStore` allowlist loop,
  `migratePlaintextSecrets`, `writeSettings` blank, `hydrateSecretsInto` restore +
  load-effect migrate/hydrate/re-merge), plus a `saveSecretValue("timelogApiToken", …, "device")`
  on edit. Device-sealed (no passphrase UI), exactly like `jiraApiToken`.
- `writeSettings` remains the sole writer of `lop-app:settings` and blanks `apiToken`.
- Renders in `IntegrationsSection`: enable toggle, host, tenant, email, token field,
  scope-mode select, **Test connection** button (→ `listUsers` + `getPrivileges`, shows
  detected scope + user count). `auto` resolves to `org` when `registrationAllTasks`,
  else `self`.

### 4. Mappings (per-project, durable) — `Workspace.timelogLinks`
Persisted as a JSON **blob**, exactly like `Workspace.steeringCommittee`:
- Storage-only, gated `config === undefined` → committee-less / links-less workspaces stay
  byte-stable; **excluded from user exports**.
- CSV `# TIMELOG LINKS` (`config,<json>` row) + MD `## Timelog Links` (fenced JSON) +
  Turso `meta` row `timelog_links` (**reuses the `meta` singleton — NOT a new `TABLE_NAMES`
  entry, NOT a new column**) + JSON + IndexedDB KV slot.
- Adding a field to the nested object costs zero extra write paths.
```ts
type TimelogUserLink = { timelogUserId: number; resourceId: number; manual: boolean };
type TimelogProjectLink = { timelogProjectId: number; bucketId: number | null; manual: boolean };
type TimelogLinks = { userLinks: TimelogUserLink[]; projectLinks: TimelogProjectLink[] };
```
- Pure `sanitizeTimelogLinks(raw): TimelogLinks` (never throws; drops bad ids; dedupes).

### 5. Matching engine — `src/app/timelog-match.ts` (pure, i18n-free)
- `autoMatchUsers(tlUsers, resources, existing): TimelogUserLink[]` — email case-fold
  primary, then `Initials`, then `FirstName+LastName` case-fold. Preserves any `manual:true`
  link; only (re)derives links for still-unmatched Timelog users.
- `autoMatchProjects(tlProjects, buckets, existing): TimelogProjectLink[]` — by project
  name / PO number / project number against `BudgetBucket.name`/`poNumber`.
- Manual link always wins; clearing a link reverts that row to auto-suggestion.
- UI: dedicated `timelog` view with two tables (People, Projects). Each row: Timelog
  entity │ editable app-entity `<select>` │ auto/manual badge │ Clear button. **Row-unique
  accessible names** (e.g. `${match} – ${tlUser.email}`).

### 6. Actuals overlay + KPIs (non-destructive)
- Pure `src/app/timelog-actuals.ts`: `aggregateActuals(items, links) → { byBucket, byResource, unattributed }`.
  `byBucket[bucketId][periodKey] = { hours, billableHours, amount }`. Items whose
  user/project is unmapped land in an explicit `unattributed` total (never dropped silently).
  `periodKey` derived from item `Date` to match the budget period granularity.
- Per-project cache `src/app/timelog-actuals-store.ts`: localStorage
  `lop-app:timelog-actuals` → `{ [projectId]: { fetchedAt: string; aggregates: ActualsByBucket } }`,
  capped most-recent; validated load; per-device; **out of exports/Turso; cleared by
  `clearAppConfig`'s `lop-app:*` sweep** (mirrors `landing-state.ts`).
- Hook `src/app/use-timelog-sync.ts`: on-demand fetch (button). Self mode → `listTimeItemsSelf`.
  Org mode → `listUsers` then serial per-employee `listEmployeeTimeItems` (capability-gated;
  fail-soft per employee). Date range = project span (or rolling window fallback).
  Error-sanitized; popout = read-only (no fetch/apply). Sets/clears `tokenInvalidAt`.
- KPI panel (in the `timelog` view): booked-vs-budget win/loss (reuses `computeBucketReport`
  semantics with overlay `actual`), per-resource booked vs allocated hours, billable %
  (`billableHours / hours`), last-synced timestamp.
- **"Apply to budget"** action: explicit button → diff preview (per bucket·period:
  current `actualHours` → Timelog hours) → confirm → writes `BucketAllocation.actualHours`
  via the existing budget setter (functional updater). Idempotent; never auto-runs.

### 7. Win/loss + other KPIs
- Win/loss: unchanged math; Timelog supplies `actual` hours (and `TotalBillableAmount` as a
  revenue cross-check). Positive `winLossHours` = under budget; positive `winLossValue` = profit.
- Other time KPIs: booked vs allocated per resource; billable ratio; actual vs planned utilisation.

## Error handling
- Proxy sanitizes all failures to status digits; never logs/echoes token or body.
- Connection test surfaces typed, non-sensitive errors.
- 401/403 → reactive `tokenInvalidAt` (mirror Jira), surfaced in Settings.
- Unmapped users/projects never crash → counted as `unattributed`.
- IndexedDB/WebCrypto unavailable → token load degrades to in-memory (never crash), like other secrets.

## Testing
- Pure engines unit + property: `timelog-match` (email/initials/name precedence, manual-wins,
  re-derive-unmatched-only), `timelog-actuals` (aggregation, unattributed routing, period
  bucketing), `sanitizeTimelogLinks` (never-throws, dedupe, bad-id drop).
- Proxy SSRF suite mirroring the Jira helper tests: allowlist (`*.timelog.com` only, reject
  lookalikes), private-IP/IPv6-mapped block, HTTPS-only, timeout, error sanitization, rate-limit.
- TAF unwrap (list/single/raw).
- Secret lockstep: seal on edit, blank on disk, hydrate on load, passphrase-absent path.
- Golden byte-stability: links-less workspace unchanged; with-links round-trips across all
  backends; regenerate `__fixtures__/golden-*` only if a curated sample gains a links blob.
- a11y: matching tables row-unique labels; `timelog` view added to `A11Y_VIEWS`; run the
  axe gate for the new view before push.

## Release
- Bump `src/app/version.ts` (APP_VERSION + milestone), CHANGELOG entry, append a
  `versionHighlightTimelog` key to `APP_HIGHLIGHT_KEYS` (+ EN/DE strings), package.json,
  README badge.
- Add AGENTS.md landmines: Timelog proxy/CSP-self note; self-vs-org scoping; `timelogLinks`
  blob persistence (zero extra write paths); overlay store out of exports; new SecretId lockstep.

## Out of scope (this slice)
- Auto/scheduled fetch; write-back to Timelog (logging time); task-level mapping;
  passphrase-wrapped Timelog token; multi-tenant Timelog hosts beyond host/tenant config.
