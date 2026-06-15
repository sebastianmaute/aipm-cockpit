# Execution Depth — "Draft Message" from a Signal (Slice 3)

**Date:** 2026-06-15
**Status:** Approved (brainstorm) — ready for implementation plan
**Feature area:** `action-row.tsx`, `actions-panel.tsx`, `task-manager.tsx`, new `mailto.ts` (surface only — engine untouched)

---

## Goal

Make task-chase and stakeholder-comms Action-Center items actionable in one click: a "Draft
message" CTA that opens the user's mail client **pre-filled** (mailto:) — chasing the assignee on
an overdue task, or messaging a stakeholder whose comms reminder is due.

Slice 3 of the execution-depth roadmap (1 = create-task 0.84.0, 2 = assign-owner 0.86.0). Reuses
the executable-CTA affordance pattern. Out of scope: escalate, re-baseline, the loop/learning
layer, push notifications, and any in-app SMTP/Graph *send* (the app is local-first; mailto opens
the user's own client).

## Background

The established "LOP status-inquiry" flow is a **mailto: compose**: `onSendInquiry(task)`
(`use-task-row-handlers.ts:111`) builds a subject (`emailSubject`) + body (`emailBodyTemplate`)
from the task, resolves the assignee email (falling back to a `window.prompt` when missing),
`window.location.href = mailto:…`, and bumps `inquiriesSent`. This slice reuses that pattern.

Two action sources fit:
- **task-due** — chase the assignee. `cta.id` is the task id; reuse `onSendInquiry(task)` verbatim.
- **stakeholder-comms** — message the stakeholder. `cta.id` is the `stakeholderId`. The stakeholder
  has `email?` and a `resourceId?` (resource-linked); effective email = `stakeholder.email` or the
  linked `Resource`'s email. No stored state to bump (the comms reminder is computed, not
  persisted).

The engine (`next-actions/`) is untouched — `source` + `cta.id` are all the surface needs.

## Decisions taken during brainstorming

1. **Both sources** get the CTA (task-due reuses `onSendInquiry`; stakeholder-comms gets a new
   mailto path).
2. **Mechanism = mailto:** reuse the established compose pattern; no in-app send to build.
3. **Unified label** "Draft message" for both sources.
4. **DRY:** extract `buildMailtoUrl(email, subject, body)` and refactor `onSendInquiry` to use it.

---

## Architecture (surface only)

```
action-row.tsx
  ─ "Draft message" button shown when:
        onDraftMessage != null
        && (action.source === "task-due" || action.source === "stakeholder-comms")
        && action.cta.kind === "open"
     onClick → stopPropagation → onDraftMessage(action)

task-manager.tsx — onDraftMessage(action), branch by source:
  task-due:
     const id = action.cta.kind === "open" ? Number(action.cta.id) : -1;
     const task = tasks.find(t => t.id === id);
     if (task) onSendInquiry(task);          // existing handler, verbatim
  stakeholder-comms:
     const id = action.cta.kind === "open" ? Number(action.cta.id) : -1;
     const sh = stakeholders.find(s => s.id === id);
     if (!sh) return;
     const email = stakeholderEmail(sh, resources);   // sh.email ?? linked resource email
     const recipient = email ?? promptForEmail();      // mirror onSendInquiry's prompt; cancel → abort
     if (!recipient) return;
     const subject = t(lang, "commsEmailSubject", project?.name ?? "");
     const body = t(lang, "commsEmailBodyTemplate", sh.name);
     window.location.href = buildMailtoUrl(recipient, subject, body);

One optional `onDraftMessage?: (action: SuggestedAction) => void` prop, threaded
task-manager → workspaceProps → workspace-section → ActionsPanel → ActionRow, gated !isPopout.
```

### Units / responsibilities

- **`mailto.ts`** (new, pure): `buildMailtoUrl(email, subject, body): string` →
  `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`.
  Unit-testable; reused by `onSendInquiry` and the comms path.
- **`action-row.tsx`** — renders the button; delegates via `onDraftMessage`. No logic.
- **`actions-panel.tsx`** — threads `onDraftMessage` to both ActionRow sites.
- **`task-manager.tsx`** — the `onDraftMessage` dispatcher (branches by source); has `tasks`,
  `onSendInquiry`, `stakeholders`, `resources`, `project`, `lang` in scope. Gated `!isPopout`.
- **`stakeholderEmail(sh, resources)`** — small helper (in `mailto.ts` or `stakeholders.ts`):
  `sh.email?.trim() || resources.find(r => r.id === sh.resourceId)?.email || undefined`.
- **Engine** — untouched.

## Data flow / behavior

- Click → `onDraftMessage(action)` → the surface resolves the entity + recipient → opens the
  prefilled mailto in the user's mail client. Fire-and-forget (no success callback from mailto).
- task-due: `onSendInquiry` additionally bumps `inquiriesSent` (existing behavior, unchanged).
- stakeholder-comms: no state mutation (nothing to bump); the action persists until the underlying
  comms cadence is satisfied (computed) — no auto-dismiss (deferred loop layer).

## Error handling / edge cases

- **No email** (task-due): `onSendInquiry` already prompts + validates (unchanged). For
  stakeholder-comms: if neither `sh.email` nor the linked resource has an email, `window.prompt`
  for one (mirroring `onSendInquiry`); cancel/invalid → abort (no mailto). Do NOT persist the
  prompted stakeholder email this slice (keep it minimal; the task path persists because the field
  + setter already exist).
- **Entity deleted** between render and click → `find` returns undefined → no-op (guarded).
- **Read-only popout** → `onDraftMessage` undefined → button absent.
- mailto length: very long bodies can exceed client limits — the body template is short (greeting +
  one line), well within limits.

## Testing

- `mailto.test.ts`: `buildMailtoUrl` encodes email/subject/body correctly (spaces, `&`, newlines,
  umlauts → percent-encoded); returns a `mailto:` scheme.
- `action-row.test.tsx`: "Draft message" button renders for a task-due action and a
  stakeholder-comms action; ABSENT for other sources and when `onDraftMessage` is undefined;
  clicking calls `onDraftMessage(action)` and does NOT trigger row Open (stopPropagation).
- `stakeholderEmail` helper: returns `sh.email` when set; falls back to the linked resource's
  email; `undefined` when neither.
- Surface dispatcher (unit or via a small extracted function): task-due branch calls
  `onSendInquiry` with the matched task; stakeholder-comms branch builds the right mailto;
  deleted-entity → no-op. (Stub `window.location.href` / `buildMailtoUrl` as needed; do not
  navigate in jsdom.)
- a11y: the button has an accessible name (`actionDraftMessage`); keyboard-reachable real
  `<button>`. (axe gate.)
- i18n EN/DE parity: `actionDraftMessage`, `commsEmailSubject`, `commsEmailBodyTemplate` (real
  umlauts via node write if needed; tsc enforces).
- Full gate: tsc, lint, vitest, e2e 12-view axe.

## Out of scope (explicit)

- Escalate / re-baseline CTAs; loop/learning layer; push notifications.
- In-app email *sending* (SMTP/Graph) — mailto only.
- Persisting a prompted stakeholder email; per-stakeholder "last contacted" tracking.
- Any engine / `ActionInput` / schema change.

## Release

0.87.0, new minor codename "Wells" (H. G. Wells). Standard checklist: bump `version.ts`
(APP_VERSION + APP_MILESTONE + build-date comment), `CHANGELOG.md` entry, append a
`versionHighlight*` key to `APP_HIGHLIGHT_KEYS` (+ EN/DE). Per [[gitlab-ci-and-ops]] + AGENTS.md.
