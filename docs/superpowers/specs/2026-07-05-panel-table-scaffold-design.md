# PanelTableScaffold — shared entity-panel render shell

**Date:** 2026-07-05
**Type:** Behavior-preserving refactor (TD-6 duplication reduction, structural tier)
**Owner:** tech-lead

## Goal

Extract the byte-identical render shell duplicated across the change, stakeholders,
and RAID panels into one presentational component, `PanelTableScaffold`. DOM output
and behavior stay exactly as today. This is the first structural (cross-file,
divergent-panel) slice of TD-6, replacing the exhausted single-extraction ratchet.

## Background

`docs/tech-debt-register.md` TD-6 tracks source duplication. The single-extraction
ratchet reached its practical floor at gate 1.8 (tsx 1.720% / typescript 1.715%,
headroom 0.08). Further gate movement needs a real reduction in the binding format,
not another 0.02% self-clone. The register names the remaining low-risk-but-structural
seam: "the divergent change↔raid↔stakeholder panel scaffold."

Measurement (2026-07-05) confirms three panels share a verbatim render shell:

| Panel | file | lines |
|---|---|---|
| Change log | `change-panel.tsx` | 653 |
| Stakeholders | `stakeholders-panel.tsx` | 593 |
| RAID | `raid-panel.tsx` | 525 |

`jscpd` finds 17 clones among these panels (6–21 lines each); the largest cluster is
the render shell below. Milestones (`rounded-lg`, `<table className="w-full text-sm">`,
different scroll container) and tasks (`rounded-xl`) are **excluded** — their class
strings diverge, and folding them in would reintroduce class-string config into an
axe-scanned surface, the exact risk this slice avoids.

## The shared shell

All three panels render this identical structure inside their `*PanelBody`. Every
`className` is a literal string, identical across the three (verified):

```tsx
<div ref={paneRef} className={`print-root print-landscape ${VIEW_PANE_RESIZABLE_CLASS}`}>
  {onLearnMore && (
    <ViewCallout view={VIEW} lang={lang} showHints={showHints !== false} isPopout={!!isPopout} onLearnMore={onLearnMore} />
  )}
  {toolbar}

  <div className="print:hidden">
    <BulkEditBar
      lang={lang}
      count={sel.count}
      open={bulkOpen}
      onToggleOpen={() => setBulkOpen((o) => !o)}
      onClear={() => { sel.clear(); setBulkOpen(false); }}
    />
    {bulkOpen && sel.count > 0 && (
      <BulkEditPanel lang={lang} count={sel.count} fields={bulkFields} onApply={applyBulk} onCancel={() => setBulkOpen(false)} />
    )}
  </div>

  <div ref={containerRef} className={COUNT === 0 ? undefined : "min-h-[240px] flex-1 overflow-auto rounded-md border border-line pr-2"}>
    {COUNT === 0 ? (
      <button
        type="button"
        onClick={onAdd}
        className={`flex w-full flex-col items-center gap-2 rounded-md border border-dashed border-line p-10 text-center text-sm text-muted-foreground hover:border-AIPM-dark-blue hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey ${INTERACTIVE}`}
      >
        <span>{EMPTY_TEXT}</span>
        <span className="font-medium">{ADD_LABEL}</span>
      </button>
    ) : (
      /* divergent per-panel <table> */
    )}
  </div>

  {/* divergent per-panel edit-modal mount */}
</div>
```

Per-panel divergences (become props/children):

- `VIEW` — the `AppView` string for `ViewCallout` (`"changes"` / `"stakeholders"` / `"raid"`).
- `toolbar` — already a per-panel JSX variable.
- `bulkFields`, `applyBulk`, `bulkOpen`/`setBulkOpen`, `sel` — bulk-edit state (structure identical, content divergent).
- `COUNT` — `changes.length` / `stakeholders.length` / `raid.length`.
- `EMPTY_TEXT`, `ADD_LABEL`, `onAdd` — empty-state text + create handler.
- RAID only: the empty `<button>` carries an `aria-label` (category-aware) and `onAdd` is `openNew(effectiveCategory)`. Change/stakeholders have no `aria-label`.
- the `<table>` (thead/tbody) — fully divergent.
- the edit-modal mount(s) after the container.

## Component contract

New file `src/app/panel-table-scaffold.tsx` (presentational, `"use client"`; no state,
no hooks — pure props→JSX, mirroring the `EditModalShell` precedent in
`edit-modal-chrome.tsx`).

```tsx
interface PanelTableScaffoldBulk {
  count: number;                       // sel.count
  open: boolean;                       // bulkOpen
  onToggleOpen: () => void;
  onClear: () => void;
  fields: BulkField[];
  onApply: (patch: Record<string, unknown>) => void;  // matches BulkEditPanel onApply
  onCancel: () => void;
}

interface PanelTableScaffoldEmpty {
  text: string;                        // <span>{text}</span>
  addLabel: string;                    // <span className="font-medium">{addLabel}</span> — caller formats "+ … …"
  onAdd: () => void;
  ariaLabel?: string;                  // RAID passes it; others omit
}

interface PanelTableScaffoldProps {
  paneRef: React.Ref<HTMLDivElement>;
  containerRef: React.Ref<HTMLDivElement>;
  view: AppView;
  lang: Lang;
  showHints?: boolean;                 // ViewCallout gets showHints !== false
  isPopout?: boolean;
  onLearnMore?: () => void;            // callout only renders when set
  toolbar: ReactNode;
  bulk: PanelTableScaffoldBulk;
  count: number;                       // empty ↔ table switch (== bulk.count in practice, kept separate for clarity)
  empty: PanelTableScaffoldEmpty;
  children: ReactNode;                 // the divergent <table>
  trailing?: ReactNode;                // edit-modal mount(s)
}
```

The scaffold renders the exact tree above, substituting props. `lang`, `bulk`, and the
`BulkEditBar`/`BulkEditPanel` wiring reproduce the current inline `onToggleOpen`/`onClear`
closures — callers pass the same closures they inline today, so no behavior shifts.

**`onApply` signature note:** the three panels' `applyBulk` all accept the bulk-patch
object emitted by `BulkEditPanel`. The plan's first task pins the exact shared type by
reading `BulkEditPanel`'s `onApply` prop and reusing it verbatim (do not invent a new
signature).

## Caller shape (change-panel example)

```tsx
return (
  <PanelTableScaffold
    paneRef={paneRef}
    containerRef={containerRef}
    view="changes"
    lang={lang}
    showHints={showHints}
    isPopout={isPopout}
    onLearnMore={onLearnMore}
    toolbar={toolbar}
    bulk={{
      count: sel.count,
      open: bulkOpen,
      onToggleOpen: () => setBulkOpen((o) => !o),
      onClear: () => { sel.clear(); setBulkOpen(false); },
      fields: bulkFields,
      onApply: applyBulk,
      onCancel: () => setBulkOpen(false),
    }}
    count={changes.length}
    empty={{ text: t(lang, "changeEmpty"), addLabel: `+ ${t(lang, "changesAdd")}…`, onAdd: openNew }}
    trailing={editModalMount}
  >
    <table className="min-w-full text-left text-sm">
      {/* unchanged thead + tbody */}
    </table>
  </PanelTableScaffold>
);
```

The `PanelFiltersProvider` export wrapper + `memo` wrap stay per-panel (defaults + Body
component differ; ~6L each, minimal). Only the render shell moves.

## Byte-identical guarantee

- Every `className` lives as a literal inside the scaffold, never a prop → identical DOM for all three panels.
- React `Fragment`/component boundaries add no DOM nodes.
- RAID and Stakeholders panels are in the axe `A11Y_VIEWS` gate; Change is eye-verified. The empty-state `aria-label` (RAID) is the only a11y-affecting attribute and is preserved via the `empty.ariaLabel` prop.

## Non-goals

- No toolbar unification (toolbars are more divergent — separate future slice).
- No generic column/row/sort/table engine (that is the deferred "full generic entity table," out of scope).
- No milestones/tasks inclusion (divergent class strings).
- No behavior, layout, i18n, or palette change of any kind.

## Testing

1. Existing panel tests (`change-panel`, `stakeholders-panel`, `raid-panel*`) + `raid-panel.characterization.test.tsx` must stay green **without edits** — proves behavior preserved.
2. New `panel-table-scaffold.test.tsx`: (a) `count===0` renders the dashed `<button>`, click fires `onAdd`; (b) `ariaLabel` applied when passed, absent otherwise; (c) `count>0` renders `children`, no empty button; (d) bulk bar toggle → `onToggleOpen`; (e) callout absent when `onLearnMore` undefined.
3. `npx tsc --noEmit` (0 errors), `npx eslint <touched> --max-warnings=0`.
4. `npx playwright test e2e/a11y.spec.ts --project=chromium -g "RAID"` and `-g "Stakeholder"` (both axe-scanned) — 3/3 green each (AIPM-light / AIPM-dark / mockup).
5. `npm run dup:check` — measure new tsx%; ratchet the gate down to match (update `package.json dup:check` + `.gitlab-ci.yml` comment + TD-6 register row).
6. `npm run size:check` — no file crosses 800; the 3 panels shrink.

## Rollout

Single MR. Order: create scaffold + its test → convert change-panel → convert
stakeholders-panel → convert raid-panel (each with full local verify) → measure dup,
ratchet gate + docs → final review → release (merge-on-green).

## Expected outcome

~120 shared shell lines collapse into one ~45-line component; the top
change↔stakeholders↔raid tsx clones vanish. tsx binding drops from ~1.72% toward ~1.6%,
gate 1.8 → ~1.65 — the first structural (not marginal) gate move of the TD-6 effort.
