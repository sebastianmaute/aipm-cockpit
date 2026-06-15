# Draft-Message Execution CTA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Draft message" CTA to task-due + stakeholder-comms Action-Center rows that opens a prefilled `mailto:` — reusing the existing status-inquiry flow for tasks and a new mailto to the stakeholder for comms.

**Architecture:** Surface-only — the `next-actions/` engine is untouched. A new pure `mailto.ts` (`buildMailtoUrl` + `stakeholderEmail`) is reused by the existing `onSendInquiry` (DRY) and the new comms path. One optional `onDraftMessage` prop is threaded to the rows; `task-manager` owns the dispatcher that branches by source.

**Tech Stack:** TypeScript, React (Next.js fork), Vitest + RTL, i18n EN+DE (tsc parity).

**Spec:** `docs/superpowers/specs/2026-06-15-action-draft-message-design.md`

---

## Grounding facts (verified)

- `onSendInquiry(task)` lives in `use-task-row-handlers.ts:111`: resolves the assignee email (prompts when missing), builds subject (`emailSubject`) + body (`emailBodyTemplate`), sets `window.location.href = mailto:…`, bumps `inquiriesSent`. It is destructured from `useTaskRowHandlers()` in `task-manager.tsx` (~line 982) → in scope there.
- `task-manager.tsx` has `tasks`, `stakeholders`, `resources`, `project`, `lang`, `isPopout` in scope. `ActionsPanel` renders in `workspace-section.tsx` (threaded via `workspaceProps`, like `onCreateTask`/`assignOwner`).
- A Stakeholder has `email?: string` and `resourceId?: number | null` (see `stakeholder-edit-modal.tsx`). A `Resource` has `email?`.
- `action-row.tsx` `ActionRowProps` already carries `onOpen/onSnooze?/onCreateTask?/assignOwner?`; the right-hand controls live in `<div className="flex shrink-0 items-center gap-1">`.
- stakeholder-comms provider sets `cta: { kind:"open", view:"stakeholders", id: stakeholderId }`; task-due sets `cta: { kind:"open", view:"open-points", id: task.id }`.

## Conventions for every task
- One test file: `npx vitest run src/app/<file>.test.ts(x)`; typecheck `npx tsc --noEmit`; lint `npm run lint`.
- New i18n strings → EN + DE, identical keys. DE here may need umlauts — after editing `i18n.de.ts` run `npx vitest run src/app/i18n-encoding.test.ts`; node-write if mangled.
- a11y: the new button needs an accessible name (its text content suffices); real `<button>`.
- Commit after each task. No `Co-Authored-By`.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `mailto.ts` | **new** pure helpers | `buildMailtoUrl`, `stakeholderEmail` |
| `use-task-row-handlers.ts` | task row handlers | refactor `onSendInquiry` to use `buildMailtoUrl` |
| `action-row.tsx` | row UI | `onDraftMessage?` prop + "Draft message" button |
| `actions-panel.tsx` | inbox list | thread `onDraftMessage` to both rows |
| `task-manager.tsx` | surface wiring | `onDraftMessage` dispatcher (branch by source) |
| `workspace-section.tsx` | renders ActionsPanel | thread `onDraftMessage` |
| `i18n.ts` / `i18n.de.ts` | strings | `actionDraftMessage`, `commsEmailSubject`, `commsEmailBodyTemplate` |
| `version.ts` / `CHANGELOG.md` | release | 0.87.0 "Wells" |

---

### Task 1: Pure `mailto.ts` + DRY-refactor `onSendInquiry`

**Files:** Create `src/app/mailto.ts`, `src/app/mailto.test.ts`; Modify `src/app/use-task-row-handlers.ts`.

- [ ] **Step 1: Write failing test** — create `src/app/mailto.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildMailtoUrl, stakeholderEmail } from "./mailto";

describe("buildMailtoUrl", () => {
  it("builds a percent-encoded mailto URL", () => {
    const url = buildMailtoUrl("a b@x.io", "Re: A&B", "Hi\nthere");
    expect(url).toBe("mailto:a%20b%40x.io?subject=Re%3A%20A%26B&body=Hi%0Athere");
  });
});

describe("stakeholderEmail", () => {
  const resources = [{ id: 7, email: "linked@x.io" }] as never;
  it("prefers the stakeholder's own email", () => {
    expect(stakeholderEmail({ email: "direct@x.io", resourceId: 7 }, resources)).toBe("direct@x.io");
  });
  it("falls back to the linked resource email", () => {
    expect(stakeholderEmail({ email: undefined, resourceId: 7 }, resources)).toBe("linked@x.io");
  });
  it("returns undefined when neither has an email", () => {
    expect(stakeholderEmail({ email: undefined, resourceId: null }, resources)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, verify failure** — `npx vitest run src/app/mailto.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — create `src/app/mailto.ts`:

```ts
// src/app/mailto.ts
// Pure mailto: helpers shared by the task status-inquiry flow and the
// stakeholder-comms draft. No React, no side effects.
import type { Resource } from "./types";

export function buildMailtoUrl(email: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Effective email for a stakeholder: their own, else the linked resource's, else undefined. */
export function stakeholderEmail(
  sh: { email?: string; resourceId?: number | null },
  resources: readonly Resource[],
): string | undefined {
  const direct = sh.email?.trim();
  if (direct) return direct;
  const linked = sh.resourceId != null ? resources.find((r) => r.id === sh.resourceId) : undefined;
  return linked?.email?.trim() || undefined;
}
```

- [ ] **Step 4: Refactor `onSendInquiry`** — in `use-task-row-handlers.ts`, add `import { buildMailtoUrl } from "./mailto";` and replace the inline mailto construction:
```ts
      const url = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
```
with:
```ts
      const url = buildMailtoUrl(email, subject, body);
```
(No behavior change — the resulting string is identical.)

- [ ] **Step 5: Run, verify pass** — `npx vitest run src/app/mailto.test.ts src/app/use-task-row-handlers.test.ts && npx tsc --noEmit` → PASS/clean (the existing onSendInquiry test still passes).

- [ ] **Step 6: Commit**

```bash
git add src/app/mailto.ts src/app/mailto.test.ts src/app/use-task-row-handlers.ts
git commit -m "feat: pure mailto helpers; onSendInquiry reuses buildMailtoUrl"
```

---

### Task 2: "Draft message" button in ActionRow

**Files:** Modify `src/app/action-row.tsx`, `src/app/actions-panel.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`; Test `src/app/action-row.test.tsx`.

- [ ] **Step 1: Write failing test** — append to `action-row.test.tsx`:

```ts
function draftableAction(source: string): never {
  return {
    id: `${source}:1:x`, source,
    title: { key: "actionTaskTitle", params: ["X"] },
    why: { key: "actionTaskWhyOverdue", params: [2] },
    score: 40, tier: "now", cta: { kind: "open", view: "open-points", id: 1 },
  } as never;
}

it("shows Draft message for task-due and stakeholder-comms and calls onDraftMessage", () => {
  const onOpen = vi.fn();
  const onDraftMessage = vi.fn();
  render(<ActionRow lang="en-US" action={draftableAction("task-due")} onOpen={onOpen} onDraftMessage={onDraftMessage} />);
  const btn = screen.getByRole("button", { name: /draft message/i });
  fireEvent.click(btn);
  expect(onDraftMessage).toHaveBeenCalledTimes(1);
  expect(onOpen).not.toHaveBeenCalled();
});

it("shows Draft message for stakeholder-comms", () => {
  render(<ActionRow lang="en-US" action={draftableAction("stakeholder-comms")} onOpen={() => {}} onDraftMessage={() => {}} />);
  expect(screen.getByRole("button", { name: /draft message/i })).toBeInTheDocument();
});

it("hides Draft message for other sources and when onDraftMessage absent", () => {
  render(<ActionRow lang="en-US" action={draftableAction("budget")} onOpen={() => {}} onDraftMessage={() => {}} />);
  expect(screen.queryByRole("button", { name: /draft message/i })).toBeNull();
  render(<ActionRow lang="en-US" action={draftableAction("task-due")} onOpen={() => {}} />);
  expect(screen.queryByRole("button", { name: /draft message/i })).toBeNull();
});
```

- [ ] **Step 2: Run, verify failure** — `npx vitest run src/app/action-row.test.tsx` → FAIL.

- [ ] **Step 3: Implement** — in `action-row.tsx`: add `onDraftMessage?: (action: SuggestedAction) => void;` to `ActionRowProps`; destructure it. Add a guard near the others:
```ts
  const canDraft =
    onDraftMessage != null &&
    (action.source === "task-due" || action.source === "stakeholder-comms") &&
    action.cta.kind === "open";
```
Inside the controls `<div className="flex shrink-0 items-center gap-1">`, after the Open button, add:
```tsx
        {canDraft && onDraftMessage && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDraftMessage(action); }}
            className="rounded-md border border-line px-2 py-1 text-xs font-medium text-AIPM-dark-blue hover:bg-surface-muted dark:text-AIPM-light-grey"
          >
            {t(lang, "actionDraftMessage")}
          </button>
        )}
```
In `actions-panel.tsx`: add `onDraftMessage?: (action: SuggestedAction) => void;` to `ActionsPanelProps`, destructure, and pass `onDraftMessage={onDraftMessage}` to BOTH `<ActionRow>` sites.

- [ ] **Step 3b: i18n** — `i18n.ts`: `actionDraftMessage: "Draft message",` · `i18n.de.ts`: `actionDraftMessage: "Nachricht verfassen",`

- [ ] **Step 4: Run, verify pass** — `npx vitest run src/app/action-row.test.tsx src/app/actions-panel.test.tsx src/app/i18n-encoding.test.ts && npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/action-row.tsx src/app/actions-panel.tsx src/app/action-row.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: Draft message button on task-due + comms action rows"
```

---

### Task 3: Wire the onDraftMessage dispatcher in the surface

**Files:** Modify `src/app/task-manager.tsx`, `src/app/workspace-section.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`.

- [ ] **Step 1: Implement** — in `task-manager.tsx`, add imports:
```ts
import { buildMailtoUrl, stakeholderEmail } from "./mailto";
```
Add the dispatcher (near `handleCreateTaskFromAction`; `onSendInquiry`, `tasks`, `stakeholders`, `resources`, `project`, `lang` are in scope):
```ts
  const handleDraftMessageFromAction = useCallback(
    (action: SuggestedAction) => {
      const id = action.cta.kind === "open" ? Number(action.cta.id) : -1;
      if (action.source === "task-due") {
        const task = tasks.find((t) => t.id === id);
        if (task) onSendInquiry(task);
        return;
      }
      if (action.source === "stakeholder-comms") {
        const sh = stakeholders.find((s) => s.id === id);
        if (!sh) return;
        let email = stakeholderEmail(sh, resources);
        if (!email) {
          const provided = window.prompt(t(lang, "promptEmail", sh.name), "");
          if (provided === null) return;
          const trimmed = provided.trim();
          if (!trimmed) return;
          email = trimmed;
        }
        const subject = t(lang, "commsEmailSubject", project?.name ?? "");
        const body = t(lang, "commsEmailBodyTemplate", sh.name);
        window.location.href = buildMailtoUrl(email, subject, body);
      }
    },
    [tasks, onSendInquiry, stakeholders, resources, project, lang],
  );
```
Thread it: add `onDraftMessage: isPopout ? undefined : handleDraftMessageFromAction` to the `workspaceProps` object (next to `onCreateTask`/`assignOwner`). In `workspace-section.tsx`: add `onDraftMessage?: (action: SuggestedAction) => void` to `WorkspaceSectionProps`, destructure it, and pass `onDraftMessage={onDraftMessage}` to `<ActionsPanel>`.

- [ ] **Step 1b: i18n** — `i18n.ts`:
```ts
  commsEmailSubject: "Project update — {0}",
  commsEmailBodyTemplate: "Hi {0},\n\nA quick update on where we stand and what I need from you:\n\n",
```
`i18n.de.ts` (em-dash U+2014; "für"/"Stand" — verify any umlaut bytes):
```ts
  commsEmailSubject: "Projekt-Update — {0}",
  commsEmailBodyTemplate: "Hallo {0},\n\nein kurzes Update zum aktuellen Stand und was ich von dir brauche:\n\n",
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit && npx vitest run src/app/actions-panel.test.tsx src/app/workspace-section.test.tsx src/app/i18n-encoding.test.ts && npm run lint`. (If `workspace-section.test.tsx` mocks props, add `onDraftMessage` minimally.)

- [ ] **Step 3: Commit**

```bash
git add src/app/task-manager.tsx src/app/workspace-section.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: wire draft-message dispatcher (task inquiry + comms mailto)"
```

---

### Task 4: Release — 0.87.0 "Wells"

**Files:** `src/app/version.ts`, `CHANGELOG.md`, `src/app/i18n.ts`, `src/app/i18n.de.ts`.

- [ ] **Step 1:** Full suite green: `npx vitest run && npx tsc --noEmit && npm run lint && npm run build`. If anything fails, STOP.
- [ ] **Step 2:** `version.ts`: `APP_VERSION="0.87.0"`, `APP_BUILD_DATE="2026-06-15"` (comment → draft-message CTA), `APP_MILESTONE="Wells"` (new minor codename, H. G. Wells — update the JSDoc from 0.86.x "Hamilton"). Append `"versionHighlightDraftMessage"` to `APP_HIGHLIGHT_KEYS`.
- [ ] **Step 3:** EN (`i18n.ts`): `versionHighlightDraftMessage: "Draft a status-chase or stakeholder message straight from the Action Center — opens your mail client pre-filled.",` DE (`i18n.de.ts`, real umlaut: "öffnet" ö, "für" ü; em-dash U+2014): `versionHighlightDraftMessage: "Eine Status-Nachfrage oder Stakeholder-Nachricht direkt aus dem Action Center verfassen — öffnet das Mailprogramm vorausgefüllt.",` Verify ö (c3 b6) bytes.
- [ ] **Step 4:** `CHANGELOG.md`: `## [0.87.0] - 2026-06-15 "Wells"` at the top, summarizing: inline "Draft message" CTA on task-due + stakeholder-comms Action Center rows — opens a prefilled mailto (reuses the status-inquiry flow for tasks; new mailto to the stakeholder for comms); surface-only, engine untouched; third execution-depth slice.
- [ ] **Step 5:** Verify `npx tsc --noEmit && npx vitest run src/app/i18n-encoding.test.ts`; commit `git commit -m "chore: release 0.87.0 draft-message CTA"`.

---

## Final verification (before finishing)
```bash
npx vitest run && npx tsc --noEmit && npm run lint && npm run build
```
Then **superpowers:finishing-a-development-branch**. e2e 12-view axe gate runs in CI — the "Draft message" button must be keyboard-reachable + labelled.

## Self-Review

**Spec coverage:**
- mailto mechanism + `buildMailtoUrl` + `stakeholderEmail`, `onSendInquiry` DRY → Task 1. ✓
- "Draft message" button on task-due + stakeholder-comms, gated → Task 2. ✓
- Dispatcher: task-due reuses `onSendInquiry`; comms resolves email (prompt fallback) + mailto → Task 3. ✓
- Threading task-manager → workspace-section → ActionsPanel → ActionRow, gated !isPopout → Tasks 2, 3. ✓
- Engine untouched → no engine task. ✓
- 3 i18n keys (`actionDraftMessage`, `commsEmailSubject`, `commsEmailBodyTemplate`) + the highlight → Tasks 2, 3, 4. ✓
- Edge cases (no-email prompt, deleted-entity guard, popout) → Tasks 2 (gate), 3 (find-guard + prompt). ✓
- Release → Task 4. ✓

**Type consistency:** `buildMailtoUrl(email,subject,body)`, `stakeholderEmail(sh,resources)`, `onDraftMessage?: (action: SuggestedAction) => void`, `canDraft`, keys `actionDraftMessage`/`commsEmailSubject`/`commsEmailBodyTemplate` — used identically across tasks. The comms subject uses `project?.name ?? ""`; body uses `sh.name`.

**Placeholder scan:** none — the only adapt-to-existing note is the `workspace-section.test.tsx` mock (Task 3 Step 2), whose required shape is specified.
