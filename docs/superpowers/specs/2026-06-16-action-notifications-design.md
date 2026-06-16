# Execution Depth — Desktop Notifications for Urgent Signals (Slice 6)

**Date:** 2026-06-16
**Status:** Approved (brainstorm) — ready for implementation plan
**Feature area:** new pure `notifications.ts`, new `use-action-notifications.ts` hook, `task-manager.tsx` (wire), settings notifications section (toggle). Engine untouched.

---

## Goal

Surface **urgent** Action Center signals (`tier: "now"`) **outside the open tab** via the browser
`Notification` API, so a user with the app backgrounded learns about new risk without watching the
Action Center. Opt-in per browser, **off by default**.

This is **slice 6** of the "execution depth" roadmap (create-task → assign-owner → draft-message →
escalate → re-baseline → **notifications**). The roadmap's final remaining item after this is the
loop/learning layer. This slice is a pure **delivery layer**: it reads the already-computed
`SuggestedAction[]` and never touches the engine.

## Background

The Action Center renders `SuggestedAction`s computed by the pure, i18n-free `next-actions/` engine
(`task-manager.tsx:648-683`, `computeNextActions(buildActionInput({...}))`). `SuggestedAction`
(`next-actions/types.ts:27-36`) carries `id` (stable `${source}:${entityId}:${reason}`), `source`,
`tier` (`"now" | "soon" | "monitor"`), `title`/`why` (`I18nText`), `cta`
(`{ kind:"open"; view; id } | { kind:"snooze"; actionId }`), `score`.

Today the only ways the app tells the user about a signal are the in-app Action Center panel and
4-second toasts (`use-toast.ts`, `toast-context.tsx`). There is **no** use of the browser
`Notification` API anywhere in `src` (greenfield). Deep-linking to a record is
`requestOpen(view, id)` (`workspace-tab-context.tsx:25-31`): it sets the active tab, sets
pending-open, and writes the URL hash. Popout/read-only mode is `useWorkspaceTab().isPopout`
(`workspace-tab-context.tsx:18-19`), which also blocks hash writes.

Settings is localStorage-only (`use-settings.ts`, `SETTINGS_KEY = "lop-app:settings"`) with a
module-level listener registry that syncs multiple `useSettings()` instances on the same page. It
already has a `notifications: NotificationsConfig` section (`settings-types.ts:64-74`) built from
`ChannelConfig = { enabled: boolean }` toggles (e.g. `birthday`, `raidReview`).

## Decisions taken during brainstorming

1. **Browser `Notification` API only.** `new Notification(title, { body, tag })`. **No** service
   worker, **no** Push API, **no** server/VAPID. Notifications are not a network call, so **no
   `proxy.ts` CSP `connect-src` host is added**. True closed-app remote push is explicitly OUT of
   scope (it would require a service worker + push backend).
2. **Fires only while a tab is open AND unfocused.** While the document is focused, the in-app panel
   already shows the signals — never raise a desktop popup. Fire only when
   `document.visibilityState === "hidden"` (i.e. the user is in another tab/app).
3. **Trigger model A — new-signal, deduped.** Each recompute, a `now`-tier signal notifies **at most
   once**, tracked by its stable `id`. No timers, no digests.
4. **Tier `now` only**, fixed for v1 (no per-tier config — YAGNI; a tier selector can be added later
   if requested).
5. **Burst = hybrid.** In one recompute cycle: exactly **1** new urgent → a **specific** notification
   (title = the action title, body = the `why`; click deep-links to that record). **>1** new urgent →
   a **single summary** notification ("N new urgent actions"; click focuses the app + opens the
   Action Center view). At most one popup per cycle.
6. **Resolve→reappear re-notifies.** The seen-id set is pruned to the currently-present urgent ids
   each cycle, so a signal that clears and later returns can notify again.
7. **Dedup state is localStorage-only** (`lop-app:notified-urgent`). It is **NOT** a persisted
   `Workspace` field — the six-write-paths rule does **not** apply. No Turso, no serializer change.
8. **Canonical-instance only.** Only the primary (non-popout) instance notifies. Popout windows are
   suppressed entirely (`isPopout` gate), which also prevents double-fire across instances.

---

## Architecture

```
SuggestedAction[] (computed in task-manager.tsx, unchanged)
        │
        ├─ use-action-notifications.ts  (browser glue hook)
        │     inputs: nextActions, enabled (settings), isPopout, lang, requestOpen
        │     state:  seenIds (seeded from localStorage "lop-app:notified-urgent")
        │     on nextActions change:
        │        gate = enabled && Notification.permission === "granted" && !isPopout
        │        if !gate: do nothing (no tracking, no fire)
        │        else if document focused:  seenIds = nextSeenIds(actions)  // mark seen, no fire
        │        else (hidden):
        │            newUrgent = newUrgentActions(actions, seenIds)
        │            plan = buildNotificationPlan(newUrgent)
        │            if plan: fire Notification(plan), onclick → window.focus() + requestOpen(...)
        │            seenIds = nextSeenIds(actions)
        │        persist seenIds to localStorage
        │
        └─ notifications.ts  (PURE, i18n-free, unit-tested)
              newUrgentActions(actions, seenIds): SuggestedAction[]
              buildNotificationPlan(newUrgent): NotificationPlan | null
              nextSeenIds(actions): string[]
```

### Pure module — `src/app/notifications.ts`

i18n-free, no browser globals. Operates on `SuggestedAction[]` and a readonly id list.

```ts
import type { SuggestedAction } from "./next-actions/types";

const URGENT_TIER = "now" as const;

/** now-tier actions whose id is not yet in the seen set. Order preserved. */
export function newUrgentActions(
  actions: readonly SuggestedAction[],
  seenIds: readonly string[],
): SuggestedAction[] {
  const seen = new Set(seenIds);
  return actions.filter((a) => a.tier === URGENT_TIER && !seen.has(a.id));
}

export type NotificationPlan =
  | { kind: "single"; action: SuggestedAction }
  | { kind: "summary"; count: number };

/** null when nothing new; single for exactly one; summary for >1. */
export function buildNotificationPlan(
  newUrgent: readonly SuggestedAction[],
): NotificationPlan | null {
  if (newUrgent.length === 0) return null;
  if (newUrgent.length === 1) return { kind: "single", action: newUrgent[0] };
  return { kind: "summary", count: newUrgent.length };
}

/**
 * Next seen-id set = exactly the currently present-and-urgent ids (deduped).
 * An id enters "seen" only while it is present and urgent, and drops out the
 * moment it is no longer present — so a cleared-then-returning signal is treated
 * as new and can re-notify. Single param (an unused `seenIds` would fail
 * `--max-warnings=0`); the prior set is fully superseded by the present set.
 */
export function nextSeenIds(actions: readonly SuggestedAction[]): string[] {
  const urgentIds = actions.filter((a) => a.tier === URGENT_TIER).map((a) => a.id);
  return [...new Set(urgentIds)];
}
```

### Hook — `src/app/use-action-notifications.ts`

```ts
interface UseActionNotificationsArgs {
  actions: readonly SuggestedAction[];
  enabled: boolean;              // settings.notifications.desktopUrgent.enabled
  isPopout: boolean;
  lang: Lang;
  requestOpen: (view: AppView, id: number) => void;
  openActionCenter: () => void;  // focus + navigate to the Action Center view (open-points)
}
```

- Seeds `seenIdsRef` from `localStorage["lop-app:notified-urgent"]` once on mount (guarded for SSR /
  missing storage; malformed JSON → empty).
- A single `useEffect` keyed on `actions` (and `enabled`/`isPopout`):
  - **Gate:** `enabled && typeof Notification !== "undefined" && Notification.permission === "granted"
    && !isPopout`. If the gate fails, **return without touching seenIds** (so toggling on later starts
    fresh from whatever is on screen rather than dumping a backlog — see note).
  - **Focused** (`document.visibilityState === "visible"` / `document.hasFocus()`): set
    `seenIdsRef.current = nextSeenIds(actions)`, persist, **no fire**.
  - **Hidden:** `plan = buildNotificationPlan(newUrgentActions(actions, seenIdsRef.current))`. If
    non-null, construct the `Notification`; then set `seenIdsRef.current = nextSeenIds(actions)`,
    persist.
  - **Backlog avoidance:** the FIRST cycle after the gate opens (mount, or enable, or
    permission-grant) should NOT fire for already-present urgent signals — only for ones that appear
    *after* the hook is live. Implement by seeding `seenIdsRef` with the current present-urgent ids on
    the first gated cycle (a `hasSeededRef` flag): first gated render marks-seen silently regardless
    of focus, subsequent renders fire on new ids. This prevents a popup-storm the instant the user
    enables the feature or refocuses-then-backgrounds.
- **Notification construction:**
  - `single`: `title = t(lang, action.title.key, ...params)`, `body = t(lang, action.why.key,
    ...params)`, `tag = action.id` (OS replaces same-tag). `onclick`: `window.focus()`; if
    `action.cta.kind === "open"` → `requestOpen(action.cta.view, Number(action.cta.id))`; then
    `notification.close()`.
  - `summary`: `title = t(lang, "notifySummaryTitle", count)`, `body = t(lang,
    "notifySummaryBody")`, `tag = "urgent-summary"`. `onclick`: `window.focus()` +
    `openActionCenter()` + close.
  - Wrap construction in `try/catch` (some environments throw even with permission) → swallow +
    optional debug; never crash the surface.
- Returns nothing (side-effecting hook). Called once from `task-manager.tsx` after `nextActions` is
  computed, passing `settings.notifications.desktopUrgent.enabled`, `isPopout`, `lang`,
  `requestOpen`, and an `openActionCenter` that navigates to the tasks/`open-points` view.

### Settings — `src/app/settings-types.ts`

Extend `NotificationsConfig` with one `ChannelConfig`:

```ts
export type NotificationsConfig = {
  // ...existing...
  jiraTokenError: ChannelConfig;
  /** Desktop browser notifications for urgent ("now") Action Center signals. Off by default. */
  desktopUrgent: ChannelConfig;
};

export const defaultNotificationsConfig: NotificationsConfig = {
  // ...existing...
  jiraTokenError: { enabled: true },
  desktopUrgent: { enabled: false },
};
```

Add coercion in the existing notifications sanitizer (mirror an existing `ChannelConfig` field; legacy
settings blobs without `desktopUrgent` must default to `{ enabled: false }`, never `undefined`).

### Settings UI — notifications section

A labeled toggle ("Desktop notifications for urgent actions") in the notifications settings section:

- `aria-pressed` reflects `enabled`; an associated `<label>`/`aria-label` (axe requires an accessible
  name — a bare control fails the gate).
- **On enable:** call `Notification.requestPermission()`. On `"granted"` → set
  `notifications.desktopUrgent.enabled = true`. On `"denied"`/`"default"` → keep it **off** and
  `showToast("error", t(lang, "notifyPermissionDenied"))`. Guard `typeof Notification === "undefined"`
  (unsupported browser) → toast + leave off.
- **On disable:** set `enabled = false` (no permission change — the browser grant persists, the app
  just stops firing).
- A hint line explains the browser-only / tab-must-be-open limitation
  (`settingsDesktopNotifyHint`).

---

## i18n keys (EN + DE, real umlauts)

| Key | EN | DE params |
|-----|----|-----|
| `notifySummaryTitle` | `{0} new urgent actions` | `{0} neue dringende Aktionen` |
| `notifySummaryBody` | `Open the app to review them.` | German |
| `settingsDesktopNotify` | `Desktop notifications for urgent actions` | German |
| `settingsDesktopNotifyHint` | `Browser only; the app tab must be open. Notifies once per new urgent signal while the tab is in the background.` | German |
| `notifyPermissionDenied` | `Notification permission was not granted.` | German |
| `versionHighlightDesktopNotify` | release-highlight one-liner (NOTE: `versionHighlightNotifications` already exists for the old reminders feature — must use a distinct key) | German |

The single-notification title/body **reuse the action's own `title`/`why` keys** — no new per-signal
strings. Interpolation is 0-based positional (`{0}`). `Lang` is `"en-US" | "en-GB" | "de"` (no
`"en"`); DE dict is lazy (`loadI18n("de")` in any DE-asserting test's `beforeAll`). Edit `i18n.de.ts`
via node UTF-8 CRLF write only (Edit tool corrupts umlauts; file is CRLF).

## Release

- `version.ts` → `APP_VERSION = "0.94.0"`, new codename, `APP_BUILD_DATE`.
- Append `"versionHighlightDesktopNotify"` to `APP_HIGHLIGHT_KEYS` (+ EN/DE strings). Do NOT reuse
  `versionHighlightNotifications` (already defined for the old reminders feature).
- `CHANGELOG.md` entry.

## Testing

**Pure `notifications.test.ts`:**
- `newUrgentActions`: filters to `now` tier; excludes seen ids; keeps order; empty when all seen;
  ignores `soon`/`monitor`.
- `buildNotificationPlan`: `null` on empty; `single` on one (carries the action); `summary{count}` on
  >1.
- `nextSeenIds`: returns present-urgent ids only; drops resolved ids (reappear re-notifies);
  dedupes.

**Hook `use-action-notifications.test.tsx`:** mock `global.Notification` (constructor spy +
`permission`), `document.hasFocus`/`visibilityState`. Assert the gate matrix:
- disabled → no construct.
- popout → no construct.
- permission `"denied"` → no construct.
- focused + granted + enabled → no construct (marks seen).
- hidden + granted + enabled + 1 new → one construct, `single`, onclick calls `requestOpen`.
- hidden + 2 new → one construct, `summary`, onclick calls `openActionCenter`.
- already-seen ids on first gated cycle → no construct (backlog avoidance).
- resolve→reappear → re-notifies.

**Settings toggle test:** enable → `requestPermission` called; granted sets enabled; denied keeps off
+ toast; unsupported browser → toast + off.

**a11y:** toggle has an accessible name (component test / e2e axe gate already covers the 12 views).

## What does NOT change

- `next-actions/` engine — read-only consumer.
- No new persisted `Workspace` field; no Turso table; no serializer/golden-fixture change.
- No `proxy.ts` CSP host (Notification API is not a network call).
- No service worker; no closed-app push.

## Out of scope (future)

- **Closed-app / true remote push** (service worker + Push API + VAPID + a push backend + CSP host).
- **Per-tier or per-source notification config** (v1 is `now`-tier, all sources).
- **Notification action buttons** (e.g. "Snooze" inline) — requires a service worker for
  `actions`; click-to-open only for v1.
- **The loop/learning layer** — the roadmap's final slice, separate spec.
