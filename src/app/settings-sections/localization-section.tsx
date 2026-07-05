"use client";

import { useState } from "react";
import { COUNTRIES } from "../holidays";
import { type Lang, t } from "../i18n";
import type { Settings } from "../settings-types";
import { InfoTooltip } from "../info-tooltip";
import { EmptyState } from "../empty-state";
import { FOCUS_RING, INTERACTIVE, TRANSITION } from "../interaction-styles";
import { RemovableChipRow } from "./removable-chip-row";

interface LocalizationSectionProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
}

export function LocalizationSection({ lang, settings, onChange }: LocalizationSectionProps) {
  const [pending, setPending] = useState("");

  const countryName = (code: string) => {
    const c = COUNTRIES.find((c) => c.code === code);
    if (!c) return code;
    return lang === "de" ? c.nameDe : c.nameEn;
  };

  const available = COUNTRIES.filter(
    (c) => !settings.holidayCountries.includes(c.code),
  );

  function addCountry() {
    if (!pending || settings.holidayCountries.includes(pending)) return;
    onChange({
      ...settings,
      holidayCountries: [...settings.holidayCountries, pending],
    });
    setPending("");
  }

  function removeCountry(code: string) {
    onChange({
      ...settings,
      holidayCountries: settings.holidayCountries.filter((c) => c !== code),
    });
  }

  return (
    <>
      <label className="mb-4 block">
        <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
          {t(lang, "language")}
          <InfoTooltip text={t(lang, "languageTooltip")} />
        </span>
        <select
          value={settings.language}
          onChange={(e) =>
            onChange({ ...settings, language: e.target.value as Lang })
          }
          className={`w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-line focus:outline-none ${FOCUS_RING} ${TRANSITION}`}
        >
          <option value="en-US">English (US)</option>
          <option value="en-GB">English (UK)</option>
          <option value="de">Deutsch</option>
        </select>
      </label>

      <div>
        <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
          {t(lang, "holidayCountries")}
          <InfoTooltip text={t(lang, "holidayCountriesTooltip")} />
        </span>
        <div className="flex gap-2">
          <select
            value={pending}
            onChange={(e) => setPending(e.target.value)}
            className={`min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-line focus:outline-none ${FOCUS_RING} ${TRANSITION}`}
          >
            <option value="">{t(lang, "selectCountry")}</option>
            {available.map((c) => (
              <option key={c.code} value={c.code}>
                {lang === "de" ? c.nameDe : c.nameEn}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={addCountry}
            disabled={!pending}
            className={`shrink-0 rounded-md bg-AIPM-dark-blue px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}
          >
            {t(lang, "add")}
          </button>
        </div>

        {settings.holidayCountries.length === 0 ? (
          <EmptyState compact title={t(lang, "noCountriesSelected")} />
        ) : (
          <ul className="mt-2 space-y-1">
            {settings.holidayCountries.map((code) => (
              <RemovableChipRow
                key={code}
                label={countryName(code)}
                ariaLabel={`${t(lang, "remove")} ${countryName(code)}`}
                onRemove={() => removeCountry(code)}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
