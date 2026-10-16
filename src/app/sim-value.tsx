"use client";

import { type Lang, t } from "./i18n";
import { SimExplainer, type SimValueExplainerProps } from "./sim-explainer";

type ExplainerProps = Omit<SimValueExplainerProps, "lang" | "onOpenHelp">;

/** A simulated slot that is waiting for its inputs (holidays still loading): neutral, empty and
 *  `aria-hidden`, with the height of a `SimValue` (`h-6`) so the layout does not jump when the
 *  value arrives. No text, so it can never read as a measured or simulated figure. */
export function SimPlaceholder() {
  return <span aria-hidden="true" data-sim-placeholder="true" className="inline-block h-6 w-12" />;
}

/** The dashed teal outline every simulated surface wears. Exported so a simulated surface that is
 *  not a text value (the Forecast tile's range bar) wears the SAME outline, never a hand-rolled one. */
export const SIM_OUTLINE_CLASS = "rounded-md border border-dashed border-ui-green-strong px-1.5 py-0.5 dark:border-ui-green";

/** The decorative "sim" badge (`aria-hidden`); the surrounding group's name carries ", simulated". */
export function SimBadge({ lang }: { lang: Lang }) {
  return (
    <span
      aria-hidden="true"
      className="rounded bg-ui-green/15 px-1 text-[10px] font-medium leading-4 text-ui-green-strong dark:text-ui-green"
    >
      {t(lang, "simBadge")}
    </span>
  );
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
  glyph,
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
  /** A decorative lead mark (the Forecast tile's ▲/▼), inside the outline and `aria-hidden`: the words carry it. */
  glyph?: string;
}) {
  return (
    <span
      role="group"
      aria-label={t(lang, "simValueSr", label)}
      data-sim="true"
      className={`${wrap ? "flex flex-wrap" : "inline-flex"} items-center gap-1.5 ${SIM_OUTLINE_CLASS}`}
    >
      <span className="text-sm font-medium text-foreground">{glyph && <span aria-hidden="true">{glyph} </span>}{value}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      <SimBadge lang={lang} />
      {explainer && <SimExplainer lang={lang} onOpenHelp={onOpenHelp} {...explainer} />}
    </span>
  );
}
