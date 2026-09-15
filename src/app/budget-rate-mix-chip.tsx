"use client";

// Rate-mix chip (MR 3 addendum §4.1): ONE control — a Badge inside the
// InfoTooltip trigger, so hovering or focusing its text or its ⓘ shows the
// shared explanation. The arrow and ⓘ are aria-hidden; `name` must contain the
// visible text (label-in-name). Not colour-only: the text says the direction.
import { InfoTooltip } from "./info-tooltip";
import { Badge } from "./badge";

export function RateMixChip({
  name, text, tip, direction,
}: {
  name: string; text: string; tip: string; direction: "hours-worse" | "eur-worse";
}) {
  const hoursWorse = direction === "hours-worse";
  return (
    <InfoTooltip text={tip} label={name}>
      <Badge
        pill
        size="sm"
        className={hoursWorse
          ? "border border-ui-pink/50 font-medium text-ui-pink-strong"
          : "border border-[var(--rag-amber)]/60 font-medium text-foreground"}
      >
        <span aria-hidden="true" className="mr-1">{hoursWorse ? "▲" : "▼"}</span>
        {text}
        <span aria-hidden="true" className="ml-1">ⓘ</span>
      </Badge>
    </InfoTooltip>
  );
}
