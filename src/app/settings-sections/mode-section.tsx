"use client";

import { useId } from "react";
import { type Lang, t } from "../i18n";
import type { Settings } from "../settings-types";
import {
  MAX_VERSION_RETENTION,
  MIN_VERSION_RETENTION,
  VERSION_RETENTION_STEP,
  sanitizeVersionRetention,
} from "../version-history";
import { Button } from "../button";
import { Input } from "../form-controls";
import { FieldHint } from "../field-hint";

interface ModeSectionProps {
  lang: Lang;
  settings: Settings;
  /** False while no project is open: the button is disabled and says why. */
  hasCurrentProject: boolean;
  /** Opens the current project's Edit project dialog, focused on its Functions. */
  onOpenProjectFunctions: () => void;
  /** Live settings patch (version-history retention saves immediately). */
  onChange: (s: Settings) => void;
}

/**
 * §706 — the settings section id stays `"mode"` (persisted deep links keep working) but it is now
 * the "Functions" pointer: functions are chosen per project, in Edit project, not here. The
 * version-history retention field stays, for expert mode only.
 */
export function ModeSection({ lang, settings, hasCurrentProject, onOpenProjectFunctions, onChange }: ModeSectionProps) {
  // Namespaced so two concurrent mounts (a settings pop-out beside the main window) cannot collide.
  const hintId = useId();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-ui-dark-blue dark:text-ui-light-grey">
          {t(lang, "settingsSectionMode")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t(lang, "settingsFunctionsPointer")}</p>
      </div>

      <div className="flex flex-col items-start gap-1">
        <Button
          variant="accent"
          size="md"
          disabled={!hasCurrentProject}
          aria-describedby={hasCurrentProject ? undefined : hintId}
          onClick={onOpenProjectFunctions}
        >
          {t(lang, "settingsFunctionsOpen")}
        </Button>
        {!hasCurrentProject && (
          <FieldHint as="span" id={hintId}>
            {t(lang, "settingsFunctionsNoProject")}
          </FieldHint>
        )}
      </div>

      {settings.expertMode === true && (
        <div className="border-t border-line pt-4">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <span className="font-medium">{t(lang, "versionRetentionLabel")}</span>
            <Input
              size="xs"
              type="number"
              min={MIN_VERSION_RETENTION}
              max={MAX_VERSION_RETENTION}
              step={VERSION_RETENTION_STEP}
              aria-label={t(lang, "versionRetentionLabel")}
              value={settings.versionHistoryRetention ?? MIN_VERSION_RETENTION}
              onChange={(e) =>
                onChange({
                  ...settings,
                  versionHistoryRetention: sanitizeVersionRetention(e.target.value),
                })
              }
              className="w-20 text-right tabular-nums"
            />
            <span className="text-xs text-muted-foreground">{t(lang, "versionRetentionUnit")}</span>
          </label>
          <FieldHint className="mt-1">{t(lang, "versionRetentionHelp")}</FieldHint>
        </div>
      )}
    </div>
  );
}
