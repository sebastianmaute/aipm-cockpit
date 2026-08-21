# Weekly Status Digest (audit #7) — Design Spec

_2026-07-10. Batch F addition. Composes existing engines (dashboard/delta RAG model, comm-templates
Graph HTML send, action-notifications, optional AI narrative) into a recurring per-project status digest.
Per-project only for this slice (SP1); portfolio-wide digest is a deferred follow-up (SP2)._

## Goal

Give a PM a recurring **weekly status digest** — RAG (with change), overdue tasks, milestones due soon,
open RAID — surfaced as an always-on in-app card, optionally emailed via Outlook (Graph) and announced by a
desktop notification, with an optional AI narrative paragraph. Manual "Generate now" always available.

## Decisions (locked with user)

- **Delivery:** all three channels — in-app card (always-on) + Graph email (M365-gated) + desktop
  notification (notif opt-in) — plus a manual "Generate digest now" button.
- **Composition:** deterministic base (always-on) + **optional** AI narrative paragraph (AI-master-switch
  gated; fails soft to deterministic).
- **Cadence:** standalone per-device digest cadence store (decoupled from the AI scheduled-jobs runner) that
  fires on app open / visibility when due; manual button independent of the auto-fire enable flag.
- **Scope:** per-project (current open project) for SP1. Portfolio-wide digest deferred to SP2.

## Non-goals (YAGNI / deferred)

- Portfolio-wide digest (SP2).
- User-editable digest email template (SP1 uses a fixed brand HTML builder; comm-templates editor stays for
  the existing stakeholder-comms templates).
- Digest history / archive table (no Turso table; the card shows the latest, email sends a point-in-time copy).
- Scheduling via the AI `scheduled_jobs` store (would couple the always-on digest to the AI opt-in).

---

## Module map

Pure engine + per-device state + thin React glue, mirroring the dashboard delta-strip / coaching-card
patterns. All pure modules are i18n-free (React surfaces translate).

- **`digest/digest-model.ts`** (pure, i18n-free)
  - `buildDigest(input: DigestInput, today: string): DigestModel`
  - `DigestInput` = `{ model: DashboardModel; horizon: MilestoneHorizon; prior?: DigestPrior }`
    (all already-computed; the digest is a projection, never a re-derivation).
  - `DigestModel` = `{ rag: RagLevel; ragPrev: RagLevel | null; overdue: {count:number; delta:number|null};
    milestonesDueSoon: {id:number; name:string; date:string; status:string}[];
    openRaid: {count:number; high:number; delta:number|null}; generatedAt: string; narrative?: string }`
  - No `Date.now()`/`new Date()` — `today` and `generatedAt` passed in.
  - Empty/blank project → minimal model (counts 0, `milestonesDueSoon: []`), never throws.

- **`digest/digest-state.ts`** (per-device store)
  - Single key `lop-app:digest-state` → `{ [projectId: string]: DigestState }`, capped 50 most-recent
    (mirrors `landing-state.ts`).
  - `DigestState` = `{ lastRunAt: string; nextDueAt: string; priorRag: RagLevel; priorMetrics:
    {overdue:number; openRaid:number} }`.
  - Exports: `loadDigestState(projectId): DigestState | null`, `advanceDigestState(projectId, {now,
    cadenceDays, rag, metrics})` (writes `lastRunAt=now`, `nextDueAt=now+cadenceDays`, snapshots
    rag/metrics), `isDigestDue(state, now): boolean`.
  - Validated load (bad JSON / partial → treated as absent). OUT of exports/Turso/recovery CONFIG_KEYS;
    swept by `clearAppConfig`'s `lop-app:*` sweep.

- **`digest/digest-email.ts`** (pure, i18n-free HTML builder)
  - `buildDigestEmailHtml(model: DigestModel, lang: Lang): string` — brand-inline-styled HTML (AIPM tokens
    as literal hex, since email clients ignore CSS vars), all facts escaped. No user free-text.
  - `buildDigestEmailSubject(model, lang): string`.

- **`digest/digest-narrative.ts`** (AI call, non-hook — mirrors `scheduled-job-analysis.ts`)
  - `runDigestNarrative(model: DigestModel, ctx): Promise<string>` — ONE forced-tool Anthropic call
    (`tool_choice:{type:"tool",name:"digest_narrative"}`, no agentic loop). Returns a sanitized prose
    paragraph; throws only status-digit / `"parse"` errors (never logs/echoes key or body). Caller catches →
    `""`.

- **`use-digest.ts`** (hook, task-manager render scope — coverage-excluded UI glue like other Phase-3 hooks)
  - `useDigest(deps): { digest: DigestModel | null; generateNow(): Promise<void>; emailDigest():
    Promise<void>; busy: boolean }`.
  - Owns: cadence check (fires `generate()` on mount + `visibilitychange` when `isDigestDue`); manual
    `generateNow` (ignores the `enabled` flag); optional AI narrative; the notification dispatch on a fresh
    cadence-fired digest; the `advanceDigestState` write; the Graph email dispatch.
  - `isPopout` → read-only (no advance, no send, no notification).
  - Non-memoized handlers (read live scope each render), called unconditionally before the single return.

- **`dashboard-sections/digest-card.tsx`** (presentational)
  - Dashboard headline card (same slot family as `DashboardCoachingCard` / `DashboardTipCard`).
  - Renders the latest `DigestModel` (RAG + delta, overdue, milestone chips, RAID) + optional narrative
    paragraph + action buttons: **Generate now** (always), **Email digest** (only when `m365Configured`).
  - Self-hides (`return null`) when no digest generated and auto-fire disabled.
  - Density via `dc.*` classes; all buttons labeled (`INTERACTIVE` atom); Dashboard IS axe-scanned.

---

## Data flow

```
computeDashboard(buildDashboardInput(entities, ctx)) ─► DashboardModel
bucketMilestonesByHorizon(milestones, tasks, today, holidaySet) ─► due ≤14d (overdue+thisWeek+next2Weeks)
loadDigestState(projectId) ─► prior (priorRag, priorMetrics)  [nullable]
        │
        ▼
buildDigest({model, horizon, prior}, today) ─► DigestModel (facts + deltas)
        │  (AI enabled?) ── yes ─► runDigestNarrative(model) → model.narrative  (fail-soft "")
        ▼
DigestModel ──► card render / buildDigestEmailHtml → Graph send / notification
        │
   on a real GENERATE (manual or cadence): advanceDigestState(projectId, {now, cadenceDays, rag, metrics})
```

- Reuses the shared `buildDashboardInput` + `computeDashboard` — the digest can never disagree with the
  Dashboard.
- Deltas from `digest-state` prior snapshot (same idea as the landing delta strip; a distinct store/key).
- State advance ONLY on a real generate (not on render); localStorage write is a side-effect in a
  callback/effect, never `set-state-in-effect`.

---

## Delivery & gating

| Channel | Trigger | Gate | Mechanism |
|---|---|---|---|
| In-app card | cadence-due on open/visibility, or manual | always-on | `digest-card.tsx` renders `DigestModel`; self-hides when none |
| Email (Graph) | "Email digest" button | `m365Configured && !isPopout` | `buildDigestEmailHtml` → existing comm-templates Graph HTML send (`/me/sendMail`); recipient defaults to signed-in user |
| Desktop notification | fresh cadence-fired digest | notif opt-in + permission | existing `action-notifications`; body "Weekly digest ready — <RAG>", click → dashboard |
| AI narrative | during compose | `isAiEnabled(settings.ai)` | optional prose layer, fails soft |

- **Popout-safe:** `isPopout` → hook read-only (mirrors every write-back hook).
- **Cadence config:** `settings.digest?: { enabled: boolean; cadenceDays: number }` (default
  `{enabled:false, cadenceDays:7}`) — per-device, rides the `writeSettings` spread (no allowlist edit,
  mirrors `dashboardDensity`). Auto-fire only when `enabled`; manual button always usable. Sanitized on load
  (`enabled === true`; `cadenceDays` clamped int 1–90, default 7). Settings control lives in
  **Settings → Integrations**, beside the notifications opt-in (the digest ties into notifications + Graph
  email, both configured there) — a toggle + interval `<select>`. Integrations is axe-scanned → labeled
  controls.
- **Security:** email send reuses the audited Graph path (never logs token/body; status digits only on
  error). Digest HTML is app-generated with escaping (no unescaped user free-text). AI narrative sanitized
  (shared `CONTROL_CHARS` scrub) before render/email.

---

## Error handling

- AI narrative off/fails → `narrative:""`, deterministic digest stands; no toast (advisory).
- Graph email fails → `reportSilentFailure(showToast, lang, "digest.emailFailed", err, "digestEmailFailed")`
  (error toast + `logDiag`, status digits only). Card stays.
- Notification blocked/denied → silent no-op; card still shows.
- `digest-state` malformed load → validated default (no prior deltas), never crashes.
- Empty project → minimal "nothing to report" model; card self-hides when disabled + never generated.

---

## Testing (TDD, per module)

- `digest-model.test.ts` — deterministic facts + deltas (RAG change up/down/flat, overdue ±, milestone
  bucketing, RAID open + high count); today passed in; empty-project minimal model; null prior → null deltas.
- `digest-state.test.ts` — `nextDueAt = now + cadenceDays`; `isDigestDue` boundary (due exactly at
  nextDueAt); cap 50; malformed-load default; per-project keying isolation.
- `digest-email.test.ts` — HTML contains RAG/overdue/milestone/RAID facts; escaping (no injection);
  subject text; brand inline styles present.
- `use-digest.test.tsx` — cadence fires when due, not before; `generateNow` ignores `enabled`; popout
  read-only (no advance/send/notify); AI-off → no narrative; email routes to Graph send mock; advance writes
  after generate.
- `digest-card.test.tsx` — self-hides when none; Email button hidden off-M365; narrative renders when
  present; labeled buttons (axe; Dashboard scanned).

---

## i18n

EN+DE parity (tsc-enforced): card title + section labels, "Generate now" / "Email digest" buttons, cadence
settings (toggle + interval label), email subject + section headings, toast keys
(`digestEmailFailed`), notification body. Edit `i18n.de.ts` via node utf8 write, CRLF `\r\n` anchors, real
umlauts (i18n-encoding bans ASCII subs). Interpolated strings use 0-based positional placeholders.

## CI / constraints

- No new persisted Workspace field, no golden regen (`digest-state` + `settings.digest` are per-device).
- `sanitizeDigestConfig` on the settings load merge; `writeSettings` spread only (never raw setItem).
- Purity: no `Date.now()`/`new Date()` in render; today via `effectiveToday(tz)` / lazy capture; cadence
  check + advance in effect/callback.
- Size: keep new files small; watch `dashboard-panel.tsx` + `task-manager.tsx` growth (`size:check`).
- Dup: reuse `buildDashboardInput`, comm-templates Graph send, action-notifications — no copy.
- Release: minor feature → new codename **0.172.0**, `versionHighlightStatusDigest` key (+ EN/DE),
  CHANGELOG entry.

## Deferred (SP2)

- Portfolio-wide digest over `aggregatePortfolio` (Turso-only, sequential loads); one email covering all
  portfolio projects. Reuses `digest-model` shape with a portfolio input adapter.
