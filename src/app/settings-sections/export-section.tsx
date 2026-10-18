// src/app/settings-sections/export-section.tsx
"use client";

import { type Lang, t } from "../i18n";
import { FieldHint } from "../field-hint";
import type { Settings } from "../settings-types";
import { EXPORT_SECTION_KEYS, defaultExportConfig, type ExportSectionKey } from "../settings-types";
import { EXPORT_SECTION_LABEL_KEYS } from "../export-section-labels";
import { Checkbox } from "../form-controls";
import { isSimulationActive } from "../forecast-simulation";
import { useWorkspace } from "../workspace-context";

interface ExportSectionProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
}

export function ExportSection({ lang, settings, onChange }: ExportSectionProps) {
  const exportConfig = settings.export ?? defaultExportConfig;
  // §502 part 4 — the simulated forecast decision is offered only while the simulation is active (the Forecast view
  // enabled AND the project's switch on): the same `isSimulationActive` that decides whether the section is emitted
  // and whether the document block select offers it. The stored flag is kept either way.
  const { settingsOverrides } = useWorkspace();
  const offered = isSimulationActive(settingsOverrides, settings.features);
  const keys = EXPORT_SECTION_KEYS.filter((k) => k !== "forecastDecision" || offered);

  function handleToggle(key: ExportSectionKey, checked: boolean) {
    onChange({
      ...settings,
      export: { ...exportConfig, [key]: checked },
    });
  }

  return (
    <div className="mb-4">
      <FieldHint className="mb-4">
        {t(lang, "exportSectionHint")}
      </FieldHint>

      <ul className="space-y-2" aria-label={t(lang, "settingsSectionExport")}>
        {keys.map((key) => {
          const checked = exportConfig[key] ?? defaultExportConfig[key];
          return (
            <li key={key}>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <Checkbox
                  checked={checked}
                  onChange={(e) => handleToggle(key, e.target.checked)}
                />
                {t(lang, EXPORT_SECTION_LABEL_KEYS[key])}
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
