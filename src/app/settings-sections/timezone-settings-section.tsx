"use client";

import { useState } from "react";
import { type Lang, t } from "../i18n";
import type { Settings } from "../settings-types";
import { browserTimeZone, isValidTimeZone, tzZones } from "../timezone";
import { FOCUS_RING, TRANSITION } from "../interaction-styles";
import { Button } from "../button";
import { Select } from "../form-controls";
import { RemovableChipRow } from "./removable-chip-row";
import { FieldHint } from "../field-hint";

interface TimezoneSettingsSectionProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
  /** Hide the "show display-tz switcher" checkbox — it writes a device-only
   *  display flag that the per-project override context can't capture, so it's
   *  omitted there rather than rendered as a dead control. */
  hideDisplaySwitcher?: boolean;
}

export function TimezoneSettingsSection({
  lang,
  settings,
  onChange,
  hideDisplaySwitcher = false,
}: TimezoneSettingsSectionProps) {
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
        <Select
          className="w-full"
          value={settings.timezone ?? ""}
          aria-label={t(lang, "tzDefaultLabel")}
          onChange={(e) => setDefault(e.target.value)}
        >
          <option value="">{`${t(lang, "tzSystemDefault")} (${browserTimeZone()})`}</option>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </Select>
      </label>

      <div>
        <span className="mb-1 block text-sm font-medium text-foreground">
          {t(lang, "tzAdditionalLabel")}
        </span>
        <div className="flex gap-2">
          <Select
            className="min-w-0 flex-1"
            value={pending}
            aria-label={t(lang, "tzAddLabel")}
            onChange={(e) => setPending(e.target.value)}
          >
            <option value="">{t(lang, "tzAddLabel")}</option>
            {zones
              .filter((z) => !additional.includes(z) && z !== defaultZone)
              .map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
          </Select>
          <Button
            variant="primary"
            size="sm"
            className="shrink-0"
            onClick={addZone}
            disabled={!pending}
          >
            {t(lang, "tzAddLabel")}
          </Button>
        </div>

        {additional.length > 0 && (
          <ul className="mt-2 space-y-1">
            {additional.map((zone) => (
              <RemovableChipRow
                key={zone}
                label={zone}
                ariaLabel={`${t(lang, "tzRemoveLabel")} – ${zone}`}
                onRemove={() => removeZone(zone)}
              />
            ))}
          </ul>
        )}
      </div>

      {!hideDisplaySwitcher && (
        <div className="mt-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!settings.showDisplayTzSwitcher}
              onChange={(e) => onChange({ ...settings, showDisplayTzSwitcher: e.target.checked })}
              className={`${FOCUS_RING} ${TRANSITION}`}
            />
            {t(lang, "tzShowSwitcher")}
          </label>
          <FieldHint className="mt-1">{t(lang, "tzShowSwitcherHint")}</FieldHint>
        </div>
      )}
    </>
  );
}
