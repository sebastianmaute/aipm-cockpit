"use client";

// Calendar multi-timezone strip (TZ-3): a live "world clock" row — the default
// (effective) zone + each configured additional zone. Ticks each minute. Shown
// only on the Calendar view when additional zones are configured.
import { useEffect, useState } from "react";
import { type Lang, t } from "./i18n";
import { formatZoneClock } from "./tz-clock";

interface TzClockStripProps {
  lang: Lang;
  defaultTz: string;
  zones: readonly string[];
}

export function TzClockStrip({ lang, defaultTz, zones }: TzClockStripProps) {
  // Lazy init (sanctioned capture; not a render-body new Date()); advance each minute.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (zones.length === 0) return null;
  const iso = now.toISOString();
  // Exclude the default zone if it's also in the additional list — avoids a
  // duplicate chip + a duplicate React key on the tz string.
  const all = [defaultTz, ...zones.filter((z) => z !== defaultTz)];
  return (
    <div
      role="region"
      aria-label={t(lang, "tzClockStripLabel")}
      className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 overflow-x-auto rounded-md border border-line bg-surface px-3 py-1.5 pr-2 text-xs text-foreground"
    >
      {all.map((tz) => (
        <span key={tz} className="whitespace-nowrap">
          <span className="font-medium text-AIPM-dark-blue dark:text-AIPM-light-grey">{tz}</span>
          <span className="ml-1 text-muted-foreground tabular-nums">{formatZoneClock(iso, tz, lang)}</span>
        </span>
      ))}
    </div>
  );
}
