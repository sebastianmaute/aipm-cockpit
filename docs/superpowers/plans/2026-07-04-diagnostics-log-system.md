# Diagnostic Log System (Sub-project B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A structured, secrets-free diagnostic log a user can export when they hit an issue, for a developer/agent to analyse — unifying `dataloss-forensics`, uncaught errors, storage/sync failures, and key transitions into one channel.

**Architecture:** A pure ring-buffer core (`diagnostics.ts`) with write-time redaction (`diagnostics-redact.ts`) persisted to a capped per-device `localStorage` key (`lop-app:diag-log`, out of exports/Turso, swept by `clearAppConfig`). Emit via `logDiag(level, code, fields)`. Surface via a Settings → Diagnostics panel (view + Copy/Download bundle) and a `window.__lopDiag()` global. Uncaught-error handlers feed it too.

**Tech Stack:** TypeScript, React 19, forked Next.js, vitest, localStorage. No new deps.

---

## File Structure

- Create `src/app/diagnostics-redact.ts` — pure redaction (secret denylist + type filter + length cap).
- Create `src/app/diagnostics.ts` — ring buffer, `logDiag`/`readDiagLog`/`clearDiagLog`/`buildDiagnosticBundle`, `window.__lopDiag`.
- Create `src/app/diagnostics-boot.ts` — `registerDiagnosticsGlobalHandlers()` (window.onerror + unhandledrejection).
- Create `src/app/diagnostics-panel.tsx` — presentational panel (table + Copy/Download/Clear).
- Create `src/app/settings-sections/diagnostics-section.tsx` — Settings section wrapper.
- Modify `src/app/dataloss-forensics.ts` — re-implement over `logDiag` (keep `readDataLossLog`/`__lopDataLossLog` as a filtered view).
- Modify `src/app/use-storage-backend.ts` — add storage-outcome/transition emit sites (the 4 dataloss calls keep working via the folded module).
- Modify `src/app/settings-view.tsx` — register the `diagnostics` `SectionId` + RAIL + render.
- Modify `src/app/recovery-panel.tsx` — add a link/section to the diagnostics bundle.
- Modify `src/app/i18n.ts` + `src/app/i18n.de.ts` — new keys.
- Register `registerDiagnosticsGlobalHandlers()` in `src/app/service-worker-registrar.tsx` (existing client boot component).

---

## Task 1: Redaction core

**Files:**
- Create: `src/app/diagnostics-redact.ts`
- Test: `src/app/diagnostics-redact.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/diagnostics-redact.test.ts
import { describe, it, expect } from "vitest";
import { redactFields } from "./diagnostics-redact";

describe("redactFields", () => {
  it("returns undefined for empty/absent input", () => {
    expect(redactFields(undefined)).toBeUndefined();
    expect(redactFields({})).toBeUndefined();
  });

  it("redacts secret-ish keys (case-insensitive substring)", () => {
    const out = redactFields({ apiKey: "sk-ant-xxx", authToken: "t", anthropicApiKey: "y", ok: "keep" })!;
    expect(out.apiKey).toBe("[redacted]");
    expect(out.authToken).toBe("[redacted]");
    expect(out.anthropicApiKey).toBe("[redacted]");
    expect(out.ok).toBe("keep");
  });

  it("drops non-primitive values (no object/array dumps)", () => {
    const out = redactFields({ a: 1, b: true, c: "x", d: { nested: 1 }, e: [1, 2], f: () => 1 })!;
    expect(out).toEqual({ a: 1, b: true, c: "x" });
  });

  it("caps long strings", () => {
    const out = redactFields({ msg: "x".repeat(500) })!;
    expect((out.msg as string).length).toBeLessThanOrEqual(200);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`Cannot find module './diagnostics-redact'`)

Run: `npm run test:run -- diagnostics-redact`

- [ ] **Step 3: Implement**

```ts
// src/app/diagnostics-redact.ts
// Pure write-time redaction for the diagnostic log. Secrets NEVER reach storage;
// only primitive, length-capped structured fields survive. No free-text content
// by contract (callers pass ids/counts/codes).

const SECRET_KEY_PARTS = [
  "apikey", "authtoken", "apitoken", "token", "passphrase",
  "password", "secret", "authorization", "bearer",
];
const FIELD_MAX = 200;

function isSecretKey(key: string): boolean {
  const k = key.toLowerCase();
  return SECRET_KEY_PARTS.some((p) => k.includes(p));
}

export function redactFields(
  fields?: Record<string, unknown>,
): Record<string, string | number | boolean> | undefined {
  if (!fields) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (isSecretKey(key)) {
      out[key] = "[redacted]";
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else if (typeof value === "string") {
      out[key] = value.length > FIELD_MAX ? value.slice(0, FIELD_MAX) : value;
    }
    // objects/arrays/functions/undefined → dropped
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
```

- [ ] **Step 4: Run test — expect PASS** (`npm run test:run -- diagnostics-redact`)

- [ ] **Step 5: Commit**

```bash
git add src/app/diagnostics-redact.ts src/app/diagnostics-redact.test.ts
git commit -m "feat(diagnostics): write-time field redaction core"
```

---

## Task 2: Diagnostic ring + API

**Files:**
- Create: `src/app/diagnostics.ts`
- Test: `src/app/diagnostics.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/diagnostics.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { logDiag, readDiagLog, clearDiagLog, buildDiagnosticBundle } from "./diagnostics";

beforeEach(() => window.localStorage.clear());

describe("diagnostics ring", () => {
  it("appends newest-first with timestamp + level + code", () => {
    logDiag("warn", "storage.saveFailed", { kind: "turso" });
    logDiag("error", "uncaught", { message: "boom" });
    const log = readDiagLog();
    expect(log).toHaveLength(2);
    expect(log[0].code).toBe("uncaught");
    expect(log[0].level).toBe("error");
    expect(log[0].at).toMatch(/^\d{4}-/);
  });

  it("caps the ring at 200", () => {
    for (let i = 0; i < 250; i++) logDiag("info", `e${i}`);
    const log = readDiagLog();
    expect(log).toHaveLength(200);
    expect(log[0].code).toBe("e249");
  });

  it("redacts secret fields before storing", () => {
    logDiag("info", "x", { apiKey: "sk-ant-leak" });
    expect(JSON.stringify(readDiagLog())).not.toContain("sk-ant-leak");
    expect(readDiagLog()[0].fields!.apiKey).toBe("[redacted]");
  });

  it("never throws on malformed storage", () => {
    window.localStorage.setItem("lop-app:diag-log", "{not json");
    expect(readDiagLog()).toEqual([]);
  });

  it("bundle carries version + events and no secrets", () => {
    logDiag("info", "x", { authToken: "leak-me" });
    const bundle = JSON.parse(buildDiagnosticBundle());
    expect(bundle.version).toBeTruthy();
    expect(bundle.events).toHaveLength(1);
    expect(JSON.stringify(bundle)).not.toContain("leak-me");
  });

  it("clearDiagLog empties the ring", () => {
    logDiag("info", "x");
    clearDiagLog();
    expect(readDiagLog()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`npm run test:run -- diagnostics.test`)

- [ ] **Step 3: Implement**

```ts
// src/app/diagnostics.ts
// Structured, secrets-free diagnostic ring. Per-device (localStorage
// `lop-app:diag-log`), capped, out of workspace exports/Turso, swept by
// clearAppConfig's `lop-app:*` removal. Never throws into the app.
// Inspect in devtools: `window.__lopDiag()`.
import { APP_VERSION } from "./version";
import { redactFields } from "./diagnostics-redact";

const KEY = "lop-app:diag-log";
const DIAG_MAX = 200;

export type DiagLevel = "error" | "warn" | "info";
export interface DiagEvent {
  at: string;
  level: DiagLevel;
  code: string;
  fields?: Record<string, string | number | boolean>;
}

export function readDiagLog(): DiagEvent[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DiagEvent[]) : [];
  } catch {
    return [];
  }
}

export function logDiag(level: DiagLevel, code: string, fields?: Record<string, unknown>): void {
  try {
    if (typeof window === "undefined") return;
    const entry: DiagEvent = { at: new Date().toISOString(), level, code, fields: redactFields(fields) };
    const next = [entry, ...readDiagLog()].slice(0, DIAG_MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* never let diagnostics break the app */
  }
}

export function clearDiagLog(): void {
  try {
    if (typeof window !== "undefined") window.localStorage.removeItem(KEY);
  } catch {
    /* swallow */
  }
}

export function buildDiagnosticBundle(): string {
  const env =
    typeof navigator !== "undefined"
      ? { userAgent: navigator.userAgent, platform: navigator.platform }
      : {};
  return JSON.stringify(
    { version: APP_VERSION, generatedAt: new Date().toISOString(), env, events: readDiagLog() },
    null,
    2,
  );
}

if (typeof window !== "undefined") {
  (window as Window & { __lopDiag?: () => DiagEvent[] }).__lopDiag = readDiagLog;
}
```

- [ ] **Step 4: Run test — expect PASS** (`npm run test:run -- diagnostics.test`)

- [ ] **Step 5: Commit**

```bash
git add src/app/diagnostics.ts src/app/diagnostics.test.ts
git commit -m "feat(diagnostics): capped secrets-free ring + bundle + window global"
```

---

## Task 3: Fold dataloss-forensics into diagnostics

**Files:**
- Modify: `src/app/dataloss-forensics.ts`
- Modify: `src/app/dataloss-forensics.test.ts`

**Goal:** `recordDataLossEvent` becomes a thin wrapper over `logDiag`; `readDataLossLog` / `window.__lopDataLossLog` return only the dataloss slice (back-compat with the 4 call sites in `use-storage-backend.ts:205,272,278,609` and the existing test).

- [ ] **Step 1: Update the test to assert the fold (edit `dataloss-forensics.test.ts`)**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { recordDataLossEvent, readDataLossLog } from "./dataloss-forensics";
import { readDiagLog } from "./diagnostics";

beforeEach(() => window.localStorage.clear());

describe("dataloss-forensics (folded into diagnostics)", () => {
  it("records into the unified diag ring under a dataloss.* code", () => {
    recordDataLossEvent({ path: "save-effect", prevCollections: 2, nextCollections: 0, refused: true });
    const diag = readDiagLog();
    expect(diag).toHaveLength(1);
    expect(diag[0].code).toMatch(/^dataloss\./);
    expect(diag[0].fields!.path).toBe("save-effect");
  });

  it("readDataLossLog returns only the dataloss slice, newest-first", () => {
    recordDataLossEvent({ path: "load", prevCollections: 3, nextCollections: 0, refused: true });
    const log = readDataLossLog();
    expect(log).toHaveLength(1);
    expect(log[0].path).toBe("load");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (old impl uses its own key)

Run: `npm run test:run -- dataloss-forensics`

- [ ] **Step 3: Re-implement `dataloss-forensics.ts` over `logDiag`**

```ts
// src/app/dataloss-forensics.ts
// Data-loss events now ride the unified diagnostic ring (see diagnostics.ts) under
// `dataloss.*` codes. This module keeps the original record/read API + the
// `window.__lopDataLossLog()` alias for back-compat with the storage guards.
import { logDiag, readDiagLog } from "./diagnostics";

export interface DataLossEvent {
  at: string;
  path: string;
  prevCollections: number;
  nextCollections: number;
  refused: boolean;
  stack?: string;
}

export function recordDataLossEvent(
  e: Omit<DataLossEvent, "at" | "stack"> & { stack?: string },
): void {
  const code = `dataloss.${e.refused ? "refused" : "observed"}`;
  logDiag(e.refused ? "warn" : "info", code, {
    path: e.path,
    prevCollections: e.prevCollections,
    nextCollections: e.nextCollections,
    refused: e.refused,
    stack: (e.stack ?? new Error().stack ?? "").split("\n").slice(2, 9).join("\n"),
  });
}

export function readDataLossLog(): DataLossEvent[] {
  return readDiagLog()
    .filter((ev) => ev.code.startsWith("dataloss."))
    .map((ev) => ({
      at: ev.at,
      path: String(ev.fields?.path ?? ""),
      prevCollections: Number(ev.fields?.prevCollections ?? 0),
      nextCollections: Number(ev.fields?.nextCollections ?? 0),
      refused: Boolean(ev.fields?.refused ?? false),
      stack: ev.fields?.stack ? String(ev.fields.stack) : undefined,
    }));
}

if (typeof window !== "undefined") {
  (window as Window & { __lopDataLossLog?: () => DataLossEvent[] }).__lopDataLossLog =
    readDataLossLog;
}
```

- [ ] **Step 4: Run tests — expect PASS** (`npm run test:run -- dataloss-forensics use-storage-backend`)

- [ ] **Step 5: Commit**

```bash
git add src/app/dataloss-forensics.ts src/app/dataloss-forensics.test.ts
git commit -m "refactor(diagnostics): fold dataloss-forensics into the unified ring"
```

---

## Task 4: Uncaught-error handlers

**Files:**
- Create: `src/app/diagnostics-boot.ts`
- Test: `src/app/diagnostics-boot.test.ts`
- Modify: `src/app/service-worker-registrar.tsx`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/diagnostics-boot.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { registerDiagnosticsGlobalHandlers } from "./diagnostics-boot";
import { readDiagLog } from "./diagnostics";

beforeEach(() => window.localStorage.clear());

describe("registerDiagnosticsGlobalHandlers", () => {
  it("logs an uncaught error event on window 'error'", () => {
    registerDiagnosticsGlobalHandlers();
    window.dispatchEvent(new ErrorEvent("error", { message: "kaboom", filename: "x.ts" }));
    const log = readDiagLog();
    expect(log.some((e) => e.code === "uncaught" && e.level === "error")).toBe(true);
  });

  it("is idempotent (registering twice does not double-log)", () => {
    registerDiagnosticsGlobalHandlers();
    registerDiagnosticsGlobalHandlers();
    window.dispatchEvent(new ErrorEvent("error", { message: "once" }));
    expect(readDiagLog().filter((e) => e.code === "uncaught")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`npm run test:run -- diagnostics-boot`)

- [ ] **Step 3: Implement**

```ts
// src/app/diagnostics-boot.ts
// One-time registration of global uncaught-error handlers that feed the diagnostic
// ring. Chains (does not replace) any existing handler.
import { logDiag } from "./diagnostics";

let registered = false;

export function registerDiagnosticsGlobalHandlers(): void {
  if (registered || typeof window === "undefined") return;
  registered = true;
  window.addEventListener("error", (e: ErrorEvent) => {
    logDiag("error", "uncaught", { message: e.message ?? "", source: e.filename ?? "" });
  });
  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const reason = e.reason;
    const message = reason instanceof Error ? reason.message : String(reason ?? "");
    logDiag("error", "unhandledRejection", { message });
  });
}
```

- [ ] **Step 4: Run test — expect PASS** (`npm run test:run -- diagnostics-boot`)

- [ ] **Step 5: Register in the client boot** — in `src/app/service-worker-registrar.tsx`, inside its existing mount `useEffect`, add:

```ts
import { registerDiagnosticsGlobalHandlers } from "./diagnostics-boot";
// ...inside the effect body:
registerDiagnosticsGlobalHandlers();
```

- [ ] **Step 6: Verify build + commit**

Run: `npx tsc --noEmit` (expect exit 0), `npm run lint` (expect exit 0)

```bash
git add src/app/diagnostics-boot.ts src/app/diagnostics-boot.test.ts src/app/service-worker-registrar.tsx
git commit -m "feat(diagnostics): capture uncaught errors + unhandled rejections"
```

---

## Task 5: Wire storage-outcome + transition emit sites

**Files:**
- Modify: `src/app/use-storage-backend.ts`

**Goal:** emit `logDiag` at the storage error/success boundary and key transitions. The 4 dataloss calls already flow through Task 3.

- [ ] **Step 1: Add the import**

```ts
import { logDiag } from "./diagnostics";
```

- [ ] **Step 2: In the load effect's catch block (near `use-storage-backend.ts:187`), after `args.onStorageOutcome?.(err)`, add:**

```ts
logDiag("error", "storage.loadFailed", { kind: settingsRef.current.storageConfig.kind, message: String(err) });
```

- [ ] **Step 3: In the save effect's `.catch((err) => {` block (near `:235`), after `args.onStorageOutcome?.(err)`, add:**

```ts
logDiag("error", "storage.saveFailed", { message: String(err) });
```

- [ ] **Step 4: In the load effect success path (after `applyWorkspace(workspace)` near `:214`), add:**

```ts
logDiag("info", "storage.loaded", { records: workspaceRecordCount(workspace) });
```

(`workspaceRecordCount` is already imported in this file.)

- [ ] **Step 5: Run + verify** — `npm run test:run -- use-storage-backend`, `npx tsc --noEmit`, `npm run lint` (all exit 0)

- [ ] **Step 6: Commit**

```bash
git add src/app/use-storage-backend.ts
git commit -m "feat(diagnostics): emit storage load/save outcomes"
```

---

## Task 6: DiagnosticsPanel

**Files:**
- Create: `src/app/diagnostics-panel.tsx`
- Test: `src/app/diagnostics-panel.test.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Add i18n keys** — in `src/app/i18n.ts` add (and mirror in `i18n.de.ts` via a node utf8 write per the AGENTS.md i18n landmine):

```ts
  diagnosticsTitle: "Diagnostics",
  diagnosticsIntro: "Recent technical events on this device. No project content or secrets are recorded.",
  diagnosticsCopyBundle: "Copy diagnostic bundle",
  diagnosticsDownloadBundle: "Download diagnostic bundle",
  diagnosticsClear: "Clear log",
  diagnosticsEmpty: "No diagnostic events recorded.",
  diagnosticsCopied: "Diagnostic bundle copied to clipboard.",
```

DE (real umlauts; write via node, match CRLF):

```
  diagnosticsTitle: "Diagnose",
  diagnosticsIntro: "Aktuelle technische Ereignisse auf diesem Gerät. Keine Projektinhalte oder Geheimnisse werden erfasst.",
  diagnosticsCopyBundle: "Diagnosepaket kopieren",
  diagnosticsDownloadBundle: "Diagnosepaket herunterladen",
  diagnosticsClear: "Protokoll leeren",
  diagnosticsEmpty: "Keine Diagnoseereignisse aufgezeichnet.",
  diagnosticsCopied: "Diagnosepaket in die Zwischenablage kopiert.",
```

- [ ] **Step 2: Write the failing test**

```tsx
// src/app/diagnostics-panel.test.tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DiagnosticsPanel } from "./diagnostics-panel";
import { logDiag, readDiagLog } from "./diagnostics";

beforeEach(() => window.localStorage.clear());

describe("DiagnosticsPanel", () => {
  it("renders recorded events", () => {
    logDiag("warn", "storage.saveFailed", { kind: "turso" });
    render(<DiagnosticsPanel lang="en-US" />);
    expect(screen.getByText("storage.saveFailed")).toBeInTheDocument();
  });

  it("Clear empties the ring", () => {
    logDiag("info", "x");
    render(<DiagnosticsPanel lang="en-US" />);
    fireEvent.click(screen.getByRole("button", { name: /clear log/i }));
    expect(readDiagLog()).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it — expect FAIL** (`npm run test:run -- diagnostics-panel`)

- [ ] **Step 4: Implement** (presentational; AIPM tokens only; uses `EmptyState`, `INTERACTIVE`, `useToastContext`)

```tsx
// src/app/diagnostics-panel.tsx
"use client";
import { useState } from "react";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { readDiagLog, clearDiagLog, buildDiagnosticBundle } from "./diagnostics";
import { EmptyState } from "./empty-state";
import { INTERACTIVE } from "./interaction-styles";
import { useToastContext } from "./toast-context";

export function DiagnosticsPanel({ lang }: { lang: Lang }) {
  const showToast = useToastContext();
  const [events, setEvents] = useState(() => readDiagLog());

  const refresh = () => setEvents(readDiagLog());
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildDiagnosticBundle());
      showToast("info", t(lang, "diagnosticsCopied"));
    } catch { /* clipboard blocked — no-op */ }
  };
  const download = () => {
    const blob = new Blob([buildDiagnosticBundle()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lop-app-diagnostics.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  const clear = () => { clearDiagLog(); refresh(); };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t(lang, "diagnosticsIntro")}</p>
      <div className="flex flex-wrap gap-2">
        <button className={`rounded-md border border-line px-3 py-1.5 text-sm ${INTERACTIVE}`} onClick={copy}>{t(lang, "diagnosticsCopyBundle")}</button>
        <button className={`rounded-md border border-line px-3 py-1.5 text-sm ${INTERACTIVE}`} onClick={download}>{t(lang, "diagnosticsDownloadBundle")}</button>
        <button className={`rounded-md border border-line px-3 py-1.5 text-sm ${INTERACTIVE}`} onClick={clear}>{t(lang, "diagnosticsClear")}</button>
      </div>
      {events.length === 0 ? (
        <EmptyState title={t(lang, "diagnosticsEmpty")} compact />
      ) : (
        <div className="min-h-0 overflow-auto pr-2">
          <table className="w-full text-left text-xs">
            <tbody className="divide-y divide-line">
              {events.map((e, i) => (
                <tr key={i}>
                  <td className="py-1 pr-2 font-mono text-muted-foreground">{e.at.slice(11, 19)}</td>
                  <td className="py-1 pr-2">{e.level}</td>
                  <td className="py-1 pr-2 font-medium">{e.code}</td>
                  <td className="py-1 font-mono text-muted-foreground">{e.fields ? JSON.stringify(e.fields) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run test — expect PASS**; then `npx tsc --noEmit` (i18n EN/DE parity enforced).

- [ ] **Step 6: Commit**

```bash
git add src/app/diagnostics-panel.tsx src/app/diagnostics-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(diagnostics): panel with copy/download/clear + i18n"
```

---

## Task 7: Settings section + recovery link

**Files:**
- Create: `src/app/settings-sections/diagnostics-section.tsx`
- Modify: `src/app/settings-view.tsx` (SectionId union + RAIL + render switch)
- Modify: `src/app/recovery-panel.tsx`

- [ ] **Step 1: Create the section wrapper**

```tsx
// src/app/settings-sections/diagnostics-section.tsx
import type { Lang } from "../i18n";
import { DiagnosticsPanel } from "../diagnostics-panel";

export function DiagnosticsSection({ lang }: { lang: Lang }) {
  return <DiagnosticsPanel lang={lang} />;
}
```

- [ ] **Step 2: Register in `settings-view.tsx`**
  - Add `"diagnostics"` to the `SectionId` union (near line 74).
  - Add `{ id: "diagnostics", labelKey: "diagnosticsTitle" }` to `RAIL` (near line 79), in the System group.
  - In the section render switch, add: `{activeSection === "diagnostics" && <DiagnosticsSection lang={lang} />}` and import `DiagnosticsSection`.

- [ ] **Step 3: Add a recovery link** — in `src/app/recovery-panel.tsx`, add a button/section that calls `buildDiagnosticBundle()` + downloads it (reuse the panel's download logic or render `<DiagnosticsPanel lang={lang} />` there).

- [ ] **Step 4: Verify** — `npx tsc --noEmit`, `npm run lint`, `npm run test:run -- settings-view diagnostics`, and the axe gate for Settings:

Run: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings"` (expect pass — the section's buttons are labeled, palette-safe)

- [ ] **Step 5: Commit**

```bash
git add src/app/settings-sections/diagnostics-section.tsx src/app/settings-view.tsx src/app/recovery-panel.tsx
git commit -m "feat(diagnostics): Settings section + recovery-page access"
```

---

## Final verification (before finishing the branch)

- [ ] `npx tsc --noEmit` → exit 0
- [ ] `npm run lint` → exit 0
- [ ] `npm run test:run` → full suite green
- [ ] `npm run size:check` → ok (new files are small; settings-view grew by a few lines — if it trips the ratchet, fold lines or `--update` per AGENTS.md)
- [ ] `npm run dup:check` → within 2.4
- [ ] Manual: trigger a save failure (bad Turso token) → event appears in Settings → Diagnostics; Download bundle → JSON has no secrets; `window.__lopDiag()` works in devtools.

Then follow **superpowers:finishing-a-development-branch**.
