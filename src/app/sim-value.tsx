"use client";

import type { ComponentProps } from "react";
import { type Lang, t } from "./i18n";
import { SimExplainer } from "./sim-explainer";

type ExplainerProps = Omit<ComponentProps<typeof SimExplainer>, "lang" | "onOpenHelp">;

/** A simulated slot that is waiting for its inputs (holidays still loading): neutral, empty and
 *  `aria-hidden`, with the height of a `SimValue` (`h-6`) so the layout does not jump when the
 *  value arrives. No text, so it can never read as a measured or simulated figure. */
export function SimPlaceholder() {
  return <span aria-hidden="true" data-sim-placeholder="true" className="inline-block h-6 w-12" />;
}

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
  wrap = false,
}: {
  lang: Lang;
  /** What the number is; becomes the accessible name with ", simulated". */
  label: string;
  value: string;
  hint?: string;
  explainer?: ExplainerProps;
  onOpenHelp?: (conceptId: string) => void;
  /** A sentence-length value: the outline spans its line and the hint, badge and (i) wrap below it. */
  wrap?: boolean;
}) {
  return (
    <span
      role="group"
      aria-label={t(lang, "simValueSr", label)}
      data-sim="true"
      className={`${wrap ? "flex flex-wrap" : "inline-flex"} items-center gap-1.5 rounded-md border border-dashed border-ui-green-strong px-1.5 py-0.5 dark:border-ui-green`}
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
