import { useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { type Lang, t } from "./i18n";
import type { Report } from "./sanitize-report";

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
  if (len < max * WARN_RATIO) {
    // Keep the id present (empty + hidden) so an input's aria-describedby that
    // references this counter never dangles to a missing element. A hidden
    // element contributes no accessible text, so nothing is announced until the
    // counter actually shows near the cap.
    return id ? <span id={id} hidden /> : null;
  }
  const atCap = len >= max;
  return (
    <p id={id} className={`mt-1 text-xs ${atCap ? "text-ui-pink-strong" : "text-muted-foreground"}`}>
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
    <p id={id} role="status" aria-live="polite" className="mt-1 text-xs text-ui-pink-strong">
      {children}
    </p>
  );
}

interface FieldErrorProps {
  id?: string;
  children: ReactNode;
}

/** Inline validation error under a field. Uses role="alert" so it's announced
 *  promptly; pair with aria-invalid + aria-describedby on the input. */
export function FieldError({ id, children }: FieldErrorProps) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs font-medium text-ui-pink-strong">
      {children}
    </p>
  );
}

/**
 * Submit-time collector. Pass each sanitized field's Report through `track`
 * (it returns the clean value); after sanitizing, read `count()` to decide
 * whether to fire the "N fields adjusted" toast, then `reset()`.
 */
export function useAdjustmentTracker() {
  const adjusted = useRef(0);
  return useMemo(() => ({
    track<T>(report: Report<T>): T {
      if (report.adjustment !== null) adjusted.current += 1;
      return report.value;
    },
    count: () => adjusted.current,
    reset: () => {
      adjusted.current = 0;
    },
  }), []);
}
