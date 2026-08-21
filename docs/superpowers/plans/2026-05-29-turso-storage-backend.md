# Turso Storage Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Turso (libSQL) `StorageBackend` that stores the whole lop-app Workspace as a single JSON blob row, read/written via Turso's raw HTTP pipeline API, configured in Settings (env-var override).

**Architecture:** Pure config resolver (`turso-config.ts`, like `msal-config.ts`) + `TursoBackend` class (`turso-backend.ts`, like the SharePoint backend — hand-rolled `fetch` to `/v2/pipeline`) + wiring into `storage.ts`/`use-storage-backend.ts`/`storage-config.tsx`/`settings-menu.tsx`. The whole workspace round-trips through the existing `workspaceToJson`/`jsonToWorkspace` helpers. No new dependencies.

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Tailwind v4 / Vitest. Turso / libSQL HTTP pipeline API (`POST {httpUrl}/v2/pipeline`, Bearer token).

**Spec:** `docs/superpowers/specs/2026-05-29-turso-storage-backend-design.md`

**Branch:** `feat/0.25.0-turso-storage` (already created and checked out).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/app/turso-config.ts` | Resolve DB URL + token (env wins, settings fallback) + URL normalization | Create |
| `src/app/turso-config.test.ts` | Unit tests for the resolver | Create |
| `src/app/turso-backend.ts` | `TursoBackend` — load/save the JSON blob via the libSQL HTTP pipeline | Create |
| `src/app/turso-backend.test.ts` | Unit tests (mock fetch) | Create |
| `src/app/storage.ts` | Add `turso` to StorageKind/StorageConfig/CreateBackendDeps/createBackend | Modify |
| `src/app/use-storage-backend.ts` | Resolve `tursoConfig` and pass into `createBackend` | Modify |
| `src/app/settings-menu.tsx` | Extend `TursoIntegrationsSettings`; interactive toggle + URL/token inputs | Modify |
| `src/app/settings-menu.test.tsx` | Turso toggle tests | Modify |
| `src/app/storage-config.tsx` | Turso option in the kind picker (gated) | Modify |
| `src/app/storage-config.test.tsx` | Turso picker tests | Modify |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | New keys (EN + DE) | Modify |
| `src/app/version.ts` | Bump 0.25.0 + highlight key | Modify |
| `CHANGELOG.md` | 0.25.0 entry | Modify |

**Reference facts (verified — do not re-derive):**
- `StorageBackend` (`storage.ts:165`): `{ readonly kind: StorageKind; load(): Promise<Workspace>; save(ws): Promise<void>; describe?(): Promise<string|null>; isReady(): Promise<boolean> }`.
- `StorageKind` (`storage.ts:117`) and `StorageConfig` (`storage.ts:127`) are string-literal unions.
- `CreateBackendDeps` (`storage.ts:~2419`): currently `{ acquireToken?: (...) => Promise<string|null> }`. `createBackend(config, deps={})` switches on `config.kind`.
- `workspaceToJson(ws): string` (`storage.ts:853`) and `jsonToWorkspace(text): Workspace` (`storage.ts:869`, sanitizing, returns empty on malformed) — the canonical round-trip. `emptyWorkspace()` (`storage.ts:71`). `StorageNotReadyError` (`storage.ts:149`, ctor takes a `hint` string).
- `getMsalConfig` resolver pattern (`msal-config.ts`): env wins, settings fallback, returns null when missing — Turso resolver mirrors it.
- `use-storage-backend.ts:57-60`: `const backend = useMemo(() => createBackend(args.settings.storageConfig, { acquireToken: auth.acquireToken }), [args.settings.storageConfig, auth.acquireToken]);`
- `settings-menu.tsx`: `TursoIntegrationsSettings = { enabled: boolean }` (line 99), `defaultTursoIntegrations` (115), `sanitizeIntegrations` turso branch (138-140), `updateM365` helper (198), `envClientIdSet` pattern (195), the disabled Turso `<label>` (696-708), `StorageConfigSection` render (568-581). `turso` resolved at line 193.
- `storage-config.tsx`: `STORAGE_OPTIONS` array (26-37), `Props` (13-24), option-disabled map (132-143), `isSp`/`spGateOk` (84-87), sp hint blocks (214-255).
- i18n: `t(lang, key, ...args)`; there is a typed `TranslationKey` union derived from the EN dictionary, so EN + DE must both gain every new key (tsc enforces). **Heed the `i18n.de.ts` ASCII-delimiter gotcha — after editing it, grep your new lines to confirm the value is delimited by ASCII `"`, not curly quotes.**

---

## Task 1: Config resolver — `turso-config.ts`

**Files:**
- Create: `src/app/turso-config.ts`
- Test: `src/app/turso-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/turso-config.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { getTursoConfig } from "./turso-config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getTursoConfig", () => {
  it("returns null when neither env nor settings provide a URL/token", () => {
    expect(getTursoConfig()).toBeNull();
    expect(getTursoConfig("libsql://x.turso.io")).toBeNull(); // no token
    expect(getTursoConfig(undefined, "tok")).toBeNull(); // no url
  });

  it("uses settings values when env is absent", () => {
    expect(getTursoConfig("libsql://x.turso.io", "tok")).toEqual({
      httpUrl: "https://x.turso.io",
      authToken: "tok",
    });
  });

  it("env vars win over settings", () => {
    vi.stubEnv("NEXT_PUBLIC_TURSO_DATABASE_URL", "libsql://env-db.turso.io");
    vi.stubEnv("NEXT_PUBLIC_TURSO_AUTH_TOKEN", "env-tok");
    expect(getTursoConfig("libsql://settings.turso.io", "settings-tok")).toEqual({
      httpUrl: "https://env-db.turso.io",
      authToken: "env-tok",
    });
  });

  it("normalizes libsql:// to https:// and strips trailing slash", () => {
    expect(getTursoConfig("libsql://x.turso.io/", "tok")?.httpUrl).toBe("https://x.turso.io");
    expect(getTursoConfig("https://x.turso.io", "tok")?.httpUrl).toBe("https://x.turso.io");
  });

  it("rejects unusable URL schemes", () => {
    expect(getTursoConfig("http://insecure.example", "tok")).toBeNull();
    expect(getTursoConfig("not a url", "tok")).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run src/app/turso-config.test.ts` → "Cannot find module './turso-config'".

- [ ] **Step 3: Implement.** Create `src/app/turso-config.ts`:

```ts
// src/app/turso-config.ts
//
// Config resolver for the Turso (libSQL) storage backend. Env vars
// (NEXT_PUBLIC_TURSO_*) win when set at build time; Settings (Integrations
// panel inputs) are the fallback. Returns null when URL or token is missing
// or the URL is unusable — the storage layer surfaces "not ready".

export interface TursoConfig {
  /** HTTPS pipeline base, e.g. "https://db.turso.io" (no trailing slash). */
  httpUrl: string;
  authToken: string;
}

/** Normalize a Turso DB URL to its HTTPS pipeline base.
 *  libsql:// → https://, https:// passthrough, trailing slash stripped;
 *  any other scheme / unparseable input → null. */
function toHttpUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol === "libsql:") parsed.protocol = "https:";
  if (parsed.protocol !== "https:") return null;
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
}

export function getTursoConfig(
  settingsUrl?: string,
  settingsToken?: string,
): TursoConfig | null {
  const envUrl = process.env.NEXT_PUBLIC_TURSO_DATABASE_URL;
  const envToken = process.env.NEXT_PUBLIC_TURSO_AUTH_TOKEN;
  const rawUrl = (envUrl && envUrl !== "" ? envUrl : settingsUrl) ?? "";
  const authToken = (envToken && envToken !== "" ? envToken : settingsToken) ?? "";
  if (!rawUrl || !authToken) return null;
  const httpUrl = toHttpUrl(rawUrl);
  if (!httpUrl) return null;
  return { httpUrl, authToken };
}
```

(Note: `new URL("libsql://x.turso.io")` parses with `protocol === "libsql:"`; reassigning `parsed.protocol = "https:"` then reading `parsed.origin` yields `https://x.turso.io`. `parsed.pathname` is `/` for a bare host, so the trailing-slash strip produces `https://x.turso.io`.)

- [ ] **Step 4: Run → PASS.** `npx vitest run src/app/turso-config.test.ts`.
- [ ] **Step 5: Gates.** `npx tsc --noEmit && npm run lint` → 0 errors.
- [ ] **Step 6: Commit.**
```bash
git add src/app/turso-config.ts src/app/turso-config.test.ts
git commit -m "feat(t1): Turso config resolver (env-or-settings + URL normalization)"
```

---

## Task 2: Backend — `turso-backend.ts`

**Files:**
- Create: `src/app/turso-backend.ts`
- Test: `src/app/turso-backend.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/turso-backend.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TursoBackend } from "./turso-backend";
import { StorageNotReadyError, emptyWorkspace, jsonToWorkspace, workspaceToJson } from "./storage";
import type { TursoConfig } from "./turso-config";

const CONFIG: TursoConfig = { httpUrl: "https://db.turso.io", authToken: "tok" };

function jsonRes(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}
function execOk(rows: unknown[][]): unknown {
  return { type: "ok", response: { type: "execute", result: { cols: [], rows } } };
}
const closeOk = { type: "ok", response: { type: "close" } };

describe("TursoBackend", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("isReady reflects config presence", async () => {
    expect(await new TursoBackend(null).isReady()).toBe(false);
    expect(await new TursoBackend(CONFIG).isReady()).toBe(true);
  });

  it("load on an empty DB returns emptyWorkspace", async () => {
    // results: [ddl-ok, select-ok(no rows), close]
    fetchSpy.mockResolvedValueOnce(jsonRes({ results: [execOk([]), execOk([]), closeOk] }));
    const ws = await new TursoBackend(CONFIG).load();
    expect(ws).toEqual(emptyWorkspace());
  });

  it("load round-trips a stored blob", async () => {
    const stored = workspaceToJson(emptyWorkspace());
    fetchSpy.mockResolvedValueOnce(
      jsonRes({ results: [execOk([]), execOk([[{ type: "text", value: stored }]]), closeOk] }),
    );
    const ws = await new TursoBackend(CONFIG).load();
    expect(ws).toEqual(jsonToWorkspace(stored));
  });

  it("save posts the table DDL + upsert with the JSON arg, Bearer header, /v2/pipeline URL", async () => {
    fetchSpy.mockResolvedValueOnce(jsonRes({ results: [execOk([]), execOk([]), closeOk] }));
    const ws = emptyWorkspace();
    await new TursoBackend(CONFIG).save(ws);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://db.turso.io/v2/pipeline");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    const body = JSON.parse(init.body as string);
    const sqls = body.requests.filter((r: { type: string }) => r.type === "execute").map((r: { stmt: { sql: string } }) => r.stmt.sql);
    expect(sqls.some((s: string) => s.includes("CREATE TABLE IF NOT EXISTS workspace"))).toBe(true);
    expect(sqls.some((s: string) => s.includes("INSERT INTO workspace"))).toBe(true);
    const upsert = body.requests.find((r: { type: string; stmt?: { sql: string } }) => r.stmt?.sql?.includes("INSERT INTO workspace"));
    expect(upsert.stmt.args).toEqual([{ type: "text", value: workspaceToJson(ws) }]);
    expect(body.requests.some((r: { type: string }) => r.type === "close")).toBe(true);
  });

  it("maps 401 to StorageNotReadyError", async () => {
    fetchSpy.mockResolvedValueOnce(jsonRes({}, 401));
    await expect(new TursoBackend(CONFIG).load()).rejects.toBeInstanceOf(StorageNotReadyError);
  });

  it("throws on a libSQL error result", async () => {
    fetchSpy.mockResolvedValueOnce(jsonRes({ results: [{ type: "error", error: { message: "boom" } }] }));
    await expect(new TursoBackend(CONFIG).load()).rejects.toThrow(/boom/);
  });

  it("throws StorageNotReadyError when not configured", async () => {
    await expect(new TursoBackend(null).load()).rejects.toBeInstanceOf(StorageNotReadyError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run src/app/turso-backend.test.ts`.

- [ ] **Step 3: Implement.** Create `src/app/turso-backend.ts`:

```ts
// src/app/turso-backend.ts
//
// Turso (libSQL) storage backend. Stores the whole Workspace as a single
// JSON blob row (id=1) via Turso's HTTP pipeline API. Token is delegated
// via the resolved TursoConfig (env-or-settings). Last-write-wins.

import {
  StorageNotReadyError,
  emptyWorkspace,
  jsonToWorkspace,
  workspaceToJson,
  type StorageBackend,
  type Workspace,
} from "./storage";
import type { TursoConfig } from "./turso-config";

const TABLE_DDL =
  "CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY, data TEXT NOT NULL)";
const SELECT_SQL = "SELECT data FROM workspace WHERE id = 1";
const UPSERT_SQL =
  "INSERT INTO workspace (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data";

interface TextArg {
  type: "text";
  value: string;
}
interface PipelineStmt {
  sql: string;
  args?: TextArg[];
}
interface PipelineResult {
  type: "ok" | "error";
  response?: { type: string; result?: { rows?: { value?: unknown }[][] } };
  error?: { message?: string };
}

function execute(stmt: PipelineStmt) {
  return { type: "execute" as const, stmt };
}

/** Defensively read results[i].response.result.rows[0][0].value as a string. */
function firstRowText(results: PipelineResult[], i: number): string | null {
  const cell = results[i]?.response?.result?.rows?.[0]?.[0];
  return cell && typeof cell.value === "string" ? cell.value : null;
}

export class TursoBackend implements StorageBackend {
  readonly kind = "turso" as const;

  constructor(private config: TursoConfig | null) {}

  async isReady(): Promise<boolean> {
    return this.config !== null;
  }

  async describe(): Promise<string | null> {
    if (!this.config) return null;
    try {
      return `Turso: ${new URL(this.config.httpUrl).host}`;
    } catch {
      return "Turso";
    }
  }

  private async runPipeline(stmts: PipelineStmt[]): Promise<PipelineResult[]> {
    if (!this.config) {
      throw new StorageNotReadyError("Configure the Turso URL and token in Settings.");
    }
    const res = await fetch(`${this.config.httpUrl}/v2/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requests: [...stmts.map(execute), { type: "close" }],
      }),
    });
    if (res.status === 401) {
      throw new StorageNotReadyError("Turso auth token rejected. Check the token in Settings.");
    }
    if (!res.ok) {
      throw new Error(`Turso returned ${res.status}. Try again later.`);
    }
    const body = (await res.json()) as { results?: PipelineResult[] };
    const results = body.results ?? [];
    for (const r of results) {
      if (r.type === "error") {
        throw new Error(`Turso error: ${r.error?.message ?? "unknown"}`);
      }
    }
    return results;
  }

  async load(): Promise<Workspace> {
    const results = await this.runPipeline([{ sql: TABLE_DDL }, { sql: SELECT_SQL }]);
    // results[0] = DDL, results[1] = SELECT.
    const text = firstRowText(results, 1);
    if (text === null) return emptyWorkspace();
    return jsonToWorkspace(text);
  }

  async save(workspace: Workspace): Promise<void> {
    await this.runPipeline([
      { sql: TABLE_DDL },
      { sql: UPSERT_SQL, args: [{ type: "text", value: workspaceToJson(workspace) }] },
    ]);
  }
}
```

- [ ] **Step 4: Run → PASS.** `npx vitest run src/app/turso-backend.test.ts`.
- [ ] **Step 5: Gates.** `npx tsc --noEmit && npm run lint` → 0 errors.
- [ ] **Step 6: Commit.**
```bash
git add src/app/turso-backend.ts src/app/turso-backend.test.ts
git commit -m "feat(t1): TursoBackend — JSON blob via libSQL HTTP pipeline"
```

---

## Task 3: Wire into `storage.ts`

**Files:**
- Modify: `src/app/storage.ts`

- [ ] **Step 1: Add `"turso"` to the unions.**
  - `StorageKind` (line 117): add `| "turso"`.
  - `StorageConfig` (line 127): add `| { kind: "turso" }`.
- [ ] **Step 2: Import the backend** near the SharePoint import at the top of `storage.ts`:
```ts
import { TursoBackend } from "./turso-backend";
import type { TursoConfig } from "./turso-config";
```
  (If a circular-import tsc error arises — `turso-backend.ts` imports from `storage.ts` and vice-versa — note that `sharepoint-backend.ts` already does exactly this same cycle with `storage.ts` and compiles fine; follow that working precedent.)
- [ ] **Step 3: Extend `CreateBackendDeps`** (around line 2419):
```ts
export interface CreateBackendDeps {
  acquireToken?: (
    scopes: readonly string[],
    options?: { interactive?: boolean },
  ) => Promise<string | null>;
  tursoConfig?: TursoConfig | null;
}
```
- [ ] **Step 4: Add the factory case** inside `createBackend`'s switch (alongside the `sp-json`/`sp-csv` case):
```ts
    case "turso":
      return new TursoBackend(deps.tursoConfig ?? null);
```
- [ ] **Step 5: Type-check.** `npx tsc --noEmit` → 0 errors. (The `StorageConfig` union is exhaustively switched in `createBackend`; adding the case satisfies it.)
- [ ] **Step 6: Commit.**
```bash
git add src/app/storage.ts
git commit -m "feat(t1): register turso StorageKind + createBackend case"
```

---

## Task 4: Settings — interactive Turso toggle + URL/token inputs

**Files:**
- Modify: `src/app/settings-menu.tsx`
- Test: `src/app/settings-menu.test.tsx`

This task adds i18n keys it references — add them to BOTH dictionaries now (Task 6 verifies the full set):
```ts
// i18n.ts (EN)
integrationsTursoHint: "Store your workspace in a Turso (libSQL) database. The auth token is stored in this browser — use a scoped token.",
integrationsTursoUrl: "Database URL",
integrationsTursoUrlPlaceholder: "libsql://your-db.turso.io",
integrationsTursoToken: "Auth token",
integrationsTursoTokenPlaceholder: "Turso database token",
```
```ts
// i18n.de.ts (DE) — verify ASCII " delimiters after editing
integrationsTursoHint: "Speichern Sie Ihren Workspace in einer Turso-(libSQL-)Datenbank. Das Auth-Token wird in diesem Browser gespeichert – verwenden Sie ein eingeschränktes Token.",
integrationsTursoUrl: "Datenbank-URL",
integrationsTursoUrlPlaceholder: "libsql://ihre-db.turso.io",
integrationsTursoToken: "Auth-Token",
integrationsTursoTokenPlaceholder: "Turso-Datenbank-Token",
```

- [ ] **Step 1: Extend the type + sanitizer.** In `settings-menu.tsx`:
  - `TursoIntegrationsSettings` (line 99):
```ts
export type TursoIntegrationsSettings = {
  enabled: boolean;
  databaseUrl?: string;
  authToken?: string;
};
```
  - `sanitizeIntegrations` turso branch (lines 138-140):
```ts
    turso: {
      enabled: typeof tursoRaw?.enabled === "boolean" ? tursoRaw.enabled : false,
      databaseUrl: typeof tursoRaw?.databaseUrl === "string" ? tursoRaw.databaseUrl : undefined,
      authToken: typeof tursoRaw?.authToken === "string" ? tursoRaw.authToken : undefined,
    },
```
  - `defaultTursoIntegrations` stays `{ enabled: false }` (optional fields omitted).
- [ ] **Step 2: Add the `updateTurso` helper + env flags** (near `updateM365`, line 198, and `envClientIdSet`, line 195):
```ts
  const envTursoUrlSet = !!process.env.NEXT_PUBLIC_TURSO_DATABASE_URL;
  const envTursoTokenSet = !!process.env.NEXT_PUBLIC_TURSO_AUTH_TOKEN;

  function updateTurso(patch: Partial<TursoIntegrationsSettings>) {
    onChange({
      ...settings,
      integrations: { ...integrations, turso: { ...turso, ...patch } },
    });
  }
```
- [ ] **Step 3: Write the failing tests.** In `settings-menu.test.tsx`, add (match the file's existing helpers `makeProps`/`makeSettings`/`t`; integration tests in this file use a `m365EnabledIntegrations` fixture — follow that pattern for building `integrations`):
```ts
it("Turso toggle is interactive and persists integrations.turso.enabled", () => {
  const onChange = vi.fn();
  render(<SettingsMenu {...makeProps({ onChange })} />);
  fireEvent.click(screen.getByRole("button", { name: t("en-US", "settings") }));
  const turso = screen.getByRole("checkbox", { name: t("en-US", "integrationsTurso") });
  expect(turso).not.toBeDisabled();
  fireEvent.click(turso);
  const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as Settings;
  expect(lastCall.integrations?.turso?.enabled).toBe(true);
});

it("shows Turso URL + token inputs when enabled", () => {
  const settings = makeSettings({ integrations: { turso: { enabled: true } } });
  render(<SettingsMenu {...makeProps({ settings })} />);
  fireEvent.click(screen.getByRole("button", { name: t("en-US", "settings") }));
  expect(screen.getByPlaceholderText(t("en-US", "integrationsTursoUrlPlaceholder"))).toBeInTheDocument();
  expect(screen.getByPlaceholderText(t("en-US", "integrationsTursoTokenPlaceholder"))).toBeInTheDocument();
});
```

- [ ] **Step 4: Run → FAIL** (toggle still disabled / inputs absent). `npx vitest run src/app/settings-menu.test.tsx`.

- [ ] **Step 5: Implement the UI.** Replace the disabled Turso `<label>` block (lines 696-708) with:
```tsx
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={turso.enabled}
                onChange={(e) => updateTurso({ enabled: e.target.checked })}
                className="h-4 w-4"
              />
              <span>{t(lang, "integrationsTurso")}</span>
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(lang, "integrationsTursoHint")}
            </p>

            {turso.enabled && (
              <div className="mt-2 space-y-2 border-l-2 border-line pl-3">
                {!envTursoUrlSet && (
                  <label className="block text-xs">
                    <span className="text-muted-foreground">{t(lang, "integrationsTursoUrl")}</span>
                    <input
                      type="text"
                      value={turso.databaseUrl ?? ""}
                      onChange={(e) => updateTurso({ databaseUrl: e.target.value })}
                      placeholder={t(lang, "integrationsTursoUrlPlaceholder")}
                      className="mt-1 w-full rounded border border-line bg-surface px-2 py-1 text-foreground"
                    />
                  </label>
                )}
                {!envTursoTokenSet && (
                  <label className="block text-xs">
                    <span className="text-muted-foreground">{t(lang, "integrationsTursoToken")}</span>
                    <input
                      type="password"
                      value={turso.authToken ?? ""}
                      onChange={(e) => updateTurso({ authToken: e.target.value })}
                      placeholder={t(lang, "integrationsTursoTokenPlaceholder")}
                      className="mt-1 w-full rounded border border-line bg-surface px-2 py-1 text-foreground"
                    />
                  </label>
                )}
              </div>
            )}
```
- [ ] **Step 6: Pass `tursoEnabled` to `StorageConfigSection`.** In its render (lines 568-581), add:
```tsx
            tursoEnabled={settings.integrations?.turso?.enabled ?? false}
```
(This only compiles after Task 5 adds the prop to `StorageConfigSection`. Recommended dispatch order is Task 4 then Task 5; the full `tsc` gate is satisfied at the end of Task 5. The settings-menu UNIT tests in Step 7 pass independently because they don't type-check the whole tree at runtime — but `tsc --noEmit` will error until Task 5 lands the prop, so run the combined `tsc` gate at Task 5 Step 6.)
- [ ] **Step 7: Run → PASS** (settings tests). `npx vitest run src/app/settings-menu.test.tsx`.
- [ ] **Step 8: Commit.**
```bash
git add src/app/settings-menu.tsx src/app/settings-menu.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(t1): interactive Turso toggle + URL/token settings inputs"
```

---

## Task 5: Storage picker option + backend deps resolution

**Files:**
- Modify: `src/app/storage-config.tsx`
- Test: `src/app/storage-config.test.tsx`
- Modify: `src/app/use-storage-backend.ts`

Add i18n keys to BOTH dictionaries:
```ts
// i18n.ts (EN)
storageTurso: "Turso database",
storageTursoNeedsToggle: "Enable Turso in Settings → Integrations.",
storageTursoNeedsConfig: "Enter the Turso URL and token in Settings.",
```
```ts
// i18n.de.ts (DE) — verify ASCII " delimiters after editing
storageTurso: "Turso-Datenbank",
storageTursoNeedsToggle: "Turso unter Einstellungen → Integrationen aktivieren.",
storageTursoNeedsConfig: "Turso-URL und -Token in den Einstellungen eingeben.",
```

### 5a. `storage-config.tsx`

- [ ] **Step 1: Write the failing test.** In `src/app/storage-config.test.tsx` (a module-level `useMsAuth` mock already exists from M2 — keep it), add (use the file's existing prop-builder helper — pass `tursoEnabled` through it):
```ts
it("Turso option is disabled until tursoEnabled", () => {
  const onChange = vi.fn();
  const { rerender } = render(<StorageConfigSection {...baseProps({ onChange, tursoEnabled: false })} />);
  expect((screen.getByRole("option", { name: t("en-US", "storageTurso") }) as HTMLOptionElement).disabled).toBe(true);
  rerender(<StorageConfigSection {...baseProps({ onChange, tursoEnabled: true })} />);
  expect((screen.getByRole("option", { name: t("en-US", "storageTurso") }) as HTMLOptionElement).disabled).toBe(false);
});

it("selecting Turso sets config kind turso", () => {
  const onChange = vi.fn();
  render(<StorageConfigSection {...baseProps({ onChange, tursoEnabled: true })} />);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "turso" } });
  expect(onChange).toHaveBeenCalledWith({ kind: "turso" });
});
```
(If the existing helper is named `makeProps`, use that; ensure every existing `StorageConfigSection` render in this test file passes `tursoEnabled` — add `tursoEnabled: false` to the shared default builder so existing tests keep compiling.)

- [ ] **Step 2: Run → FAIL** (no Turso option / prop unknown).

- [ ] **Step 3: Implement.** In `src/app/storage-config.tsx`:
  - Add to `Props` (lines 13-24): `tursoEnabled: boolean;`
  - Destructure `tursoEnabled` in the component params.
  - Add to `STORAGE_OPTIONS` (after the sp-csv entry): `{ kind: "turso", labelKey: "storageTurso" },`
  - Extend the option-disabled map (lines 132-143):
```tsx
        {STORAGE_OPTIONS.map((o) => {
          const isSpKind = o.kind === "sp-json" || o.kind === "sp-csv";
          const isTursoKind = o.kind === "turso";
          const disabled =
            o.comingSoon ||
            (isSpKind && !(m365Enabled && sharepointEnabled)) ||
            (isTursoKind && !tursoEnabled);
          return (
            <option key={o.kind} value={o.kind} disabled={disabled}>
              {t(lang, o.labelKey)}
              {o.comingSoon ? ` (${t(lang, "comingSoon")})` : ""}
            </option>
          );
        })}
```
  - Add `const isTurso = config.kind === "turso";` next to `isSp` (line 84).
  - After the sp hint blocks (after line 255, before the closing `</div>`), add (reuses the existing `ready` + `description` props, which reflect `backend.isReady()` / `describe()`):
```tsx
      {isTurso && !tursoEnabled && (
        <p className="mt-2 text-xs text-AIPM-pink">{t(lang, "storageTursoNeedsToggle")}</p>
      )}
      {isTurso && tursoEnabled && !ready && (
        <p className="mt-2 text-xs text-AIPM-pink">{t(lang, "storageTursoNeedsConfig")}</p>
      )}
      {isTurso && tursoEnabled && ready && description && (
        <p className="mt-2 text-xs text-muted-foreground">✓ {description}</p>
      )}
```
- [ ] **Step 4: Run → PASS** (storage-config tests).

### 5b. `use-storage-backend.ts`

- [ ] **Step 5: Resolve + inject tursoConfig.** Add import:
```ts
import { getTursoConfig } from "./turso-config";
```
  Replace the `backend` useMemo (lines 57-60) with one that resolves Turso config inside the memo (keeping deps as primitives so the memo stays stable):
```ts
  const backend = useMemo(() => {
    const tursoConfig = getTursoConfig(
      args.settings.integrations?.turso?.databaseUrl,
      args.settings.integrations?.turso?.authToken,
    );
    return createBackend(args.settings.storageConfig, {
      acquireToken: auth.acquireToken,
      tursoConfig,
    });
  }, [
    args.settings.storageConfig,
    auth.acquireToken,
    args.settings.integrations?.turso?.databaseUrl,
    args.settings.integrations?.turso?.authToken,
  ]);
```
- [ ] **Step 6: Gates.** `npx vitest run && npx tsc --noEmit && npm run lint` → green / 0 / 0.
- [ ] **Step 7: Commit.**
```bash
git add src/app/storage-config.tsx src/app/storage-config.test.tsx src/app/use-storage-backend.ts src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(t1): Turso storage picker option + backend deps resolution"
```

---

## Task 6: i18n completeness (EN + DE)

**Files:** Modify `src/app/i18n.ts`, `src/app/i18n.de.ts`

Tasks 4–5 added the `integrationsTurso*` and `storageTurso{,NeedsToggle,NeedsConfig}` keys. This task adds the highlight key and verifies parity.

- [ ] **Step 1: Add the highlight key to BOTH files:**
```ts
// EN (i18n.ts)
versionHighlightTursoStorage: "Store your workspace in a Turso (libSQL) database: enable Turso in Settings, add your database URL + token, then pick Turso in Storage Configuration.",
```
```ts
// DE (i18n.de.ts) — verify ASCII " delimiters after editing
versionHighlightTursoStorage: "Workspace in einer Turso-(libSQL-)Datenbank speichern: Turso in den Einstellungen aktivieren, Datenbank-URL + Token hinzufügen und in der Speicherkonfiguration „Turso“ auswählen.",
```
- [ ] **Step 2: Verify the full T1 key set exists in BOTH files** (grep): `integrationsTursoHint`, `integrationsTursoUrl`, `integrationsTursoUrlPlaceholder`, `integrationsTursoToken`, `integrationsTursoTokenPlaceholder`, `storageTurso`, `storageTursoNeedsToggle`, `storageTursoNeedsConfig`, `versionHighlightTursoStorage`. Report any missing and add them. (The backend throws plain-English `StorageNotReadyError`/`Error` strings surfaced by the existing storage error UI — no extra i18n keys needed for those; do NOT add unreferenced `storageTursoDescribe`/`storageTursoAuthRejected` keys unless something references them.)
- [ ] **Step 3:** Run `npx vitest run src/app` → green (tsc-in-tests catches EN/DE key-union mismatches). After editing `i18n.de.ts`, grep the new lines to confirm ASCII `"` delimiters; fix any curly-quote corruption.
- [ ] **Step 4:** `npx tsc --noEmit && npm run lint` → 0 errors.
- [ ] **Step 5: Commit.**
```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(t1): EN/DE highlight string for Turso storage"
```

---

## Task 7: Release 0.25.0 "Jemisin"

**Files:** Modify `src/app/version.ts`, `CHANGELOG.md`

- [ ] **Step 1: version.ts.**
  - Add at the very top (above the existing newest `// 0.24.0 …` comment):
```ts
// 0.25.0 adds a Turso (libSQL) storage backend — store the whole workspace as a
// single JSON blob row in a Turso database via the HTTP pipeline API. Enable
// Turso in Settings → Integrations, add the database URL + auth token (or set
// NEXT_PUBLIC_TURSO_* env vars), then pick "Turso database" in Storage
// Configuration. Completes the original Microsoft 365 + Turso request.
```
  - Bump `export const APP_VERSION = "0.24.0";` → `"0.25.0";`.
  - Keep `APP_BUILD_DATE = "2026-05-29"; // Jemisin milestone`.
  - Append `"versionHighlightTursoStorage",` as the LAST `APP_HIGHLIGHT_KEYS` entry (after `"versionHighlightOutlookCalendar"`).
- [ ] **Step 2: CHANGELOG.md.** Read the top first to match the exact heading style; add above the newest entry:
```markdown
## [0.25.0] — 2026-05-29 "Jemisin"

### Added
- **Turso storage backend (T1).** A new **Turso database** option in Storage Configuration stores your entire workspace as a single JSON row in a Turso (libSQL) database via the HTTP pipeline API. Enable Turso in Settings → Integrations and add your database URL + auth token (or set `NEXT_PUBLIC_TURSO_DATABASE_URL` / `NEXT_PUBLIC_TURSO_AUTH_TOKEN`). The token is stored in the browser — use a scoped token.

### Changed
- The **Turso** sub-toggle in Settings → Integrations is now interactive — **the original Microsoft 365 + Turso request is now complete** (M365 auth, SharePoint storage, Outlook contacts, Outlook calendar, Turso storage).
```
- [ ] **Step 3: Final gates.** `npx vitest run && npx tsc --noEmit && npm run lint` → green / 0 / 0. Optional `npm run test:coverage` ≥ current.
- [ ] **Step 4: Commit.**
```bash
git add src/app/version.ts CHANGELOG.md
git commit -m "release: 0.25.0 Jemisin — Turso storage backend"
```

---

## Final Review Checklist

After all tasks, review `git diff main...HEAD`:
- [ ] Spec covered: resolver (env-or-settings + normalization), backend (blob round-trip via workspaceToJson/jsonToWorkspace, 401/error mapping, isReady/describe), storage wiring, interactive toggle + inputs, gated picker option, i18n, release.
- [ ] No token in any URL — `Authorization: Bearer` header only; request URL is exactly `{httpUrl}/v2/pipeline`.
- [ ] Token input is `type="password"`; inputs hidden when env vars set.
- [ ] Turso picker option disabled unless `tursoEnabled`; not-ready hint when config missing.
- [ ] EN/DE key parity; `i18n.de.ts` ASCII delimiters verified; no dead i18n keys.
- [ ] `tsc` 0, lint 0, full suite green. `eslint.config.mjs` NOT modified.

---

## Self-Review (plan vs spec)

**1. Spec coverage:** resolver → Task 1; backend (libSQL pipeline, blob, DDL+upsert, 401/error, isReady/describe) → Task 2; StorageKind/StorageConfig/CreateBackendDeps/createBackend → Task 3; TursoIntegrationsSettings + sanitizer + interactive toggle + URL/token inputs (env-hidden, password) → Task 4; picker option (gated) + use-storage-backend deps resolution → Task 5; i18n EN/DE + highlight → Tasks 4/5/6; release 0.25.0 → Task 7. Security note documented in spec; the implementation enforces token-in-header + a scoped-token hint string. Edge cases (empty DB, libsql:// normalization, malformed blob via jsonToWorkspace, 401, not-configured) covered by Tasks 1–2 tests.

**2. Placeholder scan:** no "TBD"/"handle errors"/"similar to" — full code in every code step. The Task 4/5 "match existing test helper names" and Task 6 "drop unused keys" lines are confirm-then-use instructions, not placeholders.

**3. Type consistency:** `TursoConfig` defined in Task 1, consumed identically in Tasks 2/3/5. `TursoBackend(config: TursoConfig | null)` (Task 2) matches `new TursoBackend(deps.tursoConfig ?? null)` (Task 3). `getTursoConfig(url?, token?)` (Task 1) called in Task 5 with the `databaseUrl`/`authToken` fields added in Task 4. `tursoEnabled` prop added to `StorageConfigSection` (Task 5) is passed from `settings-menu.tsx` (Task 4 Step 6). i18n keys referenced match those added. `kind: "turso"` consistent across StorageKind/StorageConfig/backend/picker. `workspaceToJson`/`jsonToWorkspace`/`emptyWorkspace`/`StorageNotReadyError` are real `storage.ts` exports.
