"use client";

import { type Lang, t } from "../i18n";
import type { Settings } from "../settings-types";
import { InfoTooltip } from "../info-tooltip";

interface GeneralSectionProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
}

export function GeneralSection({ lang, settings, onChange }: GeneralSectionProps) {
  return (
    <>
      <div className="mb-4">
        <div className="flex items-center gap-1">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={settings.popout.reuseWindow}
              onChange={(e) =>
                onChange({
                  ...settings,
                  popout: { ...settings.popout, reuseWindow: e.target.checked },
                })
              }
              className="h-4 w-4 cursor-pointer rounded border-line text-AIPM-dark-blue focus:ring-AIPM-green"
            />
            <span className="text-sm text-foreground">
              {t(lang, "popoutReuseWindow")}
            </span>
          </label>
          <InfoTooltip text={t(lang, "popoutReuseWindowTooltip")} />
        </div>
      </div>

      <hr className="my-4 border-line" />

      <div className="mb-4">
        <label className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 text-sm text-foreground">
            {t(lang, "resourcesWorkdayHours")}
            <InfoTooltip text={t(lang, "resourcesWorkdayHoursTooltip")} />
          </span>
          <input
            type="number" min={1} max={24} step={0.5}
            value={settings.resources.workdayHours}
            onChange={(e) => {
              const n = Math.min(24, Math.max(1, Number(e.target.value) || 8));
              onChange({ ...settings, resources: { ...settings.resources, workdayHours: n } });
            }}
            className="w-20 rounded-md border border-line px-2 py-1 text-sm"
          />
        </label>
      </div>
    </>
  );
}
