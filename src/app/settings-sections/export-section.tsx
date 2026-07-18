// src/app/settings-sections/export-section.tsx
"use client";

import { type Lang, type TranslationKey, t } from "../i18n";
import { FieldHint } from "../field-hint";
import { FOCUS_RING, TRANSITION } from "../interaction-styles";
import type { Settings } from "../settings-types";
import { EXPORT_SECTION_KEYS, defaultExportConfig, type ExportSectionKey } from "../settings-types";

interface ExportSectionProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
}

const LABEL_KEYS: Record<ExportSectionKey, TranslationKey> = {
  project: "exportLabelProject",
  tasks: "exportLabelTasks",
  raid: "exportLabelRaid",
  changes: "exportLabelChanges",
  milestones: "exportLabelMilestones",
  stakeholders: "exportLabelStakeholders",
  budgets: "exportLabelBudgets",
  resources: "exportLabelResources",
  roles: "exportLabelRoles",
  absences: "exportLabelAbsences",
  shifts: "exportLabelShifts",
  status: "exportLabelStatus",
};

export function ExportSection({ lang, settings, onChange }: ExportSectionProps) {
  const exportConfig = settings.export ?? defaultExportConfig;

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
        {EXPORT_SECTION_KEYS.map((key) => {
          const checked = exportConfig[key] ?? defaultExportConfig[key];
          return (
            <li key={key}>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => handleToggle(key, e.target.checked)}
                  className={`h-4 w-4 cursor-pointer rounded border-line text-AIPM-dark-blue ${FOCUS_RING} ${TRANSITION}`}
                />
                {t(lang, LABEL_KEYS[key])}
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
