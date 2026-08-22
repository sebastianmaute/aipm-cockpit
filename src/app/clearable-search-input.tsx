"use client";

// Shared "✕ to clear" overlay for search/filter fields. Owns ONLY the relative
// wrapper and the overlaid button — the caller supplies its own field, so each
// site keeps its existing shell (report-table uses a raw <input>, the timelog
// panel uses `Input size="xs"`; unifying those would re-baseline visual
// snapshots across seven panels for no user-visible gain).
//
// Every non-obvious choice below is load-bearing and was paid for once already
// in TableFilter:
//  - The button is OVERLAID, not a sibling. A sibling next to a `type=search`
//    field reads as TWO clears in Chrome/Safari and ONE in Firefox.
//  - FOCUS_RING + TRANSITION, never the full INTERACTIVE atom: INTERACTIVE
//    bundles PRESS (`active:translate-y-px`), which writes the same
//    --tw-translate-y as the -translate-y-1/2 centring here, so the glyph
//    jumped out of centre for the duration of every press.
//  - h-6 w-6 = 24px is the WCAG 2.2 SC 2.5.8 target floor; the icon is 14px, so
//    padding alone left a ~20px target.
//  - right-1.5 + 24px = 30px stays inside the caller's pr-8 (32px), so field
//    text never runs under the button.
//
// i18n-free (the EntityLinkPicker convention): the caller passes an
// already-translated `clearLabel`.
import { useRef, type ReactNode } from "react";
import { XMarkIcon } from "./icons";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";

export interface ClearableSearchInputProps {
  /** Current field value — the ✕ renders only while this is non-empty. */
  value: string;
  /** Invoked when the ✕ is activated; the caller clears its own state. */
  onClear: () => void;
  /** Already-translated accessible name (also used as the title). */
  clearLabel: string;
  /** The field. It must reserve room via `pr-8` while `value` is non-empty and,
   *  if it is `type="search"`, suppress the native control with
   *  `[&::-webkit-search-cancel-button]:appearance-none`. */
  children: ReactNode;
  /** Extra classes for the positioning wrapper — sizing stays with the caller. */
  className?: string;
}

export function ClearableSearchInput({
  value,
  onClear,
  clearLabel,
  children,
  className,
}: ClearableSearchInputProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={wrapRef} className={`relative${className ? ` ${className}` : ""}`}>
      {children}
      {value && (
        <button
          type="button"
          // ★ Mouse: keep focus in the field so it is never taken and then
          //   dropped when this button unmounts (also protects commit-on-blur
          //   callers — the ResourcePicker precedent). NOT unit-testable:
          //   jsdom never moves focus on mousedown, so removing this leaves
          //   the suite green — the onClick refocus below is what the mouse
          //   test actually proves.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onClear();
            // ★ Keyboard: activation focus WAS on this button, which the clear
            //   just unmounted, so focus would fall to <body>. `children` is
            //   contractually THE field, so query it rather than adding a
            //   fieldRef prop that would churn every shipped call site.
            wrapRef.current?.querySelector<HTMLElement>("input, textarea")?.focus();
          }}
          aria-label={clearLabel}
          title={clearLabel}
          className={`absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-surface-muted hover:text-foreground ${FOCUS_RING} ${TRANSITION}`}
        >
          <XMarkIcon aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
