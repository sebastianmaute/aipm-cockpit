"use client";
import { useCallback, useId, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { PopoverPanel } from "./popover-panel";
import { RACI_ROLES, type RaciRole } from "./types";
import { XMarkIcon } from "./icons";

interface RaciChipPickerProps {
  value: RaciRole | "";
  onChange: (role: RaciRole | "") => void;
  /** "{milestone} · {stakeholder}" context for the accessible label. */
  ariaPrefix: string;
  lang: Lang;
}

// Brand color per role (filled when active, outlined when inactive).
const CHIP: Record<RaciRole, { on: string; off: string }> = {
  R: { on: "bg-ui-dark-blue text-white border-ui-dark-blue", off: "border-ui-dark-blue text-foreground" },
  A: { on: "bg-ui-green-strong text-white border-ui-green-strong", off: "border-ui-green-strong text-foreground" },
  C: { on: "bg-ui-purple text-white border-ui-purple", off: "border-ui-purple text-foreground" },
  I: { on: "bg-ui-dark-grey text-white border-ui-dark-grey", off: "border-ui-dark-grey text-foreground" },
};

export const ROLE_LABEL_KEY: Record<RaciRole, Parameters<typeof t>[1]> = {
  R: "raciRoleResponsible",
  A: "raciRoleAccountable",
  C: "raciRoleConsulted",
  I: "raciRoleInformed",
};

const CHIP_BASE =
  "flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-semibold leading-none transition-colors focus:outline-none focus:ring-2 focus:ring-ui-green";

// ★★★ SC 1.4.1 — the SELECTED chip is marked by a RING (a shape cue), never by
// the brand fill alone. Measured against `--surface` across the seven built-in
// scheme combos, the fill fails 1.4.11's 3:1 floor in the dark schemes: R is
// 1.10-1.31:1 and I is 2.70-2.84:1, so the selected chip is indistinguishable
// from an unselected one for EVERY user, not only users with a colour-vision
// deficiency. A (5.30-8.80) and C (3.33-6.15) clear it everywhere and carry the
// ring anyway — a picker where two chips have a cue and two do not is worse
// than either consistent state.
//
// ★★★ THE RING IS A NEUTRAL, AND `ring-offset-2` IS LOAD-BEARING RATHER THAN
// DECORATIVE — do NOT "simplify" it away. A ring in the chip's OWN role hue
// would be exactly as invisible as the fill it supplements: R's token IS
// `--ui-dark-blue`, the colour measuring 1.10:1. And no colour whatsoever can
// rescue a no-offset design. A luminance scan over the whole 0..1 range puts
// the best achievable min-ratio against {`--surface`, R, A, C, I} at 1.90-2.54
// depending on the combo, so NOTHING clears 3:1 against the surface AND all
// four fills — not any scheme token, not pure white, not pure black. That is
// structural rather than incidental: `deriveAaVariants` derives
// `--ui-green-strong` to a mid luminance that clears AA against the surface,
// which is precisely the band leaving no room for a third colour. The offset is
// what makes a neutral legitimate — it lays a 2px band of `--surface` between
// the fill and the ring, so the ring is adjacent to `--surface` on BOTH sides
// and never touches the fill, and `--foreground` is >= 5.94:1 against
// `--surface` in all seven combos (13.64-17.16 in six of them).
//
// ★★ Applied at the four selectable chips and deliberately NOT folded into
// `CHIP[role].on`: the collapsed trigger renders the current value with nothing
// beside it to contrast against, and `RaciLegend` uses `.on` for all four at
// once — ringing a static key would mark every entry as selected.
//
// ★ A `ToggleButton` migration was implemented and measured first, to gain that
// primitive's non-colour `data-pressed-marker` glyph, and was REVERTED by user
// decision: a 20px circle cannot hold a 14px marker plus its gap plus the
// letter, so it forced the chips into ~48x26px stadium pills and grew this
// unclamped popover by ~116px. The ring buys the same non-colour cue for ~20px
// (the arithmetic is at the popover's own `gap-2`/`p-1.5` comment below).
//
// ★★★ `focus:ring-[var(--foreground)]` IS NOT DECORATIVE EITHER. `CHIP_BASE`
// carries `focus:ring-ui-green`, and both utilities set the SAME custom
// property (`--tw-ring-color`); the `focus:` variant compiles to a
// higher-specificity selector (class + pseudo-class), so WHILE THE SELECTED
// CHIP HAS FOCUS its neutral ring turned green — near-indistinguishable from a
// focused UNSELECTED chip, which carries that same green ring and differs only
// by the offset. That is precisely the state a keyboard user is in the whole
// time they arrow through R/A/C/I, i.e. the exact user this cue was built for.
// Re-stating the neutral under `focus:` keeps it through focus, and the ring is
// still plainly visible (ring-2 plus the 2px `--surface` offset).
// ★ No unit test can see the cascade resolution itself — jsdom has no cascade —
// so the test only pins that the class is PRESENT.
const SELECTED_RING =
  "ring-2 ring-[var(--foreground)] focus:ring-[var(--foreground)] ring-offset-2 ring-offset-[var(--surface)]";

export function RaciChipPicker({ value, onChange, ariaPrefix, lang }: RaciChipPickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  // ★★ MUST be stable — `PopoverPanel` documents that an unstable `onClose`
  // re-subscribes its listeners on every render.
  const close = useCallback(() => setOpen(false), []);

  const pick = (role: RaciRole | "") => {
    setOpen(false);
    onChange(role);
  };

  const triggerLabel = value === "" ? t(lang, "raciSetLabel") : t(lang, ROLE_LABEL_KEY[value]);

  return (
    <span className="relative inline-flex items-center">
      {/* ★★ `aria-haspopup` is `"dialog"`, NOT `"true"` — ARIA defines the bare
          `"true"` as equivalent to `"menu"`, so it would contradict the panel's
          own `role="dialog"` below. Every other `role="dialog"` PopoverPanel
          trigger in the app spells it out the same way; enumerate them with
          `grep -rn "aria-haspopup" src/app --include=*.tsx | grep -v test`. */}
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`${ariaPrefix} — ${triggerLabel}`}
        title={t(lang, "raciSetHint")}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={`${CHIP_BASE} ${
          value === "" ? "border-dashed border-line text-muted-foreground hover:bg-surface-muted" : CHIP[value].on
        }`}
      >
        {value === "" ? "+" : value}
      </button>
      {/* ★★★ §334. This popover was a hand-rolled `createPortal` span placed by
          an inline `left` taken from the trigger's rect, with NO viewport clamp
          of any kind — and MEASURED in Chromium it overflowed the RIGHT edge at
          EVERY width sampled from 1280px down to 520px: over by ~9px at 1280 (an
          ordinary desktop, not an edge case) and by ~76px at 520. Adopting
          `PopoverPanel` buys the clamp and changes AT LEAST three behaviours.
          None is a regression, but do not read any of them as untouched. The
          three that needed judgement:

          1. ALIGNMENT. `bottom-end` right-aligns the panel to the trigger, then
             clamps its LEFT edge back inside the viewport margin post-paint. The
             old code left-aligned and clamped nothing, which IS the defect.
          2. THE FLIP. The panel now moves ABOVE the trigger when less than the
             primitive's minimum space remains beneath it. ★ UNMEASURED rather
             than verified-fine: the probe covered only the matrix's TOP row at a
             900px viewport, where 599-645px sit below the trigger, so the flip
             cannot fire there at all. Lower rows at a short viewport were never
             exercised.
          3. TAB. `PopoverPanel` registers `kind: "modal"` (this file used
             `kind: "layer"`) and traps Tab, so the five chips become reachable.
             ★★★ Do NOT restate the intuition this replaced — that the old portal
             "let Tab walk OUT into the matrix". It did not walk IN either:
             `createPortal` appends to the END of `<body>`, so tab order was
             divorced from visual position. MEASURED: focus stayed on the trigger
             after the click, the next Tab went to the NEXT ROW's trigger, and
             across a 40-press trace the first press landing inside the popover
             was the 16th — after all 21 matrix triggers had been walked.

          ★★★ NO TOTAL IS STATED, DELIBERATELY, AND RESTORING ONE IS A
          REGRESSION. Two successive revisions here gave a count — first
          "changes three behaviours ... do not read any of the three as
          untouched", then "FOUR more ride along" — and BOTH were bounds
          narrower than the fix. That is the dangerous direction: narrowing
          reads as tightening, and every test passes either way. The second was
          written as the correction FOR the first, closed with "enumerated
          against `popover-panel.tsx` itself", and still missed the item below.
          The three above are the ones that needed judgement; these ride along,
          and the list is not promised to be complete.

          ★★★ ARMING — the strongest thing the adoption bought, and the one both
          counts missed. This file registered its scroll and resize listeners
          INSIDE the measure effect, so they were live while the panel was still
          gated behind `open && pos` — before it had ever been in the DOM. That
          is exactly the pre-§124 shape the primitive's own comment documents as
          having shipped a real defect; the primitive arms on `rendered`
          instead. ★★ NOT a generic ride-along for THIS consumer: `raci-panel`
          puts the matrix in an `overflow-auto` container with one column per
          visible stakeholder, so it scrolls once there are enough. Clicking a
          partially-visible trigger makes the browser scroll the container to
          reveal it, and that scroll dispatches AFTER the click handler and its
          effects — landing on the just-registered listener, closing a panel
          that never rendered, `aria-expanded` straight back to false. ★ Read
          that as LATENT and now foreclosed, not as a reproduced bug: the shape
          matches §124 exactly, but nobody drove it in a browser here.

          Also: outside-dismiss moved to the primitive's pointer event;
          close-on-resize narrowed to a width change only, so a mobile keyboard
          no longer dismisses; close-on-scroll narrowed to ignore scrolls
          originating inside the panel, where this file closed on every scroll;
          and the panel gained the §297 focus restore on unmount plus Escape
          restoring focus before it closes, neither of which this file had.
          ★ Phrased against the primitive's BEHAVIOUR rather than its constant
          names and event spellings on purpose — a verbatim restatement here
          goes silently false the day the primitive changes, and `popover-panel`
          already states each of these where it can be kept true.

          ★★★ `role` IS REQUIRED HERE, and an earlier revision omitted it while
          still passing `ariaLabel` — which made the name INERT. A bare `<span>`
          maps to `role=generic`, ARIA 1.2 prohibits naming a generic, so the
          milestone-and-stakeholder context was computed, threaded down, and
          then dropped by AT: announced to nobody. This was the only
          `PopoverPanel` call site passing a name without a role.
          ★★ NOT `menu`, which is the other role the primitive accepts: these
          five children are `aria-pressed` buttons rather than menuitems, and a
          menu without menuitem children is an axe `aria-required-children`
          violation. `dialog` is TRUTHFUL rather than a shim chosen to satisfy
          the naming rule — the panel registers on the dismissal stack as a
          modal and genuinely traps Tab, which is what a dialog is.
          ★★ No gate could have caught the omission: axe's
          `aria-prohibited-attr` classes a role-less span as INCOMPLETE rather
          than a violation, `e2e/a11y.spec.ts` filters violations, and RACI is
          not in `A11Y_VIEWS` at all. The unit test is the only detector.
          ★ `autoFocus` is left at the primitive's DEFAULT; the test file carries
          why passing `false` here would be actively worse, not merely different.
          ★★ THE NAME IS THE COORDINATES PLUS WHAT THE DIALOG IS FOR. `ariaPrefix`
          alone ("M1 · Ada") only repeats what the trigger has just announced and
          never says what opened — so the panel is named
          `${ariaPrefix} — raciSetLabel`. ★ That key already exists in BOTH
          dictionaries ("Set RACI" / "RACI setzen"); do not mint one for this.
          ★ It duplicates the TRIGGER's name only in the unset state, where the
          trigger's own label is already `raciSetLabel` — a set chip reads
          "M1 · Ada — Accountable" against the panel's "M1 · Ada — Set RACI". */}
      {/* ★★ `gap-2`/`p-1.5` below are sized for SELECTED_RING, not chosen for
          looks. The ring extends 4px past the 20px chip (2px offset + 2px
          ring), so the former `gap-1`/`p-1` (4px each) left ZERO clearance —
          the ring landed exactly on the neighbouring chip's border and on this
          popover's own. Only one chip is ringed at a time, so 8px of gap gives
          4px of clearance and 6px of padding gives 2px.
          ★★ COUNT THE CHILDREN, NOT THE ROLES: this row holds FIVE of them —
          `RACI_ROLES.map` gives four, plus the clear chip below, "the 5th of
          five chips" its own comment calls it — so five children make FOUR
          gaps, not three. The cost is 4px x 4 gaps + 2px x 2 padding edges =
          ~20px of popover width. An earlier revision said ~16px, having
          counted the gaps BETWEEN the four role chips and forgotten that the
          clear chip adds one more.
          ★ `rounded-md border border-line bg-surface` are NOT repeated here —
          `PopoverPanel` supplies them, along with `fixed z-[100]`. */}
      <PopoverPanel
        open={open}
        anchorRef={triggerRef}
        onClose={close}
        id={panelId}
        role="dialog"
        ariaLabel={`${ariaPrefix} — ${t(lang, "raciSetLabel")}`}
        className="flex w-max items-center gap-2 p-1.5 shadow-[var(--shadow-control)]"
      >
        {RACI_ROLES.map((role) => {
          const c = CHIP[role];
          return (
            <button
              key={role}
              type="button"
              aria-pressed={value === role}
              aria-label={role}
              onClick={(e) => {
                e.stopPropagation();
                pick(role);
              }}
              className={`${CHIP_BASE} ${
                value === role ? `${c.on} ${SELECTED_RING}` : `bg-surface ${c.off} hover:bg-surface-muted`
              }`}
            >
              {role}
            </button>
          );
        })}
        <button
          type="button"
          aria-label={t(lang, "raciClear")}
          title={t(lang, "raciClearHint")}
          onClick={(e) => {
            e.stopPropagation();
            pick("");
          }}
          className={`${CHIP_BASE} border-line text-muted-foreground hover:bg-surface-muted`}
        >
          {/* ★ NOT an `IconButton`. This is the 5th of five chips that must
              render identically (R/A/C/I + clear), and `CHIP_BASE` pins them
              to a 20px `rounded-full` box. Still true under SELECTED_RING: a
              ring is a box-shadow, so it adds no layout and the five stay one
              size — and it is correctly absent HERE, because clear is not a
              role and is never the selected value. `IconButton` hard-codes
              `rounded-md` + `p-1`; a caller `className` cannot reliably win
              either, because Tailwind resolves conflicting utilities by
              stylesheet source order, not class-attribute order — and `p-1`
              sorts AFTER `p-0`, so the padding override loses outright.
              Glyph-only conversion here; the wrapper stays hand-rolled. */}
          <XMarkIcon aria-hidden="true" className="h-3 w-3" />
        </button>
      </PopoverPanel>
    </span>
  );
}

/** Bottom-of-panel legend: the same four colored chips with full labels. */
export function RaciLegend({ lang }: { lang: Lang }) {
  return (
    <div className="mt-3 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {RACI_ROLES.map((role) => (
        <span key={role} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold text-white ${CHIP[role].on}`}
          >
            {role}
          </span>
          {t(lang, ROLE_LABEL_KEY[role])}
        </span>
      ))}
    </div>
  );
}
