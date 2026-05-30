# Modern Sidebar Layout — Phase 4 Workstream C: DRY Menu Cluster + Banner Parity

**Date:** 2026-05-30
**Status:** Design approved, ready for implementation plan
**Phase:** Phase 4 "Shell Polish" — Workstream C (independent of A/B/D)

## Goal

Remove the duplicated action-menu cluster shared by the classic header and the
modern top bar by extracting a single `ActionMenus` component, and close the
banner-parity gap so the modern layout shows the same Due / Birthday / Jira-token
banners the classic layout already shows.

## Background

- **Menu duplication.** `app-header.tsx` (classic) renders, in its right cluster,
  `Voice · Add · Bell · Export · Help · Version · Settings`. `task-manager.tsx`
  builds a `topBarMenus` element (`Voice · Export · Help · Version`) for the modern
  `TopBar`. The run `Voice · Export · Help · Version` — including `ExportMenu`'s
  ~12-prop data list — is duplicated JSX in both files. Settings correctly diverges
  (classic gear popover vs. modern full-page sidebar view, established in
  Workstream B) and stays out of the shared cluster.
- **Banner gap.** The classic tree (`legacyTree` in `task-manager.tsx`) renders
  `DueBanner`, `BirthdayBanner`, and `JiraTokenBanner`, each gated by `!isPopout`
  plus its dismiss/snooze state. The modern tree (`modernTree`) renders **none** of
  them — only the numeric `bannerCount` reaches the `TopBar` bell badge. The
  dismiss/snooze state already lives in the single `TaskManagerInner` instance, so
  this is purely a rendering gap, not a state-wiring problem.

## Decisions (from brainstorming)

1. **Cluster scope:** `Voice + Export + Help + Version` extracted into one
   `ActionMenus` component. The component calls `useWorkspace()` internally for the
   ExportMenu data, so callers pass only `lang` and the voice handlers (maximum DRY).
2. **Banner placement (modern):** a new `ModernShell` `banners` slot rendered at the
   **top of `<main>`**, above the view content, inside the existing `p-6` scroll
   area. Banners scroll with content (mirrors classic).
3. **Banner view-scope (modern):** **all views**, including the full-page Edit and
   Settings views — true parity with classic, simplest logic.
4. **Banner reuse:** extract a single shared `bannersEl` const inside
   `TaskManagerInner` (keeping the existing gates verbatim) used by **both** the
   classic and modern trees — no new prop-heavy component (KISS/YAGNI), since the
   gates reference ~12 local values.

## Architecture

### `ActionMenus` component (DRY)

New `src/app/action-menus.tsx`:

```tsx
"use client";
import dynamic from "next/dynamic";
import { type Lang } from "./i18n";
import { type Command } from "./voice";
import { ExportMenu } from "./export-menu";
import { HelpMenu } from "./help-menu";
import { VersionMenu } from "./version-menu";
import { useWorkspace } from "./workspace-context";

const VoiceCommandButton = dynamic(
  () => import("./voice-button").then((m) => m.VoiceCommandButton),
  { ssr: false },
);

interface ActionMenusProps {
  lang: Lang;
  onCommand: (cmd: Command, originalText: string) => void;
  onVoiceError: (msg: string) => void;
}

export function ActionMenus({ lang, onCommand, onVoiceError }: ActionMenusProps) {
  const { tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates } = useWorkspace();
  return (
    <>
      <VoiceCommandButton lang={lang} onCommand={onCommand} onError={onVoiceError} />
      <ExportMenu lang={lang} tasks={tasks} raid={raid} absences={absences} shifts={shifts} resources={resources} roles={roles} disciplines={disciplines} grades={grades} plan={plan} budgets={budgets} fxRates={fxRates} />
      <HelpMenu lang={lang} />
      <VersionMenu lang={lang} />
    </>
  );
}
```

Consumers:

- **Modern** (`task-manager.tsx`): replace the inline `topBarMenus` element with
  `topBarMenus={<ActionMenus lang={lang} onCommand={handleCommand} onVoiceError={(msg) => showToast("error", msg)} />}`.
  Drop the now-unused `VoiceCommandButton`/`ExportMenu`/`HelpMenu`/`VersionMenu`
  imports from `task-manager.tsx` if no other reference remains.
- **Classic** (`app-header.tsx`): render `<ActionMenus lang={lang} onCommand={handleCommand} onVoiceError={(msg) => showToast("error", msg)} />`
  in place of the inline Voice/Export/Help/Version, and **remove** the
  `useWorkspace()` call (line 59) and its import — AppHeader used those only to feed
  ExportMenu. Drop the `VoiceCommandButton`/`ExportMenu`/`HelpMenu`/`VersionMenu`
  imports and the local `dynamic` VoiceCommandButton definition.

**Deliberate classic reorder (approved).** Classic's right cluster currently places
`Voice` first (before `Add`/`Bell`), with `Export · Help · Version` after `Bell`.
Because `ActionMenus` is one contiguous component, `Voice` becomes adjacent to the
menus. The new classic order is `Add · Bell · [Voice · Export · Help · Version] · Settings`:
`Add`/`Bell`/`Settings` keep their slots; only `Voice` shifts right two positions.
This minor, more-consistent reorder is the accepted cost of including `Voice` in the
shared cluster.

### Banner parity

Extract a single shared element inside `TaskManagerInner`, keeping every existing
gate verbatim:

```tsx
const bannersEl = (
  <>
    {!isPopout && !bannerDismissed && !dueSnooze.isSnoozed && (
      <DueBanner items={bannerItems} lang={lang} onOpenList={() => setDueModalOpen(true)} onDismiss={() => setBannerDismissed(true)} onSnooze={dueSnooze.snooze} />
    )}
    {!isPopout && !birthdaySnooze.isSnoozed && !birthdayDismissed && birthdayItems.length > 0 && (
      <BirthdayBanner items={birthdayItems} lang={lang} onDismiss={() => setBirthdayDismissed(true)} onSnooze={birthdaySnooze.snooze} />
    )}
    {!isPopout && jiraTokenAlert && !jiraTokenSnooze.isSnoozed && !jiraTokenDismissed && (
      <JiraTokenBanner alert={jiraTokenAlert} lang={lang} onSnooze={jiraTokenSnooze.snooze} onDismiss={() => setJiraTokenDismissed(true)} />
    )}
  </>
);
```

- **Classic** (`legacyTree`): `{bannersEl}` replaces the three inline banner blocks
  (currently between `AppHeader` and `{workspaceEl}`). Pure refactor — identical
  output, since popouts still hit the `!isPopout` guard.
- **Modern** (`modernTree`): pass `banners={bannersEl}` to `ModernShell`.

`ModernShell` gains an optional slot:

```tsx
banners?: React.ReactNode;
```

rendered at the top of `<main>`:

```tsx
<main id="main-content" className="min-h-0 flex-1 overflow-auto bg-surface-muted p-6 dark:bg-black">
  {banners}
  {content}
</main>
```

## Data Flow & Error Handling

No new data paths. Dismiss/snooze state already lives in the single
`TaskManagerInner` instance, so modern dismissals persist exactly like classic.
Voice errors route through the same `showToast("error", …)` callback in both
layouts. No new error surfaces.

## i18n

**None.** Banners and menus reuse existing translation keys. No `i18n.de.ts` edit,
so the known ASCII-quote→curly-quote corruption hazard does not apply this round.

## Testing

- **`action-menus.test.tsx`** — rendered within a `WorkspaceProvider`, asserts the
  Export, Help, and Version triggers (and the Voice button) are present.
- **`modern-shell.test.tsx`** — new `banners` slot renders its content at the top of
  `<main>` (testid pattern matching the existing `topBarMenus` test).
- **`app-header.test.tsx`** — the menus still render (now via `ActionMenus`); update
  any assertion that referenced `ExportMenu`/`HelpMenu`/`VersionMenu` directly.
- **DRY sweep guard** (`action-menus-sweep.test.ts`, cwd-based like
  `settings-sections-sweep.test.ts`): assert both `app-header.tsx` and
  `task-manager.tsx` import `./action-menus`, and that neither inlines
  `ExportMenu`/`HelpMenu`/`VersionMenu` any longer. Prevents the cluster from
  drifting back into duplication.

## Out of Scope

- Workstream D (divergent-table sweep: `reports.tsx`, `budget-panel.tsx`,
  `jira-conflicts-modal.tsx`, `roles-modal.tsx`, `resource-calendar.tsx`).
- Any banner visual redesign or new banner types.
- Any change to the Settings entry point or the Add/Bell buttons.

## Constraints Honored

- AIPM 9-color palette only; no gradients, no drop shadows, no off-palette colors
  (banners and menus are already palette-compliant — no style changes).
- `README.md` and `public/*.png` are pre-existing uncommitted user changes — never
  touched or staged.
- Branch: `phase4c-menu-banner-parity`; merge to `main` locally; push only on
  request.
- Next release: **0.34.0**, codename "Chambers" (Becky Chambers) — verify no
  collision against existing CHANGELOG codenames during the release task.
