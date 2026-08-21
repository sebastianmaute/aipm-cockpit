# Help Expansion SP2 — Contextual per-view callouts

**Date:** 2026-06-28
**Part of:** the 4-part "expand Help for PM novices" roadmap (SP1 backbone+Help-view · **SP2 contextual per-view callouts** · SP3 interactive relations map · SP4 themed guided tours). SP2 reads the `relatedViews`/concept data SP1 populated in `help-content.ts`.

## Goal

On each working view, show a dismissable one-line plain-language callout that tells a PM-novice *what this view is for* and links straight into the matching Help concept. Per-device dismiss + a global "Show view hints" switch. EN + DE.

## Decisions (approved)

1. **Depth:** one-liner per view **+ a "Learn more →"** deep-link that opens the Help view scrolled to the matching concept.
2. **Visibility:** **per-view ✕ dismiss** (persisted per-device) **+ a global "Show view hints" toggle** in Settings → Appearance (default ON).
3. **Open Points (tasks) is included** (tasks render in a separate `TasksSection`, so a second mount).

## Architecture

### Content backbone — `view-callouts.ts` (pure, i18n-free)

```ts
import type { TranslationKey } from "./i18n";
import type { AppView } from "./nav-config";

export interface ViewCallout {
  textKey: TranslationKey;   // short novice one-liner
  conceptId: string;         // a HELP_ENTRIES concept id (Learn-more target)
}

export const VIEW_CALLOUTS: Partial<Record<AppView, ViewCallout>> = { /* ~14 views */ };
```

Covered views (each → its primary concept): `open-points`→concept-task-status · `gantt`→concept-dependency · `milestones`→concept-milestone · `raid`→concept-raid · `changes`→concept-change · `stakeholders`→concept-stakeholder · `raci`→concept-raci · `budget`→concept-budget · `budget-report`→concept-budget · `resources`→concept-resource · `workload`→concept-resource · `planning`→concept-resource · `steering-committee`→concept-steering · `trends`→concept-baseline.

Excluded: `dashboard` (already has coaching + tip cards), `actions`, chat, reports, projects, settings, help — no callout entry ⇒ component self-hides.

### Dismiss store — `view-hints-store.ts` (pure)

Per-device localStorage `lop-app:view-hints` → `{ dismissed: Record<string, true> }`. `loadDismissed()` (validated, never throws) + `dismissView(view, isPopout)` (popout = no-op write). NOT workspace data — out of exports/Turso; cleared by `clearAppConfig`'s `lop-app:*` sweep (no app-reset edit needed).

### Component — `view-callout.tsx`

`ViewCallout({ view, lang, showHints })`. Consumes `useWorkspaceTab()` for `isPopout` + `requestHelpConcept`. Renders **null** when: no `VIEW_CALLOUTS[view]` · `isPopout` · `!showHints` · already dismissed (lazy `useState(loadDismissed)`). Otherwise a slim banner:
- left: a short text (`t(lang, callout.textKey)`),
- "Learn more →" `<button>` → `requestHelpConcept(callout.conceptId)`,
- ✕ `<button aria-label={viewHintDismiss}>` → dismiss + persist + hide.

Palette-safe (`border-line`, `bg-surface-muted`, `text-foreground`/`text-muted-foreground`, brand link colour); `INTERACTIVE` atoms. Many mount views are axe-scanned — both buttons carry accessible names; resting contrast clears AA.

### Cross-view navigation — `workspace-tab-context.tsx`

Add a string channel mirroring `requestChat` (sets `activeTab` + a pending value, NO hash write):

```ts
pendingHelpConcept: string | null;
requestHelpConcept: (conceptId: string) => void;   // setActiveTab("help"); setPendingHelpConcept(id)
clearHelpConcept: () => void;
```

### Help view consumes the pending concept — `help-view.tsx`

HelpView gains **optional** props `pendingHelpConcept?: string | null` + `onHelpConceptConsumed?: () => void` (optional so the standalone `help-view.test.tsx` renders unchanged — it has no `WorkspaceTabProvider`). Scroll-to-concept uses the **render-time reconcile + nonce-keyed effect** pattern (mirrors `useDeepLinkRowFlash`: track `handledConcept`/`seq` in state during render; an effect keyed on `seq` does `scrollIntoView` on `help-sec-<id>` then calls `onHelpConceptConsumed`). No `set-state-in-effect`.

`workspace-section.tsx` threads `pendingHelpConcept`/`clearHelpConcept` (from `useWorkspaceTab`) into `<HelpView>`.

### Mounts

- `workspace-section.tsx`: `<ViewCallout view={activeTab} lang={lang} showHints={settings.showViewHints !== false} />` immediately after the `<ActionChips>` strip inside `#workspace-panels` (a `shrink-0` sibling; panels stay `flex-1` below). One mount covers all workspace-section views.
- `tasks-section.tsx`: `<ViewCallout view="open-points" … />` inside the top `shrink-0 print:hidden` wrapper, after its `<ActionChips>`.

### Global toggle — Settings → Appearance

`settings.showViewHints?: boolean` (default ON; read as `!== false`). Persists via the `writeSettings` spread (no allowlist edit — mirrors `dashboardDensity`/`tasksViewMode`). `AppearanceSection` adds a `SegmentedControl<"shown"|"hidden">` (Shown/Hidden) with an `ariaLabel` (General is axe-scanned). Add the field to the `Settings` interface + `defaultSettings` in `settings-types.ts`.

### i18n (EN `i18n.ts` Edit / DE `i18n.de.ts` node-utf8 write, CRLF, `\u` umlauts)

- 14 `viewHint<View>` one-liners (EN+DE).
- `viewHintLearnMore`, `viewHintDismiss`.
- `showViewHintsLabel`, `showViewHintsHint`, `viewHintsShown`, `viewHintsHidden`.

tsc enforces EN/DE parity + `TranslationKey` validity.

## Testing

- `view-callouts.test.ts`: every `conceptId` resolves to a real `HELP_ENTRIES` id; every `textKey` exists in the EN dict; keys are valid `AppView`s (typed).
- `view-hints-store.test.ts`: round-trip dismiss; malformed/absent storage → `{}`; popout write is a no-op.
- `view-callout.test.tsx`: renders the banner for a view with a callout; returns null when popout / `!showHints` / dismissed; Learn-more invokes `requestHelpConcept`; ✕ hides + persists. (Wrap in a `WorkspaceTabProvider` test harness or pass a mocked context.)
- tsc + lint green; axe gate on the scanned mount views (eye/`a11y.spec` spot-check RAID/Milestones/Budget).

## Out of scope (later SPs)

- The interactive relations map (SP3) and themed guided tours (SP4). SP2 adds no new concept content — it reuses SP1's concepts.
- Version bump / CHANGELOG — deferred to release of the branch.
