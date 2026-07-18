"use client";

import { useState } from "react";
import { type Lang, t } from "../i18n";
import type { Settings } from "../settings-types";
import { InfoTooltip } from "../info-tooltip";
import { FieldHint } from "../field-hint";
import { TypeToConfirmDialog } from "../type-to-confirm-dialog";
import { resetAppToCleanSlate } from "../app-reset";
import { FOCUS_RING, INTERACTIVE, TRANSITION } from "../interaction-styles";

interface GeneralSectionProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
}

/** The exact phrase the user must type to confirm a full reset. Deliberately a
 *  fixed English phrase (a friction gate), not localized. */
const RESET_CONFIRM_PHRASE = "yes, reset everything";

export function GeneralSection({ lang, settings, onChange }: GeneralSectionProps) {
  const [resetOpen, setResetOpen] = useState(false);
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
              className={`h-4 w-4 cursor-pointer rounded border-line text-ui-dark-blue ${FOCUS_RING} ${TRANSITION}`}
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
            className={`w-20 rounded-md border border-line px-2 py-1 text-sm ${FOCUS_RING} ${TRANSITION}`}
          />
        </label>
      </div>

      <hr className="my-4 border-line" />

      {/* Danger zone — full factory reset (detaches projects, no file/DB delete). */}
      <div className="mb-2">
        <h3 className="text-sm font-semibold text-ui-pink-strong">
          {t(lang, "settingsResetHeading")}
        </h3>
        <FieldHint className="mt-1">{t(lang, "settingsResetDesc")}</FieldHint>
        <button
          type="button"
          onClick={() => setResetOpen(true)}
          className={`mt-3 rounded-md border border-ui-pink/50 bg-surface px-4 py-2 text-sm font-medium text-ui-pink-strong hover:bg-ui-pink/10 ${INTERACTIVE}`}
        >
          {t(lang, "settingsResetButton")}
        </button>
      </div>

      {resetOpen && (
        <TypeToConfirmDialog
          lang={lang}
          title={t(lang, "settingsResetDialogTitle")}
          message={t(lang, "settingsResetDialogMessage")}
          confirmValue={RESET_CONFIRM_PHRASE}
          confirmLabel={t(lang, "settingsResetConfirmLabel")}
          onConfirm={() => resetAppToCleanSlate()}
          onCancel={() => setResetOpen(false)}
        />
      )}
    </>
  );
}
