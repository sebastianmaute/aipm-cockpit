import type { ReactNode } from "react";
import { type Lang, t } from "./i18n";

/** Below this fraction of the cap the counter is hidden to avoid noise. */
const WARN_RATIO = 0.8;

interface CharCounterProps {
  value: string;
  max: number;
  id?: string;
  lang: Lang;
}

/** Character counter: hidden < 80% of max, muted at >= 80%, pink + hint at the cap. */
export function CharCounter({ value, max, id, lang }: CharCounterProps) {
  const len = value.length;
  if (len < max * WARN_RATIO) return null;
  const atCap = len >= max;
  return (
    <p id={id} className={`mt-1 text-xs ${atCap ? "text-AIPM-pink" : "text-muted-foreground"}`}>
      {t(lang, "fieldCounter", len, max)}
      {atCap ? ` — ${t(lang, "fieldTrimmedToFit")}` : ""}
    </p>
  );
}

interface FieldNoticeProps {
  id?: string;
  children: ReactNode;
}

/** Inline, announced notice under a field (clamp/strip messages). */
export function FieldNotice({ id, children }: FieldNoticeProps) {
  if (!children) return null;
  return (
    <p id={id} role="status" aria-live="polite" className="mt-1 text-xs text-AIPM-pink">
      {children}
    </p>
  );
}
