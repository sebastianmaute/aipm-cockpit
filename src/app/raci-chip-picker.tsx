"use client";
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

export function RaciChipPicker({ value, onChange, ariaPrefix, lang }: RaciChipPickerProps) {
  return (
    <span className="inline-flex items-center gap-1">
      {RACI_ROLES.map((role) => {
        const active = value === role;
        const c = CHIP[role];
        return (
          <button
            key={role}
            type="button"
            aria-pressed={active}
            aria-label={`${ariaPrefix} — ${t(lang, ROLE_LABEL_KEY[role])}`}
            onClick={() => onChange(active ? "" : role)}
            className={`flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-semibold leading-none transition-colors ${
              active ? c.on : `bg-surface ${c.off} hover:bg-surface-muted`
            } focus:outline-none focus:ring-1 focus:ring-AIPM-green`}
          >
            {role}
          </button>
        );
      })}
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
