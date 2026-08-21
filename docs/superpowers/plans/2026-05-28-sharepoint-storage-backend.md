# SharePoint Storage Backend (0.22.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the SharePoint storage backend (`sp-json` / `sp-csv` StorageKinds) so users can save their workspace to SharePoint via Microsoft Graph, reusing M1's MSAL foundation.

**Architecture:** A new `sharepoint-backend.ts` module exposes a pure URL parser plus a `SharePointBackend` class implementing the existing `StorageBackend` interface. `storage.ts`'s sp-* StorageConfig variants drop the pre-existing `clientId`/`tenantId` fields (sketched before M1 centralized MSAL config) in favor of `{ hostname, sitePath, itemPath }`. `createBackend(config, deps?)` accepts an optional `acquireToken` callback that the SharePoint cases require. The `storage-config.tsx` UI adds a SharePoint URL input and gates the sp-* options behind `integrations.m365.enabled && integrations.m365.sharepoint`. Settings → Integrations makes the SharePoint sub-toggle interactive.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Vitest, native `fetch` (no new deps), `@azure/msal-browser` from M1.

**Spec:** `docs/superpowers/specs/2026-05-28-sharepoint-storage-backend-design.md`
**Branch:** `feat/0.22.0-sharepoint-storage-backend` (already created off `main`).

> **Heads-up for the implementer subagent:**
> 1. **Fact-forcing gate.** Before FIRST shell command print 2 facts. Before EVERY Edit/Write, in SAME message print 4 facts — (a) importers (Grep new symbol), (b) symbols affected, (c) data fields (sp-* StorageConfig shape), (d) instruction verbatim: "adjust the design to follow the following table:". Then retry.
> 2. **win32** — Bash tool, no `&&`-chained `cd`, don't touch eslint.config.mjs.
> 3. After test runs, if `git status` shows `src/app/sample-workspace.md` dirty, `git restore` it BEFORE committing.
> 4. **Pre-existing context:** `storage.ts:116-144` already declares sp-* StorageKinds with `clientId, tenantId, siteUrl, filePath`. These pre-existing fields are dropped in Task 3 in favor of `hostname, sitePath, itemPath`. `storage-config.tsx:31-32` already lists sp-* options with `comingSoon: true` — Task 6 changes the gating logic.

---

## Task 1: `parseSharePointFileUrl` pure helper + tests (TDD)

**Files:**
- Create `src/app/sharepoint-backend.ts`
- Create `src/app/sharepoint-backend.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/sharepoint-backend.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseSharePointFileUrl } from "./sharepoint-backend";

describe("parseSharePointFileUrl", () => {
  it("parses a standard SharePoint Sites URL", () => {
    expect(
      parseSharePointFileUrl(
        "https://contoso.sharepoint.com/sites/Alpha/Shared%20Documents/lop/workspace.json",
      ),
    ).toEqual({
      hostname: "contoso.sharepoint.com",
      sitePath: "/sites/Alpha",
      itemPath: "Shared Documents/lop/workspace.json",
    });
  });

  it("decodes %20 escapes in itemPath", () => {
    const result = parseSharePointFileUrl(
      "https://contoso.sharepoint.com/sites/A/Shared%20Documents/Project%20X/file.json",
    );
    expect(result?.itemPath).toBe("Shared Documents/Project X/file.json");
  });

  it("strips query string", () => {
    expect(
      parseSharePointFileUrl(
        "https://contoso.sharepoint.com/sites/Alpha/Shared%20Documents/file.json?web=1",
      ),
    ).toEqual({
      hostname: "contoso.sharepoint.com",
      sitePath: "/sites/Alpha",
      itemPath: "Shared Documents/file.json",
    });
  });

  it("strips fragment", () => {
    expect(
      parseSharePointFileUrl(
        "https://contoso.sharepoint.com/sites/Alpha/Shared%20Documents/file.json#frag",
      ),
    ).toEqual({
      hostname: "contoso.sharepoint.com",
      sitePath: "/sites/Alpha",
      itemPath: "Shared Documents/file.json",
    });
  });

  it("rejects http:// URLs", () => {
    expect(
      parseSharePointFileUrl(
        "http://contoso.sharepoint.com/sites/A/Shared%20Documents/file.json",
      ),
    ).toBeNull();
  });

  it("rejects non-sharepoint.com hostnames", () => {
    expect(
      parseSharePointFileUrl("https://example.com/sites/A/Documents/file.json"),
    ).toBeNull();
  });

  it("rejects OneDrive for Business URLs (*-my.sharepoint.com)", () => {
    expect(
      parseSharePointFileUrl(
        "https://contoso-my.sharepoint.com/personal/user/Documents/file.json",
      ),
    ).toBeNull();
  });

  it("rejects URLs without /sites/ segment", () => {
    expect(
      parseSharePointFileUrl(
        "https://contoso.sharepoint.com/teams/Alpha/Documents/file.json",
      ),
    ).toBeNull();
  });

  it("rejects malformed URLs", () => {
    expect(parseSharePointFileUrl("not a url")).toBeNull();
    expect(parseSharePointFileUrl("")).toBeNull();
  });

  it("rejects trailing-slash (folder, not file)", () => {
    expect(
      parseSharePointFileUrl(
        "https://contoso.sharepoint.com/sites/A/Shared%20Documents/folder/",
      ),
    ).toBeNull();
  });

  it("rejects URLs with empty itemPath", () => {
    expect(
      parseSharePointFileUrl("https://contoso.sharepoint.com/sites/A"),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Confirm tests FAIL**

```bash
npx vitest run sharepoint-backend
```
Expected: FAIL with "Cannot find module './sharepoint-backend'".

- [ ] **Step 3: Implement `parseSharePointFileUrl` in `sharepoint-backend.ts`**

Create `src/app/sharepoint-backend.ts`:

```ts
// src/app/sharepoint-backend.ts
//
// SharePoint storage backend — implements StorageBackend interface via
// Microsoft Graph. Token acquisition is delegated to the caller (M1's
// useMsAuth().acquireToken).

export interface SpFileLocation {
  hostname: string;
  sitePath: string;
  itemPath: string;
}

/** Parse a SharePoint file URL into Graph-addressable components.
 *  Supports the standard SharePoint Sites pattern:
 *    https://<host>/sites/<site>/<library>/<path>/<file>
 *  Returns null on malformed input or unsupported URL shape
 *  (e.g. *-my.sharepoint.com OneDrive). */
export function parseSharePointFileUrl(url: string): SpFileLocation | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (!parsed.hostname.endsWith(".sharepoint.com")) return null;
  // Exclude OneDrive for Business: hostnames like contoso-my.sharepoint.com.
  const hostLocal = parsed.hostname.replace(/\.sharepoint\.com$/, "");
  if (hostLocal.endsWith("-my")) return null;

  if (parsed.pathname.endsWith("/")) return null;
  const segments = parsed.pathname.split("/").filter((s) => s !== "");
  if (segments.length < 3) return null;
  if (segments[0] !== "sites") return null;

  const decoded = segments.map((s) => decodeURIComponent(s));
  const sitePath = `/${decoded[0]}/${decoded[1]}`;
  const itemSegs = decoded.slice(2);
  if (itemSegs.length === 0) return null;
  const itemPath = itemSegs.join("/");

  return {
    hostname: parsed.hostname,
    sitePath,
    itemPath,
  };
}
```

- [ ] **Step 4: Confirm tests PASS**

```bash
npx vitest run sharepoint-backend
```
Expected: 11/11 PASS.

- [ ] **Step 5: Gates**

```bash
npx tsc --noEmit
npm run lint
```
Expected: 0 errors. Restore `sample-workspace.md` if dirty.

- [ ] **Step 6: Commit**

```bash
git add src/app/sharepoint-backend.ts src/app/sharepoint-backend.test.ts
git commit -m "feat(sharepoint): parseSharePointFileUrl pure helper + 11 unit tests"
```

---

## Task 2: `SharePointBackend` class + tests (mocked fetch + acquireToken)

**Files:**
- Modify `src/app/sharepoint-backend.ts` (append class)
- Modify `src/app/sharepoint-backend.test.ts` (append describe block)

- [ ] **Step 1: Write the failing tests**

Append to `src/app/sharepoint-backend.test.ts`:

```ts
import { afterEach, beforeEach, vi } from "vitest";
import { SharePointBackend } from "./sharepoint-backend";
import type { Workspace } from "./storage";

const FAKE_LOCATION = {
  hostname: "contoso.sharepoint.com",
  sitePath: "/sites/Alpha",
  itemPath: "Shared Documents/lop/workspace.json",
} as const;

const EMPTY_WORKSPACE: Workspace = {
  tasks: [],
  raid: [],
  absences: [],
  shifts: [],
  resources: [],
  roles: [],
  disciplines: [],
  grades: [],
  plan: {
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    granularity: "month",
    currency: "EUR",
  },
} as unknown as Workspace;

describe("SharePointBackend", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let acquireToken: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    acquireToken = vi.fn().mockResolvedValue("fake-token");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function makeJsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("isReady returns false when acquireToken returns null", async () => {
    acquireToken.mockResolvedValue(null);
    const be = new SharePointBackend(
      { kind: "sp-json", ...FAKE_LOCATION },
      acquireToken,
    );
    expect(await be.isReady()).toBe(false);
  });

  it("isReady returns true when acquireToken returns a token", async () => {
    const be = new SharePointBackend(
      { kind: "sp-json", ...FAKE_LOCATION },
      acquireToken,
    );
    expect(await be.isReady()).toBe(true);
  });

  it("load constructs correct Graph URL", async () => {
    fetchSpy.mockResolvedValue(makeJsonResponse(EMPTY_WORKSPACE));
    const be = new SharePointBackend(
      { kind: "sp-json", ...FAKE_LOCATION },
      acquireToken,
    );
    await be.load();
    expect(fetchSpy).toHaveBeenCalledOnce();
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toBe(
      "https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com:/sites/Alpha:/drive/root:/Shared Documents/lop/workspace.json:/content",
    );
  });

  it("load 200 returns parsed Workspace for sp-json", async () => {
    fetchSpy.mockResolvedValue(makeJsonResponse(EMPTY_WORKSPACE));
    const be = new SharePointBackend(
      { kind: "sp-json", ...FAKE_LOCATION },
      acquireToken,
    );
    const ws = await be.load();
    expect(ws.tasks).toEqual([]);
  });

  it("load 404 returns default empty Workspace", async () => {
    fetchSpy.mockResolvedValue(new Response("", { status: 404 }));
    const be = new SharePointBackend(
      { kind: "sp-json", ...FAKE_LOCATION },
      acquireToken,
    );
    const ws = await be.load();
    expect(ws.tasks).toEqual([]);
    expect(ws.raid).toEqual([]);
  });

  it("load 401 throws StorageNotReadyError with reauthenticate hint", async () => {
    fetchSpy.mockResolvedValue(new Response("", { status: 401 }));
    const be = new SharePointBackend(
      { kind: "sp-json", ...FAKE_LOCATION },
      acquireToken,
    );
    await expect(be.load()).rejects.toThrow(/sign-in expired/i);
  });

  it("load 403 throws StorageNotReadyError with permission hint", async () => {
    fetchSpy.mockResolvedValue(new Response("", { status: 403 }));
    const be = new SharePointBackend(
      { kind: "sp-json", ...FAKE_LOCATION },
      acquireToken,
    );
    await expect(be.load()).rejects.toThrow(/permission denied/i);
  });

  it("load 500 throws with friendly hint", async () => {
    fetchSpy.mockResolvedValue(new Response("", { status: 500 }));
    const be = new SharePointBackend(
      { kind: "sp-json", ...FAKE_LOCATION },
      acquireToken,
    );
    await expect(be.load()).rejects.toThrow(/sharepoint returned 500/i);
  });

  it("acquireToken null throws with sign-in hint", async () => {
    acquireToken.mockResolvedValue(null);
    const be = new SharePointBackend(
      { kind: "sp-json", ...FAKE_LOCATION },
      acquireToken,
    );
    await expect(be.load()).rejects.toThrow(/sign in to microsoft/i);
  });

  it("save constructs correct PUT URL and body for sp-json", async () => {
    fetchSpy.mockResolvedValue(new Response("", { status: 201 }));
    const be = new SharePointBackend(
      { kind: "sp-json", ...FAKE_LOCATION },
      acquireToken,
    );
    await be.save(EMPTY_WORKSPACE);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(
      "https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com:/sites/Alpha:/drive/root:/Shared Documents/lop/workspace.json:/content",
    );
    expect((init as RequestInit).method).toBe("PUT");
    expect((init as RequestInit).body).toBe(JSON.stringify(EMPTY_WORKSPACE));
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer fake-token");
  });

  it("save constructs correct Content-Type for sp-csv", async () => {
    fetchSpy.mockResolvedValue(new Response("", { status: 200 }));
    const be = new SharePointBackend(
      { kind: "sp-csv", ...FAKE_LOCATION },
      acquireToken,
    );
    await be.save(EMPTY_WORKSPACE);
    const [, init] = fetchSpy.mock.calls[0];
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get("Content-Type")).toBe("text/csv;charset=utf-8");
  });

  it("describe returns 'filename on sitePath'", async () => {
    const be = new SharePointBackend(
      { kind: "sp-json", ...FAKE_LOCATION },
      acquireToken,
    );
    expect(await be.describe()).toBe("workspace.json on /sites/Alpha");
  });
});
```

- [ ] **Step 2: Confirm tests FAIL**

```bash
npx vitest run sharepoint-backend
```
Expected: FAIL — "SharePointBackend is not exported".

- [ ] **Step 3: Implement `SharePointBackend`**

Append to `src/app/sharepoint-backend.ts`:

```ts
import { StorageNotReadyError, type StorageBackend, type Workspace, workspaceFromCsv, workspaceToCsv } from "./storage";

const GRAPH = "https://graph.microsoft.com/v1.0";

const EMPTY_WORKSPACE: Workspace = {
  tasks: [],
  raid: [],
  absences: [],
  shifts: [],
  resources: [],
  roles: [],
  disciplines: [],
  grades: [],
  plan: {
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    granularity: "month",
    currency: "EUR",
  },
} as unknown as Workspace;

function graphUrlFor(loc: SpFileLocation): string {
  return `${GRAPH}/sites/${loc.hostname}:${loc.sitePath}:/drive/root:/${loc.itemPath}:/content`;
}

export type SpStorageConfig =
  | ({ kind: "sp-json" } & SpFileLocation)
  | ({ kind: "sp-csv" } & SpFileLocation);

export class SharePointBackend implements StorageBackend {
  readonly kind: "sp-json" | "sp-csv";
  private location: SpFileLocation;
  private acquireToken: (scopes: readonly string[]) => Promise<string | null>;

  constructor(
    config: SpStorageConfig,
    acquireToken: (scopes: readonly string[]) => Promise<string | null>,
  ) {
    this.kind = config.kind;
    this.location = {
      hostname: config.hostname,
      sitePath: config.sitePath,
      itemPath: config.itemPath,
    };
    this.acquireToken = acquireToken;
  }

  async isReady(): Promise<boolean> {
    const token = await this.acquireToken(["Files.ReadWrite"]);
    return !!token;
  }

  async describe(): Promise<string | null> {
    const filename = this.location.itemPath.split("/").pop() ?? this.location.itemPath;
    return `${filename} on ${this.location.sitePath}`;
  }

  private async getToken(): Promise<string> {
    const token = await this.acquireToken(["Files.ReadWrite"]);
    if (!token) throw new StorageNotReadyError("Sign in to Microsoft first");
    return token;
  }

  async load(): Promise<Workspace> {
    const token = await this.getToken();
    const res = await fetch(graphUrlFor(this.location), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404) return EMPTY_WORKSPACE;
    if (res.status === 401) {
      throw new StorageNotReadyError("Sign-in expired. Re-authenticate from Settings.");
    }
    if (res.status === 403) {
      throw new StorageNotReadyError("Permission denied. The signed-in user lacks read access to this file.");
    }
    if (!res.ok) {
      throw new Error(`SharePoint returned ${res.status}. Try again later.`);
    }
    if (this.kind === "sp-csv") {
      const csv = await res.text();
      return workspaceFromCsv(csv);
    }
    return (await res.json()) as Workspace;
  }

  async save(workspace: Workspace): Promise<void> {
    const token = await this.getToken();
    const body =
      this.kind === "sp-csv"
        ? workspaceToCsv(workspace)
        : JSON.stringify(workspace);
    const contentType =
      this.kind === "sp-csv" ? "text/csv;charset=utf-8" : "application/json";
    const res = await fetch(graphUrlFor(this.location), {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": contentType,
      },
      body,
    });
    if (res.status === 401) {
      throw new StorageNotReadyError("Sign-in expired. Re-authenticate from Settings.");
    }
    if (res.status === 403) {
      throw new StorageNotReadyError("Permission denied. The signed-in user lacks write access to this file.");
    }
    if (!res.ok) {
      throw new Error(`SharePoint returned ${res.status}. Try again later.`);
    }
  }
}
```

If `workspaceFromCsv` / `workspaceToCsv` aren't exported from `storage.ts`, Grep for them — they're likely defined for LocalFileBackend. Export them if needed.

- [ ] **Step 4: Confirm tests PASS**

```bash
npx vitest run sharepoint-backend
```
Expected: 11 prior + 12 new = 23 PASS.

- [ ] **Step 5: Gates**

```bash
npx tsc --noEmit
npm run lint
```
Expected: 0 errors. Restore `sample-workspace.md` if dirty.

- [ ] **Step 6: Commit**

```bash
git add src/app/sharepoint-backend.ts src/app/sharepoint-backend.test.ts
git commit -m "feat(sharepoint): SharePointBackend class — Graph PUT/GET with token acquisition"
```

---

## Task 3: Update `storage.ts` — drop clientId/tenantId, wire `createBackend` deps

**Files:** Modify `src/app/storage.ts` + the file that calls `createBackend` (Grep to find).

- [ ] **Step 1: Drop clientId/tenantId from sp-* StorageConfig variants**

READ `src/app/storage.ts` around L126–144. Find:
```ts
export type StorageConfig =
  | { kind: "browser" }
  | { kind: "local-json" }
  | { kind: "local-csv" }
  | { kind: "local-md" }
  | {
      kind: "sp-json";
      clientId: string;
      tenantId: string;
      siteUrl: string;
      filePath: string;
    }
  | {
      kind: "sp-csv";
      clientId: string;
      tenantId: string;
      siteUrl: string;
      filePath: string;
    };
```

Replace with:
```ts
export type StorageConfig =
  | { kind: "browser" }
  | { kind: "local-json" }
  | { kind: "local-csv" }
  | { kind: "local-md" }
  | {
      kind: "sp-json";
      hostname: string;
      sitePath: string;
      itemPath: string;
    }
  | {
      kind: "sp-csv";
      hostname: string;
      sitePath: string;
      itemPath: string;
    };
```

- [ ] **Step 2: Update `createBackend` to accept deps + dispatch sp-***

READ `src/app/storage.ts` around L2444. Find `export function createBackend(config: StorageConfig): StorageBackend {`. Modify to:

```ts
export interface CreateBackendDeps {
  acquireToken?: (scopes: readonly string[]) => Promise<string | null>;
}

export function createBackend(
  config: StorageConfig,
  deps: CreateBackendDeps = {},
): StorageBackend {
  // ... existing local-* and browser cases unchanged ...
```

Add an import at the top of `storage.ts`:
```ts
import { SharePointBackend } from "./sharepoint-backend";
```

Inside the existing switch (or if/else chain) handling `config.kind`, add the sp-* cases:

```ts
    case "sp-json":
    case "sp-csv": {
      if (!deps.acquireToken) {
        throw new StorageNotReadyError("M365 sign-in required");
      }
      return new SharePointBackend(
        {
          kind: config.kind,
          hostname: config.hostname,
          sitePath: config.sitePath,
          itemPath: config.itemPath,
        },
        deps.acquireToken,
      );
    }
```

- [ ] **Step 3: Update the `createBackend` call site to pass `acquireToken`**

Grep `createBackend(` in `src/app` to find the call site (likely `use-storage-backend.ts` or similar hook). READ that file. Inside the hook function, add:

```ts
import { useMsAuth } from "./use-ms-auth";

const m365Enabled = settings.integrations?.m365?.enabled ?? false;
const auth = useMsAuth(m365Enabled);
```

Then replace `createBackend(config)` with `createBackend(config, { acquireToken: auth.acquireToken })`.

If the hook doesn't currently receive `settings` directly, get the `integrations.m365.enabled` flag from wherever it's available in scope. Passing the auth's `acquireToken` unconditionally is safe — when M365 is disabled, the hook returns a noop that yields null.

- [ ] **Step 4: Run all tests**

```bash
npx vitest run
```
Expected: full suite green (existing 949 + 23 sharepoint-backend = 972). If `storage.test.ts` exists and tests sp-* with the OLD StorageConfig shape (clientId/tenantId/siteUrl/filePath), update those fixtures to `{ hostname, sitePath, itemPath }`.

- [ ] **Step 5: Gates**

```bash
npx tsc --noEmit
npm run lint
```
Expected: 0 errors. Restore `sample-workspace.md` if dirty.

- [ ] **Step 6: Commit**

```bash
git add src/app/storage.ts
git add src/app/use-storage-backend.ts 2>/dev/null || true
git commit -m "feat(sharepoint): wire createBackend(deps) for sp-* + drop clientId/tenantId"
```

---

## Task 4: Make Settings → Integrations SharePoint sub-toggle interactive

**Files:** Modify `src/app/settings-menu.tsx` and `src/app/settings-menu.test.tsx`.

- [ ] **Step 1: Update the SharePoint sub-toggle JSX**

READ `src/app/settings-menu.tsx`. Find the sub-toggles `<fieldset>` block from M1 (lists SharePoint / Outlook contacts / Outlook calendar, all rendered disabled with the "Available in 0.22.0+" tooltip). Inside the `.map` iteration, the SharePoint case becomes interactive while the other two remain disabled. Replace the existing map body with:

```tsx
{(
  [
    ["integrationsSharepoint", "sharepoint", false] as const,
    ["integrationsOutlookContacts", "outlookContacts", true] as const,
    ["integrationsOutlookCalendar", "outlookCalendar", true] as const,
  ]
).map(([labelKey, key, comingSoon]) => (
  <label
    key={labelKey}
    className={`mt-1 flex items-center gap-2 text-sm ${comingSoon ? "text-muted-foreground" : "text-foreground"}`}
    title={comingSoon ? t(lang, "integrationsComingSoon") : undefined}
  >
    <input
      type="checkbox"
      disabled={comingSoon}
      checked={comingSoon ? false : m365[key]}
      onChange={
        comingSoon
          ? undefined
          : (e) => updateM365({ [key]: e.target.checked })
      }
      readOnly={comingSoon}
      className={`h-4 w-4 ${comingSoon ? "cursor-not-allowed" : ""}`}
    />
    <span>{t(lang, labelKey)}</span>
  </label>
))}
```

Adapt the snippet to match the existing M1 JSX shape if it differs.

- [ ] **Step 2: Add tests**

In `src/app/settings-menu.test.tsx`, append to the existing `describe("SettingsMenu — Integrations section", ...)` block:

```tsx
it("SharePoint sub-toggle is interactive (not disabled) when M365 enabled", async () => {
  const settings = {
    ...defaultSettings,
    integrations: {
      m365: {
        enabled: true,
        sharepoint: false,
        outlookContacts: false,
        outlookCalendar: false,
      },
      turso: { enabled: false },
    },
  };
  render(<SettingsMenu {...baseProps} settings={settings} />);
  const openers = screen.queryAllByRole("button");
  if (openers[0]) await userEvent.setup().click(openers[0]);
  const sharepointCheckbox = await screen.findByRole("checkbox", {
    name: /sharepoint storage/i,
  });
  expect(sharepointCheckbox).not.toBeDisabled();
});

it("Outlook contacts + calendar still disabled (M3/M4 not yet shipped)", async () => {
  const settings = {
    ...defaultSettings,
    integrations: {
      m365: {
        enabled: true,
        sharepoint: false,
        outlookContacts: false,
        outlookCalendar: false,
      },
      turso: { enabled: false },
    },
  };
  render(<SettingsMenu {...baseProps} settings={settings} />);
  const openers = screen.queryAllByRole("button");
  if (openers[0]) await userEvent.setup().click(openers[0]);
  const contactsCheckbox = await screen.findByRole("checkbox", {
    name: /outlook contacts/i,
  });
  const calendarCheckbox = await screen.findByRole("checkbox", {
    name: /outlook calendar/i,
  });
  expect(contactsCheckbox).toBeDisabled();
  expect(calendarCheckbox).toBeDisabled();
});

it("toggling SharePoint persists settings.integrations.m365.sharepoint", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const settings = {
    ...defaultSettings,
    integrations: {
      m365: {
        enabled: true,
        sharepoint: false,
        outlookContacts: false,
        outlookCalendar: false,
      },
      turso: { enabled: false },
    },
  };
  render(
    <SettingsMenu {...baseProps} settings={settings} onChange={onChange} />,
  );
  const openers = screen.queryAllByRole("button");
  if (openers[0]) await user.click(openers[0]);
  const sharepointCheckbox = await screen.findByRole("checkbox", {
    name: /sharepoint storage/i,
  });
  await user.click(sharepointCheckbox);
  expect(onChange).toHaveBeenCalled();
  const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
  expect(lastCall.integrations?.m365?.sharepoint).toBe(true);
});
```

- [ ] **Step 3: Run tests + gates**

```bash
npx vitest run settings-menu
npx tsc --noEmit
npm run lint
```
Expected: PASS, 0 errors. Restore `sample-workspace.md` if dirty.

- [ ] **Step 4: Commit**

```bash
git add src/app/settings-menu.tsx src/app/settings-menu.test.tsx
git commit -m "feat(sharepoint): SharePoint sub-toggle interactive in Settings → Integrations"
```

---

## Task 5: i18n EN + DE (closes key union before storage-config UI)

**Files:** Modify `src/app/i18n.ts` and `src/app/i18n.de.ts`.

- [ ] **Step 1: Add EN entries to `i18n.ts`**

READ. Add near other storage-related keys:

```ts
storageSpJson: "SharePoint JSON",
storageSpCsv: "SharePoint CSV",
spStorageHint: "Paste the full URL of the SharePoint file you want to use.",
spStorageUrlPlaceholder: "https://your-tenant.sharepoint.com/sites/.../workspace.json",
spStorageUrlLabel: "SharePoint file URL",
spStorageNeedsM365: "Enable Microsoft 365 in Settings → Integrations first.",
spStorageNeedsSignIn: "Sign in to Microsoft to use SharePoint storage.",
spStorageNeedsToggle: "Enable SharePoint storage in Settings → Integrations first.",
spStorageInvalidUrl: "Could not parse this URL. Use the full SharePoint file URL.",
spStorageDescribe: "{filename} on {sitePath}",
spStoragePermissionDenied: "Permission denied. The signed-in user lacks access to this file.",
spStorageSignInExpired: "Sign-in expired. Re-authenticate from Settings.",
versionHighlightSharepointStorage: "SharePoint storage backend: save your workspace as a JSON or CSV file in a SharePoint Sites library — paste the file URL in Storage Configuration after enabling SharePoint in Settings → Integrations.",
```

If `storageSpJson` and `storageSpCsv` already exist (referenced from `storage-config.tsx:31-32`'s `comingSoon: true` entries), update them in place. Do NOT touch `APP_HIGHLIGHT_KEYS` here — Task 8 handles it.

- [ ] **Step 2: Add DE entries to `i18n.de.ts`**

```ts
storageSpJson: "SharePoint JSON",
storageSpCsv: "SharePoint CSV",
spStorageHint: "Vollständige URL der SharePoint-Datei einfügen.",
spStorageUrlPlaceholder: "https://your-tenant.sharepoint.com/sites/.../workspace.json",
spStorageUrlLabel: "SharePoint-Datei-URL",
spStorageNeedsM365: "Microsoft 365 zuerst in Einstellungen → Integrationen aktivieren.",
spStorageNeedsSignIn: "Bei Microsoft anmelden, um SharePoint-Speicher zu nutzen.",
spStorageNeedsToggle: "SharePoint-Speicher zuerst in Einstellungen → Integrationen aktivieren.",
spStorageInvalidUrl: "URL konnte nicht ausgewertet werden. Vollständige SharePoint-Datei-URL verwenden.",
spStorageDescribe: "{filename} auf {sitePath}",
spStoragePermissionDenied: "Zugriff verweigert. Der angemeldete Benutzer hat keinen Zugriff auf diese Datei.",
spStorageSignInExpired: "Anmeldung abgelaufen. Erneut in den Einstellungen anmelden.",
versionHighlightSharepointStorage: "SharePoint-Speicher: Arbeitsbereich als JSON- oder CSV-Datei in einer SharePoint-Sites-Bibliothek speichern — Datei-URL in der Speicherkonfiguration einfügen, nachdem SharePoint in Einstellungen → Integrationen aktiviert wurde.",
```

- [ ] **Step 3: Gates**

```bash
npx tsc --noEmit
npm run lint
npx vitest run
```
Expected: tsc 0; lint 0; full suite green. Restore `sample-workspace.md` if dirty.

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(sharepoint): i18n EN + DE for SharePoint storage backend"
```

---

## Task 6: Update `storage-config.tsx` — sp-* options + URL input + gates

**Files:** Modify `src/app/storage-config.tsx` and the caller (Grep `<StorageConfigSection`).

- [ ] **Step 1: Add imports + props**

READ `src/app/storage-config.tsx`. Add imports at the top:

```ts
import { useMsAuth } from "./use-ms-auth";
import { parseSharePointFileUrl } from "./sharepoint-backend";
```

Extend `Props`:

```ts
type Props = {
  // ... existing props ...
  m365Enabled: boolean;
  sharepointEnabled: boolean;
};
```

Destructure them in the component signature.

- [ ] **Step 2: Update STORAGE_OPTIONS — drop `comingSoon` on sp-***

Find the existing `STORAGE_OPTIONS` (~L22–33). Edit two lines:
- Find: `{ kind: "sp-json", labelKey: "storageSpJson", comingSoon: true },`
- Replace: `{ kind: "sp-json", labelKey: "storageSpJson" },`

- Find: `{ kind: "sp-csv", labelKey: "storageSpCsv", comingSoon: true },`
- Replace: `{ kind: "sp-csv", labelKey: "storageSpCsv" },`

- [ ] **Step 3: Add gating logic + URL input UI**

After the existing `const isLocal = ...` and `const isSp = ...` declarations, add:

```tsx
const auth = useMsAuth(m365Enabled);
const spGateOk = m365Enabled && sharepointEnabled;

function spUrlForConfig(): string {
  if (config.kind === "sp-json" || config.kind === "sp-csv") {
    return `https://${config.hostname}${config.sitePath}/${config.itemPath}`;
  }
  return "";
}

const [spUrl, setSpUrl] = useState(spUrlForConfig());
const [spUrlError, setSpUrlError] = useState<string | null>(null);

function handleSpUrlBlur() {
  setSpUrlError(null);
  if (!spUrl.trim()) return;
  const parsed = parseSharePointFileUrl(spUrl.trim());
  if (!parsed) {
    setSpUrlError(t(lang, "spStorageInvalidUrl"));
    return;
  }
  if (config.kind === "sp-json" || config.kind === "sp-csv") {
    onChange({ kind: config.kind, ...parsed });
  }
}
```

Inside the JSX, after the existing `{isLocal && (...)}` block, add the sp-* branch:

```tsx
{isSp && !spGateOk && (
  <p className="mt-2 text-xs text-AIPM-pink">
    {!m365Enabled
      ? t(lang, "spStorageNeedsM365")
      : t(lang, "spStorageNeedsToggle")}
  </p>
)}

{isSp && spGateOk && !auth.account && (
  <div className="mt-2 space-y-2">
    <p className="text-xs text-muted-foreground">
      {t(lang, "spStorageNeedsSignIn")}
    </p>
    <button
      type="button"
      onClick={() => { void auth.signIn(); }}
      className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90"
    >
      {t(lang, "integrationsM365SignIn")}
    </button>
  </div>
)}

{isSp && spGateOk && auth.account && (
  <div className="mt-2 space-y-1">
    <label className="block text-xs">
      <span className="text-muted-foreground">{t(lang, "spStorageUrlLabel")}</span>
      <input
        type="text"
        value={spUrl}
        onChange={(e) => setSpUrl(e.target.value)}
        onBlur={handleSpUrlBlur}
        placeholder={t(lang, "spStorageUrlPlaceholder")}
        className="mt-1 w-full rounded border border-line bg-surface px-2 py-1 text-foreground"
      />
    </label>
    <p className="text-xs text-muted-foreground">{t(lang, "spStorageHint")}</p>
    {spUrlError && (
      <p className="text-xs text-AIPM-pink">{spUrlError}</p>
    )}
  </div>
)}
```

- [ ] **Step 4: Wire the new props into the caller**

Grep `<StorageConfigSection` in `src/app`. Pass:
```tsx
m365Enabled={settings.integrations?.m365?.enabled ?? false}
sharepointEnabled={settings.integrations?.m365?.sharepoint ?? false}
```

- [ ] **Step 5: Add focused tests**

If `storage-config.test.tsx` exists, append:

```tsx
it("shows 'enable M365 first' when M365 is OFF and user picks sp-json", () => {
  render(
    <StorageConfigSection
      lang="en-US"
      config={{ kind: "sp-json", hostname: "x", sitePath: "/sites/a", itemPath: "f" }}
      onChange={vi.fn()}
      description={null}
      ready={false}
      onPickFile={async () => {}}
      onOpenFile={async () => {}}
      onGrantWrite={async () => {}}
      m365Enabled={false}
      sharepointEnabled={false}
    />,
  );
  expect(screen.getByText(/enable microsoft 365/i)).toBeInTheDocument();
});

it("shows URL input when M365+SharePoint enabled AND signed in", () => {
  vi.mock("./use-ms-auth", () => ({
    useMsAuth: () => ({
      account: { username: "x@y.com" } as { username: string },
      ready: true,
      signIn: vi.fn(),
      signOut: vi.fn(),
      acquireToken: async () => "t",
    }),
  }));
  render(
    <StorageConfigSection
      lang="en-US"
      config={{ kind: "sp-json", hostname: "x.sharepoint.com", sitePath: "/sites/a", itemPath: "f.json" }}
      onChange={vi.fn()}
      description={null}
      ready={false}
      onPickFile={async () => {}}
      onOpenFile={async () => {}}
      onGrantWrite={async () => {}}
      m365Enabled={true}
      sharepointEnabled={true}
    />,
  );
  expect(screen.getByLabelText(/sharepoint file url/i)).toBeInTheDocument();
});
```

If `storage-config.test.tsx` doesn't exist, create it with the above tests + minimal imports.

- [ ] **Step 6: Run tests + gates**

```bash
npx vitest run storage-config
npx tsc --noEmit
npm run lint
```
Expected: PASS, 0 errors. Restore `sample-workspace.md` if dirty.

- [ ] **Step 7: Commit**

```bash
git add src/app/storage-config.tsx
git add src/app/storage-config.test.tsx 2>/dev/null || true
git add src/app/settings-menu.tsx 2>/dev/null || true
git commit -m "feat(sharepoint): storage-config UI — sp-* options + URL input + gating"
```

---

## Task 7: Integration smoke test

**Files:** Modify `src/app/settings-menu.test.tsx`.

- [ ] **Step 1: Add a smoke test for the sub-toggle persistence**

Append to `src/app/settings-menu.test.tsx`:

```tsx
it("enabling SharePoint sub-toggle in Integrations updates settings.integrations.m365.sharepoint", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const settings = {
    ...defaultSettings,
    integrations: {
      m365: {
        enabled: true,
        sharepoint: false,
        outlookContacts: false,
        outlookCalendar: false,
      },
      turso: { enabled: false },
    },
  };
  render(
    <SettingsMenu {...baseProps} settings={settings} onChange={onChange} />,
  );
  const openers = screen.queryAllByRole("button");
  if (openers[0]) await user.click(openers[0]);
  const checkbox = await screen.findByRole("checkbox", {
    name: /sharepoint storage/i,
  });
  expect(checkbox).not.toBeDisabled();
  await user.click(checkbox);
  expect(onChange).toHaveBeenCalled();
  const updated = onChange.mock.calls[onChange.mock.calls.length - 1][0];
  expect(updated.integrations?.m365?.sharepoint).toBe(true);
});
```

- [ ] **Step 2: Run tests + gates**

```bash
npx vitest run settings-menu
npx tsc --noEmit
npm run lint
```
Expected: PASS. Restore `sample-workspace.md` if dirty.

- [ ] **Step 3: Commit**

```bash
git add src/app/settings-menu.test.tsx
git commit -m "test(sharepoint): integration smoke for sub-toggle persistence"
```

---

## Task 8: Release 0.22.0

**Files:** `src/app/version.ts`, `CHANGELOG.md`.

- [ ] **Step 1: version.ts** — READ first. Set `APP_VERSION = "0.22.0"` (currently `"0.21.0"`). Keep `APP_BUILD_DATE = "2026-05-28"; // Jemisin milestone`. Add a new top-of-file comment block ABOVE the existing `// 0.21.0 …` block:

```ts
// 0.22.0 implements the SharePoint storage backend (sp-json / sp-csv) — store
// the workspace as a single JSON or CSV file in a SharePoint Sites library via
// Microsoft Graph. Reuses M1's MSAL foundation; paste the file URL in Storage
// Configuration after enabling SharePoint in Settings → Integrations.
```

Append `"versionHighlightSharepointStorage"` as the LAST entry of `APP_HIGHLIGHT_KEYS`. Match the tuple's `as const` style.

- [ ] **Step 2: CHANGELOG** — READ to match style; add a new `[0.22.0] — 2026-05-28 "Jemisin"` entry ABOVE the `[0.21.0]` entry:

```markdown
## [0.22.0] — 2026-05-28 "Jemisin"

### Added
- SharePoint storage backend: store your workspace as a single JSON or CSV file in a SharePoint Sites library via Microsoft Graph. Enable SharePoint in Settings → Integrations (the sub-toggle is now interactive), then in Storage Configuration pick "SharePoint JSON" or "SharePoint CSV" and paste the SharePoint file URL. First save creates the file; concurrent edits use last-write-wins (no ETag tracking). Reuses M1's MSAL foundation; sign-in is gated behind the M365 master toggle and triggers an incremental-consent popup for `Files.ReadWrite` on first SharePoint access.
- New version highlight: "SharePoint storage" (`versionHighlightSharepointStorage`) in both EN and DE.

### Changed
- `StorageConfig` for `sp-json` / `sp-csv` no longer carries per-config `clientId` / `tenantId` — MSAL config is centralized at the M1 foundation. New shape: `{ kind, hostname, sitePath, itemPath }`. Existing settings without sp-* StorageConfig are unaffected.
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
npm run lint
npm run test:coverage
```
Expected: tsc 0; lint 0; all suites pass; coverage ≥ 70%. Restore `sample-workspace.md` if dirty.

- [ ] **Step 4: Commit**

```bash
git add src/app/version.ts CHANGELOG.md
git commit -m "docs(release): 0.22.0 Jemisin — SharePoint storage backend (sp-json / sp-csv)"
```

---

## Final review

Dispatch a final reviewer over `git diff main...HEAD`. Confirm:

1. **Scope:** only `src/app/sharepoint-backend.ts`, `src/app/sharepoint-backend.test.ts` (new), `src/app/storage.ts`, the file calling `createBackend` (likely `use-storage-backend.ts`), `src/app/storage-config.tsx`, `src/app/storage-config.test.tsx` (possibly new), `src/app/settings-menu.tsx`, `src/app/settings-menu.test.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `src/app/version.ts`, `CHANGELOG.md` touched. Anything else = flag.
2. **URL parser:** 11 tests pass. Returns null for OneDrive, non-https, missing /sites/, malformed, trailing-slash inputs.
3. **Backend class:** 12 tests pass (load 200/404/401/403/500, save sp-json/sp-csv, isReady, describe, acquireToken null).
4. **storage.ts:** sp-* StorageConfig variants use `{ kind, hostname, sitePath, itemPath }` — `clientId` and `tenantId` removed. `createBackend(config, deps?)` dispatches sp-* to `SharePointBackend`.
5. **Settings sub-toggle:** SharePoint sub-toggle interactive; Outlook contacts + calendar + Turso sub-toggles still disabled.
6. **Storage config UI:** sp-* options gated on `m365Enabled && sharepointEnabled`; URL input + parse-on-blur; sign-in prompt when account null.
7. **i18n:** EN and DE both contain all new keys + `versionHighlightSharepointStorage`.
8. **Release metadata:** `APP_VERSION === "0.22.0"`; `APP_BUILD_DATE` and `// Jemisin milestone` UNCHANGED; `APP_HIGHLIGHT_KEYS` ends with `"versionHighlightSharepointStorage"`; CHANGELOG `[0.22.0]` entry present with Added + Changed.
9. **Gates:** `npx tsc --noEmit` 0; `npm run lint` 0 errors; `npx vitest run` ≥ 975 (949 + 23 sharepoint + 3 settings-menu + 2 storage-config); coverage ≥ 70%.

After approval, use `superpowers:finishing-a-development-branch`.

---

## Self-Review (author)

**Spec coverage:**
- `parseSharePointFileUrl` pure helper + tests → Task 1 ✓
- `SharePointBackend` class + tests → Task 2 ✓
- storage.ts wiring (drop clientId/tenantId; createBackend deps) → Task 3 ✓
- SharePoint sub-toggle interactive → Task 4 ✓
- i18n EN + DE → Task 5 ✓
- storage-config.tsx URL input + gates → Task 6 ✓
- Integration smoke → Task 7 ✓
- Release 0.22.0 → Task 8 ✓
- Non-goals (no Graph drive picker, no OneDrive support, no ETag, no migration tooling) → none touched ✓

**Placeholder scan:** No TBD/TODO. Test code is complete and runnable; the storage-config UI test mocks `useMsAuth` with concrete return values. Task 3 Step 3 says "Grep to find createBackend call site" — that's investigation, not a stub.

**Type consistency:** `SpFileLocation`, `SpStorageConfig` defined in `sharepoint-backend.ts` and reused via spread when constructing `SharePointBackend`. `createBackend(config, deps?)` signature stays consistent across the dispatcher and the call site. `StorageConfig` sp-* shape `{ kind, hostname, sitePath, itemPath }` matches the parser output exactly. `acquireToken` callback signature `(scopes: readonly string[]) => Promise<string | null>` matches across M1's `useMsAuth`, `CreateBackendDeps`, and `SharePointBackend.constructor`.

**Ordering note:** Task 5 (i18n) runs after Tasks 1–4 (which don't reference any new i18n keys) and BEFORE Task 6 (storage-config UI) to close the i18n key union before UI uses the new keys. Task 7 (integration smoke) requires the settings panel from Task 4. Task 8 (release) is last. Subagent-driven runs sequentially → correct.
