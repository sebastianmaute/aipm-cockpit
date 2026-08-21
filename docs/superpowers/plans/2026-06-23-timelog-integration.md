# Timelog Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consume actual time bookings from Timelog, match Timelog people+projects to app resources+budget buckets (auto + manual-overrides-auto), and surface time-linked KPIs (win/loss et al.) non-destructively.

**Architecture:** A server-side SSRF-guarded `/api/timelog` proxy (browser-only app can't reach `app2.timelog.com` directly) mirroring the Jira proxy; a browser wire layer; pure i18n-free matching + aggregation engines; a per-project localStorage actuals cache; durable per-project link mappings persisted as a JSON blob (mirror `steeringCommittee`); a device-sealed `timelogApiToken` (mirror `jiraApiToken`); a dedicated `timelog` nav view + a Settings→Integrations config block; and an explicit "Apply to budget" action that writes the existing `BucketAllocation.actualHours`.

**Tech Stack:** Forked Next.js 16 / React 19 / TypeScript / Tailwind; Vitest (+ fast-check property tests); Playwright (axe gate). Timelog Web API v1 (Bearer token, TAF response envelope).

**Spec:** `docs/superpowers/specs/2026-06-23-timelog-integration-design.md` (read it first).

---

## Conventions every task obeys (project landmines)

- **Lint is fatal** (`--max-warnings=0`): no unused imports/vars after an extract; no `obj.member` in a `useMemo`/`useEffect` dep array (hoist to a scalar local); no `Date.now()`/`Math.random()`/`new Date()` in a render body (use lazy `useState(()=>…)` or read inside an effect/callback); `react-hooks/set-state-in-effect` is banned (use render-time reconcile).
- **`npx tsc --noEmit`** after editing ANY test (tests aren't typechecked by build/vitest). It enforces EN/DE i18n key parity.
- **`Lang`** is `"en-US" | "en-GB" | "de"` — NO `"en"`. DE dict is lazy: a test asserting DE output must `loadI18n("de")` in `beforeAll`.
- **i18n.de.ts** must use real umlauts and is CRLF — edit it via a node utf8 write script (the Edit tool corrupts umlauts + curls quotes), anchor on `\r\n`, then verify. `i18n-encoding` test BANS ASCII subs (fuer/druecken).
- **`t(lang, key, a, b)`** interpolation is 0-based positional: `{0}`/`{1}`.
- Before creating `<name>.ts`, confirm no `<name>.tsx` exists (a bare `./<name>` import resolves `.ts` ahead of `.tsx`).
- New interactive control needs an accessible name; per-row controls in a list need a **row-unique** name (`${label} – ${row.key}`); `placeholder` is NOT a name.
- Apply interaction atoms additively: buttons get `${INTERACTIVE}`; form fields get `${FOCUS_RING} ${TRANSITION}` only.
- Run `npm run test:run`, `npm run lint`, `npx tsc --noEmit` green before each commit. Commit messages: conventional (`feat:`/`test:`/`fix:`); NO attribution trailers (disabled globally).
- Never `git add -A` (would sweep untracked `.agents/`, `skills-lock.json`). Stage explicit paths.

---

## File structure (what each new file owns)

| File | Responsibility |
|---|---|
| `src/app/timelog-types.ts` | `TimelogUser`, `TimelogTimeItem`, `TimelogFinancialDay`, `TimelogUserLink`, `TimelogProjectLink`, `TimelogLinks`, `TimelogConfig`, `TimelogScopeMode` + `defaultTimelogConfig` |
| `src/app/timelog-sanitize.ts` | `sanitizeTimelogLinks`, `sanitizeTimelogConfig` (pure, never throw) |
| `src/app/api/timelog/_helpers.ts` | SSRF-guarded proxy helpers (allowlist `*.timelog.com`, parse, call, forward) |
| `src/app/api/timelog/route.ts` | Single POST proxy route |
| `src/app/timelog-api.ts` | Browser wire layer (`unwrapTaf` + typed endpoint wrappers) |
| `src/app/timelog-match.ts` | Pure `autoMatchUsers`, `autoMatchProjects` (manual-wins) |
| `src/app/timelog-actuals.ts` | Pure `aggregateActuals` → byBucket/byResource/unattributed |
| `src/app/timelog-actuals-store.ts` | Per-project localStorage cache (`lop-app:timelog-actuals`) |
| `src/app/use-timelog-sync.ts` | Fetch hook (self/org, capability-gate, error-sanitize) |
| `src/app/timelog-settings.tsx` | Settings config block (mirror `jira-settings.tsx`) |
| `src/app/timelog-panel.tsx` | The `timelog` view: matching tables + KPI panel + apply-to-budget |
| `src/app/timelog-apply.ts` | Pure plan/apply of overlay actuals → `BucketAllocation.actualHours` |

Modified (clone-from existing): `secrets.ts`, `secrets-store.ts`, `use-settings.ts`, `settings-types.ts`, `workspace.ts`, `sanitize-records.ts` (barrel only), `csv-codecs-*.ts`, `markdown-codecs-*.ts`, `turso-schema.ts`, `browser-backend.ts`, `nav-config.ts`, `nav-icons.tsx`, `feature-modules.ts`, `workspace-panels.tsx`, `workspace-section.tsx`, `settings-sections/integrations-section.tsx`, `i18n.ts`, `i18n.de.ts`, `e2e/a11y.spec.ts`, `version.ts`, `CHANGELOG.md`, `README.md`, `AGENTS.md`.

---

## PHASE 1 — Data foundations (pure, no UI, no network)

### Task 1: Timelog types + sanitizers + config defaults

**Files:**
- Create: `src/app/timelog-types.ts`
- Create: `src/app/timelog-sanitize.ts`
- Create: `src/app/timelog-sanitize.test.ts`

- [ ] **Step 1: Write `timelog-types.ts`** (pure type module, no runtime except the default const)

```ts
// src/app/timelog-types.ts
// Pure, i18n-free type definitions for the Timelog integration.

/** A Timelog organisation user (from GET /v1/user → UserApiReadModel). */
export type TimelogUser = {
  userId: number;        // UserApiReadModel.UserID
  firstName: string;
  lastName: string;
  initials: string;
  email: string;
  isActive: boolean;
};

/** One time-tracking registration (from time-tracking-item endpoints). */
export type TimelogTimeItem = {
  timeRegistrationId: number;
  userId: number;
  projectId: number;
  projectName: string;
  projectNo: string;
  taskId: number;
  date: string;          // ISO "YYYY-MM-DD" (item.Date, date portion)
  hours: number;
  billableHours: number;
  isBillable: boolean;
};

/** Per-user/per-date financial aggregate (financial-data endpoint). */
export type TimelogFinancialDay = {
  userId: number;
  date: string;
  totalActualHour: number;
  totalBillableHour: number;
  totalBillableAmount: number;
  billableCurrency: string;
};

/** Durable mapping: Timelog user → app Resource. `manual` pins it against auto re-derive. */
export type TimelogUserLink = { timelogUserId: number; resourceId: number; manual: boolean };
/** Durable mapping: Timelog project → app budget bucket (null = explicitly unmapped). */
export type TimelogProjectLink = { timelogProjectId: number; bucketId: number | null; manual: boolean };
/** Per-project blob persisted on the Workspace (mirror SteeringCommittee). */
export type TimelogLinks = { userLinks: TimelogUserLink[]; projectLinks: TimelogProjectLink[] };

export type TimelogScopeMode = "auto" | "self" | "org";

/** Per-device connection config (mirror JiraConfig). Lives at settings.timelog (TOP-LEVEL). */
export type TimelogConfig = {
  enabled: boolean;
  host: string;     // e.g. "app2.timelog.com"
  tenant: string;   // e.g. "Acme"
  email: string;    // identifying, plaintext
  apiToken: string; // sealed secret; blanked on disk by writeSettings
  scopeMode: TimelogScopeMode;
  /** ISO timestamp set on a 401/403; cleared on next success. Drives the reactive "rejected" state. */
  tokenInvalidAt?: string;
};

export const defaultTimelogConfig: TimelogConfig = {
  enabled: false,
  host: "app2.timelog.com",
  tenant: "Acme",
  email: "",
  apiToken: "",
  scopeMode: "auto",
};
```

- [ ] **Step 2: Write the failing test** `src/app/timelog-sanitize.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { sanitizeTimelogLinks, sanitizeTimelogConfig } from "./timelog-sanitize";
import { defaultTimelogConfig } from "./timelog-types";

describe("sanitizeTimelogLinks", () => {
  it("returns undefined for non-objects", () => {
    expect(sanitizeTimelogLinks(null)).toBeUndefined();
    expect(sanitizeTimelogLinks(42)).toBeUndefined();
  });
  it("keeps valid links and coerces manual to boolean", () => {
    const out = sanitizeTimelogLinks({
      userLinks: [{ timelogUserId: 5, resourceId: 9, manual: true }],
      projectLinks: [{ timelogProjectId: 3, bucketId: 7, manual: 1 }],
    });
    expect(out).toEqual({
      userLinks: [{ timelogUserId: 5, resourceId: 9, manual: true }],
      projectLinks: [{ timelogProjectId: 3, bucketId: 7, manual: true }],
    });
  });
  it("drops links with non-numeric ids and dedupes by timelog id (last wins)", () => {
    const out = sanitizeTimelogLinks({
      userLinks: [
        { timelogUserId: 5, resourceId: 1, manual: false },
        { timelogUserId: 5, resourceId: 2, manual: true },
        { timelogUserId: "x", resourceId: 3, manual: false },
      ],
      projectLinks: [],
    });
    expect(out).toEqual({
      userLinks: [{ timelogUserId: 5, resourceId: 2, manual: true }],
      projectLinks: [],
    });
  });
  it("accepts bucketId null (explicit unmapped) but drops missing ids", () => {
    const out = sanitizeTimelogLinks({
      userLinks: [],
      projectLinks: [{ timelogProjectId: 3, bucketId: null, manual: false }],
    });
    expect(out?.projectLinks).toEqual([{ timelogProjectId: 3, bucketId: null, manual: false }]);
  });
});

describe("sanitizeTimelogConfig", () => {
  it("falls back to defaults for garbage", () => {
    expect(sanitizeTimelogConfig(null)).toEqual(defaultTimelogConfig);
  });
  it("clamps scopeMode to the allowed set and trims strings", () => {
    const out = sanitizeTimelogConfig({
      enabled: true, host: " app1.timelog.com ", tenant: "acme", email: "a@b.c",
      apiToken: "tok", scopeMode: "bogus",
    });
    expect(out.enabled).toBe(true);
    expect(out.host).toBe("app1.timelog.com");
    expect(out.scopeMode).toBe("auto");
  });
});
```

- [ ] **Step 3: Run it — expect FAIL** (`timelog-sanitize` not found)

Run: `npm run test:run -- timelog-sanitize`
Expected: FAIL "Failed to resolve import ./timelog-sanitize".

- [ ] **Step 4: Write `timelog-sanitize.ts`**

```ts
// src/app/timelog-sanitize.ts
// Pure, i18n-free validators. Never throw; coerce/drop bad input.
import {
  type TimelogLinks, type TimelogUserLink, type TimelogProjectLink,
  type TimelogConfig, type TimelogScopeMode, defaultTimelogConfig,
} from "./timelog-types";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function dedupeLast<T>(items: T[], key: (t: T) => number): T[] {
  const m = new Map<number, T>();
  for (const it of items) m.set(key(it), it);
  return [...m.values()];
}

export function sanitizeTimelogLinks(raw: unknown): TimelogLinks | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const rawUsers = Array.isArray(r.userLinks) ? r.userLinks : [];
  const rawProjects = Array.isArray(r.projectLinks) ? r.projectLinks : [];
  const userLinks: TimelogUserLink[] = dedupeLast(
    rawUsers
      .map((u): TimelogUserLink | null => {
        const o = (u && typeof u === "object" ? u : {}) as Record<string, unknown>;
        if (!isNum(o.timelogUserId) || !isNum(o.resourceId)) return null;
        return { timelogUserId: o.timelogUserId, resourceId: o.resourceId, manual: Boolean(o.manual) };
      })
      .filter((x): x is TimelogUserLink => x !== null),
    (u) => u.timelogUserId,
  );
  const projectLinks: TimelogProjectLink[] = dedupeLast(
    rawProjects
      .map((p): TimelogProjectLink | null => {
        const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
        if (!isNum(o.timelogProjectId)) return null;
        const bucketId = isNum(o.bucketId) ? o.bucketId : o.bucketId === null ? null : null;
        return { timelogProjectId: o.timelogProjectId, bucketId, manual: Boolean(o.manual) };
      })
      .filter((x): x is TimelogProjectLink => x !== null),
    (p) => p.timelogProjectId,
  );
  return { userLinks, projectLinks };
}

const SCOPES: readonly TimelogScopeMode[] = ["auto", "self", "org"];
export function sanitizeTimelogConfig(raw: unknown): TimelogConfig {
  if (!raw || typeof raw !== "object") return { ...defaultTimelogConfig };
  const o = raw as Record<string, unknown>;
  const scopeMode = SCOPES.includes(o.scopeMode as TimelogScopeMode)
    ? (o.scopeMode as TimelogScopeMode)
    : "auto";
  return {
    enabled: o.enabled === true,
    host: str(o.host) || defaultTimelogConfig.host,
    tenant: str(o.tenant) || defaultTimelogConfig.tenant,
    email: str(o.email),
    apiToken: typeof o.apiToken === "string" ? o.apiToken : "",
    scopeMode,
    tokenInvalidAt: typeof o.tokenInvalidAt === "string" ? o.tokenInvalidAt : undefined,
  };
}
```

- [ ] **Step 5: Run — expect PASS**

Run: `npm run test:run -- timelog-sanitize`
Expected: PASS (all cases).

- [ ] **Step 6: Wire `settings.timelog` into the Settings type** (mirror `jira`)

In `src/app/settings-types.ts`: import `{ type TimelogConfig, defaultTimelogConfig }` from `./timelog-types`, add `timelog?: TimelogConfig;` to the `Settings` type (next to `jira`), and add `timelog: defaultTimelogConfig,` to `defaultSettings`. (Leave secret handling to Task 2.)

- [ ] **Step 7: Typecheck + commit**

Run: `npx tsc --noEmit` (Expected: clean) then:
```bash
git add src/app/timelog-types.ts src/app/timelog-sanitize.ts src/app/timelog-sanitize.test.ts src/app/settings-types.ts
git commit -m "feat(timelog): add timelog types, sanitizers, and settings.timelog config"
```

---

### Task 2: Device-sealed `timelogApiToken` secret (lockstep clone of `jiraApiToken`)

**Files:**
- Modify: `src/app/secrets.ts:8` (SecretId union), `:28` (isSealedSecret allowlist)
- Modify: `src/app/secrets-store.ts` (readStore allowlist loop, migratePlaintextSecrets seal+return)
- Modify: `src/app/use-settings.ts` (writeSettings blank, hydrateSecretsInto read+merge)
- Modify: the startup load-effect that migrates/hydrates jira (grep for it)
- Test: extend `src/app/use-settings.secrets.test.ts` (or the nearest secrets test)

**Recipe:** `timelogApiToken` must appear in EVERY place `jiraApiToken` appears. This is a hardcoded-allowlist landmine — a missed site silently drops the ciphertext on read.

- [ ] **Step 1: Enumerate every jira secret site**

Run: `git grep -n "jiraApiToken" -- src`
Expected: a finite list (secrets.ts union + isSealedSecret; secrets-store.ts allowlist loop, migrate params/return/seal-block; use-settings.ts writeSettings blank + hydrate read + merge; the load-effect; existing tests). Record each file:line.

- [ ] **Step 2: Edit `secrets.ts`** (verified anchors)

Line 8 → add `| "timelogApiToken"`:
```ts
export type SecretId = "anthropicApiKey" | "tursoAuthToken" | "jiraApiToken" | "timelogApiToken";
```
Line ~28 in `isSealedSecret` → add the disjunct:
```ts
(s.id === "anthropicApiKey" || s.id === "tursoAuthToken" || s.id === "jiraApiToken" || s.id === "timelogApiToken") &&
```

- [ ] **Step 3: Edit `secrets-store.ts`** — at each site found in Step 1, add `timelogApiToken` beside `jiraApiToken`:
  - the `readStore()` allowlist array (the `as const` id list),
  - `migratePlaintextSecrets` input param `timelogApiToken?: string`, the `const timelogApiToken = (input.timelogApiToken ?? "").trim()`, the `let timelogApiTokenOut = ""`, the `if (timelogApiToken && !loadSealed("timelogApiToken")) { try { saveSealed(await sealDevice("timelogApiToken", timelogApiToken)); } catch { timelogApiTokenOut = timelogApiToken; } }` block, and the return object key,
  - the return TYPE `{ …; timelogApiToken: string }`.

(Use the jira block immediately above as the literal template; copy it, replace `jira`→`timelog`.)

- [ ] **Step 4: Edit `use-settings.ts`**
  - In `writeSettings`, blank the token before persist, mirroring the jira line:
    ```ts
    timelog: settings.timelog ? { ...settings.timelog, apiToken: "" } : settings.timelog,
    ```
  - In `hydrateSecretsInto`, read + merge, mirroring jira:
    ```ts
    const timelogToken = await readDeviceSecret("timelogApiToken"); // same reader jira uses
    // …in the returned object:
    timelog: settings.timelog && timelogToken !== null
      ? { ...settings.timelog, apiToken: timelogToken }
      : settings.timelog,
    ```
  - In the startup load-effect block (the file found in Step 1, likely passing tokens into `migratePlaintextSecrets`), add `timelogApiToken: settings.timelog?.apiToken` to the migrate input and thread the migrated value back exactly as jira is threaded.

- [ ] **Step 5: Write the failing test** (extend the secrets test found in Step 1; mirror the jira hydration test)

```ts
it("hydrateSecretsInto merges the device-sealed timelog apiToken into settings.timelog", async () => {
  saveSealed(await sealDevice("timelogApiToken", "timelog-live"));
  const merged = await hydrateSecretsInto({
    ...defaultSettings,
    timelog: { ...defaultTimelogConfig, apiToken: "" },
  });
  expect(merged.timelog?.apiToken).toBe("timelog-live");
});

it("writeSettings blanks settings.timelog.apiToken on disk", () => {
  writeSettings({ ...defaultSettings, timelog: { ...defaultTimelogConfig, apiToken: "secret" } });
  const onDisk = JSON.parse(window.localStorage.getItem("lop-app:settings")!);
  expect(onDisk.timelog.apiToken).toBe("");
});
```
(Import `defaultTimelogConfig` from `./timelog-types`; `sealDevice` from `./secrets`.)

- [ ] **Step 6: Run test — expect FAIL then PASS**

Run: `npm run test:run -- use-settings.secrets` (or the test file name). Expected: FAIL first (merge/blank not yet wired), PASS after Steps 2–4.

- [ ] **Step 7: Verify completeness + typecheck**

Run: `git grep -n "jiraApiToken" -- src | wc -l` and `git grep -n "timelogApiToken" -- src | wc -l` — the timelog count must be ≥ the jira count (every jira site mirrored, plus the union). Then `npx tsc --noEmit`.

- [ ] **Step 8: Commit**

```bash
git add src/app/secrets.ts src/app/secrets-store.ts src/app/use-settings.ts <load-effect-file> <secrets-test-file>
git commit -m "feat(timelog): device-seal timelogApiToken at rest (mirror jiraApiToken lockstep)"
```

---

### Task 3: Persist `Workspace.timelogLinks` as a JSON blob across all 6 backends (clone `steeringCommittee`)

**Files (clone every `steeringCommittee` / `steering_committee` site):**
- Modify: `src/app/workspace.ts` (Workspace type field + JSON serialize/deserialize)
- Modify: `src/app/sanitize-records.ts` (re-export `sanitizeTimelogLinks` through the barrel)
- Modify: `src/app/csv-codecs-core.ts` (`CSV_SECTION_TIMELOG_LINKS` const), `csv-codecs-config.ts` (encode + emit), `csv-codecs-decode.ts` (decode)
- Modify: `src/app/markdown-codecs-core.ts` (encode + emit), `markdown-codecs-decode.ts` (decode)
- Modify: `src/app/turso-schema.ts` (meta-row read, dirty detect, INSERT)
- Modify: `src/app/browser-backend.ts` (KV slot load + save)
- Test: `src/app/timelog-links-persistence.test.ts` (new) + the golden byte-stability suite stays green

**Recipe:** `timelogLinks` rides the existing `meta` singleton in Turso (key `"timelog_links"`) — NOT a new `TABLE_NAMES` entry, NOT a new column. It is storage-only and EXCLUDED from user exports, gated `undefined` → byte-stable (a links-less workspace serializes identically to today).

- [ ] **Step 1: Enumerate every steering site**

Run: `git grep -ni "steeringcommittee\|steering_committee\|steering committee" -- src`
Expected: the JSON serialize/deserialize lines in `workspace.ts`, the CSV `# STEERING COMMITTEE` encode/emit/decode, the MD `## Steering Committee` encode/emit/decode, the Turso `meta` read/dirty/INSERT, the IndexedDB KV slot, and `sanitizeSteeringCommittee`. Record file:line for each.

- [ ] **Step 2: Add the Workspace field** in `src/app/workspace.ts` next to `steeringCommittee`:
```ts
timelogLinks?: Readonly<TimelogLinks>;
```
Import `type TimelogLinks` from `./timelog-types`. Add the JSON serialize (next to steering):
```ts
...(ws.timelogLinks ? { timelogLinks: ws.timelogLinks } : {}),
```
and deserialize:
```ts
if (p.timelogLinks !== undefined) {
  const links = sanitizeTimelogLinks(p.timelogLinks);
  if (links) raw.timelogLinks = links;
}
```
Import `sanitizeTimelogLinks` from `./timelog-sanitize` (or `./sanitize` if the barrel re-exports it — see Step 3).

- [ ] **Step 3: Barrel re-export** — in `src/app/sanitize-records.ts` add `export { sanitizeTimelogLinks } from "./timelog-sanitize";` only if the codecs import sanitizers from `./sanitize`. (Otherwise import directly from `./timelog-sanitize` at each call site. Pick one; be consistent.)

- [ ] **Step 4: CSV** — in `csv-codecs-core.ts` add `export const CSV_SECTION_TIMELOG_LINKS = "# TIMELOG LINKS";`. In `csv-codecs-config.ts`, clone `steeringCommitteeToCsv`/`csvToSteeringCommittee`:
```ts
export function timelogLinksToCsv(links: TimelogLinks, neutralize = false): string {
  return ["config", csvCellEscape(JSON.stringify(links), neutralize)].join(",");
}
```
and in `workspaceToCsv`, emit ONLY when not a config-scoped export and links present (mirror steering's gate):
```ts
if (config === undefined && ws.timelogLinks)
  csvPush(CSV_SECTION_TIMELOG_LINKS, timelogLinksToCsv(ws.timelogLinks, neutralize));
```
In `csv-codecs-decode.ts`, mirror the steering decode in the section loop: parse the `config,<json>` row → `sanitizeTimelogLinks(JSON.parse(...))` → `ws.timelogLinks = …`.

- [ ] **Step 5: Markdown** — in `markdown-codecs-core.ts` clone the steering fenced-JSON encoder:
```ts
export function timelogLinksToMarkdown(links: TimelogLinks): string {
  return ["## Timelog Links", "", "```json", JSON.stringify(links, null, 2), "```", ""].join("\n");
}
```
emit in `workspaceToMarkdown` with the same `config === undefined && ws.timelogLinks` gate. In `markdown-codecs-decode.ts`, clone the steering section decoder (regex the `## Timelog Links` fenced block → `sanitizeTimelogLinks(JSON.parse(...))`).

- [ ] **Step 6: Turso** — in `turso-schema.ts` clone the three steering sites: meta-row READ (`key === "timelog_links"` → sanitize → `ws.timelogLinks`), dirty detection (`if (prev.timelogLinks !== next.timelogLinks) dirty.add("meta")`), and the INSERT into `meta` (`key="timelog_links"`, `value=JSON.stringify(ws.timelogLinks)`, guarded by `if (ws.timelogLinks)`). Do NOT touch `TABLE_NAMES`.

- [ ] **Step 7: IndexedDB** — in `browser-backend.ts` clone the steering KV slot: a `KV_TIMELOG_LINKS_KEY = "timelogLinks"` const, the load `idbGet` + `sanitizeTimelogLinks`, and the save (`ws.timelogLinks ? idbSet(...) : idbDelete(...)`).

- [ ] **Step 8: Write the round-trip + byte-stability test** `src/app/timelog-links-persistence.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { workspaceToJson, jsonToWorkspace } from "./workspace"; // use the real serializer names
import { workspaceToCsv, csvToWorkspace } from "./csv-codecs";
import { workspaceToMarkdown, markdownToWorkspace } from "./markdown-codecs";
import { emptyWorkspace } from "./workspace"; // or the test helper that builds a minimal ws
import type { TimelogLinks } from "./timelog-types";

const LINKS: TimelogLinks = {
  userLinks: [{ timelogUserId: 11, resourceId: 2, manual: true }],
  projectLinks: [{ timelogProjectId: 99, bucketId: 5, manual: false }],
};

describe("timelogLinks persistence", () => {
  it("survives a JSON round-trip", () => {
    const ws = { ...emptyWorkspace(), timelogLinks: LINKS };
    expect(jsonToWorkspace(workspaceToJson(ws)).timelogLinks).toEqual(LINKS);
  });
  it("survives a CSV round-trip", () => {
    const ws = { ...emptyWorkspace(), timelogLinks: LINKS };
    expect(csvToWorkspace(workspaceToCsv(ws)).timelogLinks).toEqual(LINKS);
  });
  it("survives a Markdown round-trip", () => {
    const ws = { ...emptyWorkspace(), timelogLinks: LINKS };
    expect(markdownToWorkspace(workspaceToMarkdown(ws)).timelogLinks).toEqual(LINKS);
  });
  it("a links-less workspace serializes WITHOUT a timelog section (byte-stable)", () => {
    const csv = workspaceToCsv(emptyWorkspace());
    expect(csv).not.toContain("# TIMELOG LINKS");
    const md = workspaceToMarkdown(emptyWorkspace());
    expect(md).not.toContain("## Timelog Links");
  });
});
```
(Fix the import names to the real serializer exports discovered in Step 1.)

- [ ] **Step 9: Run the new test + the golden suite**

Run: `npm run test:run -- timelog-links-persistence golden-workspace`
Expected: new test PASS; `golden-workspace.test` STILL PASS (links-less sample bytes unchanged — do NOT regenerate fixtures; if golden fails, a gate was added to the non-config path by mistake).

- [ ] **Step 10: Typecheck + commit**

Run: `npx tsc --noEmit`. Then commit the explicit files (workspace.ts, the codec files, turso-schema.ts, browser-backend.ts, sanitize-records.ts if touched, the new test):
```bash
git commit -m "feat(timelog): persist Workspace.timelogLinks as a meta-blob across all backends"
```

---

## PHASE 2 — Server proxy + browser wire layer

### Task 4: SSRF-guarded `/api/timelog` proxy helpers (clone Jira `_helpers.ts`)

**Files:**
- Create: `src/app/api/timelog/_helpers.ts`
- Test: `src/app/api/timelog/_helpers.test.ts`

**Read first:** `src/app/api/jira/_helpers.ts` (the template) and `src/app/api/jira/_rate-limit.ts`.

- [ ] **Step 1: Write the failing SSRF test** `src/app/api/timelog/_helpers.test.ts`

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { parseTimelogRequest, callTimelog, type TimelogCreds } from "./_helpers";

const creds: TimelogCreds = { host: "app2.timelog.com", tenant: "Acme", token: "tok" };
function req(body: unknown): Request {
  return new Request("http://localhost/api/timelog", { method: "POST", body: JSON.stringify(body) });
}
afterEach(() => vi.restoreAllMocks());

describe("timelog proxy SSRF guard", () => {
  it("rejects a non-timelog.com host", async () => {
    const r = await callTimelog({ ...creds, host: "evil.com" }, "/v1/user", { method: "GET" });
    expect(r.status).toBe(400);
  });
  it("rejects a lookalike host (timelog.com.attacker.com)", async () => {
    const r = await callTimelog({ ...creds, host: "app2.timelog.com.attacker.com" }, "/v1/user", { method: "GET" });
    expect(r.status).toBe(400);
  });
  it("rejects a private-IP host", async () => {
    const r = await callTimelog({ ...creds, host: "10.0.0.1" }, "/v1/user", { method: "GET" });
    expect(r.status).toBe(400);
  });
  it("accepts app1..app9.timelog.com and builds the tenant base path", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await callTimelog({ ...creds, host: "app1.timelog.com", tenant: "acme" }, "/v1/user", { method: "GET" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://app1.timelog.com/acme/api/v1/user",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer tok" }) }),
    );
  });
  it("parseTimelogRequest returns missing-credentials error when fields absent", async () => {
    const out = await parseTimelogRequest(req({ path: "/v1/user" }));
    expect("error" in out && (out.error as Response).status).toBe(400);
  });
  it("parseTimelogRequest rejects a path that does not start with /v1/", async () => {
    const out = await parseTimelogRequest(req({ ...creds, path: "/evil" }));
    expect("error" in out && (out.error as Response).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`./_helpers` not found).

Run: `npm run test:run -- api/timelog/_helpers`

- [ ] **Step 3: Write `_helpers.ts`** — copy Jira's `_helpers.ts` verbatim and adapt: replace `Creds` with `TimelogCreds { host, tenant, token }`; replace `isAllowedJiraHost` with `isAllowedTimelogHost` (suffix `.timelog.com` OR apex `timelog.com`); keep `isPrivateHost`/`mappedIpv4ToDotted` unchanged; add a path allowlist (must match `/^\/v1\//`); build the URL as `https://${host}/${tenant}/api${path}` after validating host; use `Authorization: Bearer ${token}` (NOT Basic); keep the 10s `AbortSignal.timeout`, `cache:"no-store"`, and the 502 catch with `console.error`. Export `TimelogCreds`, `parseCreds`, `parseTimelogRequest`, `callTimelog`, `forwardJsonResponse`.

Skeleton (host guard + call; fill the copied SSRF helpers from Jira):
```ts
import { rateLimit } from "../jira/_rate-limit"; // reuse the existing limiter

export type TimelogCreds = { host: string; tenant: string; token: string };

export function parseCreds(body: unknown): TimelogCreds | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const host = typeof b.host === "string" ? b.host.trim() : "";
  const tenant = typeof b.tenant === "string" ? b.tenant.trim() : "";
  const token = typeof b.token === "string" ? b.token.trim() : "";
  if (!host || !tenant || !token) return null;
  return { host, tenant, token };
}

function isAllowedTimelogHost(h: string): boolean {
  const l = h.toLowerCase();
  return l === "timelog.com" || l.endsWith(".timelog.com");
}
// …copy isPrivateHost + mappedIpv4ToDotted from jira/_helpers.ts verbatim…

function normalizeHost(host: string): string | null {
  // host is a bare hostname (no scheme). Reject IP literals / private / non-timelog.
  const h = host.toLowerCase();
  if (!isAllowedTimelogHost(h)) return null;
  if (isPrivateHost(h)) return null;
  return h;
}

const TIMELOG_UPSTREAM_TIMEOUT_MS = 10_000;

export type TimelogRequest = { creds: TimelogCreds; path: string; query: Record<string, string>; body: Record<string, unknown> };

export async function parseTimelogRequest(request: Request): Promise<{ error: Response } | TimelogRequest> {
  const limited = rateLimit(request);
  if (limited) return { error: limited };
  let body: unknown;
  try { body = await request.json(); } catch { return { error: Response.json({ error: "invalid-json" }, { status: 400 }) }; }
  const creds = parseCreds(body);
  if (!creds) return { error: Response.json({ error: "missing-credentials" }, { status: 400 }) };
  const b = body as Record<string, unknown>;
  const path = typeof b.path === "string" ? b.path : "";
  if (!/^\/v1\//.test(path)) return { error: Response.json({ error: "invalid-path" }, { status: 400 }) };
  const query = (b.query && typeof b.query === "object" ? b.query : {}) as Record<string, string>;
  return { creds, path, query, body: b };
}

export async function callTimelog(creds: TimelogCreds, path: string, init?: RequestInit): Promise<Response> {
  const host = normalizeHost(creds.host);
  if (!host) return Response.json({ error: "invalid-host" }, { status: 400 }) as unknown as Response;
  const url = `https://${host}/${encodeURIComponent(creds.tenant)}/api${path}`;
  try {
    return await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${creds.token}`, Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMELOG_UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    console.error("Timelog upstream fetch failed:", err);
    return Response.json({ error: "upstream-unreachable" }, { status: 502 }) as unknown as Response;
  }
}

export async function forwardJsonResponse(upstream: Response): Promise<Response> {
  const text = await upstream.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: "non-json-response" }; }
  return Response.json(data, { status: upstream.status });
}
```
Note: the URL test asserts the encoded tenant; with `tenant:"acme"` `encodeURIComponent` is a no-op so the expected URL matches.

- [ ] **Step 4: Run — expect PASS.** Run: `npm run test:run -- api/timelog/_helpers`.

- [ ] **Step 5: tsc + commit**

```bash
git add src/app/api/timelog/_helpers.ts src/app/api/timelog/_helpers.test.ts
git commit -m "feat(timelog): SSRF-guarded /api/timelog proxy helpers"
```

---

### Task 5: `/api/timelog` route

**Files:**
- Create: `src/app/api/timelog/route.ts`
- Test: `src/app/api/timelog/route.test.ts`

**Read first:** one Jira route, e.g. `src/app/api/jira/search/route.ts`.

- [ ] **Step 1: Write the failing test** `route.test.ts`

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { POST } from "./route";

afterEach(() => vi.restoreAllMocks());

it("forwards an upstream 200 with the GET query string built from query", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify({ Entities: [] }), { status: 200 }));
  const req = new Request("http://localhost/api/timelog", {
    method: "POST",
    body: JSON.stringify({
      host: "app2.timelog.com", tenant: "Acme", token: "tok",
      path: "/v1/time-tracking-item/get-by-date", query: { startDate: "2026-06-01", endDate: "2026-06-30" },
    }),
  });
  const res = await POST(req);
  expect(res.status).toBe(200);
  const url = fetchMock.mock.calls[0][0] as string;
  expect(url).toContain("/v1/time-tracking-item/get-by-date?startDate=2026-06-01&endDate=2026-06-30");
});

it("returns 400 for a bad path", async () => {
  const req = new Request("http://localhost/api/timelog", {
    method: "POST",
    body: JSON.stringify({ host: "app2.timelog.com", tenant: "Acme", token: "tok", path: "/evil" }),
  });
  expect((await POST(req)).status).toBe(400);
});
```

- [ ] **Step 2: Run — expect FAIL.** Run: `npm run test:run -- api/timelog/route`.

- [ ] **Step 3: Write `route.ts`**

```ts
import { parseTimelogRequest, callTimelog, forwardJsonResponse } from "./_helpers";

export async function POST(request: Request): Promise<Response> {
  const parsed = await parseTimelogRequest(request);
  if ("error" in parsed) return parsed.error;
  const { creds, path, query } = parsed;
  const qs = Object.entries(query)
    .filter(([, v]) => typeof v === "string" && v.length > 0)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const upstream = await callTimelog(creds, qs ? `${path}?${qs}` : path, { method: "GET" });
  return forwardJsonResponse(upstream);
}
```
(GET-only this slice — the app only reads. No body forwarding.)

- [ ] **Step 4: Run — expect PASS.** Run: `npm run test:run -- api/timelog/route`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/timelog/route.ts src/app/api/timelog/route.test.ts
git commit -m "feat(timelog): /api/timelog GET proxy route"
```

---

### Task 6: Browser wire layer `timelog-api.ts`

**Files:**
- Create: `src/app/timelog-api.ts`
- Test: `src/app/timelog-api.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { unwrapTaf, listUsers, listTimeItemsSelf, type TimelogCreds } from "./timelog-api";

const creds: TimelogCreds = { host: "app2.timelog.com", tenant: "Acme", token: "tok" };
afterEach(() => vi.restoreAllMocks());

describe("unwrapTaf", () => {
  it("unwraps a TAF list to an array of Properties", () => {
    const out = unwrapTaf({ Entities: [{ Properties: { UserID: 1 } }, { Properties: { UserID: 2 } }],
      Properties: { TotalRecord: 2 } });
    expect(out).toEqual([{ UserID: 1 }, { UserID: 2 }]);
  });
  it("unwraps a TAF single to a one-element array", () => {
    expect(unwrapTaf({ Properties: { UserID: 9 } })).toEqual([{ UserID: 9 }]);
  });
  it("returns [] for an empty/odd payload", () => {
    expect(unwrapTaf(null)).toEqual([]);
  });
});

describe("listUsers", () => {
  it("POSTs to /api/timelog with the user path and maps fields", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      Entities: [{ Properties: { UserID: 5, FirstName: "Ada", LastName: "L", Initials: "AL", Email: "a@b.c", IsActive: true } }],
    }), { status: 200 }));
    const users = await listUsers(creds);
    expect(users).toEqual([{ userId: 5, firstName: "Ada", lastName: "L", initials: "AL", email: "a@b.c", isActive: true }]);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ host: "app2.timelog.com", tenant: "Acme", token: "tok", path: "/v1/user" });
  });
  it("throws TimelogError carrying only the status digits on a non-200", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
    await expect(listUsers(creds)).rejects.toMatchObject({ status: 401 });
  });
});

describe("listTimeItemsSelf", () => {
  it("maps a time-tracking item to TimelogTimeItem", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      Entities: [{ Properties: { TimeRegistrationID: 1, UserID: 5, ProjectID: 9, ProjectName: "P", ProjectNo: "P1",
        TaskID: 3, Date: "2026-06-10T00:00:00", Hours: 4, BillableHours: 4, IsBillable: true } }],
    }), { status: 200 }));
    const items = await listTimeItemsSelf(creds, "2026-06-01", "2026-06-30");
    expect(items[0]).toEqual({ timeRegistrationId: 1, userId: 5, projectId: 9, projectName: "P", projectNo: "P1",
      taskId: 3, date: "2026-06-10", hours: 4, billableHours: 4, isBillable: true });
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** Run: `npm run test:run -- timelog-api`.

- [ ] **Step 3: Write `timelog-api.ts`**

```ts
// src/app/timelog-api.ts
// Browser wire layer over the /api/timelog proxy. i18n-free.
import type { TimelogUser, TimelogTimeItem, TimelogFinancialDay } from "./timelog-types";

export type TimelogCreds = { host: string; tenant: string; token: string };

export class TimelogError extends Error {
  status: number;
  constructor(status: number) { super(`timelog-http-${status}`); this.name = "TimelogError"; this.status = status; }
}

/** Unwrap the TimeLog API Format envelope to a flat array of Properties objects. */
export function unwrapTaf(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== "object") return [];
  const r = json as Record<string, unknown>;
  if (Array.isArray(r.Entities)) {
    return (r.Entities as unknown[]).map((e) => {
      const o = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
      return (o.Properties && typeof o.Properties === "object" ? o.Properties : o) as Record<string, unknown>;
    });
  }
  if (r.Properties && typeof r.Properties === "object") return [r.Properties as Record<string, unknown>];
  return [];
}

async function call(creds: TimelogCreds, path: string, query: Record<string, string> = {}): Promise<Record<string, unknown>[]> {
  const res = await fetch("/api/timelog", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...creds, path, query }),
  });
  if (!res.ok) throw new TimelogError(res.status);
  return unwrapTaf(await res.json());
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const s = (v: unknown): string => (typeof v === "string" ? v : "");
const dateOnly = (v: unknown): string => s(v).slice(0, 10);

export async function listUsers(creds: TimelogCreds): Promise<TimelogUser[]> {
  return (await call(creds, "/v1/user")).map((p) => ({
    userId: num(p.UserID), firstName: s(p.FirstName), lastName: s(p.LastName),
    initials: s(p.Initials), email: s(p.Email), isActive: p.IsActive !== false,
  }));
}

export async function getPrivileges(creds: TimelogCreds): Promise<{ registrationAllTasks: boolean }> {
  const rows = await call(creds, "/v1/user-setting");
  const privs = (rows[0]?.Privileges ?? {}) as Record<string, unknown>;
  return { registrationAllTasks: privs.RegistrationAllTasks === true };
}

function mapTimeItem(p: Record<string, unknown>): TimelogTimeItem {
  return {
    timeRegistrationId: num(p.TimeRegistrationID), userId: num(p.UserID),
    projectId: num(p.ProjectID), projectName: s(p.ProjectName), projectNo: s(p.ProjectNo),
    taskId: num(p.TaskID), date: dateOnly(p.Date), hours: num(p.Hours),
    billableHours: num(p.BillableHours), isBillable: p.IsBillable === true,
  };
}

export async function listTimeItemsSelf(creds: TimelogCreds, startDate: string, endDate: string): Promise<TimelogTimeItem[]> {
  return (await call(creds, "/v1/time-tracking-item/get-by-date", { startDate, endDate })).map(mapTimeItem);
}

export async function listEmployeeTimeItems(creds: TimelogCreds, employeeUserId: number, startDate: string, endDate: string): Promise<TimelogTimeItem[]> {
  return (await call(creds, "/v1/approval/timesheets/get-status-by-period-with-rejected-time-tracking-items",
    { employeeUserId: String(employeeUserId), startDate, endDate })).map(mapTimeItem);
}

export async function getFinancialDataSelf(creds: TimelogCreds, startDate: string, endDate: string): Promise<TimelogFinancialDay[]> {
  return (await call(creds, "/v1/time-registration-financial-data/get-by-date-range", { startDate, endDate })).map((p) => ({
    userId: num(p.UserID), date: dateOnly(p.Date), totalActualHour: num(p.TotalActualHour),
    totalBillableHour: num(p.TotalBillableHour), totalBillableAmount: num(p.TotalBillableAmount),
    billableCurrency: s(p.BillableCurrencyABB),
  }));
}
```

- [ ] **Step 4: Run — expect PASS.** Run: `npm run test:run -- timelog-api`.

- [ ] **Step 5: Commit**

```bash
git add src/app/timelog-api.ts src/app/timelog-api.test.ts
git commit -m "feat(timelog): browser wire layer (TAF unwrap + typed endpoint wrappers)"
```

---

## PHASE 3 — Pure engines

### Task 7: Identity + project matching engine `timelog-match.ts`

**Files:**
- Create: `src/app/timelog-match.ts`
- Test: `src/app/timelog-match.test.ts`

**Read first:** `types.ts` `Resource` (`id`, `firstName`, `lastName`, `email?`) and `BudgetBucket` (`id`, `name`, `poNumber?`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { autoMatchUsers, autoMatchProjects } from "./timelog-match";
import type { TimelogUser } from "./timelog-types";
import type { Resource, BudgetBucket } from "./types";

const res = (id: number, firstName: string, lastName: string, email?: string): Resource =>
  ({ id, firstName, lastName, email, roleId: null, utilizationMode: "hours", utilization: {} } as Resource);
const tlUser = (userId: number, email: string, initials = "", firstName = "", lastName = ""): TimelogUser =>
  ({ userId, email, initials, firstName, lastName, isActive: true });

describe("autoMatchUsers", () => {
  it("matches by email case-insensitively", () => {
    const links = autoMatchUsers([tlUser(5, "Ada@Acme.com")], [res(2, "Ada", "L", "ada@acme.com")], { userLinks: [], projectLinks: [] });
    expect(links).toContainEqual({ timelogUserId: 5, resourceId: 2, manual: false });
  });
  it("falls back to initials then first+last when no email match", () => {
    const links = autoMatchUsers([tlUser(7, "", "AL")], [res(3, "Ada", "Lovelace")], { userLinks: [], projectLinks: [] });
    // initials AL vs first+last A+L → matches resource 3
    expect(links).toContainEqual({ timelogUserId: 7, resourceId: 3, manual: false });
  });
  it("PRESERVES a manual link and does NOT auto-override it", () => {
    const existing = { userLinks: [{ timelogUserId: 5, resourceId: 99, manual: true }], projectLinks: [] };
    const links = autoMatchUsers([tlUser(5, "ada@acme.com")], [res(2, "Ada", "L", "ada@acme.com")], existing);
    expect(links).toContainEqual({ timelogUserId: 5, resourceId: 99, manual: true });
    expect(links).not.toContainEqual({ timelogUserId: 5, resourceId: 2, manual: false });
  });
  it("does not emit a link when nothing matches", () => {
    const links = autoMatchUsers([tlUser(8, "nobody@x.com")], [res(2, "Ada", "L", "ada@acme.com")], { userLinks: [], projectLinks: [] });
    expect(links.find((l) => l.timelogUserId === 8)).toBeUndefined();
  });
});

describe("autoMatchProjects", () => {
  const bucket = (id: number, name: string, poNumber?: string): BudgetBucket =>
    ({ id, name, poNumber, type: "tm", currency: "EUR", startDate: "", endDate: "", status: "open", allocations: [] } as BudgetBucket);
  it("matches by project name case-insensitively, else PO number", () => {
    const links = autoMatchProjects(
      [{ id: 9, name: "ForgeOps", no: "PO-42" }],
      [bucket(5, "forgeops")],
      { userLinks: [], projectLinks: [] },
    );
    expect(links).toContainEqual({ timelogProjectId: 9, bucketId: 5, manual: false });
  });
  it("preserves a manual project link", () => {
    const existing = { userLinks: [], projectLinks: [{ timelogProjectId: 9, bucketId: 1, manual: true }] };
    const links = autoMatchProjects([{ id: 9, name: "ForgeOps", no: "" }], [bucket(5, "ForgeOps")], existing);
    expect(links).toContainEqual({ timelogProjectId: 9, bucketId: 1, manual: true });
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** Run: `npm run test:run -- timelog-match`.

- [ ] **Step 3: Write `timelog-match.ts`**

```ts
// src/app/timelog-match.ts — pure, i18n-free matching. Manual links always win.
import type { Resource, BudgetBucket } from "./types";
import type { TimelogUser, TimelogLinks, TimelogUserLink, TimelogProjectLink } from "./timelog-types";

const norm = (s: string): string => s.trim().toLowerCase();

export function autoMatchUsers(
  tlUsers: readonly TimelogUser[],
  resources: readonly Resource[],
  existing: TimelogLinks,
): TimelogUserLink[] {
  const manual = existing.userLinks.filter((l) => l.manual);
  const pinned = new Set(manual.map((l) => l.timelogUserId));
  const out: TimelogUserLink[] = [...manual];
  for (const u of tlUsers) {
    if (pinned.has(u.userId)) continue;
    let match: Resource | undefined;
    if (u.email) match = resources.find((r) => r.email && norm(r.email) === norm(u.email));
    if (!match && u.initials) {
      const ini = norm(u.initials);
      match = resources.find((r) => norm(`${r.firstName[0] ?? ""}${r.lastName[0] ?? ""}`) === ini);
    }
    if (!match && (u.firstName || u.lastName))
      match = resources.find((r) => norm(`${r.firstName} ${r.lastName}`) === norm(`${u.firstName} ${u.lastName}`));
    if (match) out.push({ timelogUserId: u.userId, resourceId: match.id, manual: false });
  }
  return out;
}

export type TimelogProjectRef = { id: number; name: string; no: string };

export function autoMatchProjects(
  tlProjects: readonly TimelogProjectRef[],
  buckets: readonly BudgetBucket[],
  existing: TimelogLinks,
): TimelogProjectLink[] {
  const manual = existing.projectLinks.filter((l) => l.manual);
  const pinned = new Set(manual.map((l) => l.timelogProjectId));
  const out: TimelogProjectLink[] = [...manual];
  for (const p of tlProjects) {
    if (pinned.has(p.id)) continue;
    let match = buckets.find((b) => norm(b.name) === norm(p.name));
    if (!match && p.no) match = buckets.find((b) => b.poNumber && norm(b.poNumber) === norm(p.no));
    if (match) out.push({ timelogProjectId: p.id, bucketId: match.id, manual: false });
  }
  return out;
}
```

- [ ] **Step 4: Run — expect PASS.** Run: `npm run test:run -- timelog-match`.

- [ ] **Step 5: Add a property test** `src/app/timelog-match.property.test.ts`

```ts
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { autoMatchUsers } from "./timelog-match";
import type { Resource } from "./types";

describe("autoMatchUsers property", () => {
  it("never overrides a manual link regardless of inputs", () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 50 }), fc.integer({ min: 1, max: 50 }), fc.integer({ min: 51, max: 99 }),
      (tlId, autoRes, manualRes) => {
        const resources = [{ id: autoRes, firstName: "A", lastName: "B", email: "x@y.z" } as Resource];
        const out = autoMatchUsers(
          [{ userId: tlId, email: "x@y.z", initials: "", firstName: "", lastName: "", isActive: true }],
          resources,
          { userLinks: [{ timelogUserId: tlId, resourceId: manualRes, manual: true }], projectLinks: [] },
        );
        const link = out.find((l) => l.timelogUserId === tlId);
        expect(link).toEqual({ timelogUserId: tlId, resourceId: manualRes, manual: true });
      },
    ));
  });
});
```

- [ ] **Step 6: Run + tsc + commit**

Run: `npm run test:run -- timelog-match` then `npx tsc --noEmit`.
```bash
git add src/app/timelog-match.ts src/app/timelog-match.test.ts src/app/timelog-match.property.test.ts
git commit -m "feat(timelog): pure identity + project matching engine (manual overrides auto)"
```

---

### Task 8: Actuals aggregation engine `timelog-actuals.ts`

**Files:**
- Create: `src/app/timelog-actuals.ts`
- Test: `src/app/timelog-actuals.test.ts`

**Period key:** mirror the budget plan's period key. Buckets use `Record<string, number>` keyed by `"YYYY-MM"` (monthly) — derive the period key from the item date's first 7 chars (`"2026-06"`). Document this as the assumed granularity (matches `BucketAllocation.actualHours` monthly keys).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { aggregateActuals } from "./timelog-actuals";
import type { TimelogTimeItem, TimelogLinks } from "./timelog-types";

const item = (userId: number, projectId: number, date: string, hours: number, billable = hours): TimelogTimeItem =>
  ({ timeRegistrationId: 0, userId, projectId, projectName: "", projectNo: "", taskId: 0, date, hours, billableHours: billable, isBillable: billable > 0 });

const links: TimelogLinks = {
  userLinks: [{ timelogUserId: 5, resourceId: 2, manual: false }],
  projectLinks: [{ timelogProjectId: 9, bucketId: 7, manual: false }],
};

describe("aggregateActuals", () => {
  it("sums mapped hours into byBucket[bucketId][period]", () => {
    const out = aggregateActuals([item(5, 9, "2026-06-10", 4), item(5, 9, "2026-06-20", 2)], links);
    expect(out.byBucket[7]["2026-06"]).toEqual({ hours: 6, billableHours: 6 });
  });
  it("aggregates per resource", () => {
    const out = aggregateActuals([item(5, 9, "2026-06-10", 4)], links);
    expect(out.byResource[2]).toEqual({ hours: 4, billableHours: 4 });
  });
  it("routes unmapped user OR unmapped project hours to unattributed (never dropped)", () => {
    const out = aggregateActuals([item(5, 999, "2026-06-10", 3), item(404, 9, "2026-06-10", 5)], links);
    expect(out.unattributed.hours).toBe(8);
    expect(out.byBucket[7]).toBeUndefined();
  });
  it("maps a bucketId:null project link to unattributed", () => {
    const out = aggregateActuals([item(5, 9, "2026-06-10", 4)],
      { userLinks: links.userLinks, projectLinks: [{ timelogProjectId: 9, bucketId: null, manual: true }] });
    expect(out.unattributed.hours).toBe(4);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** Run: `npm run test:run -- timelog-actuals`.

- [ ] **Step 3: Write `timelog-actuals.ts`**

```ts
// src/app/timelog-actuals.ts — pure, i18n-free aggregation of Timelog bookings.
import type { TimelogTimeItem, TimelogLinks } from "./timelog-types";

export type HourCell = { hours: number; billableHours: number };
export type ActualsByBucket = Record<number, Record<string, HourCell>>;
export type ActualsByResource = Record<number, HourCell>;
export type ActualsAggregate = {
  byBucket: ActualsByBucket;
  byResource: ActualsByResource;
  unattributed: HourCell;
};

const periodKey = (isoDate: string): string => isoDate.slice(0, 7); // "YYYY-MM"
const add = (cell: HourCell | undefined, it: TimelogTimeItem): HourCell => ({
  hours: (cell?.hours ?? 0) + it.hours,
  billableHours: (cell?.billableHours ?? 0) + it.billableHours,
});

export function aggregateActuals(items: readonly TimelogTimeItem[], links: TimelogLinks): ActualsAggregate {
  const userToRes = new Map(links.userLinks.map((l) => [l.timelogUserId, l.resourceId]));
  const projToBucket = new Map(links.projectLinks.map((l) => [l.timelogProjectId, l.bucketId]));
  const byBucket: ActualsByBucket = {};
  const byResource: ActualsByResource = {};
  let unattributed: HourCell = { hours: 0, billableHours: 0 };

  for (const it of items) {
    const resourceId = userToRes.get(it.userId);
    const bucketId = projToBucket.get(it.projectId);
    if (resourceId === undefined || bucketId === undefined || bucketId === null) {
      unattributed = add(unattributed, it);
      continue;
    }
    byResource[resourceId] = add(byResource[resourceId], it);
    const pk = periodKey(it.date);
    byBucket[bucketId] ??= {};
    byBucket[bucketId][pk] = add(byBucket[bucketId][pk], it);
  }
  return { byBucket, byResource, unattributed };
}
```

- [ ] **Step 4: Run — expect PASS.** Run: `npm run test:run -- timelog-actuals`.

- [ ] **Step 5: Property test** `src/app/timelog-actuals.property.test.ts` — total hours conserved (sum of byBucket + unattributed === sum of all item hours):

```ts
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { aggregateActuals } from "./timelog-actuals";
import type { TimelogTimeItem, TimelogLinks } from "./timelog-types";

describe("aggregateActuals conservation", () => {
  it("never loses hours", () => {
    fc.assert(fc.property(
      fc.array(fc.record({
        userId: fc.integer({ min: 1, max: 5 }), projectId: fc.integer({ min: 1, max: 5 }),
        hours: fc.integer({ min: 0, max: 8 }),
      })),
      (raw) => {
        const items: TimelogTimeItem[] = raw.map((r) => ({
          timeRegistrationId: 0, userId: r.userId, projectId: r.projectId, projectName: "", projectNo: "",
          taskId: 0, date: "2026-06-10", hours: r.hours, billableHours: r.hours, isBillable: true,
        }));
        const links: TimelogLinks = {
          userLinks: [{ timelogUserId: 1, resourceId: 1, manual: false }],
          projectLinks: [{ timelogProjectId: 1, bucketId: 1, manual: false }],
        };
        const out = aggregateActuals(items, links);
        const bucketSum = Object.values(out.byBucket).flatMap((p) => Object.values(p)).reduce((s, c) => s + c.hours, 0);
        const total = items.reduce((s, i) => s + i.hours, 0);
        expect(bucketSum + out.unattributed.hours).toBe(total);
      },
    ));
  });
});
```

- [ ] **Step 6: Run + tsc + commit**

```bash
git add src/app/timelog-actuals.ts src/app/timelog-actuals.test.ts src/app/timelog-actuals.property.test.ts
git commit -m "feat(timelog): pure actuals aggregation engine (byBucket/byResource/unattributed)"
```

---

### Task 9: Per-project actuals cache `timelog-actuals-store.ts`

**Files:**
- Create: `src/app/timelog-actuals-store.ts`
- Test: `src/app/timelog-actuals-store.test.ts`

**Read first:** `src/app/landing-state.ts` (the per-project localStorage map pattern, capped, validated load). Mirror it. Key: `lop-app:timelog-actuals`. Cleared automatically by `clearAppConfig`'s `lop-app:*` sweep — verify, no extra wiring.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { loadActualsCache, saveActualsCache, TIMELOG_ACTUALS_KEY } from "./timelog-actuals-store";

afterEach(() => window.localStorage.clear());

describe("timelog actuals cache", () => {
  it("round-trips per project", () => {
    saveActualsCache("proj-1", { fetchedAt: "2026-06-23T10:00:00Z", aggregates: { byBucket: { 7: { "2026-06": { hours: 4, billableHours: 4 } } }, byResource: {}, unattributed: { hours: 0, billableHours: 0 } } });
    const got = loadActualsCache("proj-1");
    expect(got?.aggregates.byBucket[7]["2026-06"].hours).toBe(4);
  });
  it("returns undefined for an unknown project and for corrupt JSON", () => {
    expect(loadActualsCache("missing")).toBeUndefined();
    window.localStorage.setItem(TIMELOG_ACTUALS_KEY, "{not json");
    expect(loadActualsCache("x")).toBeUndefined();
  });
  it("keeps entries isolated per project", () => {
    saveActualsCache("a", { fetchedAt: "t", aggregates: { byBucket: {}, byResource: {}, unattributed: { hours: 1, billableHours: 0 } } });
    saveActualsCache("b", { fetchedAt: "t", aggregates: { byBucket: {}, byResource: {}, unattributed: { hours: 2, billableHours: 0 } } });
    expect(loadActualsCache("a")?.aggregates.unattributed.hours).toBe(1);
    expect(loadActualsCache("b")?.aggregates.unattributed.hours).toBe(2);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** Run: `npm run test:run -- timelog-actuals-store`.

- [ ] **Step 3: Write `timelog-actuals-store.ts`**

```ts
// src/app/timelog-actuals-store.ts — per-device, per-project Timelog actuals cache.
// Out of exports/Turso; cleared by clearAppConfig's lop-app:* sweep. Mirrors landing-state.ts.
import type { ActualsAggregate } from "./timelog-actuals";

export const TIMELOG_ACTUALS_KEY = "lop-app:timelog-actuals";
const MAX_PROJECTS = 50;

export type ActualsCacheEntry = { fetchedAt: string; aggregates: ActualsAggregate };
type CacheMap = Record<string, ActualsCacheEntry>;

function loadMap(): CacheMap {
  try {
    const raw = window.localStorage.getItem(TIMELOG_ACTUALS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as CacheMap) : {};
  } catch {
    return {};
  }
}

export function loadActualsCache(projectId: string): ActualsCacheEntry | undefined {
  const entry = loadMap()[projectId];
  if (!entry || typeof entry !== "object" || typeof entry.fetchedAt !== "string" || !entry.aggregates) return undefined;
  return entry;
}

export function saveActualsCache(projectId: string, entry: ActualsCacheEntry): void {
  const map = loadMap();
  map[projectId] = entry;
  // Cap to the most-recent MAX_PROJECTS by fetchedAt.
  const keys = Object.keys(map);
  if (keys.length > MAX_PROJECTS) {
    const sorted = keys.sort((a, b) => (map[a].fetchedAt < map[b].fetchedAt ? 1 : -1)).slice(0, MAX_PROJECTS);
    const trimmed: CacheMap = {};
    for (const k of sorted) trimmed[k] = map[k];
    try { window.localStorage.setItem(TIMELOG_ACTUALS_KEY, JSON.stringify(trimmed)); } catch { /* quota — ignore */ }
    return;
  }
  try { window.localStorage.setItem(TIMELOG_ACTUALS_KEY, JSON.stringify(map)); } catch { /* quota — ignore */ }
}
```

- [ ] **Step 4: Run — expect PASS + verify clearAppConfig sweep**

Run: `npm run test:run -- timelog-actuals-store`. Then `git grep -n "lop-app:" src/app/app-reset.ts` to confirm `clearAppConfig` wipes all `lop-app:*` keys (no per-key wiring needed).

- [ ] **Step 5: Commit**

```bash
git add src/app/timelog-actuals-store.ts src/app/timelog-actuals-store.test.ts
git commit -m "feat(timelog): per-project actuals cache (lop-app:timelog-actuals)"
```

---

## PHASE 4 — Hook, settings UI, view, apply-to-budget

### Task 10: Sync hook `use-timelog-sync.ts`

**Files:**
- Create: `src/app/use-timelog-sync.ts`
- Test: `src/app/use-timelog-sync.test.ts`

**Behaviour:** on `sync(dateRange)`: resolve scope (`auto`→probe `getPrivileges`; `self`/`org` forced). Self → `listTimeItemsSelf`. Org → `listUsers` then serial per-employee `listEmployeeTimeItems` (fail-soft per employee — a single employee error is swallowed, others proceed). Aggregate via `aggregateActuals`, persist via `saveActualsCache`. On a `TimelogError` with status 401/403, set `tokenInvalidAt` (via the settings setter) and surface a sanitized error; clear it on success. Popout = read-only (no sync). All errors carry only status digits — never token/body.

- [ ] **Step 1: Write the failing test** (mock `./timelog-api`)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("./timelog-api", () => ({
  TimelogError: class extends Error { status: number; constructor(s: number) { super(); this.status = s; } },
  listUsers: vi.fn(), getPrivileges: vi.fn(),
  listTimeItemsSelf: vi.fn(), listEmployeeTimeItems: vi.fn(),
}));
import * as api from "./timelog-api";
import { useTimelogSync } from "./use-timelog-sync";
import type { TimelogLinks } from "./timelog-types";

const creds = { host: "app2.timelog.com", tenant: "Acme", token: "tok" };
const links: TimelogLinks = { userLinks: [{ timelogUserId: 5, resourceId: 2, manual: false }], projectLinks: [{ timelogProjectId: 9, bucketId: 7, manual: false }] };
beforeEach(() => { vi.clearAllMocks(); window.localStorage.clear(); });

it("self mode aggregates the token user's items and caches them", async () => {
  (api.getPrivileges as any).mockResolvedValue({ registrationAllTasks: false });
  (api.listTimeItemsSelf as any).mockResolvedValue([
    { timeRegistrationId: 1, userId: 5, projectId: 9, projectName: "", projectNo: "", taskId: 0, date: "2026-06-10", hours: 4, billableHours: 4, isBillable: true },
  ]);
  const { result } = renderHook(() => useTimelogSync({ creds, links, scopeMode: "auto", projectId: "p1", isPopout: false, onTokenInvalid: vi.fn(), onTokenValid: vi.fn() }));
  await act(async () => { await result.current.sync("2026-06-01", "2026-06-30"); });
  expect(result.current.aggregates?.byBucket[7]["2026-06"].hours).toBe(4);
});

it("org mode is fail-soft: one employee error does not abort the others", async () => {
  (api.listUsers as any).mockResolvedValue([{ userId: 5, firstName: "", lastName: "", initials: "", email: "", isActive: true }, { userId: 6, firstName: "", lastName: "", initials: "", email: "", isActive: true }]);
  (api.listEmployeeTimeItems as any)
    .mockResolvedValueOnce([{ timeRegistrationId: 1, userId: 5, projectId: 9, projectName: "", projectNo: "", taskId: 0, date: "2026-06-10", hours: 4, billableHours: 4, isBillable: true }])
    .mockRejectedValueOnce(new (api as any).TimelogError(500));
  const { result } = renderHook(() => useTimelogSync({ creds, links, scopeMode: "org", projectId: "p1", isPopout: false, onTokenInvalid: vi.fn(), onTokenValid: vi.fn() }));
  await act(async () => { await result.current.sync("2026-06-01", "2026-06-30"); });
  expect(result.current.aggregates?.byBucket[7]["2026-06"].hours).toBe(4);
});

it("calls onTokenInvalid on a 401", async () => {
  (api.getPrivileges as any).mockResolvedValue({ registrationAllTasks: false });
  (api.listTimeItemsSelf as any).mockRejectedValue(new (api as any).TimelogError(401));
  const onTokenInvalid = vi.fn();
  const { result } = renderHook(() => useTimelogSync({ creds, links, scopeMode: "self", projectId: "p1", isPopout: false, onTokenInvalid, onTokenValid: vi.fn() }));
  await act(async () => { await result.current.sync("2026-06-01", "2026-06-30"); });
  expect(onTokenInvalid).toHaveBeenCalled();
  expect(result.current.error).toBeTruthy();
});

it("popout is read-only: sync is a no-op", async () => {
  const { result } = renderHook(() => useTimelogSync({ creds, links, scopeMode: "self", projectId: "p1", isPopout: true, onTokenInvalid: vi.fn(), onTokenValid: vi.fn() }));
  await act(async () => { await result.current.sync("2026-06-01", "2026-06-30"); });
  expect(api.listTimeItemsSelf).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run — expect FAIL.** Run: `npm run test:run -- use-timelog-sync`.

- [ ] **Step 3: Write `use-timelog-sync.ts`**

```ts
// src/app/use-timelog-sync.ts
import { useCallback, useState } from "react";
import {
  listUsers, getPrivileges, listTimeItemsSelf, listEmployeeTimeItems, TimelogError, type TimelogCreds,
} from "./timelog-api";
import { aggregateActuals, type ActualsAggregate } from "./timelog-actuals";
import { saveActualsCache, loadActualsCache } from "./timelog-actuals-store";
import type { TimelogLinks, TimelogScopeMode, TimelogTimeItem } from "./timelog-types";

type Args = {
  creds: TimelogCreds;
  links: TimelogLinks;
  scopeMode: TimelogScopeMode;
  projectId: string;
  isPopout: boolean;
  onTokenInvalid: () => void;
  onTokenValid: () => void;
};

export function useTimelogSync(args: Args) {
  const cached = loadActualsCache(args.projectId);
  const [aggregates, setAggregates] = useState<ActualsAggregate | undefined>(cached?.aggregates);
  const [fetchedAt, setFetchedAt] = useState<string | undefined>(cached?.fetchedAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<number | null>(null);

  const sync = useCallback(async (startDate: string, endDate: string): Promise<void> => {
    if (args.isPopout) return; // read-only
    setBusy(true);
    setError(null);
    try {
      let scope = args.scopeMode;
      if (scope === "auto") {
        const priv = await getPrivileges(args.creds);
        scope = priv.registrationAllTasks ? "org" : "self";
      }
      let items: TimelogTimeItem[] = [];
      if (scope === "self") {
        items = await listTimeItemsSelf(args.creds, startDate, endDate);
      } else {
        const users = await listUsers(args.creds);
        for (const u of users) {
          try { items = items.concat(await listEmployeeTimeItems(args.creds, u.userId, startDate, endDate)); }
          catch { /* fail-soft per employee */ }
        }
      }
      const agg = aggregateActuals(items, args.links);
      const at = new Date().toISOString(); // in a callback, not render — purity-safe
      setAggregates(agg);
      setFetchedAt(at);
      saveActualsCache(args.projectId, { fetchedAt: at, aggregates: agg });
      args.onTokenValid();
    } catch (e) {
      const status = e instanceof TimelogError ? e.status : 0;
      setError(status || 1);
      if (status === 401 || status === 403) args.onTokenInvalid();
    } finally {
      setBusy(false);
    }
  }, [args]);

  return { aggregates, fetchedAt, busy, error, sync };
}
```

- [ ] **Step 4: Run — expect PASS.** Run: `npm run test:run -- use-timelog-sync`. Then `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-timelog-sync.ts src/app/use-timelog-sync.test.ts
git commit -m "feat(timelog): sync hook (self/org scope, fail-soft, token-invalid signalling)"
```

---

### Task 11: Apply-to-budget engine `timelog-apply.ts`

**Files:**
- Create: `src/app/timelog-apply.ts`
- Test: `src/app/timelog-apply.test.ts`

**Read first:** `types.ts` `BudgetBucket`/`BucketAllocation`. The overlay aggregates hours by bucket+period; a bucket has N role allocations. Rule for this slice: write the bucket's total period hours into the bucket's FIRST allocation's `actualHours[period]` (deterministic, reversible), leaving other allocations untouched; produce a diff first so the UI can preview/confirm.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { planApply, applyActualsToBuckets } from "./timelog-apply";
import type { BudgetBucket } from "./types";
import type { ActualsByBucket } from "./timelog-actuals";

const bucket = (id: number, actual: Record<string, number> = {}): BudgetBucket =>
  ({ id, name: "B", type: "tm", currency: "EUR", startDate: "", endDate: "", status: "open",
     allocations: [{ roleId: 1, resourceIds: [], budgetHours: {}, actualHours: actual }] } as BudgetBucket);

const overlay: ActualsByBucket = { 7: { "2026-06": { hours: 6, billableHours: 6 } } };

describe("planApply", () => {
  it("produces a diff of current→next actualHours per bucket·period", () => {
    const diff = planApply([bucket(7, { "2026-06": 2 })], overlay);
    expect(diff).toContainEqual({ bucketId: 7, period: "2026-06", current: 2, next: 6 });
  });
  it("skips buckets not in the overlay", () => {
    expect(planApply([bucket(8)], overlay)).toEqual([]);
  });
});

describe("applyActualsToBuckets", () => {
  it("writes overlay hours into the first allocation (immutably) and leaves others intact", () => {
    const before = [bucket(7, { "2026-06": 2 })];
    const after = applyActualsToBuckets(before, overlay);
    expect(after[0].allocations[0].actualHours["2026-06"]).toBe(6);
    expect(before[0].allocations[0].actualHours["2026-06"]).toBe(2); // input not mutated
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** Run: `npm run test:run -- timelog-apply`.

- [ ] **Step 3: Write `timelog-apply.ts`**

```ts
// src/app/timelog-apply.ts — pure plan/apply of Timelog overlay actuals into budget allocations.
import type { BudgetBucket } from "./types";
import type { ActualsByBucket } from "./timelog-actuals";

export type ApplyDiffRow = { bucketId: number; period: string; current: number; next: number };

export function planApply(buckets: readonly BudgetBucket[], overlay: ActualsByBucket): ApplyDiffRow[] {
  const rows: ApplyDiffRow[] = [];
  for (const b of buckets) {
    const periods = overlay[b.id];
    if (!periods) continue;
    const first = b.allocations[0];
    for (const [period, cell] of Object.entries(periods)) {
      rows.push({ bucketId: b.id, period, current: first?.actualHours?.[period] ?? 0, next: cell.hours });
    }
  }
  return rows;
}

export function applyActualsToBuckets(buckets: readonly BudgetBucket[], overlay: ActualsByBucket): BudgetBucket[] {
  return buckets.map((b) => {
    const periods = overlay[b.id];
    if (!periods || b.allocations.length === 0) return b;
    const [first, ...rest] = b.allocations;
    const nextActual = { ...first.actualHours };
    for (const [period, cell] of Object.entries(periods)) nextActual[period] = cell.hours;
    return { ...b, allocations: [{ ...first, actualHours: nextActual }, ...rest] };
  });
}
```

- [ ] **Step 4: Run — expect PASS + tsc + commit**

```bash
git add src/app/timelog-apply.ts src/app/timelog-apply.test.ts
git commit -m "feat(timelog): pure apply-to-budget plan/apply engine"
```

---

### Task 12: Settings config block `timelog-settings.tsx` + i18n + wire into IntegrationsSection

**Files:**
- Create: `src/app/timelog-settings.tsx`
- Modify: `src/app/settings-sections/integrations-section.tsx` (render `<TimelogSettings>`)
- Modify: `src/app/i18n.ts` + `src/app/i18n.de.ts` (new keys)
- Test: `src/app/timelog-settings.test.tsx`

**Read first:** `src/app/jira-settings.tsx` (the closest template — enable toggle, fields, the `saveSecretValue("jiraApiToken", value, "device")` call, test-connection button).

- [ ] **Step 1: Add i18n keys (EN)** in `src/app/i18n.ts` — add near the other integration keys:
```
navTimelog: "Time bookings",
timelogTitle: "Timelog time bookings",
timelogEnable: "Enable Timelog integration",
timelogHost: "Host",
timelogTenant: "Tenant",
timelogEmail: "Account email",
timelogToken: "Personal access token",
timelogScope: "Data scope",
timelogScopeAuto: "Auto-detect",
timelogScopeSelf: "My bookings only",
timelogScopeOrg: "Whole organisation",
timelogTest: "Test connection",
timelogTestOk: "Connected — {0} users, scope: {1}",
timelogTestFail: "Connection failed (HTTP {0})",
timelogTokenInvalid: "Token was rejected. Re-enter it.",
timelogMatchPeople: "People",
timelogMatchProjects: "Projects",
timelogMatchAuto: "Auto",
timelogMatchManual: "Manual",
timelogMatchClear: "Clear link",
timelogMatchNone: "— not linked —",
timelogSync: "Fetch bookings",
timelogLastSynced: "Last fetched {0}",
timelogUnattributed: "Unattributed: {0} h",
timelogApply: "Apply to budget",
timelogApplyConfirm: "Apply {0} bucket changes to budget actual hours?",
timelogKpiBooked: "Booked hours",
timelogKpiBillable: "Billable %",
timelogKpiWinLoss: "Win/loss (hours)",
loadingTimelog: "Loading time bookings",
```

- [ ] **Step 2: Add the SAME keys (DE)** in `src/app/i18n.de.ts` via a node utf8 write script (the file is CRLF; the Edit tool corrupts umlauts). Use real umlauts. Example values:
```
navTimelog: "Zeitbuchungen",
timelogTitle: "Timelog-Zeitbuchungen",
timelogEnable: "Timelog-Integration aktivieren",
timelogHost: "Host",
timelogTenant: "Mandant",
timelogEmail: "Konto-E-Mail",
timelogToken: "Persoenlicher Zugriffstoken",   // ← replace 'oe' with real ö before writing
timelogScope: "Datenbereich",
timelogScopeAuto: "Automatisch erkennen",
timelogScopeSelf: "Nur meine Buchungen",
timelogScopeOrg: "Gesamte Organisation",
timelogTest: "Verbindung testen",
timelogTestOk: "Verbunden — {0} Benutzer, Bereich: {1}",
timelogTestFail: "Verbindung fehlgeschlagen (HTTP {0})",
timelogTokenInvalid: "Token wurde abgelehnt. Bitte erneut eingeben.",
timelogMatchPeople: "Personen",
timelogMatchProjects: "Projekte",
timelogMatchAuto: "Auto",
timelogMatchManual: "Manuell",
timelogMatchClear: "Verknuepfung entfernen",   // ← real ü
timelogMatchNone: "— nicht verknuepft —",       // ← real ü
timelogSync: "Buchungen abrufen",
timelogLastSynced: "Zuletzt abgerufen {0}",
timelogUnattributed: "Nicht zugeordnet: {0} h",
timelogApply: "Auf Budget anwenden",
timelogApplyConfirm: "{0} Bucket-Aenderungen auf die Ist-Stunden des Budgets anwenden?",  // ← real Ä
timelogKpiBooked: "Gebuchte Stunden",
timelogKpiBillable: "Abrechenbar %",
timelogKpiWinLoss: "Gewinn/Verlust (Stunden)",
loadingTimelog: "Zeitbuchungen werden geladen",
```
**The 'oe'/'ue'/'Ae' shown above are placeholders for the umlaut chars** — the node write script MUST emit real ö/ü/Ä or the `i18n-encoding` test fails. After writing, run the verify in Step 8.

- [ ] **Step 3: Write `timelog-settings.tsx`** (mirror `jira-settings.tsx`)

```tsx
"use client";
import { useState } from "react";
import { t, type Lang } from "./i18n";
import type { TimelogConfig, TimelogScopeMode } from "./timelog-types";
import { saveSecretValue } from "./use-secrets";
import { listUsers, getPrivileges } from "./timelog-api";
import { FOCUS_RING, TRANSITION, INTERACTIVE } from "./interaction-styles";

interface Props {
  lang: Lang;
  config: TimelogConfig;
  onChange: (next: TimelogConfig) => void;
}

export function TimelogSettings({ lang, config, onChange }: Props) {
  const [testResult, setTestResult] = useState<string | null>(null);
  const set = (patch: Partial<TimelogConfig>) => onChange({ ...config, ...patch });

  function handleToken(value: string) {
    set({ apiToken: value, tokenInvalidAt: undefined });
    void saveSecretValue("timelogApiToken", value, "device");
  }
  async function test() {
    setTestResult(null);
    try {
      const creds = { host: config.host, tenant: config.tenant, token: config.apiToken };
      const [users, priv] = await Promise.all([listUsers(creds), getPrivileges(creds)]);
      const scope = config.scopeMode === "auto" ? (priv.registrationAllTasks ? "org" : "self") : config.scopeMode;
      setTestResult(t(lang, "timelogTestOk", String(users.length), scope));
      set({ tokenInvalidAt: undefined });
    } catch (e) {
      const status = (e as { status?: number }).status ?? 0;
      setTestResult(t(lang, "timelogTestFail", String(status)));
    }
  }

  const field = `mt-1 w-full rounded border border-line bg-surface px-2 py-1 text-sm text-foreground ${FOCUS_RING} ${TRANSITION}`;
  return (
    <div className="mt-4 border-t border-line pt-3">
      <h3 className="text-sm font-medium text-foreground">{t(lang, "timelogTitle")}</h3>
      <label className="mt-2 flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4" checked={config.enabled}
          onChange={(e) => set({ enabled: e.target.checked })} />
        <span>{t(lang, "timelogEnable")}</span>
      </label>
      {config.enabled && (
        <div className="mt-2 flex flex-col gap-2">
          <label className="block text-xs">{t(lang, "timelogHost")}
            <input className={field} value={config.host} aria-label={t(lang, "timelogHost")}
              onChange={(e) => set({ host: e.target.value })} /></label>
          <label className="block text-xs">{t(lang, "timelogTenant")}
            <input className={field} value={config.tenant} aria-label={t(lang, "timelogTenant")}
              onChange={(e) => set({ tenant: e.target.value })} /></label>
          <label className="block text-xs">{t(lang, "timelogEmail")}
            <input className={field} type="email" value={config.email} aria-label={t(lang, "timelogEmail")}
              onChange={(e) => set({ email: e.target.value })} /></label>
          <label className="block text-xs">{t(lang, "timelogToken")}
            <input className={field} type="password" value={config.apiToken} aria-label={t(lang, "timelogToken")}
              onChange={(e) => handleToken(e.target.value)} /></label>
          {config.tokenInvalidAt && <p className="text-xs text-AIPM-pink-strong">{t(lang, "timelogTokenInvalid")}</p>}
          <label className="block text-xs">{t(lang, "timelogScope")}
            <select className={field} value={config.scopeMode} aria-label={t(lang, "timelogScope")}
              onChange={(e) => set({ scopeMode: e.target.value as TimelogScopeMode })}>
              <option value="auto">{t(lang, "timelogScopeAuto")}</option>
              <option value="self">{t(lang, "timelogScopeSelf")}</option>
              <option value="org">{t(lang, "timelogScopeOrg")}</option>
            </select></label>
          <button type="button" onClick={test}
            className={`self-start rounded-md border border-line bg-surface px-3 py-1 text-xs font-medium text-AIPM-dark-blue dark:text-AIPM-light-grey ${INTERACTIVE}`}>
            {t(lang, "timelogTest")}
          </button>
          {testResult && <p className="text-xs text-muted-foreground">{testResult}</p>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire into `integrations-section.tsx`** — import `TimelogSettings` and `defaultTimelogConfig`; render after the Jira block:
```tsx
<TimelogSettings
  lang={lang}
  config={settings.timelog ?? defaultTimelogConfig}
  onChange={(next) => onChange({ ...settings, timelog: next })}
/>
```
(Use the section's existing `settings`/`onChange` props found in its signature.)

- [ ] **Step 5: Write the render test** `src/app/timelog-settings.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
vi.mock("./use-secrets", () => ({ saveSecretValue: vi.fn().mockResolvedValue(undefined) }));
import * as secrets from "./use-secrets";
import { TimelogSettings } from "./timelog-settings";
import { defaultTimelogConfig } from "./timelog-types";
import { t } from "./i18n";

beforeEach(() => vi.clearAllMocks());

it("seals the token via saveSecretValue on input", () => {
  let cfg = { ...defaultTimelogConfig, enabled: true };
  render(<TimelogSettings lang="en-US" config={cfg} onChange={(n) => (cfg = n)} />);
  fireEvent.change(screen.getByLabelText(t("en-US", "timelogToken")), { target: { value: "tok123" } });
  expect(secrets.saveSecretValue).toHaveBeenCalledWith("timelogApiToken", "tok123", "device");
});

it("hides config fields until enabled", () => {
  render(<TimelogSettings lang="en-US" config={defaultTimelogConfig} onChange={() => {}} />);
  expect(screen.queryByLabelText(t("en-US", "timelogHost"))).toBeNull();
});
```

- [ ] **Step 6: Run — expect FAIL then PASS.** Run: `npm run test:run -- timelog-settings`.

- [ ] **Step 7: Run the DE-parity + encoding gates**

Run: `npx tsc --noEmit` (enforces EN/DE key parity — fails if any new key missing on one side).
Run: `npm run test:run -- i18n-encoding` (fails on ASCII umlaut subs — confirms Step 2 used real umlauts).

- [ ] **Step 8: Commit**

```bash
git add src/app/timelog-settings.tsx src/app/timelog-settings.test.tsx src/app/settings-sections/integrations-section.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(timelog): settings config block with test-connection + i18n EN/DE"
```

---

### Task 13: The `timelog` nav view + panel (matching tables + KPIs + apply)

**Files:**
- Create: `src/app/timelog-panel.tsx`
- Modify: `src/app/nav-config.ts` (AppView union + LABEL_KEYS), `nav-icons.tsx` (ICON_PATHS), `feature-modules.ts` (module), `workspace-panels.tsx` (lazy export), `workspace-section.tsx` (route + props), `e2e/a11y.spec.ts` (A11Y_VIEWS)
- Test: `src/app/timelog-panel.test.tsx`

- [ ] **Step 1: Register the view (tsc-forced exhaustive maps)**
  - `nav-config.ts`: add `"timelog"` to the `AppView` union; add `timelog: "navTimelog"` to `LABEL_KEYS`.
  - `nav-icons.tsx`: add `timelog: "<clock svg path>"` to the `Record<AppView, string>` (a clock glyph, e.g. `"M12 6v6l4 2M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"`).
  - `feature-modules.ts`: add `"timelog"` to `FeatureModuleId`, a `{ id: "timelog", labelKey: "navTimelog", views: ["timelog"] }` entry to `FEATURE_MODULES`, and ensure `ALL_MODULE_IDS` includes it.
  - Run `npx tsc --noEmit` after this step — it will flag any OTHER exhaustive `Record<AppView,…>`/`Record<ActionSource,…>` map that needs the new key (AGENTS.md warns: action-source-label, action-source-icon may apply only to ActionSource, not AppView — only extend what tsc flags).

- [ ] **Step 2: Lazy panel export** in `workspace-panels.tsx`:
```tsx
export const TimelogPanel = dynamic(() => import("./timelog-panel").then((m) => m.TimelogPanel), { ssr: false, loading });
```
(`loading` is the existing `PanelSkeleton` fallback used by the other 20 panels.)

- [ ] **Step 3: Write `timelog-panel.tsx`** — the view. Consumes `useWorkspace()` (resources, budgets, project id) + `useSettings()` (timelog config) + `useTimelogSync` + match engines. Renders: People table, Projects table (each row-unique labelled), a "Fetch bookings" button, KPI tiles, and an "Apply to budget" button with a confirm.

```tsx
"use client";
import { useMemo, useState } from "react";
import { t, type Lang } from "./i18n";
import { useWorkspace } from "./workspace-context";
import { useSettings } from "./use-settings";
import { useTimelogSync } from "./use-timelog-sync";
import { autoMatchUsers, autoMatchProjects } from "./timelog-match";
import { planApply, applyActualsToBuckets } from "./timelog-apply";
import { sanitizeTimelogLinks } from "./timelog-sanitize";
import { defaultTimelogConfig, type TimelogLinks } from "./timelog-types";
import { VIEW_PANE_FILL_CLASS } from "./view-styles";
import { INTERACTIVE, FOCUS_RING, TRANSITION } from "./interaction-styles";

export function TimelogPanel({ lang, isPopout = false }: { lang: Lang; isPopout?: boolean }) {
  const ws = useWorkspace();
  const { settings, setSettings } = useSettings();
  const cfg = settings.timelog ?? defaultTimelogConfig;
  const links: TimelogLinks = ws.timelogLinks ?? { userLinks: [], projectLinks: [] };
  const projectId = ws.project?.id != null ? String(ws.project.id) : "default";

  const setLinks = (next: TimelogLinks) => ws.setTimelogLinks?.(sanitizeTimelogLinks(next));

  const creds = { host: cfg.host, tenant: cfg.tenant, token: cfg.apiToken };
  const sync = useTimelogSync({
    creds, links, scopeMode: cfg.scopeMode, projectId, isPopout,
    onTokenInvalid: () => setSettings({ ...settings, timelog: { ...cfg, tokenInvalidAt: new Date().toISOString() } }),
    onTokenValid: () => { if (cfg.tokenInvalidAt) setSettings({ ...settings, timelog: { ...cfg, tokenInvalidAt: undefined } }); },
  });

  // Diff for apply-to-budget.
  const applyDiff = useMemo(
    () => (sync.aggregates ? planApply(ws.budgets, sync.aggregates.byBucket) : []),
    [sync.aggregates, ws.budgets],
  );
  const [confirming, setConfirming] = useState(false);

  function manualLinkUser(timelogUserId: number, resourceId: number | null) {
    const rest = links.userLinks.filter((l) => l.timelogUserId !== timelogUserId);
    setLinks({ ...links, userLinks: resourceId === null ? rest : [...rest, { timelogUserId, resourceId, manual: true }] });
  }
  // (manualLinkProject mirrors this for projectLinks/bucketId.)

  function applyToBudget() {
    if (!sync.aggregates) return;
    ws.setBudgets((prev) => applyActualsToBuckets(prev, sync.aggregates!.byBucket));
    setConfirming(false);
  }

  // … render: People table (one row per resource OR per fetched-user — see note), Projects table,
  // fetch button (calls sync.sync with the project span / rolling window),
  // KPI tiles (booked hours = sum byResource; billable % ; win/loss via existing budget report),
  // and the Apply button gated on applyDiff.length > 0 with a confirm popover using timelogApplyConfirm.
  return (
    <div className={VIEW_PANE_FILL_CLASS}>
      <h2 className="text-lg font-medium text-foreground">{t(lang, "timelogTitle")}</h2>
      {/* matching tables + KPI tiles + apply button — see Step 4 tests for required labels */}
    </div>
  );
}
```
**Implementation notes for the engineer:** the People table lists the linked/auto-suggested matches — derive suggestions with `autoMatchUsers(fetchedUsers, ws.resources, links)`; each row's app-resource `<select>` carries `aria-label={`${t(lang,"timelogMatchPeople")} – ${row.email}`}` (row-unique). The Projects table mirrors with `autoMatchProjects`. The KPI tiles reuse `report-table.tsx` `Tile`. The Apply button is `${INTERACTIVE}`; selects get `${FOCUS_RING} ${TRANSITION}`. Wrap any RagBadge in `<span aria-hidden>` if used inside a clickable chip.

- [ ] **Step 4: Add the workspace setter** `setTimelogLinks` to `workspace-context.tsx` (mirror `setSteeringCommittee`): expose `timelogLinks` + `setTimelogLinks: (next: TimelogLinks | undefined) => void` on the context, threaded from the storage layer (the field is already persisted by Task 3 — this just surfaces a setter that updates the in-memory workspace + triggers save, exactly like `setSteeringCommittee`).

- [ ] **Step 5: Route in `workspace-section.tsx`** — import `TimelogPanel` from `./workspace-panels`; add the tabpanel case:
```tsx
{activeTab === "timelog" && (
  <div id="panel-timelog" role="tabpanel" className={panelScrollClass}>
    <TimelogPanel lang={lang} isPopout={isPopout} />
  </div>
)}
```

- [ ] **Step 6: Add to the axe gate** — `e2e/a11y.spec.ts` `A11Y_VIEWS`: append `"Time bookings"` (must equal the rendered `navTimelog` EN label).

- [ ] **Step 7: Write the panel test** `src/app/timelog-panel.test.tsx` — render within the workspace/settings/tab providers (mirror `documents-panel.test.tsx` wrapper), seed a resource + a budget bucket + an enabled `settings.timelog`, mock `use-timelog-sync` to return a fixed aggregate, and assert:
  - the People table renders a row-unique select labelled `${timelogMatchPeople} – <email>`,
  - clicking the select to a resource persists a manual link (`ws.timelogLinks.userLinks[0].manual === true`),
  - the "Apply to budget" button is present when the diff is non-empty and writes `actualHours` on confirm.

(Assert `getByRole("combobox", { name: ... })` with the EXACT row-unique name — string `name` is an exact match; run `npx tsc --noEmit` after writing the test.)

- [ ] **Step 8: Run unit + a11y for the new view**

Run: `npm run test:run -- timelog-panel` then `npx tsc --noEmit` then
`npx playwright test e2e/a11y.spec.ts --project=chromium -g "Time bookings"` (webServer auto-starts; ~16s). Expected: axe clean (row-unique labels, named selects).

- [ ] **Step 9: Commit**

```bash
git add src/app/timelog-panel.tsx src/app/nav-config.ts src/app/nav-icons.tsx src/app/feature-modules.ts src/app/workspace-panels.tsx src/app/workspace-section.tsx src/app/workspace-context.tsx src/app/timelog-panel.test.tsx e2e/a11y.spec.ts
git commit -m "feat(timelog): timelog nav view — matching tables, KPIs, apply-to-budget"
```

---

## PHASE 5 — Release

### Task 14: AGENTS.md landmines + release metadata

**Files:**
- Modify: `AGENTS.md`, `src/app/version.ts`, `CHANGELOG.md`, `package.json`, `README.md`

- [ ] **Step 1: AGENTS.md** — add a "Timelog integration" bullet under Architecture pointers capturing: `/api/timelog` server proxy is REQUIRED (browser CORS) and CSP needs NO host (same-origin like Jira); reads are self-scoped, org-wide needs the privileged approval endpoint + `RegistrationAllTasks` probe; `Workspace.timelogLinks` persists as a `meta`-blob (NOT TABLE_NAMES, zero extra column write paths) and is excluded from exports + byte-stable when absent; `timelogApiToken` is the 4th `SecretId` (device-sealed, the 6-edit lockstep); the actuals cache `lop-app:timelog-actuals` is per-device, out of exports, cleared by `clearAppConfig`; "Apply to budget" writes the FIRST allocation's `actualHours` via a functional `setBudgets`.

- [ ] **Step 2: version.ts** — bump `APP_VERSION` to the next minor (e.g. `0.139.0`), set `APP_MILESTONE` to the next author surname, update the `APP_BUILD_DATE` comment, and append `"versionHighlightTimelog"` to `APP_HIGHLIGHT_KEYS`.

- [ ] **Step 3: i18n highlight strings** — add `versionHighlightTimelog` EN (i18n.ts) + DE (i18n.de.ts via node utf8 write, real umlauts).

- [ ] **Step 4: CHANGELOG.md** — new top entry for the new version: Added (Timelog integration: proxy, identity+project matching, actuals overlay, win/loss KPIs, apply-to-budget).

- [ ] **Step 5: package.json** version + **README.md** badge bump.

- [ ] **Step 6: Gates + commit**

Run: `npx tsc --noEmit` (DE parity incl. the highlight key) + `npm run test:run -- i18n-encoding`.
```bash
git add AGENTS.md src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md package.json README.md
git commit -m "docs(timelog): AGENTS.md landmines + release metadata"
```

### Task 15: Full-suite green + final review

- [ ] **Step 1:** `npm run lint` (Expected: 0 warnings). Fix any unused import from the extracts.
- [ ] **Step 2:** `npx tsc --noEmit` (Expected: clean).
- [ ] **Step 3:** `npm run test:run` (Expected: all green, incl. golden-workspace byte-stability + the new suites).
- [ ] **Step 4:** `npm run build` (Expected: success — prebuild script-docs in sync).
- [ ] **Step 5:** `npx playwright test e2e/a11y.spec.ts --project=chromium` (Expected: all 13 views incl. "Time bookings" pass axe).
- [ ] **Step 6:** Dispatch `ecc:typescript-reviewer` (or the code-review skill) over `git diff main...HEAD`. Address CRITICAL/HIGH. Re-run gates.
- [ ] **Step 7:** Stop. Hand back to the user for the release trigger (commit/push/MR/merge are user-gated per standing pref).

---

## Self-review (against the spec)

- **Spec §1 proxy** → Tasks 4–5. **§2 wire** → Task 6. **§3 config + secret** → Tasks 1 (config), 2 (secret). **§4 mappings blob** → Task 3. **§5 match engine** → Task 7 (+ UI Task 13). **§6 actuals overlay + cache + sync + apply** → Tasks 8, 9, 10, 11 (+ UI 13). **§7 win/loss/KPIs** → Task 13 (reuses existing budget report). **Error handling** → Tasks 4 (sanitize), 10 (tokenInvalid). **Testing** → every task is TDD; SSRF/TAF/secret/blob/match/actuals covered. **Release** → Tasks 14–15.
- **Decisions honoured:** support-both scope (Task 10 auto/self/org), overlay+apply non-destructive (Tasks 8–11), people+project (Task 7/13), one MR (single branch), dedicated view + A11Y gate (Task 13), manual sync only (Task 10).
- **Type consistency:** `TimelogLinks`/`TimelogConfig`/`TimelogTimeItem` defined in Task 1, consumed unchanged in 3/6/7/8/10/11/13; `ActualsByBucket`/`ActualsAggregate` defined in Task 8, consumed in 9/10/11/13; `TimelogCreds` defined in Task 4 (proxy) and Task 6 (wire) — NOTE these are two separate same-shaped types (server vs browser); the wire layer's `TimelogCreds` is the one the hook/panel import. `setTimelogLinks` added in Task 13 Step 4, used in Task 13 panel.
- **No placeholders:** mirror-recipes (Tasks 2, 3) use a verification grep + verified anchors rather than guessed line numbers (the safest form); all pure logic has complete code.
