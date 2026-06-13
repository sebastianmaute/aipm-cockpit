"use client";

interface InfoTooltipProps {
  /** Already-translated tooltip text. Empty → renders nothing. */
  text: string;
  /** Accessible label for the trigger; defaults to `text`. */
  label?: string;
}

export function InfoTooltip({ text, label }: InfoTooltipProps) {
  if (!text) return null;
  return (
    <span className="group relative inline-flex items-center align-middle">
      {/* A focusable <span> (NOT a <button>): button is a *labelable* element, so
          when an InfoTooltip sits inside a field's <label> the button would steal
          the implicit label→input association. A span with role=button keeps the
          hover/focus tooltip behaviour without hijacking the label. */}
      <span
        role="button"
        tabIndex={0}
        aria-label={label ?? text}
        className="flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-line text-[10px] font-semibold leading-none text-muted-foreground hover:text-foreground focus:outline-none focus:ring-1 focus:ring-AIPM-green"
      >
        i
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 w-max max-w-[16rem] -translate-x-1/2 rounded-md border border-line bg-surface px-2 py-1 text-xs font-normal text-foreground opacity-0 shadow-md transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
