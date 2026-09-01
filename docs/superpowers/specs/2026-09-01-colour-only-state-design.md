# Colour-only state and the pink text token — design

**Roadmap slice 7.** Closes `docs/open-followups.md` §55, §56, §101 and §325.

**Goal.** Every control that signals an on/selected state does so through a channel that is not
hue, and every state indicator clears the contrast floor its own success criterion sets — in all
seven built-in scheme combos and in user-imported themes.

**Architecture.** Three mechanisms, one per criterion, plus one app-wide motion fix. They are
deliberately not unified: the failures do not share a cause, and a single mechanism would either
destroy meaning (hue carries information at the RAG and RACI sites) or leave a criterion open.

**Tech.** No new dependencies. The contrast arithmetic already exists in `scheme-tokens.ts`
(`relLuminance`, `hexToRgb`, `nudgeToAa`, `deriveAaVariants`) and is already unit-tested by
`scheme-tokens.test.ts`, `scheme-contrast-cues.test.ts` and `scheme-purple-hover.test.ts`.

---

## 1. What was measured, and why the roadmap's assumption was wrong

Every number below is computed from `src/app/builtin-schemes.ts` through the repo's own
`relLuminance` / `deriveAaVariants`, not eyeballed and not from a parallel implementation. jsdom
has no layout and no colour, but that is irrelevant here: these are token values, so they are
computable in a unit test, and three existing test files already do exactly this. **The tables below
are not yet pinned by any test — Task 1 of the plan makes them so. Until then they are a
measurement, not a guarantee.**

The roadmap brief for this slice stated that the light schemes conform and "the DARK maps are the
actual failure". That holds for `ToggleButton`'s border pair and for nothing else.

### 1.1 §56 — `ToggleButton` pressed border, `--ui-dark-blue` vs `--line`

| harbor-L | harbor-D | meridian-L | meridian-D | umber-L | umber-D | beacon-L |
|---|---|---|---|---|---|---|
| 8.97 | **1.22** | 7.71 | **1.16** | 9.30 | **1.03** | 10.22 |

Reproduces the register table exactly. Dark-only, as filed. Floor is 3:1 (SC 1.4.11).

### 1.2 §101 — `SegmentedControl` active fill vs track

| harbor-L | harbor-D | meridian-L | meridian-D | umber-L | umber-D | beacon-L |
|---|---|---|---|---|---|---|
| 10.42 | **2.38** | 8.73 | **2.43** | 10.54 | **2.25** | **1.13** |

The three dark figures reproduce the register. **beacon-light at 1.13:1 is not in the register at
all**, and it is the worst measurement in the app — `--segment-active-bg` `#ffffff` on
`--segment-track-bg` `#eef1f3`. Beacon is `DEFAULT_SCHEME_ID`, what a fresh install runs. §101's
table has six rows and asserts "the light schemes pass on lightness alone", which is true of the
three it measured and false for the one it omitted.

The component's apparent second cue is inert: the selected segment carries
`shadow-[var(--shadow-control)]`, `globals.css` sets `--shadow-control: none`, and
`grep -c "shadow-control" src/app/builtin-schemes.ts` returns 0 — no scheme overrides it.

### 1.3 §325 — raw `--ui-pink` as text

Against `--surface-muted`, the card background — and the background `deriveAaVariants` itself
derives the `-strong` variants against, precisely because it is the harder of the two:

| harbor-L | harbor-D | meridian-L | meridian-D | umber-L | umber-D | beacon-L |
|---|---|---|---|---|---|---|
| **4.12** | 6.24 | **4.16** | 5.76 | **4.41** | 5.74 | **3.04** |

Floor is 4.5:1 (SC 1.4.3). **All four light schemes fail**, not only beacon. The register records a
single beacon measurement of 3.83:1 against `--surface`; this widens it by three schemes and one
background. In the dark schemes `nudgeToAa` returns the base unchanged, so `--ui-pink-strong` and
`--ui-pink` are the same colour there and the fix is a visual no-op in dark mode.

### 1.4 §55 — the twelve hand-rolled toggles, adjudicated individually

Floor 3:1 for a lightness difference to count as the additional non-colour distinction that
Understanding SC 1.4.1 allows.

| Site | State signal | Measured | Verdict |
|---|---|---|---|
| `create-project-wizard` (2 buttons) | `border-ui-green` vs `border-line`, 10% tint | 1.53–1.88 light / 4.96–6.90 dark; tint 1.08–1.22 everywhere | **fails, LIGHT schemes** |
| `task-form-fields` health chips | `border-[--rag-*]` vs `--line` | red 3.08–4.44 · amber 1.34–2.34 light · green 2.47–2.96 light | **amber + green fail, LIGHT** |
| `knowledge-panel` | fill `--ui-dark-blue` vs `--surface-muted` | 8.73–10.54 light / 1.01–1.17 dark | **fails, dark** |
| `raci-chip-picker` R | fill `--ui-dark-blue` vs `--surface` | 9.93–12.84 light / 1.10–1.31 dark | **fails, dark** |
| `raci-chip-picker` I | fill `--ui-dark-grey` vs `--surface` | 6.01 light / 2.70–2.84 dark | **fails, dark** |
| `raci-chip-picker` A, C | fill `--ui-green-strong` / `--ui-purple` | A 5.30–8.80 · C 3.33–6.15 | conforms |
| `comm-templates-section` (2 buttons) | fill `--ui-dark-blue` vs `--surface` | as raci R | **fails, dark** |
| `voice-button` | 15/20% pink tint + `animate-pulse` | 1.21–1.42 **all seven** | **fails everywhere** |
| `dictation-mic` | icon `--ui-green-strong` vs `--muted-foreground` | 3.08 harbor-L only; 1.20–2.72 elsewhere | **fails, 6 of 7** |
| `step0-import-panel` | same border as wizard, **plus `font-medium` and a text-colour change** | border as wizard | conforms — weight is not a colour channel |
| `task-form-fields` "none" chip | `--ui-dark-blue`, `dark:--ui-blue` vs `--line` | 8.97–10.22 light / 4.22–4.58 dark | conforms |
| `influence-interest-matrix` | `ring-2 ring-ui-green` **and** a `●` glyph | — | conforms |

Three of the twelve already conform. Two fail only in the light schemes. A blanket migration would
have edited conformant code and mis-stated the cause; this is the trap the roadmap brief warned
about, landing in the opposite direction from the one it predicted.

---

## 2. Mechanism 1 — the shape marker (SC 1.4.1)

Hue carries meaning at the failing sites: RAG red/amber/green *is* the health value, RACI
colours *are* the role. A token swap would destroy that information. A shape whose presence or
absence signals state is hue-independent and survives any scheme, including user-imported ones.

`ToggleButton` already implements exactly this: a trailing `data-pressed-marker` check glyph,
**always rendered** and merely `invisible` when off so the button keeps one width — conditional
rendering would shift neighbouring controls under the pointer on every click. The glyph carries its
own explicit `aria-hidden`, because lucide only defaults that when an icon has no children and no
a11y prop, and `aria-pressed` already tells assistive technology the state.

**Nine call sites adopt `ToggleButton`**: `create-project-wizard` ×2, `task-form-fields` health chips
(amber and green fail; all three adopt so the row stays visually uniform), `knowledge-panel`,
`raci-chip-picker` R and I (A and C adopt too, same uniformity argument within one picker),
`comm-templates-section` ×2, `voice-button`, `dictation-mic`.

**Three sites are not touched**: `step0-import-panel`, `task-form-fields`' "none" chip, and
`influence-interest-matrix`. Each already carries a non-colour cue. Editing them would be a change
with no defect behind it.

`SegmentedControl` gets the same marker on its selected segment, painted in
`--segment-active-fg`. That token is the right one and the obvious alternative is wrong: measured
against the *track*, `--segment-active-fg` scores 1.01–1.14 in the light schemes, but the marker is
drawn on the selected segment and is adjacent to that segment's own fill, where
`--segment-active-fg` vs `--segment-active-bg` measures **5.40–11.72 across all seven combos**.
Presence-vs-absence closes 1.4.1; the ≥5.40:1 against its own background closes 1.4.11 for the
indicator. §101 therefore needs no new token.

**`dictation-mic` note.** It returns `{ mic, status, ... }` as separate nodes, so the "Listening"
text that would otherwise be a sufficient cue is rendered at the consumer's discretion and is not
guaranteed to sit beside the button. The marker makes the control self-sufficient regardless of how
a consumer arranges the pieces.

**`voice-button` note.** Icon-only, and its tint is not a cue at 1.21–1.42:1 — the pulse is doing
all the work today. It adopts the marker, and its `animate-pulse` is demoted to decoration under
`motion-safe:` (see §5), so no accessibility-relevant state rides on motion.

---

## 3. Mechanism 2 — derived `--control-state-border` (SC 1.4.11)

§56 is explicitly **not** the 1.4.1 problem 0.212.0 fixed; the entry says the check glyph "only
masks it". SC 1.4.11 requires 3:1 for visual information identifying components **and states** —
"states" is normative. At 1.03:1 the pressed border is invisible to every user, not only to users
with a colour-vision deficiency.

**`ToggleButton` has TWO accents, and §56 measured only one.** `ToggleAccent` is
`"dark-blue" | "pink"`, and the entry's table covers the dark-blue border alone. Measured, pressed
border vs unpressed `--line`:

| accent | harbor-L | harbor-D | meridian-L | meridian-D | umber-L | umber-D | beacon-L |
|---|---|---|---|---|---|---|---|
| `dark-blue` | 8.97 | **1.22** | 7.71 | **1.16** | 9.30 | **1.03** | 10.22 |
| `pink` | 3.55 | 5.08 | 3.68 | 4.74 | 3.89 | 5.03 | 3.04 |

The pink accent conforms in all seven combos, so §56's defect is real but narrower than the entry
implies — it is the `dark-blue` accent only. `gantt-view-menu.tsx:148` is its one `accent="pink"`
consumer today.

Generalise the existing helper:

- `nudgeToContrast(base, bg, target, lighten?)` — the current `nudgeToAa` body with the hardcoded
  `4.5` replaced by `target`.
- `nudgeToAa(base, bg, lighten?)` becomes `nudgeToContrast(base, bg, 4.5, lighten)`, preserving
  every existing caller and the mode-aware `lighten` override with its documented reasoning.
- `deriveAaVariants` gains **one derived token per accent**:
  `--control-state-border` from `--ui-dark-blue` and `--control-state-border-pink` from
  `--ui-pink`, each `nudgeToContrast(base, colors["--line"], 3.0)`.

`ToggleButton` consumes them in place of the literal accent borders, one per `ToggleAccent` member.

**Deriving the pink accent is deliberate even though it currently passes.** The nudge exits on its
first condition check and returns the base unchanged, so there is no visual change and no cost —
but beacon's 3.04 clears the floor by 0.04, and both `--ui-pink` and `--line` are user-editable, so
a custom scheme can drop it under 3:1 with nothing to catch it. Deriving both accents makes the
floor structural rather than a property of today's built-in values.

**The light schemes do not move.** They already measure 8.97–10.22, so the loop exits on its first
condition check and returns the base unchanged. Only the three dark maps change. This honours §56's
prescription that the fix belongs at the scheme layer rather than in the component, while covering
user-imported themes — which a hand-edited built-in map cannot.

`--control-state-border` is added to the derived-token list in `color-schemes.ts` alongside
`--ui-green-strong` / `--ui-pink-strong` / `--ui-purple-strong`, and to `globals.css` with a
static fallback for the pre-hydration paint.

---

## 4. Mechanism 3 — `--ui-pink-strong` at the text sites (SC 1.4.3)

The inventory grep returns **13 lines, 12 candidate sites, 10 files**. The thirteenth is a comment
in `type-to-confirm-dialog.tsx` quoting the token to explain why the strong variant is used there —
the detector matches the note documenting the fix. Reproduce:

```
grep -rn "text-ui-pink[^-]" src/app --include=*.tsx | grep -v "\.test\.tsx:"
```

**Six real-text sites** move to `text-ui-pink-strong`: `document-block-notices`,
`documents-asset-section` (×2), `documents-deleted-section`, `documents-panel`, and the destructive
menu item in `document-block-gutter`.

**Six `hover:text-ui-pink` glyph sites are not a contrast defect.** Against the 3:1 non-text floor
they pass in every combo, worst case 3.04 on beacon. What they are is primitive non-adoption:
`icon-button.tsx` already ships `danger: "text-muted-foreground hover:bg-ui-pink/10
hover:text-ui-pink-strong"` — exactly what these six hand-roll. They adopt `IconButton` for that
reason, and the spec records that the reason is consistency, not contrast, so a later reader does
not infer a measurement that was never taken.

---

## 5. Reduced motion (SC 2.2.2, and protecting mechanism 1)

`grep -n prefers-reduced-motion src/app/globals.css` returns nothing: the app honours reduced
motion nowhere. Two files animate — `skeleton.tsx` and `voice-button.tsx`.

`globals.css` gains a `@media (prefers-reduced-motion: reduce)` block that stills both. Because
mechanism 1 gives `voice-button` a shape cue, removing its motion costs no state information — the
ordering matters, and doing the motion fix without the marker would have made the control's state
undetectable for reduced-motion users.

This is a fourth criterion in the slice and is included deliberately: the same edit that makes the
pulse decorative is the one that makes it safe to suppress.

---

## 6. Files

**Modified — token layer**
- `src/app/scheme-tokens.ts` — `nudgeToContrast`; `--control-state-border` and
  `--control-state-border-pink` in `deriveAaVariants`
- `src/app/color-schemes.ts` — both new tokens added to the derived-token list
- `src/app/globals.css` — static fallbacks for both tokens (pre-hydration paint), reduced-motion
  block

**Modified — primitives**
- `src/app/toggle-button.tsx` — consume `--control-state-border`; correct the header comment, which
  claims the pressed state "is visible at a glance" and is measurably false in the dark schemes
- `src/app/segmented-control.tsx` — selected-segment marker

**Modified — call sites**
- `create-project-wizard.tsx` · `task-form-fields.tsx` · `task-health-chip-style.ts` ·
  `knowledge-panel.tsx` · `raci-chip-picker.tsx` ·
  `settings-sections/comm-templates-section.tsx` · `voice-button.tsx` · `dictation-mic.tsx`
- `document-block-notices.tsx` · `documents-asset-section.tsx` · `documents-deleted-section.tsx` ·
  `documents-panel.tsx` · `document-block-gutter.tsx` — pink text
- `history-panel.tsx` · `labels-input.tsx` · `project-form-fields.tsx` ·
  `settings-sections/removable-chip-row.tsx` · `stakeholder-recipient-input.tsx` — `IconButton`
  `danger` adoption

**Created**
- `src/app/scheme-state-contrast.test.ts` — the contrast floors, computed over every built-in combo

**Not touched, and the spec says so on purpose**: `step0-import-panel.tsx`,
`influence-interest-matrix.tsx`, and `task-form-fields`' "none" chip.

---

## 7. Testing

1. **`scheme-state-contrast.test.ts`** — generalised over `BUILTIN_SCHEMES` rather than naming
   schemes, so a new built-in is covered without being added: **both** `--control-state-border` and
   `--control-state-border-pink` vs `--line` ≥ 3:1; `--segment-active-fg` vs `--segment-active-bg`
   ≥ 3:1; `--ui-pink-strong` vs `--surface-muted` ≥ 4.5:1. Each assertion must be mutation-proved —
   lowering the derived target to 1.0 has to turn the border assertions red, and a variant must pass
   unmutated first. ★ The pink-accent assertion is the one at risk of being vacuous: it passes today
   against the *underived* token too, so its mutant must be the derivation itself, not the value.
2. **Per-site marker pins** — each migrated site renders the marker when on and keeps it in the DOM
   when off, since an always-rendered `invisible` marker is what holds the width stable. A test
   asserting only the on state passes against a conditional-render regression.
3. **Reduced motion** — assert the media block exists and names both animating selectors. This is a
   source-level assertion, and the spec records that limitation: jsdom does not evaluate media
   queries, so nothing here proves the browser stills the animation.
4. **Existing suites** — `toggle-button.test.tsx`, `segmented-control.test.tsx`,
   `scheme-tokens.test.ts` and the three call-site suites must stay green.

**What no gate can catch.** axe 4.12.1's only `wcag141` rule is `link-in-text-block`; nothing in axe
evaluates whether a control's state is colour-only, at any scheme count or seed size. The unit tests
above are the only detector this work will ever have. An eye-verify of the migrated controls in a
dark scheme and in beacon is owed and is not substitutable by any gate.

---

## 8. Out of scope, and filed instead

- **§302** — already CLOSED 2026-08-31 by slice 3, whose entry states "slice 7 must not re-close
  it". Re-closing it would be a multi-place edit against a closed entry.
- **`aria-pressed` vs `role="radio"`** — six of the twelve sites are mutually-exclusive choices
  modelled as independent toggles (`create-project-wizard`, `step0-import-panel`,
  `task-form-fields`, `raci-chip-picker`, `knowledge-panel`, `influence-interest-matrix`), so a
  screen reader hears six of seven options as "not pressed" rather than one as "checked". That is
  SC 4.1.2, a different criterion, and converting them changes keyboard interaction on six
  surfaces. New register entry.
- **The app-wide reduced-motion gap beyond the two animating files** — the media block added here
  covers what exists today; a policy for future animation is a separate concern.
- **Register amendments** (not new entries): §101 gains its missing beacon-light row and loses the
  claim that the light schemes all pass; §325 widens from one beacon measurement to all four light
  schemes against `--surface-muted`.

### Register bookkeeping

Max on `origin/main` is **328**. A concurrent slice (export fidelity) is filing at the same time, so
the pair is split by agreement: **that slice takes 329–330, this one takes 331–332.**

★★★ **A number is reserved only once it is on `origin/main`** — two branches have minted the same
one before. Whoever merges second re-checks and renumbers rather than assuming:

```
grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | tail -1
```

★★ **`docs/open-followups.md` is edited by both slices, and that merge is the hazard, not the
source tree.** Taking one side wholesale in a conflict resolution loses the other branch's entries
with every gate still green; `--cc` cannot see it, because it is a census of invented content and is
blind to a resolution that took one side whole. Adjudicate the summary table PER ROW, and diff
against this branch's own tip afterwards, not only against the merge base.

★★ The register is INSIDE `doc-claims-check` (`SKIP_DIRS` in `scripts/doc-claims-lib.mjs` is
`["docs/superpowers"]`, so this spec is exempt and the register is not). Register edits cite symbols
and reproduce commands, never `path:LINE` — the gate is a ratchet, and a new citation fails it.
