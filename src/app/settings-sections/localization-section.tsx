"use client";

import { useState } from "react";
import { COUNTRIES } from "../holidays";
import { type Lang, t } from "../i18n";
import type { Settings } from "../settings-types";
import { InfoTooltip } from "../info-tooltip";
import { EmptyState } from "../empty-state";
import { Button } from "../button";
import { Select } from "../form-controls";
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
        <Select
          className="w-full"
          value={settings.language}
          onChange={(e) =>
            onChange({ ...settings, language: e.target.value as Lang })
          }
        >
          <option value="en-US">English (US)</option>
          <option value="en-GB">English (UK)</option>
          <option value="de">Deutsch</option>
        </Select>
      </label>

      <div>
        <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
          {t(lang, "holidayCountries")}
          <InfoTooltip text={t(lang, "holidayCountriesTooltip")} />
        </span>
        <div className="flex gap-2">
          <Select
            className="min-w-0 flex-1"
            value={pending}
            onChange={(e) => setPending(e.target.value)}
          >
            <option value="">{t(lang, "selectCountry")}</option>
            {available.map((c) => (
              <option key={c.code} value={c.code}>
                {lang === "de" ? c.nameDe : c.nameEn}
              </option>
            ))}
          </Select>
          <Button
            variant="primary"
            size="sm"
            className="shrink-0"
            onClick={addCountry}
            disabled={!pending}
          >
            {t(lang, "add")}
          </Button>
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
