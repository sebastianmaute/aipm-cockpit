# AIPM Design Tokens & Color Rules

The single source of truth for color in lop-app. Every component uses ONLY the
semantic tokens and `--AIPM-*` brand utilities below — never raw `zinc-*` or hex.
Defined in `src/app/globals.css`.

## Brand palette (fixed in light & dark)

| Utility | Hex | Role |
|---|---|---|
| `AIPM-dark-grey` | #636362 | primary text (light) |
| `AIPM-dark-blue` | #004159 | fills (buttons), headers, section titles, table-headers |
| `AIPM-green` | #84BD00 | **dominant accent** — focus rings, active indicators, links, positive/done |
| `AIPM-light-grey` | #E3E6E6 | subtle bg / dividers / alt-rows |
| `AIPM-medium-grey` | #939598 | secondary text |
| `AIPM-blue` | #60C0DD | info / vacation / callouts / charts |
| `AIPM-pink` | #E5497C | errors / delete / alerts / overdue / critical |
| `AIPM-purple` | #AA4899 | warnings / medium-severity / holiday / differentiation |

## Semantic surface tokens (light / dark)

| Utility | Role | Light | Dark |
|---|---|---|---|
| `bg-background` | page bg | #FFFFFF | #0B0F12 |
| `text-foreground` | primary text | #636362 | #E3E6E6 |
| `bg-surface` | cards, panels, modals | #FFFFFF | #121619 |
| `bg-surface-muted` | alt rows, chips, hovers, subtle zones | #E3E6E6 | #1B2024 |
| `border-line` | borders, dividers | #E3E6E6 | #2B3137 |
| `text-muted-foreground` | secondary text | #939598 | #939598 |

The four dark neutrals are the ONLY non-palette values; they exist solely in
`globals.css` token definitions (the AIPM palette is light-oriented). Components
never reference them directly.

## Rules

- **Green accents, Dark Blue fills.** Solid fills (primary buttons, selected
  segmented-control pill) = `bg-AIPM-dark-blue text-white`. Green = focus rings,
  active/selected indicators, links, positive states.
- **No drop shadows, no gradients.** Remove every `shadow-*` and
  `bg-gradient`/`from-`/`via-`/`to-`. Use `border border-line` for separation.
- **Status mapping:** red→`AIPM-pink`, amber/warning/medium→`AIPM-purple`,
  info/vacation→`AIPM-blue`, holiday/differentiation→`AIPM-purple`,
  done/low→`AIPM-green`. Soft backgrounds use alpha tints (e.g. `bg-AIPM-pink/10`).

## Canonical recipes

- Primary button: `bg-AIPM-dark-blue text-white hover:bg-AIPM-dark-blue/90`
- Secondary button: `border border-line bg-surface text-foreground hover:bg-surface-muted`
- Destructive: text/border `AIPM-pink` (`text-AIPM-pink`, `border-AIPM-pink`, `hover:bg-AIPM-pink/10`)
- Focus ring: `focus:outline-none focus:ring-2 focus:ring-AIPM-green`
- Card / panel: `bg-surface border border-line`
- Table header: `bg-AIPM-dark-blue text-white`

## Calendar status colors

- Absence cells (with V/S/T/O glyph): vacation `AIPM-blue`, sick `AIPM-pink`, training `AIPM-purple`, other `AIPM-medium-grey` (alpha ~/30).
- Column shades: today `AIPM-green` wash, holiday `AIPM-purple` wash (fainter than the training cell), weekend `surface-muted`, normal `surface`.

## RAID category & severity colors

- **Categories (R/A/I/D)** — 4-state chips, all 4 palette hues: Risk=`AIPM-pink`, Action=`AIPM-blue`, Issue=`AIPM-purple`, Decision=`AIPM-green`. Chips render at `/15` alpha light, `/20` dark.
- **Severity ramp (Low→Critical)** — 4-step cold→hot: Low=`AIPM-green`, Medium=`AIPM-blue`, High=`AIPM-purple`, Critical=`AIPM-pink`. Alpha escalates with severity (`/20` Low/Medium → `/25` High → `/30` Critical).
- **RAG health dots (R/A/G)** — solid dots: R=`bg-AIPM-pink`, A=`bg-AIPM-purple`, G=`bg-AIPM-green` (same triple as the task-form-modal RAG indicator and the reports legend).

## RAG role tokens (dual-CI) — text-on-surface caveat

The dual-CI style system adds `--rag-red/amber/green` role tokens (+ `-text` AA companions) so RAG semantics switch across the Acme / Dashboard / Custom styles.

- ★ **`--rag-amber-text` is AA only on the LIGHT AIPM surface** — it maps to `AIPM-purple` (a brown under the Dashboard style). As **small text on `bg-surface`** it falls below WCAG AA on the dark and Dashboard styles (3.5:1 and 4.4:1). `--rag-red-text` / `--rag-green-text` pass.
- **Carry tier colour on a NON-text element** — a solid dot or a left stripe (`bg-[var(--rag-amber)]` / `border-l-[var(--rag-amber)]`), which are exempt from text-contrast rules — never as small tinted text. (This bit the Next-actions tier counts + hero eyebrow; both were moved to a dot/stripe.)

## Migration status (sub-project E)

- E0 (0.15.1): tokens + `segmented-control`, `modal`, `modal-header`, `app-header`. ✅
- E-sweep chunk 1 (0.15.2): resources-panel, resource-directory, resource-workload, resources-report, budget-panel. ✅
- E-sweep calendar (0.15.3): resource-calendar.tsx. ✅
- E-sweep modals (0.15.4): resource-edit, shift-edit, absence-edit, roles, budget-bucket, task-form, jira-conflicts, bulk-edit. ✅
- E-sweep tasks UI + inputs + reports (0.15.5): combo-input, contact-input, labels-input, dependencies-editor, task-manager-ui, tasks-section, reports, task-row. ✅
- E-sweep raid-panel (0.15.6): raid-panel.tsx. ✅
- E-sweep gantt (0.15.7): gantt.tsx. ✅
- E-sweep menus + chrome + misc (0.16.0 "Butler"): settings-menu, jira-settings, storage-config, export-menu, help-menu, version-menu, notifications, chat-panel, activity-log-panel, effort-progress-bar, error, markdown, page, voice-button, workspace-section, read-only-mirror-banner. ✅
✅ **Sub-project E complete (0.16.0 "Butler") — the AIPM design system now covers the whole app.**
