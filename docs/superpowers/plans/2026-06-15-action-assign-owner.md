# Assign-Owner Execution CTA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an inline "Assign owner" CTA to RAID-no-owner Action-Center rows: a popover with the shared `ResourcePicker` whose pick writes the owner to the RAID item immediately.

**Architecture:** Surface-only — the `next-actions/` engine is untouched. The row detects assign-eligible items via the existing `why.key === "actionRaidWhyNoOwner"` marker. An optional `assignOwner` prop bundle ({resources, onCreateResource, onAssign}) carries the picker deps; `task-manager` owns the `setRaid` write + toast.

**Tech Stack:** TypeScript, React (Next.js fork), Vitest + RTL, i18n EN+DE (tsc parity).

**Spec:** `docs/superpowers/specs/2026-06-15-action-assign-owner-design.md`

---

## Grounding facts (verified)

- `action-row.tsx` `ActionRowProps` = `{ lang, action, onOpen, onSnooze?, onCreateTask? }`; the right-hand controls live in `<div className="flex shrink-0 items-center gap-1">` (Open button, then the create-task button, then the snooze `▾` menu which uses a `<span className="relative">` + an `absolute` dropdown — mirror THAT popover structure).
- `ResourcePicker` (`resource-picker.tsx`): props `value: {name,email,resourceId}`, `resources: readonly Resource[]`, `onChange: (next: {name,email,resourceId}) => void`, `onCreateResource: (name,email) => number`.
- `task-manager.tsx`: `handleCreateResource` (line ~742, `(name,email): number`), `resources`, `setRaid`, `showToast` (`useToast`), `lang`, `isPopout` all in scope. `ActionsPanel` is rendered in `workspace-section.tsx` (threaded via `workspaceProps`), same as `onCreateTask`.
- RAID owner = three fields: `owner` (name), `ownerEmail`, `ownerResourceId`.

## Conventions for every task
- One test file: `npx vitest run src/app/<file>.test.tsx`; typecheck `npx tsc --noEmit` (enforces i18n parity); lint `npm run lint`.
- New i18n strings → EN + DE, identical keys. DE here has no umlauts, but the Edit tool curls quotes in `i18n.de.ts` — after editing run `npx vitest run src/app/i18n-encoding.test.ts`, node-write if mangled.
- a11y (AGENTS.md axe constraint): the new button needs an accessible name; the popover must be keyboard-operable + close on Escape.
- Commit after each task. No `Co-Authored-By`.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `action-row.tsx` | row UI | `assignOwner` prop; "Assign owner" button + ResourcePicker popover |
| `actions-panel.tsx` | inbox list | thread `assignOwner` to both ActionRow sites |
| `task-manager.tsx` | surface wiring | build `assignOwner` bundle (setRaid write + toast), gate `!isPopout` |
| `workspace-section.tsx` | renders ActionsPanel | thread `assignOwner` through |
| `i18n.ts` / `i18n.de.ts` | strings | `actionAssignOwner`, `actionOwnerAssigned` |
| `version.ts` / `CHANGELOG.md` | release | 0.86.0 "Hamilton" |

---

### Task 1: "Assign owner" button + ResourcePicker popover in ActionRow

**Files:** Modify `src/app/action-row.tsx`, `src/app/actions-panel.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`; Test `src/app/action-row.test.tsx`.

- [ ] **Step 1: Write the failing test** — append to `action-row.test.tsx`:

```ts
import { fireEvent } from "@testing-library/react";

function noOwnerRaid(): never {
  return {
    id: "raid:12:severity", source: "raid",
    title: { key: "actionRaidTitle", params: [12, "DB outage"] },
    why: { key: "actionRaidWhyNoOwner", params: ["High"] },
    score: 30, tier: "now", cta: { kind: "open", view: "raid", id: 12 },
  } as never;
}
const bundle = { resources: [], onCreateResource: () => 1, onAssign: vi.fn() };

it("shows Assign owner for a no-owner raid action and writes via onAssign", () => {
  const onOpen = vi.fn();
  render(<ActionRow lang="en-US" action={noOwnerRaid()} onOpen={onOpen} assignOwner={{ ...bundle, onAssign: vi.fn() }} />);
  const btn = screen.getByRole("button", { name: /assign owner/i });
  fireEvent.click(btn);                       // opens popover; does not Open the row
  expect(onOpen).not.toHaveBeenCalled();
  // ResourcePicker renders a text input; typing + the picker's onChange drives onAssign.
  // (Assert the popover is open by the picker's presence — a textbox appears.)
  expect(screen.getByRole("textbox")).toBeInTheDocument();
});

it("hides Assign owner for an owned raid action (severity why)", () => {
  const owned = { ...noOwnerRaid(), why: { key: "actionRaidWhySeverity", params: ["High"] } } as never;
  render(<ActionRow lang="en-US" action={owned} onOpen={() => {}} assignOwner={bundle} />);
  expect(screen.queryByRole("button", { name: /assign owner/i })).toBeNull();
});

it("hides Assign owner when no assignOwner bundle is provided", () => {
  render(<ActionRow lang="en-US" action={noOwnerRaid()} onOpen={() => {}} />);
  expect(screen.queryByRole("button", { name: /assign owner/i })).toBeNull();
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run src/app/action-row.test.tsx`
Expected: FAIL — no `assignOwner` prop / no button.

- [ ] **Step 3: Implement** — in `action-row.tsx`:

Add the bundle type + prop:
```ts
import { ResourcePicker } from "./resource-picker";
import type { Resource } from "./types";

export interface AssignOwnerBundle {
  resources: readonly Resource[];
  onCreateResource: (name: string, email: string) => number;
  onAssign: (action: SuggestedAction, value: { name: string; email: string; resourceId: number | null }) => void;
}
```
Add `assignOwner?: AssignOwnerBundle;` to `ActionRowProps` and destructure it. Add popover state next to `menuOpen`:
```ts
  const [assignOpen, setAssignOpen] = useState(false);
  const canAssign =
    assignOwner != null &&
    action.source === "raid" &&
    action.why.key === "actionRaidWhyNoOwner" &&
    action.cta.kind === "open";
```
Inside the controls `<div className="flex shrink-0 items-center gap-1">`, after the Open button (and before/after the create-task button — order is cosmetic), add:
```tsx
        {canAssign && assignOwner && (
          <span className="relative">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={assignOpen}
              onClick={(e) => { e.stopPropagation(); setAssignOpen((o) => !o); }}
              className="rounded-md border border-line px-2 py-1 text-xs font-medium text-AIPM-dark-blue hover:bg-surface-muted dark:text-AIPM-light-grey"
            >
              {t(lang, "actionAssignOwner")}
            </button>
            {assignOpen && (
              <span
                role="dialog"
                aria-label={t(lang, "actionAssignOwner")}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => { if (e.key === "Escape") setAssignOpen(false); }}
                className="absolute right-0 top-full z-20 mt-1 w-64 rounded-md border border-line bg-surface p-2 shadow-sm"
              >
                <ResourcePicker
                  value={{ name: "", email: "", resourceId: null }}
                  resources={assignOwner.resources}
                  onCreateResource={assignOwner.onCreateResource}
                  onChange={(next) => { assignOwner.onAssign(action, next); setAssignOpen(false); }}
                />
              </span>
            )}
          </span>
        )}
```
(Note: the existing snooze menu already uses `shadow-sm`; if the palette-sweep flags it, match whatever the snooze menu uses. The snooze menu in this file uses `shadow-sm` already, so it's consistent.)

In `actions-panel.tsx`: add `assignOwner?: AssignOwnerBundle;` to `ActionsPanelProps` (import the type from `./action-row`), destructure it, and pass `assignOwner={assignOwner}` to BOTH `<ActionRow>` sites (now/soon list + monitor list).

- [ ] **Step 3b: i18n** — `i18n.ts`: `actionAssignOwner: "Assign owner",`  · `i18n.de.ts`: `actionAssignOwner: "Verantwortlichen zuweisen",`

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/app/action-row.test.tsx src/app/actions-panel.test.tsx src/app/i18n-encoding.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/action-row.tsx src/app/actions-panel.tsx src/app/action-row.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: Assign owner popover on RAID no-owner action rows"
```

---

### Task 2: Wire the assignOwner bundle in the surface

**Files:** Modify `src/app/task-manager.tsx`, `src/app/workspace-section.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`; Test: covered by Task 1 + existing tests.

- [ ] **Step 1: Implement** — in `task-manager.tsx`, build the bundle (place near `handleCreateTaskFromAction`; `useMemo` import already present). It reads `raid` for the exists-guard, so include it in deps:

```ts
  const assignOwnerBundle = useMemo(
    () =>
      isPopout
        ? undefined
        : {
            resources,
            onCreateResource: handleCreateResource,
            onAssign: (
              action: SuggestedAction,
              v: { name: string; email: string; resourceId: number | null },
            ) => {
              const id = action.cta.kind === "open" ? Number(action.cta.id) : -1;
              if (!raid.some((r) => r.id === id)) return; // deleted between open + pick
              setRaid((prev) =>
                prev.map((r) =>
                  r.id === id
                    ? {
                        ...r,
                        owner: v.name || undefined,
                        ownerEmail: v.email || undefined,
                        ownerResourceId: v.resourceId,
                      }
                    : r,
                ),
              );
              showToast("info", t(lang, "actionOwnerAssigned", id));
            },
          },
    [isPopout, resources, handleCreateResource, raid, setRaid, showToast, lang],
  );
```

Thread `assignOwnerBundle` to the `ActionsPanel` render. As with `onCreateTask`, `ActionsPanel` lives in `workspace-section.tsx`: add `assignOwner: assignOwnerBundle` to the `workspaceProps` object, add `assignOwner?: AssignOwnerBundle` (import the type from `./action-row`) to `WorkspaceSectionProps`, destructure it, and pass `assignOwner={assignOwner}` to `<ActionsPanel>`.

- [ ] **Step 1b: i18n** — `i18n.ts`: `actionOwnerAssigned: "Owner assigned to RAID #{0}",` · `i18n.de.ts`: `actionOwnerAssigned: "Verantwortlichen zu RAID #{0} zugewiesen",`

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npx vitest run src/app/actions-panel.test.tsx src/app/workspace-section.test.tsx src/app/i18n-encoding.test.ts && npm run lint`
Expected: PASS / clean. (If `workspace-section.test.tsx` mocks ActionsPanel/props, add `assignOwner` to the mock as needed.)

- [ ] **Step 3: Commit**

```bash
git add src/app/task-manager.tsx src/app/workspace-section.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: wire assign-owner (setRaid write + toast) into the action inbox"
```

---

### Task 3: Release — 0.86.0 "Hamilton"

**Files:** `src/app/version.ts`, `CHANGELOG.md`, `src/app/i18n.ts`, `src/app/i18n.de.ts`.

- [ ] **Step 1:** Full suite green: `npx vitest run && npx tsc --noEmit && npm run lint && npm run build`. If anything fails, STOP.
- [ ] **Step 2:** `version.ts`: `APP_VERSION="0.86.0"`, `APP_BUILD_DATE="2026-06-15"` (comment → assign-owner CTA), `APP_MILESTONE="Hamilton"` (new minor codename, Peter F. Hamilton — update the codename JSDoc from 0.85.x "Liu"). Append `"versionHighlightAssignOwner"` to `APP_HIGHLIGHT_KEYS`.
- [ ] **Step 3:** EN (`i18n.ts`): `versionHighlightAssignOwner: "Assign an owner to a RAID risk straight from the Action Center — pick a person in the inbox and it's set, no editor round-trip.",` DE (`i18n.de.ts`): `versionHighlightAssignOwner: "Einem RAID-Risiko direkt im Action Center einen Verantwortlichen zuweisen — Person in der Inbox wählen, fertig, ohne Umweg über den Editor.",` (em-dash U+2014; "wählen" has ä, "fertig" none — verify ä bytes c3 a4 via grep + i18n-encoding test.)
- [ ] **Step 4:** `CHANGELOG.md`: `## [0.86.0] - 2026-06-15 "Hamilton"` at the top, summarizing: inline "Assign owner" CTA on RAID-no-owner Action Center rows (ResourcePicker popover; writes owner immediately; surface-only, engine untouched).
- [ ] **Step 5:** Verify `npx tsc --noEmit && npx vitest run src/app/i18n-encoding.test.ts`; commit `git commit -m "chore: release 0.86.0 assign-owner CTA"`.

---

## Final verification (before finishing)
```bash
npx vitest run && npx tsc --noEmit && npm run lint && npm run build
```
Then **superpowers:finishing-a-development-branch**. e2e 12-view axe gate runs in CI — the "Assign owner" button + popover must be keyboard-reachable, labelled, Escape-closable.

## Self-Review

**Spec coverage:**
- Trigger (raid + no-owner why-key + open cta + bundle present) → Task 1 `canAssign`. ✓
- Inline ResourcePicker popover, pick writes immediately → Task 1 (popover) + Task 2 (`onAssign` setRaid). ✓
- `assignOwner` single prop bundle threaded ActionsPanel → ActionRow, gated !isPopout → Tasks 1, 2. ✓
- setRaid writes 3 owner fields, item-exists guard, toast → Task 2. ✓
- a11y (button label, role=dialog, aria-expanded, Escape) → Task 1. ✓
- Engine untouched → no engine task. ✓
- Two i18n keys (`actionAssignOwner`, `actionOwnerAssigned`) → Tasks 1, 2. ✓
- Release → Task 3. ✓

**Type consistency:** `AssignOwnerBundle` ({resources, onCreateResource, onAssign}) defined once in `action-row.tsx`, imported by `actions-panel.tsx` + `workspace-section.tsx`; `onAssign(action, value)` value shape matches `ResourcePicker.onChange`'s `{name,email,resourceId}`; `actionAssignOwner` / `actionOwnerAssigned` keys consistent.

**Placeholder scan:** none — the only adapt-to-existing note is the `workspace-section.test.tsx` mock (Task 2 Step 2), whose required shape is specified.
