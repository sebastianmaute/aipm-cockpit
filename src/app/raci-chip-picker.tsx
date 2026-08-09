"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type Lang, t } from "./i18n";
import { RACI_ROLES, type RaciRole } from "./types";
import { useDismissable } from "./use-dismissable";
import { XMarkIcon } from "@heroicons/react/24/outline";

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
          className="fixed z-[100] flex w-max items-center gap-1 rounded-md border border-line bg-surface p-1 shadow-[var(--shadow-control)]"
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
                  value === role ? c.on : `bg-surface ${c.off} hover:bg-surface-muted`
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
                to a 20px `rounded-full` box. `IconButton` hard-codes
                `rounded-md` + `p-1`; a caller `className` cannot reliably win
                either, because Tailwind resolves conflicting utilities by
                stylesheet source order, not class-attribute order — and `p-1`
                sorts AFTER `p-0`, so the padding override loses outright.
                Glyph-only conversion here; the wrapper stays hand-rolled. */}
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
