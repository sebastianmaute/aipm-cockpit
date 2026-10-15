"use client";

import type { ComponentProps } from "react";
import { type Lang, t } from "./i18n";
import { SimExplainer } from "./sim-explainer";

type ExplainerProps = Omit<ComponentProps<typeof SimExplainer>, "lang" | "onOpenHelp">;

/** The one look for a simulated number: dashed teal outline plus a "sim" badge,
 *  so it cannot be mistaken for a measured value. Calculated values never use
 *  this. The badge is decorative (`aria-hidden`); the group's accessible name
 *  carries ", simulated" instead. */
export function SimValue({
  lang,
  label,
  value,
  hint,
  explainer,
  onOpenHelp,
}: {
  lang: Lang;
  /** What the number is; becomes the accessible name with ", simulated". */
  label: string;
  value: string;
  hint?: string;
  explainer?: ExplainerProps;
  onOpenHelp?: (conceptId: string) => void;
}) {
  return (
    <span
      role="group"
      aria-label={t(lang, "simValueSr", label)}
      data-sim="true"
      className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-ui-green-strong px-1.5 py-0.5 dark:border-ui-green"
    >
      <span className="text-sm font-medium text-foreground">{value}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      <span
        aria-hidden="true"
        className="rounded bg-ui-green/15 px-1 text-[10px] font-medium leading-4 text-ui-green-strong dark:text-ui-green"
      >
        {t(lang, "simBadge")}
      </span>
      {explainer && <SimExplainer lang={lang} onOpenHelp={onOpenHelp} {...explainer} />}
    </span>
  );
}
