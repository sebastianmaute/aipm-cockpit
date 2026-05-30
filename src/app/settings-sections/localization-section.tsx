"use client";

import { useState } from "react";
import { COUNTRIES } from "../holidays";
import { type Lang, t } from "../i18n";
import type { Settings } from "../settings-types";
import { InfoTooltip } from "../info-tooltip";

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
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-line focus:outline-none focus:ring-1 focus:ring-AIPM-green"
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
            className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-line focus:outline-none focus:ring-1 focus:ring-AIPM-green"
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
            className="shrink-0 rounded-md bg-AIPM-dark-blue px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t(lang, "add")}
          </button>
        </div>

        {settings.holidayCountries.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {t(lang, "noCountriesSelected")}
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {settings.holidayCountries.map((code) => (
              <li
                key={code}
                className="flex items-center justify-between rounded-md bg-surface-muted px-3 py-1.5 text-sm"
              >
                <span className="text-foreground">
                  {countryName(code)}
                </span>
                <button
                  type="button"
                  onClick={() => removeCountry(code)}
                  aria-label={`${t(lang, "remove")} ${countryName(code)}`}
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
    </>
  );
}
