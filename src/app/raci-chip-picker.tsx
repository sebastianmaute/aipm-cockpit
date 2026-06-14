"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type Lang, t } from "./i18n";
import { RACI_ROLES, type RaciRole } from "./types";

interface RaciChipPickerProps {
  value: RaciRole | "";
  onChange: (role: RaciRole | "") => void;
  /** "{milestone} · {stakeholder}" context for the accessible label. */
  ariaPrefix: string;
  lang: Lang;
}

// Brand color per role (filled when active, outlined when inactive).
const CHIP: Record<RaciRole, { on: string; off: string }> = {
  R: { on: "bg-AIPM-dark-blue text-white border-AIPM-dark-blue", off: "border-AIPM-dark-blue text-foreground" },
  A: { on: "bg-AIPM-green-strong text-white border-AIPM-green-strong", off: "border-AIPM-green-strong text-foreground" },
  C: { on: "bg-AIPM-purple text-white border-AIPM-purple", off: "border-AIPM-purple text-foreground" },
  I: { on: "bg-AIPM-dark-grey text-white border-AIPM-dark-grey", off: "border-AIPM-dark-grey text-foreground" },
};

const ROLE_LABEL_KEY: Record<RaciRole, Parameters<typeof t>[1]> = {
  R: "raciRoleResponsible",
  A: "raciRoleAccountable",
  C: "raciRoleConsulted",
  I: "raciRoleInformed",
};

const CHIP_BASE =
  "flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-semibold leading-none transition-colors focus:outline-none focus:ring-1 focus:ring-AIPM-green";

export function RaciChipPicker({ value, onChange, ariaPrefix, lang }: RaciChipPickerProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);

  // Position the popover via a body portal so it is never clipped by the RACI
  // matrix's overflow-auto scroll container. Close on outside pointerdown,
  // Escape, or scroll/resize (a fixed popover must not drift from its trigger).
  useEffect(() => {
    if (!open) return;
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: r.left });
    const onPointerDown = (e: PointerEvent) => {
      const tgt = e.target as Node;
      if (!triggerRef.current?.contains(tgt) && !popRef.current?.contains(tgt)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
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
          className="fixed z-[100] flex w-max items-center gap-1 rounded-md border border-line bg-surface p-1 shadow-sm"
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
            onClick={(e) => {
              e.stopPropagation();
              pick("");
            }}
            className={`${CHIP_BASE} border-line text-muted-foreground hover:bg-surface-muted`}
          >
            ✕
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
