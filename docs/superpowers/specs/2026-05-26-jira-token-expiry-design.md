# Jira Token Expiry Reminder + Sync Info Message — Design Spec

**Date:** 2026-05-26
**Status:** Approved (design); pending spec review
**Topic:** Warn the user before/when their Jira API token expires, and show a clear, actionable message when "Sync with Jira" fails because the token is expired/invalid or Jira is unreachable.

---

## Problem

The user wants (1) a reminder when their Jira API token is **expiring** or **has expired**, and (2) clicking **Sync with Jira** while the token is expired/invalid or a connection isn't possible should show a clear **information message** (today it surfaces only a generic `jiraSyncFailed: "Jira sync failed: {0}"`).

An Atlassian API token is opaque — its expiry date cannot be read from the token, and `JiraConfig` stores no expiry. So a proactive "expiring soon" warning requires recording the expiry date; an "it stopped working" warning can be derived reactively from a 401/403.

Approved approach: **do both** — record the expiry date for proactive warnings AND react to auth failures.

## Goals

1. Proactively remind the user a configurable number of days before the recorded token expiry, and once it has passed.
2. Reactively detect a rejected token (HTTP 401/403) on sync or test-connection and surface a persistent reminder.
3. When Sync is clicked and the token is expired/invalid or Jira is unreachable, show a specific, actionable info message instead of the generic failure.

## Non-Goals

- Reading expiry from the token (impossible — it's opaque).
- Auto-refreshing or rotating tokens.
- A separate notifications enable-toggle for this reminder (it only appears when Jira is configured and a real condition exists; snooze/dismiss handle suppression).
- A dedicated Jira lead-time setting (reuses `settings.notifications.reminderLeadDays`).

---

## Design

### 1. Data model

**`JiraConfig`** (`src/app/settings-menu.tsx`) gains two optional fields; `defaultJiraConfig` sets `tokenExpiresAt: ""` (the invalid timestamp stays absent by default):

```ts
  /** Optional ISO date "YYYY-MM-DD" the user records from Atlassian; "" = unknown/never. Drives proactive warnings. */
  tokenExpiresAt: string;
  /** ISO timestamp set when a Jira call returns 401/403; cleared on the next successful sync/test. Drives the reactive "rejected" state. */
  tokenInvalidAt?: string;
```

Persisted via the existing `use-settings.ts` localStorage mechanism (whole-settings serialization). Older stored settings simply lack these fields — both are safe when absent (treated as "no date" / "valid").

### 2. Token-status derivation (pure helper)

**New file `src/app/jira-token-status.ts`:**

```ts
import type { JiraConfig } from "./settings-menu";

export type JiraTokenAlert =
  | { state: "invalid" | "expired" | "expiring"; daysLeft: number; date: string }
  | null;

/** today is "YYYY-MM-DD". Returns the highest-priority alert or null. Priority: invalid > expired > expiring. */
export function getJiraTokenAlert(
  jira: JiraConfig,
  today: string,
  leadDays: number,
): JiraTokenAlert {
  if (!jira.enabled) return null;
  if (jira.tokenInvalidAt) return { state: "invalid", daysLeft: 0, date: "" };
  const exp = jira.tokenExpiresAt?.trim();
  if (!exp) return null;
  const daysLeft = daysBetween(today, exp); // exp - today, in whole days
  if (daysLeft < 0) return { state: "expired", daysLeft, date: exp };
  if (daysLeft <= leadDays) return { state: "expiring", daysLeft, date: exp };
  return null;
}
```

`daysBetween(a, b)` parses both `YYYY-MM-DD` at UTC noon and returns `round((b - a) / 86400000)`. (Mirror an existing date helper if one fits; otherwise inline this small function in the same file and unit-test it.)

### 3. Error classifier (reusable)

**`src/app/jira-api.ts`** gains a classifier (and exports `JiraApiError` if not already exported — `formatJiraError` already does `err instanceof JiraApiError`, so the class exists in this module):

```ts
export type JiraErrorKind = "auth" | "network" | "other";

export function classifyJiraError(err: unknown): JiraErrorKind {
  if (err instanceof JiraApiError) {
    if (err.status === 401 || err.status === 403) return "auth";
    if (err.status >= 500) return "network"; // proxy/Atlassian unreachable surfaces as 5xx
    return "other";
  }
  return "network"; // fetch threw (offline / proxy unreachable) → TypeError, not a JiraApiError
}
```

### 4. Reactive — sync & test-connection

**`src/app/use-jira-sync.ts`:**
- `UseJiraSyncArgs` gains: `onJiraAuthResult?: (ok: boolean) => void;` — called `false` on a 401/403 (mark token invalid), `true` on a successful sync (clear it).
- **Preflight** at the top of `handleJiraSync`, after the `!jiraCfg.enabled` guard and before building creds: if `jiraCfg.tokenExpiresAt` is set and is in the past relative to `todayRef.current`, show the expired message and return without calling the API:

  ```ts
  if (jiraCfg.tokenExpiresAt && daysBetween(todayRef.current, jiraCfg.tokenExpiresAt) < 0) {
    args.showToast("info", t(langRef.current, "jiraTokenExpiredBanner", formatExpiryDate(jiraCfg.tokenExpiresAt, langRef.current)));
    return;
  }
  ```
- **On success:** immediately after `searchAllIssues(creds, jql)` resolves (auth proven good), call `args.onJiraAuthResult?.(true)`.
- **Catch:** replace the single generic catch with classification (`classifyJiraError` is destructured from `loadJiraApi()` alongside `formatJiraError`):

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
  (The existing per-row `jiraPushFailed` handling is unchanged.)

**`src/app/jira-settings.tsx` `handleTest`:** on success, also clear the flag via `onChange({ ...config, tokenInvalidAt: undefined })`; in the catch, if `classifyJiraError(err) === "auth"`, set `onChange({ ...config, tokenInvalidAt: new Date().toISOString() })`. (Keeps the banner in sync with what "Test connection" diagnoses — testing a fixed token clears the reminder; testing a dead one raises it.) Import `classifyJiraError` from `./jira-api`.

### 5. Settings UI — record the expiry date

**`src/app/jira-settings.tsx`:** add an optional date input near the API-token field:

```tsx
<label>{t(lang, "jiraTokenExpires")}</label>
<input
  type="date"
  className={inputClass}
  value={config.tokenExpiresAt ?? ""}
  onChange={(e) => onChange({ ...config, tokenExpiresAt: e.target.value })}
/>
<p className="…hint…">{t(lang, "jiraTokenExpiresHint")}</p>
```

### 6. Proactive — the reminder banner

- **`src/app/reminder-snooze.ts`:** extend `ReminderKind`: `"due" | "birthday" | "jiraToken"`.
- **`src/app/notifications.tsx`:** add `JiraTokenBanner`, mirroring `BirthdayBanner` (icon ⚠, message line, `SnoozeMenu`, Dismiss):

  ```tsx
  export function JiraTokenBanner({ alert, lang, onSnooze, onDismiss }: {
    alert: { state: "invalid" | "expired" | "expiring"; daysLeft: number; date: string };
    lang: Lang;
    onSnooze: (ms: number) => void;
    onDismiss: () => void;
  }) {
    const msg =
      alert.state === "invalid"  ? t(lang, "jiraTokenInvalidBanner") :
      alert.state === "expired"  ? t(lang, "jiraTokenExpiredBanner", formatExpiryDate(alert.date, lang)) :
                                   t(lang, "jiraTokenExpiringBanner", alert.daysLeft, formatExpiryDate(alert.date, lang));
    // role="region" aria-label={t(lang,"jiraTokenBannerAria")}, ⚠ icon, msg, <SnoozeMenu/>, Dismiss button
  }
  ```

  `formatExpiryDate` formats `YYYY-MM-DD` for display using the app's existing date-format helper for the active `lang`.
- **`src/app/task-manager.tsx`:** wire it next to the existing banners:

  ```ts
  const jiraTokenSnooze = useReminderSnooze("jiraToken");
  const [jiraTokenDismissed, setJiraTokenDismissed] = useState(false);
  const jiraTokenAlert = useMemo(
    () => getJiraTokenAlert(settings.jira, today, settings.notifications.reminderLeadDays),
    [settings.jira, today, settings.notifications.reminderLeadDays],
  );
  ```
  Pass `onJiraAuthResult` into `useJiraSync`:
  ```ts
  onJiraAuthResult: (ok: boolean) =>
    setSettings((s) => ({ ...s, jira: { ...s.jira, tokenInvalidAt: ok ? undefined : new Date().toISOString() } })),
  ```
  Render near the birthday banner:
  ```tsx
  {!isPopout && jiraTokenAlert && !jiraTokenSnooze.isSnoozed && !jiraTokenDismissed && (
    <JiraTokenBanner alert={jiraTokenAlert} lang={lang} onSnooze={jiraTokenSnooze.snooze} onDismiss={() => setJiraTokenDismissed(true)} />
  )}
  ```

### 7. i18n keys (EN / DE)

| Key | EN | DE |
|---|---|---|
| `jiraTokenExpires` | Token expires on | Token läuft ab am |
| `jiraTokenExpiresHint` | Optional. Atlassian shows this date when you create the token. Leave blank if your token doesn't expire. | Optional. Atlassian zeigt dieses Datum beim Erstellen des Tokens an. Leer lassen, wenn Ihr Token nicht abläuft. |
| `jiraTokenBannerAria` | Jira token reminder | Jira-Token-Erinnerung |
| `jiraTokenExpiringBanner` | Your Jira API token expires in {0} day(s), on {1}. Create a new one in Jira and update Settings → Jira before it stops working. | Ihr Jira-API-Token läuft in {0} Tag(en) ab, am {1}. Erstellen Sie in Jira ein neues und hinterlegen Sie es unter Einstellungen → Jira, bevor es nicht mehr funktioniert. |
| `jiraTokenExpiredBanner` | Your Jira API token expired on {0}. Sync is paused until you create a new token and update Settings → Jira. | Ihr Jira-API-Token ist am {0} abgelaufen. Die Synchronisierung ist pausiert, bis Sie ein neues Token erstellen und es unter Einstellungen → Jira hinterlegen. |
| `jiraTokenInvalidBanner` | Jira rejected your API token — it may be expired or invalid. Create a new token and update Settings → Jira. | Jira hat Ihr API-Token abgelehnt – es ist möglicherweise abgelaufen oder ungültig. Erstellen Sie ein neues Token und hinterlegen Sie es unter Einstellungen → Jira. |
| `jiraSyncUnreachable` | Couldn't reach Jira — check your connection and the site URL, then try again. | Jira konnte nicht erreicht werden – bitte Verbindung und Site-URL prüfen und erneut versuchen. |

The sync **toasts** reuse `jiraTokenExpiredBanner` (preflight) and `jiraTokenInvalidBanner` (401/403) — same actionable text in banner and toast (DRY); only `jiraSyncUnreachable` is sync-specific.

---

## Data flow

```
Settings → Jira: user records "Token expires on" date → jira.tokenExpiresAt
task-manager: getJiraTokenAlert(jira, today, leadDays)
   → expiring (≤ leadDays) / expired (past) / invalid (tokenInvalidAt set) → JiraTokenBanner (snooze/dismiss)
Click Sync:
   tokenExpiresAt in past?  → info toast (expired), no API call
   else call Jira:
       success → onJiraAuthResult(true) → clear tokenInvalidAt
       401/403 → onJiraAuthResult(false) → set tokenInvalidAt → info toast (invalid) → banner shows "invalid"
       network/5xx → info toast (unreachable)
       other → existing jiraSyncFailed
Test connection: success → clear tokenInvalidAt; 401/403 → set tokenInvalidAt
```

## Error handling

- Unknown expiry (`tokenExpiresAt` blank) → no proactive banner; reactive 401 still raises the "invalid" banner + sync toast.
- A recorded date that's wrong (token actually works) → preflight would block sync; the user can clear/correct the date. Documented limitation, acceptable since the date is user-entered.

## Testing

1. **`jira-token-status.test.ts`** — `getJiraTokenAlert`: null when `enabled:false`; null when no date and no `tokenInvalidAt`; `expiring` when date within `leadDays`; `expired` when date in the past; `invalid` when `tokenInvalidAt` set (overrides a still-future date); null when date is beyond `leadDays`. Plus `daysBetween` boundaries.
2. **`jira-api` classifier test** — `classifyJiraError`: `JiraApiError(401)`/`(403)` → `"auth"`; `JiraApiError(500)` → `"network"`; `JiraApiError(404)`/`(400)` → `"other"`; a plain `Error`/`TypeError` → `"network"`.
3. **`use-jira-sync.test.tsx`** (extend) — preflight: with `tokenExpiresAt` in the past, clicking sync shows the expired info toast and does NOT call `searchAllIssues`; on a 401 from search, `onJiraAuthResult(false)` is called and an info toast shown; on success `onJiraAuthResult(true)` is called.
4. **`notifications` banner test** — `JiraTokenBanner` renders the correct copy for each of invalid / expired / expiring.

## Files Touched

- `src/app/settings-menu.tsx` — `JiraConfig` + `defaultJiraConfig` fields.
- `src/app/jira-token-status.ts` (new) + test.
- `src/app/jira-api.ts` — `classifyJiraError`, export `JiraApiError` (if needed) + test.
- `src/app/use-jira-sync.ts` — preflight, classified catch, `onJiraAuthResult`, success-clear (+ test additions).
- `src/app/jira-settings.tsx` — date field; `handleTest` clear/set `tokenInvalidAt`.
- `src/app/reminder-snooze.ts` — `"jiraToken"` kind.
- `src/app/notifications.tsx` — `JiraTokenBanner` (+ test).
- `src/app/task-manager.tsx` — alert memo, snooze/dismiss, banner render, `onJiraAuthResult` wiring.
- `src/app/i18n.ts`, `src/app/i18n.de.ts` — 7 new keys (EN + DE).
