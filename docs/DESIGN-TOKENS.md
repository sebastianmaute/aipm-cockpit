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

## Migration status (sub-project E)

- E0 (0.15.1): tokens + `segmented-control`, `modal`, `modal-header`, `app-header`. ✅
- E-sweep chunk 1 (0.15.2): resources-panel, resource-directory, resource-workload, resources-report, budget-panel. ✅
- Remaining: resource-calendar, all modals, and other area sweeps (tasks, RAID, gantt, reports, menus) are still pending.
