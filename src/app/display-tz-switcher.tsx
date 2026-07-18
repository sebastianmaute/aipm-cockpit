"use client";

// Top-bar switcher for the session display timezone (TZ-2). Controlled by the
// DisplayTimezoneContext value (passed as `ctx` so it is trivially testable).
import { type Lang, t } from "./i18n";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";

interface DisplayTzCtx {
  displayTz: string;
  effectiveTz: string;
  isOverridden: boolean;
  setDisplayOverride: (tz: string | undefined) => void;
}

interface DisplayTzSwitcherProps {
  lang: Lang;
  ctx: DisplayTzCtx;
  additionalTimezones: readonly string[];
}

export function DisplayTzSwitcher({ lang, ctx, additionalTimezones }: DisplayTzSwitcherProps) {
  const extras = additionalTimezones.filter((z) => z !== "UTC" && z !== ctx.effectiveTz);
  return (
    <select
      aria-label={t(lang, "displayTzLabel")}
      value={ctx.isOverridden ? ctx.displayTz : ""}
      onChange={(e) => ctx.setDisplayOverride(e.target.value || undefined)}
      className={`rounded-md border border-line bg-surface px-2 py-1 text-xs text-foreground focus:border-ui-dark-blue focus:outline-none ${FOCUS_RING} ${TRANSITION}`}
    >
      <option value="">{`${t(lang, "displayTzDefault")} (${ctx.effectiveTz})`}</option>
      <option value="UTC">UTC</option>
      {extras.map((z) => (
        <option key={z} value={z}>{z}</option>
      ))}
    </select>
  );
}
