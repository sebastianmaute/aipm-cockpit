# AIPM Design Tokens & Color Rules

The single source of truth for color *roles* in aipm-cockpit. Every component uses ONLY the
semantic tokens and `--ui-*` brand utilities below — never raw `zinc-*` or a hex.

The token **names** are declared in `src/app/globals.css` (and mapped for Tailwind in its `@theme`
block). The token **values** come from the active colour scheme, applied at runtime as inline custom
properties by `use-style`'s `syncScheme` — the sole apply path. What is in `globals.css :root` is the
no-JS / pre-boot fallback only. So: rely on the role, never on a specific hex.

Four schemes ship built in (`builtin-schemes.ts`): **Harbor**, **Meridian** and **Umber**, each with a
light and a dark variant, and **Beacon**, which is light-only. ★★ `DEFAULT_SCHEME_ID` is **`beacon`**,
but the `globals.css :root` fallback below is **Harbor light** — so the pre-boot paint and the applied
default are deliberately different palettes. Do not read a hex in the table below as "what a fresh
install shows"; it is what shows before `syncScheme` runs, and nothing more.

> The brand tokens were renamed `--AIPM-*` → `--ui-*` in 0.190.23 (Release B). `AIPM` survives as the
> company/theme *name* and in asset classes (`AIPM-logo`), but no token carries that prefix.

> ★★★ **CORRECTED 2026-07-30 — this section described the pre-scheme world.** It previously listed eight
> tokens under the heading "Brand palette (**fixed** in light & dark)" with the historical AIPM hexes. Two
> things were wrong. **(1) Nothing is fixed.** Since the scheme work (0.182–0.184, then Release A in
> 0.190.22) the active *scheme* overrides every token at runtime via inline `setProperty`; `globals.css
> :root` is only the no-JS / pre-boot fallback, and it now holds **Harbor-light** values, not AIPM ones. Of
> those eight documented hexes, exactly **one** — `#636362` for `ui-dark-grey` — is still a live token
> value. Three (`#004159`, `#AA4899`, `#60C0DD`) are absent from the file entirely, and four (`#84BD00`,
> `#E5497C`, `#E3E6E6`, `#939598`) survive only inside explanatory comments *about* why the brand value
> was unusable, not as the value. **(2) Four tokens were missing** — the three `-strong` AA companions and
> `ui-white`, making the list 8 where the real base set is 12. What is stable is the **role**, not the
> value; read the table below as roles with an illustrative fallback, and never hard-code a hex.

## Base palette — 12 tokens

Hex shown is the `globals.css :root` fallback (Harbor light). The active scheme replaces it.

| Utility | Fallback | Role |
|---|---|---|
| `ui-dark-grey` | #636362 | primary text (light) |
| `ui-dark-blue` | #153a5c | fills (buttons), headers, section titles, table-headers |
| `ui-green` | #2bc4b6 | **dominant accent** — focus rings, active indicators, links, positive/done |
| `ui-white` | #ffffff | on-dark text, card fills |
| `ui-light-grey` | #c9d3dc | subtle bg / dividers / alt-rows |
| `ui-medium-grey` | #7d8a97 | secondary text; neutral dots/fills |
| `ui-blue` | #2f6f9e | info / vacation / callouts / charts |
| `ui-pink` | #c24a76 | errors / delete / alerts / overdue / critical |
| `ui-purple` | #5f57a8 | warnings / medium-severity / holiday / differentiation |
| `ui-green-strong` | #1a7870 | AA companion — green **text** on a light surface |
| `ui-pink-strong` | #a53f64 | AA companion — pink **text** on a light surface |
| `ui-purple-strong` | #514a8f | AA companion — purple **text** on a light purple tint |

### The `-strong` AA companions

The bright brand colours fail WCAG AA as small text on light surfaces (brand green is 2.26:1 on white;
`ui-pink` ~3.76:1; `ui-purple` on `bg-ui-purple/10` ~3.6:1). Each has a darker companion for **text only** —
the bright token still applies to fills, borders, and text on dark surfaces.

- ★ For a *user* scheme these are **derived** (`deriveAaVariants`), not authored; a scheme may also **pin**
  one, and a pinned value wins (`resolveSchemeColors` is base-wins).
- ★★ `--ui-purple-strong` is the one exception to how the others are derived: its reference is the purple
  tint **composited over** `--surface-muted` (the RAID "caused by" chips' hover state), not a plain surface,
  because no site puts that token on a plain surface. Deriving it against the card cleared AA there while
  still failing on hover. `scheme-purple-hover.test.ts` is the only coverage — the axe gate scans the
  resting state and never opens that modal.
- ★★ A `-strong` token is tuned to sit *at* AA, so **any alpha on it lands under**: `hover:text-…-strong/80`
  and a whole-element `hover:opacity-80` have both shipped as real contrast failures. Use a non-colour hover
  cue instead.
- ★ Swapping a bright token for its `-strong` companion is **not** automatically a win: in a light scheme
  with no pinned value the derivation can exit at zero iterations, making the swap a literal no-op.

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
  segmented-control pill) = `bg-ui-dark-blue text-white`. Green = focus rings,
  active/selected indicators, links, positive states.
- **No drop shadows, no gradients.** Remove every `shadow-*` and
  `bg-gradient`/`from-`/`via-`/`to-`. Use `border border-line` for separation.
- **Status mapping:** red→`ui-pink`, amber/warning/medium→`ui-purple`,
  info/vacation→`ui-blue`, holiday/differentiation→`ui-purple`,
  done/low→`ui-green`. Soft backgrounds use alpha tints (e.g. `bg-ui-pink/10`).
- **Chrome greys via semantic tokens only.** `bg`/`border`/`divide-ui-light-grey`
  and `text-ui-dark-grey` are BANNED (`palette-chrome-sweep` guard) — use
  `bg-surface-muted`/`border-line` for zones/dividers, `bg-ui-medium-grey` for a
  solid grey, `text-muted-foreground` for secondary text. The palette guards scan
  comments too, so a bare `shadow`/grey word in a comment can trip them.

- **`INTERACTIVE` is not universal — it bundles `PRESS`.** `INTERACTIVE` =
  `TRANSITION` + `FOCUS_RING` + `PRESS`, and `PRESS` is `active:translate-y-px`.
  That writes the SAME `--tw-translate-y` custom property as any positioning
  translate, so a control centred with `-translate-y-1/2` visibly jumps out of
  centre while pressed. An absolutely-positioned control takes
  `${FOCUS_RING} ${TRANSITION}` only — the same reason form fields never take
  `PRESS`.
- **Icon-only controls need a 24px target.** WCAG 2.2 SC 2.5.8 sets a 24×24 CSS
  px floor, and axe does **not** check it, so it slips the gate. A 14px icon with
  `p-0.5` is ~20px and fails; give the button `flex h-6 w-6 items-center
  justify-center` and size the icon inside it.
- **A floating surface must not reuse a pane's control label.** The Help window
  and the modals float over a pane whose own reset button is always present, so
  reusing `tableResetSizeHint` puts two identically-named buttons on screen doing
  different things (WCAG 2.4.6). Use `modalResetSize` there. axe passes this — a
  name exists — so it is caught by eye or not at all.

## Canonical recipes

- Primary button: `bg-ui-dark-blue text-white hover:bg-ui-dark-blue/90`
- Secondary button: `border border-line bg-surface text-foreground hover:bg-surface-muted`
- Destructive: text/border `ui-pink` (`text-ui-pink`, `border-ui-pink`, `hover:bg-ui-pink/10`)
- Focus ring: `focus:outline-none focus:ring-2 focus:ring-ui-green`
- Card / panel: `bg-surface border border-line`
- Table header: `bg-ui-dark-blue text-white`

## Calendar status colors

- Absence cells (with V/S/T/O glyph): vacation `ui-blue`, sick `ui-pink`, training `ui-purple`, other `ui-medium-grey` (alpha ~/30).
- Column shades: today `ui-green` wash, holiday `ui-purple` wash (fainter than the training cell), weekend `surface-muted`, normal `surface`.

## RAID category & severity colors

- **Categories (R/A/I/D)** — 4-state chips, all 4 palette hues: Risk=`ui-pink`, Action=`ui-blue`, Issue=`ui-purple`, Decision=`ui-green`. Chips render at `/15` alpha light, `/20` dark.
- **Severity ramp (Low→Critical)** — 4-step cold→hot: Low=`ui-green`, Medium=`ui-blue`, High=`ui-purple`, Critical=`ui-pink`. Alpha escalates with severity (`/20` Low/Medium → `/25` High → `/30` Critical).
- **RAG health dots (R/A/G)** — solid dots: R=`bg-ui-pink`, A=`bg-ui-purple`, G=`bg-ui-green` (same triple as the task-form-modal RAG indicator and the reports legend).

## RAG role tokens — text-on-surface caveat

`--rag-red/amber/green` (+ their `-text` AA companions) carry RAG semantics as their own role family, so
a scheme can move them without moving the brand hues.

★★★ The two named styles this section used to describe — "Acme" and "Dashboard" — **no longer
exist in the app in any form**; a theme is a file the user loads, and the built-ins are the four schemes
named at the top of this file. `data-style` is the constant `"custom"`. The measured numbers below were
taken against those retired styles and are kept only because the RULE they support is unchanged; do not
quote the ratios as current, and re-measure against the scheme you are actually shipping on.

- ★ **`--rag-amber-text` was AA on a light surface and below it on a dark one** — as **small text on
  `bg-surface`** it measured 3.5:1 and 4.4:1 on the two styles that then existed. `--rag-red-text` /
  `--rag-green-text` passed.
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
