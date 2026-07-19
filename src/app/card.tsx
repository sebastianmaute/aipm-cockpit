"use client";

import type React from "react";

/**
 * Canonical card surface: the `rounded-lg border border-line bg-surface` box
 * (the dominant card shape across the app) as ONE primitive so every hand-rolled
 * card wrapper reads from a single source of truth (design-system Phase 1c).
 *
 * Minimal + presentational — it only owns the shared chrome:
 *  - `boxed`  → adds the `--shadow-card` elevation token (use only where a raised
 *    surface is wanted, e.g. the dashboard cockpit cards).
 *  - `padded` → adds `p-4` (the common boxed-section padding). Cards needing a
 *    different pad (e.g. `p-3`, density `dc.cardPad`) pass it via `className`.
 *
 * Shadow is opt-in on purpose: many card boxes (report/resource summary tiles)
 * are intentionally flat. All other props (`id`, `role`, `data-*`, event
 * handlers) pass straight through; `className` is appended AFTER the canonical
 * classes so a caller can extend but the base tokens always win first.
 *
 * `as` renders the same card chrome on a different element (e.g. `as="section"`
 * for a landmark content section). Props are typed against `HTMLElement`, so an
 * element-specific attribute (a `<details>` `open`) needs a cast at the call
 * site — plain `as="section"`/`"article"` sections need nothing extra.
 */
export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  /** Element to render (default `div`). Use `"section"`/`"article"` for a landmark. */
  as?: React.ElementType;
  /** Add the `--shadow-card` elevation token. */
  boxed?: boolean;
  /** Add `p-4` padding. */
  padded?: boolean;
}

export function Card({ as: Tag = "div", boxed = false, padded = false, className, children, ...rest }: CardProps) {
  const cls = [
    "rounded-lg border border-line bg-surface",
    boxed ? "shadow-[var(--shadow-card)]" : "",
    padded ? "p-4" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Tag className={cls} {...rest}>
      {children}
    </Tag>
  );
}
