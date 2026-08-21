# Jira Token Expiry Reminder + Sync Info Message Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warn the user before/when their Jira API token expires (proactive banner from a recorded expiry date + reactive detection of 401/403), and show a clear info message when Sync is clicked but the token is expired/invalid or Jira is unreachable.

**Architecture:** A recorded `tokenExpiresAt` date plus a reactive `tokenInvalidAt` flag on `JiraConfig` drive a pure `getJiraTokenAlert` derivation, surfaced through a `JiraTokenBanner` reusing the existing reminder/snooze infrastructure. A `classifyJiraError` helper lets the sync path show specific auth/connection messages and set/clear the flag.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-26-jira-token-expiry-design.md`

**Verification:** single test `npx vitest run src/app/<file>.test.ts`; full suite `npx vitest run`; typecheck `npx tsc --noEmit`.

**Conventions:** attribution disabled globally (no `Co-Authored-By`). Do NOT edit `eslint.config.mjs`/config (hook blocks it). A GateGuard hook may block the first Edit/Write and first Bash — present facts in the same message and retry.

---

## Task 1: i18n keys (EN + DE)

**Files:** Modify `src/app/i18n.ts` (the `enUS` object, before `} as const;`), `src/app/i18n.de.ts` (the `de` object).

Context: `de` is typed `Record<TranslationKey, string>`, so `tsc` fails until both have all 7 keys.

- [ ] **Step 1: Add the EN keys to `enUS`**

```ts
  jiraTokenExpires: "Token expires on",
  jiraTokenExpiresHint: "Optional. Atlassian shows this date when you create the token. Leave blank if your token doesn't expire.",
  jiraTokenBannerAria: "Jira token reminder",
  jiraTokenExpiringBanner: "Your Jira API token expires in {0} day(s), on {1}. Create a new one in Jira and update Settings → Jira before it stops working.",
  jiraTokenExpiredBanner: "Your Jira API token expired on {0}. Sync is paused until you create a new token and update Settings → Jira.",
  jiraTokenInvalidBanner: "Jira rejected your API token — it may be expired or invalid. Create a new token and update Settings → Jira.",
  jiraSyncUnreachable: "Couldn't reach Jira — check your connection and the site URL, then try again.",
```

- [ ] **Step 2: Add the matching DE keys to `de`**

```ts
  jiraTokenExpires: "Token läuft ab am",
  jiraTokenExpiresHint: "Optional. Atlassian zeigt dieses Datum beim Erstellen des Tokens an. Leer lassen, wenn Ihr Token nicht abläuft.",
  jiraTokenBannerAria: "Jira-Token-Erinnerung",
  jiraTokenExpiringBanner: "Ihr Jira-API-Token läuft in {0} Tag(en) ab, am {1}. Erstellen Sie in Jira ein neues und hinterlegen Sie es unter Einstellungen → Jira, bevor es nicht mehr funktioniert.",
  jiraTokenExpiredBanner: "Ihr Jira-API-Token ist am {0} abgelaufen. Die Synchronisierung ist pausiert, bis Sie ein neues Token erstellen und es unter Einstellungen → Jira hinterlegen.",
  jiraTokenInvalidBanner: "Jira hat Ihr API-Token abgelehnt – es ist möglicherweise abgelaufen oder ungültig. Erstellen Sie ein neues Token und hinterlegen Sie es unter Einstellungen → Jira.",
  jiraSyncUnreachable: "Jira konnte nicht erreicht werden – bitte Verbindung und Site-URL prüfen und erneut versuchen.",
```

- [ ] **Step 3: Typecheck** — `npx tsc --noEmit` → PASS (parity gate).
- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "i18n: add Jira token expiry banner and sync message strings (EN + DE)"
```

---

## Task 2: `JiraConfig` data model

**Files:** Modify `src/app/settings-menu.tsx` (the `JiraConfig` type and `defaultJiraConfig`).

- [ ] **Step 1: Add the two fields to `JiraConfig`**

After the existing fields (e.g. after `assigneeDisplayName`):

```ts
  /** Optional ISO date "YYYY-MM-DD" the user records from Atlassian; "" = unknown/never. Drives proactive warnings. */
  tokenExpiresAt: string;
  /** ISO timestamp set when a Jira call returns 401/403; cleared on the next successful sync/test. Drives the reactive "rejected" state. */
  tokenInvalidAt?: string;
```

- [ ] **Step 2: Add the default to `defaultJiraConfig`**

Add `tokenExpiresAt: "",` to the `defaultJiraConfig` object (leave `tokenInvalidAt` absent — undefined means "valid").

- [ ] **Step 3: Typecheck** — `npx tsc --noEmit`. Expected: PASS. If any test fixture builds a strict `JiraConfig` literal that now errors on the missing required `tokenExpiresAt`, add `tokenExpiresAt: ""` to it (most fixtures are `as`-cast partials and won't break).
- [ ] **Step 4: Commit**

```bash
git add src/app/settings-menu.tsx
git commit -m "feat(jira): add tokenExpiresAt and tokenInvalidAt to JiraConfig"
```

---

## Task 3: `classifyJiraError` + export `JiraApiError`

**Files:** Modify `src/app/jira-api.ts`; Test: `src/app/jira-api.test.ts` (create if absent).

Context: `JiraApiError` (jira-api.ts:39, constructor `(status, payload)`) is currently NOT exported. Export it so the test can construct one, and add a classifier the sync path uses.

- [ ] **Step 1: Write the failing test**

Create/extend `src/app/jira-api.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifyJiraError, JiraApiError } from "./jira-api";

describe("classifyJiraError", () => {
  it("classifies 401/403 as auth", () => {
    expect(classifyJiraError(new JiraApiError(401, {}))).toBe("auth");
    expect(classifyJiraError(new JiraApiError(403, {}))).toBe("auth");
  });
  it("classifies 5xx as network", () => {
    expect(classifyJiraError(new JiraApiError(500, {}))).toBe("network");
  });
  it("classifies other HTTP statuses as other", () => {
    expect(classifyJiraError(new JiraApiError(404, {}))).toBe("other");
    expect(classifyJiraError(new JiraApiError(400, {}))).toBe("other");
  });
  it("classifies a thrown non-Jira error (fetch failure) as network", () => {
    expect(classifyJiraError(new TypeError("Failed to fetch"))).toBe("network");
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run src/app/jira-api.test.ts` → FAIL (`classifyJiraError`/`JiraApiError` not exported).

- [ ] **Step 3: Export `JiraApiError` and add the classifier**

In `src/app/jira-api.ts`, add `export` to the class declaration (`export class JiraApiError extends Error {`). Add near `formatJiraError`:

```ts
export type JiraErrorKind = "auth" | "network" | "other";

export function classifyJiraError(err: unknown): JiraErrorKind {
  if (err instanceof JiraApiError) {
    if (err.status === 401 || err.status === 403) return "auth";
    if (err.status >= 500) return "network";
    return "other";
  }
  return "network";
}
```

- [ ] **Step 4: Run it** — `npx vitest run src/app/jira-api.test.ts` → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/app/jira-api.ts src/app/jira-api.test.ts
git commit -m "feat(jira): classifyJiraError helper; export JiraApiError"
```

---

## Task 4: `getJiraTokenAlert` derivation

**Files:** Create `src/app/jira-token-status.ts`; Test: `src/app/jira-token-status.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/app/jira-token-status.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getJiraTokenAlert, daysUntil } from "./jira-token-status";
import type { JiraConfig } from "./settings-menu";

function cfg(over: Partial<JiraConfig>): JiraConfig {
  return {
    enabled: true, siteUrl: "", email: "", apiToken: "", projectKey: "", projectName: "",
    issueTypes: [], assigneeMode: "currentUser", assigneeAccountId: "", assigneeDisplayName: "",
    tokenExpiresAt: "", ...over,
  } as JiraConfig;
}
const TODAY = "2026-05-26";

describe("getJiraTokenAlert", () => {
  it("returns null when Jira is disabled", () => {
    expect(getJiraTokenAlert(cfg({ enabled: false, tokenExpiresAt: "2026-05-27" }), TODAY, 7)).toBeNull();
  });
  it("returns null with no date and no invalid flag", () => {
    expect(getJiraTokenAlert(cfg({}), TODAY, 7)).toBeNull();
  });
  it("returns expiring when within lead days", () => {
    expect(getJiraTokenAlert(cfg({ tokenExpiresAt: "2026-05-30" }), TODAY, 7))
      .toEqual({ state: "expiring", daysLeft: 4, date: "2026-05-30" });
  });
  it("returns null when beyond lead days", () => {
    expect(getJiraTokenAlert(cfg({ tokenExpiresAt: "2026-07-01" }), TODAY, 7)).toBeNull();
  });
  it("returns expired when the date is past", () => {
    const a = getJiraTokenAlert(cfg({ tokenExpiresAt: "2026-05-20" }), TODAY, 7);
    expect(a?.state).toBe("expired");
  });
  it("invalid overrides a still-future date", () => {
    const a = getJiraTokenAlert(cfg({ tokenExpiresAt: "2026-12-31", tokenInvalidAt: "2026-05-26T10:00:00Z" }), TODAY, 7);
    expect(a?.state).toBe("invalid");
  });
});

describe("daysUntil", () => {
  it("returns whole-day difference", () => {
    expect(daysUntil("2026-05-30", "2026-05-26")).toBe(4);
    expect(daysUntil("2026-05-20", "2026-05-26")).toBe(-6);
  });
  it("returns null on an unparseable date", () => {
    expect(daysUntil("not-a-date", "2026-05-26")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run src/app/jira-token-status.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

Create `src/app/jira-token-status.ts`:

```ts
import type { JiraConfig } from "./settings-menu";

export type JiraTokenAlert =
  | { state: "invalid" | "expired" | "expiring"; daysLeft: number; date: string }
  | null;

/** Whole-day difference (target - today). Both args are "YYYY-MM-DD". null if unparseable. */
export function daysUntil(targetIso: string, todayIso: string): number | null {
  const target = Date.parse(`${targetIso}T12:00:00Z`);
  const today = Date.parse(`${todayIso}T12:00:00Z`);
  if (Number.isNaN(target) || Number.isNaN(today)) return null;
  return Math.round((target - today) / 86_400_000);
}

/** Highest-priority token alert, or null. Priority: invalid > expired > expiring. `today` is "YYYY-MM-DD". */
export function getJiraTokenAlert(jira: JiraConfig, today: string, leadDays: number): JiraTokenAlert {
  if (!jira.enabled) return null;
  if (jira.tokenInvalidAt) return { state: "invalid", daysLeft: 0, date: "" };
  const exp = jira.tokenExpiresAt?.trim();
  if (!exp) return null;
  const daysLeft = daysUntil(exp, today);
  if (daysLeft === null) return null;
  if (daysLeft < 0) return { state: "expired", daysLeft, date: exp };
  if (daysLeft <= leadDays) return { state: "expiring", daysLeft, date: exp };
  return null;
}
```

- [ ] **Step 4: Run it** — `npx vitest run src/app/jira-token-status.test.ts` → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/app/jira-token-status.ts src/app/jira-token-status.test.ts
git commit -m "feat(jira): getJiraTokenAlert token-status derivation"
```

---

## Task 5: `formatExpiryDate` date helper

**Files:** Modify `src/app/date-format.ts`; Test: `src/app/date-format.test.ts` (exists).

- [ ] **Step 1: Write the failing test**

Add to `src/app/date-format.test.ts` (reuse the file's existing `import { describe, it, expect } from "vitest";`; add `formatExpiryDate` to the import from `./date-format`):

```ts
describe("formatExpiryDate", () => {
  it("formats an ISO date for the locale", () => {
    const s = formatExpiryDate("2026-08-15", "en-US");
    expect(s).toMatch(/Aug/);
    expect(s).toMatch(/2026/);
  });
  it("returns the input unchanged when unparseable", () => {
    expect(formatExpiryDate("not-a-date", "en-US")).toBe("not-a-date");
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run src/app/date-format.test.ts` → FAIL (`formatExpiryDate` missing).

- [ ] **Step 3: Implement**

Add to `src/app/date-format.ts` (it already exports `localeFor` and imports `Lang`):

```ts
/** Formats a "YYYY-MM-DD" date for display in the active language; returns the input if unparseable. */
export function formatExpiryDate(isoDate: string, lang: Lang): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.valueOf())) return isoDate;
  return d.toLocaleDateString(localeFor(lang), { year: "numeric", month: "short", day: "2-digit" });
}
```

- [ ] **Step 4: Run it** — `npx vitest run src/app/date-format.test.ts` → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/app/date-format.ts src/app/date-format.test.ts
git commit -m "feat(date): formatExpiryDate display helper"
```

---

## Task 6: Jira settings — expiry date field + test-connection flag sync

**Files:** Modify `src/app/jira-settings.tsx`.

Context: `JiraSettingsSection` receives `config: JiraConfig` and `onChange: (next: JiraConfig) => void`. No unit-test harness for this file, so verify via `tsc` + the full suite + manual; the classify logic itself is covered by Task 3. `formatJiraError` is already imported; add `classifyJiraError`.

- [ ] **Step 1: Add the expiry date field**

Near the API-token input (after it), add (match the file's existing field-wrapper/label markup; `inputClass` is the shared constant at the top of the file):

```tsx
<div>
  <label>{t(lang, "jiraTokenExpires")}</label>
  <input
    type="date"
    className={inputClass}
    value={config.tokenExpiresAt ?? ""}
    onChange={(e) => onChange({ ...config, tokenExpiresAt: e.target.value })}
  />
  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t(lang, "jiraTokenExpiresHint")}</p>
</div>
```

- [ ] **Step 2: Clear/set the invalid flag in `handleTest`**

Update the import to include `classifyJiraError` from `./jira-api`. In `handleTest`, after `testConnection(creds)` resolves (success path) add `onChange({ ...config, tokenInvalidAt: undefined });`. In the `catch (err)` block add (alongside the existing `setStatus`):

```ts
if (classifyJiraError(err) === "auth") {
  onChange({ ...config, tokenInvalidAt: new Date().toISOString() });
}
```

- [ ] **Step 3: Typecheck + full suite** — `npx tsc --noEmit` → PASS; `npx vitest run` → PASS (settings-menu.test.tsx still green).
- [ ] **Step 4: Commit**

```bash
git add src/app/jira-settings.tsx
git commit -m "feat(jira): record token expiry date; test-connection clears/sets invalid flag"
```

---

## Task 7: `JiraTokenBanner` component

**Files:** Modify `src/app/notifications.tsx`; Test: `src/app/notifications.test.tsx` (create if absent, else extend).

Context: mirror `BirthdayBanner` (same file). `SnoozeMenu` is a module-local component in this file (reuse it). Import `formatExpiryDate` from `./date-format` and the `JiraTokenAlert` type from `./jira-token-status`.

- [ ] **Step 1: Write the failing test**

Create/extend `src/app/notifications.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { JiraTokenBanner } from "./notifications";

describe("JiraTokenBanner", () => {
  it("renders the invalid message", () => {
    render(<JiraTokenBanner alert={{ state: "invalid", daysLeft: 0, date: "" }} lang="en-US" onSnooze={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText(/rejected your API token/i)).toBeInTheDocument();
  });
  it("renders the expired message", () => {
    render(<JiraTokenBanner alert={{ state: "expired", daysLeft: -3, date: "2026-05-20" }} lang="en-US" onSnooze={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText(/expired on/i)).toBeInTheDocument();
  });
  it("renders the expiring message with day count", () => {
    render(<JiraTokenBanner alert={{ state: "expiring", daysLeft: 4, date: "2026-05-30" }} lang="en-US" onSnooze={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText(/expires in 4 day/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run src/app/notifications.test.tsx` → FAIL (`JiraTokenBanner` missing).

- [ ] **Step 3: Implement**

Add imports at the top of `src/app/notifications.tsx`:

```ts
import { formatExpiryDate } from "./date-format";
import type { JiraTokenAlert } from "./jira-token-status";
```

Add the component (mirroring `BirthdayBanner`):

```tsx
export function JiraTokenBanner({
  alert, lang, onSnooze, onDismiss,
}: { alert: NonNullable<JiraTokenAlert>; lang: Lang; onSnooze: (ms: number) => void; onDismiss: () => void }) {
  const msg =
    alert.state === "invalid" ? t(lang, "jiraTokenInvalidBanner")
    : alert.state === "expired" ? t(lang, "jiraTokenExpiredBanner", formatExpiryDate(alert.date, lang))
    : t(lang, "jiraTokenExpiringBanner", alert.daysLeft, formatExpiryDate(alert.date, lang));
  return (
    <div role="region" aria-label={t(lang, "jiraTokenBannerAria")}
      className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-AIPM-pink/40 bg-AIPM-pink/10 px-4 py-3 dark:border-AIPM-pink/60 dark:bg-AIPM-pink/15">
      <span aria-hidden className="text-lg">⚠</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{msg}</p>
      </div>
      <div className="flex gap-2">
        <SnoozeMenu lang={lang} onSnooze={onSnooze} />
        <button type="button" onClick={onDismiss} aria-label={t(lang, "alertBannerDismiss")}
          className="rounded-md border border-AIPM-medium-grey/40 bg-white px-3 py-1.5 text-xs font-medium text-AIPM-dark-grey hover:bg-AIPM-light-grey dark:border-zinc-700 dark:bg-zinc-900 dark:text-AIPM-medium-grey">
          {t(lang, "alertBannerDismiss")}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run it** — `npx vitest run src/app/notifications.test.tsx` → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/app/notifications.tsx src/app/notifications.test.tsx
git commit -m "feat(jira): JiraTokenBanner for expiring/expired/invalid token"
```

---

## Task 8: Sync — preflight, classified failures, flag sync

**Files:** Modify `src/app/use-jira-sync.ts`; Test: `src/app/use-jira-sync.test.tsx` (exists).

Context: `handleJiraSync` (use-jira-sync.ts:52) reads settings via `settingsRef`, has `args.showToast`/`langRef`/`todayRef`, and destructures helpers from `loadJiraApi()`. The success path begins right after `const issues = await searchAllIssues(creds, jql);` (line ~80); the generic catch is at line ~249. Add `onJiraAuthResult` to args; import `daysUntil` from `./jira-token-status` and `formatExpiryDate` from `./date-format`.

- [ ] **Step 1: Write the failing tests**

Read `src/app/use-jira-sync.test.tsx` to learn its harness (how it builds `UseJiraSyncArgs`, mocks `loadJiraApi`/the jira-api module, renders the hook, and invokes `handleJiraSync`). Add a describe block, reusing that harness and passing a `vi.fn()` for `onJiraAuthResult`:

```tsx
  it("blocks sync and shows the expired message when tokenExpiresAt is in the past", async () => {
    // settings.jira.enabled=true, tokenExpiresAt="2020-01-01", today="2026-05-26"; spy searchAllIssues
    // call handleJiraSync(); assert showToast("info", <expired text>) AND searchAllIssues NOT called
  });
  it("on a 401 from search, calls onJiraAuthResult(false) and shows an info toast", async () => {
    // searchAllIssues rejects with new JiraApiError(401, {}) (import JiraApiError from "./jira-api")
    // assert onJiraAuthResult called with false; showToast called with "info"
  });
  it("on a successful sync, calls onJiraAuthResult(true)", async () => {
    // searchAllIssues resolves []; assert onJiraAuthResult called with true
  });
```

Implement with the file's existing mock/`act` conventions. IMPORTANT: if the harness mocks `loadJiraApi` to return a fake module object, that fake MUST also expose `classifyJiraError` and `formatJiraError` (re-export the real ones from `./jira-api`, or include matching impls), since `handleJiraSync` now destructures `classifyJiraError`.

- [ ] **Step 2: Run them** — `npx vitest run src/app/use-jira-sync.test.tsx` → FAIL.

- [ ] **Step 3: Add `onJiraAuthResult` to the args type**

```ts
export interface UseJiraSyncArgs {
  settings: Settings;
  today: string;
  lang: Lang;
  showToast: (kind: "info" | "error", text: string) => void;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  /** Called false when a sync hits a 401/403 (token rejected), true on a successful sync. */
  onJiraAuthResult?: (ok: boolean) => void;
}
```

- [ ] **Step 4: Imports + preflight**

Add at the top: `import { daysUntil } from "./jira-token-status";` and `import { formatExpiryDate } from "./date-format";`.

In `handleJiraSync`, right after the `if (!jiraCfg.enabled) return;` guard (line ~55), before building `creds`:

```ts
  if (jiraCfg.tokenExpiresAt) {
    const d = daysUntil(jiraCfg.tokenExpiresAt, todayRef.current);
    if (d !== null && d < 0) {
      args.showToast("info", t(langRef.current, "jiraTokenExpiredBanner", formatExpiryDate(jiraCfg.tokenExpiresAt, langRef.current)));
      return;
    }
  }
```

- [ ] **Step 5: Clear the flag on success**

Add `classifyJiraError` to the destructure from `await loadJiraApi()` (next to `formatJiraError`). Immediately after `const issues = await searchAllIssues(creds, jql);` add:

```ts
      args.onJiraAuthResult?.(true);
```

- [ ] **Step 6: Classify failures in the catch**

Replace the existing catch body (line ~249) with:

```ts
    } catch (err) {
      const kind = classifyJiraError(err);
      if (kind === "auth") {
        args.onJiraAuthResult?.(false);
        args.showToast("info", t(langRef.current, "jiraTokenInvalidBanner"));
      } else if (kind === "network") {
        args.showToast("info", t(langRef.current, "jiraSyncUnreachable"));
      } else {
        args.showToast("error", t(langRef.current, "jiraSyncFailed", formatJiraError(err)));
      }
    }
```

(Leave the per-row `jiraPushFailed` handling inside the try unchanged.)

- [ ] **Step 7: Run tests + typecheck** — `npx vitest run src/app/use-jira-sync.test.tsx` → PASS; `npx tsc --noEmit` → PASS.
- [ ] **Step 8: Commit**

```bash
git add src/app/use-jira-sync.ts src/app/use-jira-sync.test.tsx
git commit -m "feat(jira): sync preflight + classified auth/connection messages + token-flag sync"
```

---

## Task 9: Wire the banner + snooze + flag into `TaskManagerInner`

**Files:** Modify `src/app/reminder-snooze.ts` (the `ReminderKind` type), `src/app/task-manager.tsx`.

Context (integration — pieces are unit-tested in Tasks 4 & 7). `task-manager.tsx` already renders `DueBanner`/`BirthdayBanner` (~lines 435-447), uses `useReminderSnooze`, has `settings`/`setSettings`/`today`/`lang`/`isPopout` in scope, and calls `useJiraSync({...})`.

- [ ] **Step 1: Extend `ReminderKind`**

In `src/app/reminder-snooze.ts:1`:

```ts
export type ReminderKind = "due" | "birthday" | "jiraToken";
```

- [ ] **Step 2: Add imports + hooks in `TaskManagerInner`**

Imports: `import { getJiraTokenAlert } from "./jira-token-status";` and add `JiraTokenBanner` to the existing import from `./notifications`.

Near the other snooze/alert hooks (~lines 145-153):

```ts
  const jiraTokenSnooze = useReminderSnooze("jiraToken");
  const [jiraTokenDismissed, setJiraTokenDismissed] = useState(false);
  const jiraTokenAlert = useMemo(
    () => getJiraTokenAlert(settings.jira, today, settings.notifications.reminderLeadDays),
    [settings.jira, today, settings.notifications.reminderLeadDays],
  );
```

- [ ] **Step 3: Pass `onJiraAuthResult` to `useJiraSync`**

In the existing `useJiraSync({ ... })` call, add:

```ts
    onJiraAuthResult: (ok: boolean) =>
      setSettings((s) => ({ ...s, jira: { ...s.jira, tokenInvalidAt: ok ? undefined : new Date().toISOString() } })),
```

- [ ] **Step 4: Render the banner**

After the birthday banner block, add:

```tsx
      {!isPopout && jiraTokenAlert && !jiraTokenSnooze.isSnoozed && !jiraTokenDismissed && (
        <JiraTokenBanner
          alert={jiraTokenAlert}
          lang={lang}
          onSnooze={jiraTokenSnooze.snooze}
          onDismiss={() => setJiraTokenDismissed(true)}
        />
      )}
```

- [ ] **Step 5: Typecheck + full suite** — `npx tsc --noEmit` → PASS; `npx vitest run` → PASS (no regressions).
- [ ] **Step 6: Commit**

```bash
git add src/app/reminder-snooze.ts src/app/task-manager.tsx
git commit -m "feat(jira): show token-expiry banner and persist token-invalid flag"
```

---

## Final verification

- [ ] **Whole suite + typecheck + lint** — `npx vitest run`, then `npx tsc --noEmit`, then `npx eslint src/app`. Expected: all green.

- [ ] **Manual smoke**

1. Settings → Jira: set "Token expires on" a few days out → banner "expires in N day(s)…"; set it in the past → banner "expired".
2. With the date in the past, click **Sync with Jira** → info toast (expired, "Sync is paused…"), no network call.
3. With a valid date but a wrong token, Sync → info toast "Jira rejected your API token…" and the banner shows "invalid"; fix the token + Test connection (or a successful Sync) → banner clears.
4. Break the site URL / go offline and Sync → "Couldn't reach Jira…".
5. Snooze and Dismiss behave like the due/birthday banners.

---

## Self-Review

**Spec coverage:** data model → Task 2; derivation → Task 4; classifier + `JiraApiError` export → Task 3; date helper → Task 5; settings date field + test-connection flag → Task 6; banner → Task 7; sync preflight/messages/flag → Task 8; wiring (ReminderKind, snooze, memo, render, `onJiraAuthResult`) → Task 9; i18n → Task 1; testing → each task + Final verification.

**Placeholder scan:** all code blocks concrete. Task 6's label markup says "match the file's existing field-wrapper/label markup" — a styling-match instruction; the input/handlers/keys are exact. Task 8's test bodies give the exact assertions and mandate reusing the file's existing mock harness (which exists, not invented).

**Type consistency:** `tokenExpiresAt`/`tokenInvalidAt` (Task 2) used identically in 4/6/8/9. `getJiraTokenAlert`/`daysUntil` (Task 4) signatures match uses in 8/9. `classifyJiraError` → `"auth"|"network"|"other"` (Task 3) consumed in 6/8. `JiraTokenAlert` (Task 4) is the `JiraTokenBanner` prop via `NonNullable<JiraTokenAlert>` (Task 7) and the Task 9 memo. `onJiraAuthResult` (Task 8) supplied in Task 9. The 7 i18n keys (Task 1) match every `t(lang, …)` reference in 6/7/8.
