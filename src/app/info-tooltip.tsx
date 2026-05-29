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
      <button
        type="button"
        aria-label={label ?? text}
        title={text}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-line text-[10px] font-semibold leading-none text-muted-foreground hover:text-foreground focus:outline-none focus:ring-1 focus:ring-AIPM-green"
      >
        i
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 w-max max-w-[16rem] -translate-x-1/2 rounded-md border border-line bg-surface px-2 py-1 text-xs font-normal text-foreground opacity-0 shadow-md transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
