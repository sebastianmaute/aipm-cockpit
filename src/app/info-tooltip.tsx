"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { TooltipSurface } from "./tooltip-surface";

type InfoTooltipProps =
  | {
      /** Already-translated tooltip text. Empty → renders nothing. */
      text: string;
      /** Accessible label for the trigger; defaults to `text`. */
      label?: string;
      children?: undefined;
    }
  | {
      text: string;
      /** Required with a custom trigger, and it must CONTAIN the trigger's
       *  visible text (WCAG 2.5.3 label-in-name). */
      label: string;
      /** Custom trigger content (e.g. a `Badge` chip), rendered inside the one
       *  focusable trigger instead of the "i" glyph (MR 3, plan Ruling 8). */
      children: ReactNode;
    };

const ICON_TRIGGER_CLASS =
  "flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-line text-[10px] font-semibold normal-case leading-none text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ui-green";
const CUSTOM_TRIGGER_CLASS =
  "inline-flex cursor-help items-center rounded-full focus:outline-none focus:ring-2 focus:ring-ui-green";

export function InfoTooltip({ text, label, children }: InfoTooltipProps) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const MARGIN = 8;
    const HALF = 128; // half of max-w-[16rem] (256px)
    const centered = r.left + r.width / 2;
    const clampedLeft = Math.min(
      Math.max(centered, MARGIN + HALF),
      window.innerWidth - MARGIN - HALF,
    );
    setPos({ top: r.bottom + 4, left: clampedLeft });
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  if (!text) return null;
  return (
    <span ref={ref} className="relative inline-flex items-center align-middle">
      {/* A focusable <span> (NOT a <button>): button is a *labelable* element, so
          when an InfoTooltip sits inside a field's <label> the button would steal
          the implicit label→input association. A span with role=button keeps the
          hover/focus tooltip behaviour without hijacking the label. */}
      <span
        role="button"
        tabIndex={0}
        // Test hook for `src/test/hint-label.ts`: a naming <label> must never
        // contain this trigger (open-followups §386).
        data-info-tooltip-trigger=""
        aria-label={label ?? text}
        onPointerEnter={() => setOpen(true)}
        onPointerLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).focus(); }}
        onKeyDown={(e) => { if (e.key === "Escape") (e.currentTarget as HTMLElement).blur(); }}
        className={children === undefined ? ICON_TRIGGER_CLASS : CUSTOM_TRIGGER_CLASS}
      >
        {children === undefined ? "i" : children}
      </span>
      {open && pos && <TooltipSurface top={pos.top} left={pos.left}>{text}</TooltipSurface>}
    </span>
  );
}
