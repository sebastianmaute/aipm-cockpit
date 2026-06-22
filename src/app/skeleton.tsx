"use client";

import { t, type Lang } from "./i18n";
import { VIEW_PANE_FILL_CLASS } from "./view-styles";

/** A single shimmer placeholder block. Decorative — palette-safe (surface-muted
 *  fill, no shadow/gradient) and `aria-hidden` so screen readers skip it; the
 *  surrounding status region announces the loading state instead. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-surface-muted ${className}`} />;
}

/** Full-pane loading placeholder for a lazily-loaded (`dynamic`) view panel.
 *  Mirrors the standard view-pane chrome so the swap to real content doesn't
 *  jump, and approximates a header + table rows.
 *
 *  Pass `lang` when the call site has it: the placeholder becomes a
 *  `role="status"` live region with a translated, screen-reader-only label.
 *  Omit `lang` (e.g. a prop-less `dynamic` fallback) and it degrades to a purely
 *  decorative `aria-hidden` shimmer — no announcement, but no worse than the
 *  blank it replaces. */
export function PanelSkeleton({ lang, rows = 6 }: { lang?: Lang; rows?: number }) {
  const live = lang ? { role: "status" as const, "aria-live": "polite" as const } : { "aria-hidden": true };
  return (
    <div {...live} className={VIEW_PANE_FILL_CLASS}>
      {lang && <span className="sr-only">{t(lang, "loading")}</span>}
      <Skeleton className="mb-4 h-7 w-48 shrink-0" />
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}
