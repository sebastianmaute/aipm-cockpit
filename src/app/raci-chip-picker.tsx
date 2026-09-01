"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type Lang, t } from "./i18n";
import { RACI_ROLES, type RaciRole } from "./types";
import { useDismissable } from "./use-dismissable";
import { ToggleButton } from "./toggle-button";
import { XMarkIcon } from "./icons";

interface RaciChipPickerProps {
  value: RaciRole | "";
  onChange: (role: RaciRole | "") => void;
  /** "{milestone} · {stakeholder}" context for the accessible label. */
  ariaPrefix: string;
  lang: Lang;
}

// Brand color per role (filled when active, outlined when inactive).
//
// ★★★ THE TRAILING `!` IS LOAD-BEARING, NOT STYLE NOISE. Since open-followups
// §55 the four popover chips are `ToggleButton`s, and these strings arrive as
// that primitive's `className` — which is APPENDED VERBATIM to its own pressed
// classes (`border-[var(--control-state-border)] bg-ui-dark-blue/10
// text-ui-dark-blue hover:bg-ui-dark-blue/20 dark:bg-ui-dark-blue/20 …`).
// Class-attribute ORDER decides nothing in CSS: two same-property utilities of
// equal specificity are resolved by their order in Tailwind's GENERATED
// stylesheet, which no call site controls. Without `!` the primitive's dark-blue
// tint can win and the role hue — the only thing carrying WHICH of R/A/C/I is
// selected — silently disappears; `text-white` losing to the primitive's
// `text-ui-dark-blue` would additionally put dark-blue text on a dark-blue fill.
// `!` beats a non-important declaration whatever the order, including the
// primitive's `dark:` variants. Repo idiom; Tailwind v4 puts the modifier last.
// ★ `hover:` is NEW. The primitive hovers a pressed chip to `bg-ui-dark-blue/20`,
//   which on a solid green/purple/grey fill is the wrong hue AND would wash the
//   fill out; re-pointing it at the chip's OWN token reproduces today's
//   behaviour, where an active chip has no hover response at all.
// ★ `text-foreground` in `off` carries NO `!` — it is byte-identical to the
//   primitive's own unpressed value, so it resolves the same either way.
// ★ The `!` is inert for the two non-ToggleButton consumers below (the trigger
//   and `RaciLegend`), which have no competing declaration. One map is kept
//   deliberately: a second copy of the hues is exactly the drift this file
//   cannot afford.
const CHIP: Record<RaciRole, { on: string; off: string }> = {
  R: {
    on: "bg-ui-dark-blue! text-white! border-ui-dark-blue! hover:bg-ui-dark-blue!",
    off: "border-ui-dark-blue! text-foreground",
  },
  A: {
    on: "bg-ui-green-strong! text-white! border-ui-green-strong! hover:bg-ui-green-strong!",
    off: "border-ui-green-strong! text-foreground",
  },
  C: {
    on: "bg-ui-purple! text-white! border-ui-purple! hover:bg-ui-purple!",
    off: "border-ui-purple! text-foreground",
  },
  I: {
    on: "bg-ui-dark-grey! text-white! border-ui-dark-grey! hover:bg-ui-dark-grey!",
    off: "border-ui-dark-grey! text-foreground",
  },
};

export const ROLE_LABEL_KEY: Record<RaciRole, Parameters<typeof t>[1]> = {
  R: "raciRoleResponsible",
  A: "raciRoleAccountable",
  C: "raciRoleConsulted",
  I: "raciRoleInformed",
};

const CHIP_BASE =
  "flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-semibold leading-none transition-colors focus:outline-none focus:ring-2 focus:ring-ui-green";

// Shape appended to the four popover role `ToggleButton`s, on top of the role
// hue above. Both properties COLLIDE with the primitive's own and both are
// load-bearing, so both carry the trailing `!` (see the CHIP note):
//   `rounded-full` vs the primitive's `rounded-md` — the round chip is the RACI
//     visual identity, shared with the trigger and `RaciLegend` beside it.
//   `font-semibold` vs the primitive's `font-medium` — the single role LETTER is
//     the whole label, and it must read at the same weight as those two.
// ★★ `CHIP_BASE`'s `h-5 w-5` is deliberately NOT passed. A 20px circle cannot
//    hold the primitive's 14px marker plus its `gap-1.5` and the letter, so the
//    popover chips are the primitive's own box (`px-2.5 py-1.5 text-xs`) and are
//    now stadium-shaped rather than round. That growth is forced by the non-
//    colour cue, not a free choice. The trigger and the legend keep `CHIP_BASE`
//    unchanged — neither is a toggle, so neither takes a marker.
const ROLE_CHIP_SHAPE = "rounded-full! font-semibold!";

export function RaciChipPicker({ value, onChange, ariaPrefix, lang }: RaciChipPickerProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);

  // Escape goes through the dismissal stack. No `claims` gate: this is a
  // transient anchored popover that already closes on scroll, never a
  // persistent floating surface left open while the user works elsewhere.
  useDismissable({ open, kind: "layer", onDismiss: () => setOpen(false) });

  // Position the popover via a body portal so it is never clipped by the RACI
  // matrix's overflow-auto scroll container. Close on outside pointerdown or
  // scroll/resize (a fixed popover must not drift from its trigger).
  useEffect(() => {
    if (!open) return;
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: r.left });
    const onPointerDown = (e: PointerEvent) => {
      const tgt = e.target as Node;
      if (!triggerRef.current?.contains(tgt) && !popRef.current?.contains(tgt)) setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const pick = (role: RaciRole | "") => {
    setOpen(false);
    onChange(role);
  };

  const triggerLabel = value === "" ? t(lang, "raciSetLabel") : t(lang, ROLE_LABEL_KEY[value]);

  return (
    <span className="relative inline-flex items-center">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
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
      {open && pos && typeof document !== "undefined" &&
        createPortal(
        <span
          ref={popRef}
          style={{ top: pos.top, left: pos.left }}
          // ★ The four role chips are `ToggleButton`s now, and `onToggle` takes
          //   no event — so each chip's own `e.stopPropagation()` moved up here,
          //   where it fires at the very next node in the same bubble path and
          //   is therefore equivalent for a click landing on a chip. Without it
          //   a chip click would reach any ancestor click handler in the RACI
          //   matrix (the portal bubbles through the REACT tree, not the DOM).
          //   The clear button keeps its own call; the duplicate is harmless.
          onClick={(e) => e.stopPropagation()}
          className="fixed z-[100] flex w-max items-center gap-1 rounded-md border border-line bg-surface p-1 shadow-[var(--shadow-control)]"
        >
          {/* open-followups §55 (WCAG 1.4.1) — the selected role was carried by
              the brand fill ALONE, which against `--surface` measures 1.10-1.31
              for R and 2.70-2.84 for I in the three dark schemes, both under the
              3:1 floor. A (5.30-8.80) and C (3.33-6.15) pass everywhere and
              migrate anyway: a picker where two chips carry the non-colour
              marker and two do not is worse than either consistent state.
              ★ The hue STAYS (it carries WHICH role is selected) and is pinned
                against the cascade by the `!` in the CHIP map above. */}
          {RACI_ROLES.map((role) => {
            const c = CHIP[role];
            const selected = value === role;
            return (
              <ToggleButton
                key={role}
                pressed={selected}
                onToggle={() => pick(role)}
                ariaLabel={role}
                className={`${ROLE_CHIP_SHAPE} ${selected ? c.on : c.off}`}
                lang={lang}
              >
                {role}
              </ToggleButton>
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
            {/* ★ NOT an `IconButton`, and NOT a `ToggleButton` either — it
                clears rather than selecting, so it has no pressed state and
                takes no marker. It keeps `CHIP_BASE`'s 20px `rounded-full` box,
                which since open-followups §55 no longer matches the four role
                chips beside it: those had to grow to hold the non-colour marker.
                (Read the note on `ROLE_CHIP_SHAPE` before "restoring" the match
                — a 20px circle cannot hold the marker at all.) `IconButton`
                hard-codes `rounded-md` + `p-1`; a caller `className` cannot
                reliably win either, because Tailwind resolves conflicting
                utilities by stylesheet source order, not class-attribute order
                — and `p-1` sorts AFTER `p-0`, so the padding override loses
                outright. Glyph-only conversion here; the wrapper stays
                hand-rolled. */}
            <XMarkIcon aria-hidden="true" className="h-3 w-3" />
          </button>
        </span>,
        document.body,
      )}
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
