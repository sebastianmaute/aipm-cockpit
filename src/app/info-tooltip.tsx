"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface InfoTooltipProps {
  /** Already-translated tooltip text. Empty → renders nothing. */
  text: string;
  /** Accessible label for the trigger; defaults to `text`. */
  label?: string;
}

export function InfoTooltip({ text, label }: InfoTooltipProps) {
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
        aria-label={label ?? text}
        onPointerEnter={() => setOpen(true)}
        onPointerLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).focus(); }}
        onKeyDown={(e) => { if (e.key === "Escape") (e.currentTarget as HTMLElement).blur(); }}
        className="flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-line text-[10px] font-semibold normal-case leading-none text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ui-green"
      >
        i
      </span>
      {open && pos && typeof document !== "undefined" &&
        createPortal(
          <span
            role="tooltip"
            data-tooltip-portal
            style={{ top: pos.top, left: pos.left, transform: "translateX(-50%)" }}
            className="pointer-events-none fixed z-[100] w-max max-w-[16rem] rounded-md border border-line bg-surface px-2 py-1 text-xs font-normal normal-case text-foreground"
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}
