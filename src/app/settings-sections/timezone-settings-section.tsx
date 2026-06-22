"use client";

import { useState } from "react";
import { type Lang, t } from "../i18n";
import type { Settings } from "../settings-types";
import { browserTimeZone, isValidTimeZone, tzZones } from "../timezone";

interface TimezoneSettingsSectionProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
}

export function TimezoneSettingsSection({ lang, settings, onChange }: TimezoneSettingsSectionProps) {
  const zones = tzZones();
  const additional = settings.additionalTimezones ?? [];
  const [pending, setPending] = useState("");
  // The resolved default (per-device override, else the browser zone). Excluded
  // from the add list so a user can't add it as a redundant "additional" zone.
  // (Per-project operatingTimezone isn't in scope here; the calendar strip dedupes
  // that rarer case regardless.)
  const defaultZone = settings.timezone || browserTimeZone();

  function setDefault(value: string) {
    onChange({ ...settings, timezone: value || undefined });
  }

  function addZone() {
    if (!pending || !isValidTimeZone(pending) || additional.includes(pending) || pending === defaultZone) return;
    onChange({ ...settings, additionalTimezones: [...additional, pending] });
    setPending("");
  }

  function removeZone(zone: string) {
    onChange({ ...settings, additionalTimezones: additional.filter((z) => z !== zone) });
  }

  return (
    <>
      <label className="mb-4 block">
        <span className="mb-1 block text-sm font-medium text-foreground">
          {t(lang, "tzDefaultLabel")}
        </span>
        <select
          value={settings.timezone ?? ""}
          aria-label={t(lang, "tzDefaultLabel")}
          onChange={(e) => setDefault(e.target.value)}
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-line focus:outline-none focus:ring-1 focus:ring-AIPM-green"
        >
          <option value="">{`${t(lang, "tzSystemDefault")} (${browserTimeZone()})`}</option>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </label>

      <div>
        <span className="mb-1 block text-sm font-medium text-foreground">
          {t(lang, "tzAdditionalLabel")}
        </span>
        <div className="flex gap-2">
          <select
            value={pending}
            aria-label={t(lang, "tzAddLabel")}
            onChange={(e) => setPending(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-line focus:outline-none focus:ring-1 focus:ring-AIPM-green"
          >
            <option value="">{t(lang, "tzAddLabel")}</option>
            {zones
              .filter((z) => !additional.includes(z) && z !== defaultZone)
              .map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
          </select>
          <button
            type="button"
            onClick={addZone}
            disabled={!pending}
            className="shrink-0 rounded-md bg-AIPM-dark-blue px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t(lang, "tzAddLabel")}
          </button>
        </div>

        {additional.length > 0 && (
          <ul className="mt-2 space-y-1">
            {additional.map((zone) => (
              <li
                key={zone}
                className="flex items-center justify-between rounded-md bg-surface-muted px-3 py-1.5 text-sm"
              >
                <span className="text-foreground">{zone}</span>
                <button
                  type="button"
                  onClick={() => removeZone(zone)}
                  aria-label={`${t(lang, "tzRemoveLabel")} – ${zone}`}
                  className="text-muted-foreground hover:text-AIPM-pink"
                >
                  <svg
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                    className="h-4 w-4"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4.28 4.28a.75.75 0 011.06 0L10 8.94l4.66-4.66a.75.75 0 111.06 1.06L11.06 10l4.66 4.66a.75.75 0 11-1.06 1.06L10 11.06l-4.66 4.66a.75.75 0 01-1.06-1.06L8.94 10 4.28 5.34a.75.75 0 010-1.06z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!settings.showDisplayTzSwitcher}
            onChange={(e) => onChange({ ...settings, showDisplayTzSwitcher: e.target.checked })}
          />
          {t(lang, "tzShowSwitcher")}
        </label>
        <p className="mt-1 text-xs text-muted-foreground">{t(lang, "tzShowSwitcherHint")}</p>
      </div>
    </>
  );
}
