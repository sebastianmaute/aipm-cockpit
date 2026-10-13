// The Functions picker: mode badge, Simple / Advanced presets and one checkbox per
// feature module. Extracted from the create-project wizard's step 3 (§706) so Edit
// project and the Time bookings view share it.
//
// §707: a module that reads from other modules (`FeatureModule.uses`) shows a
// `UsesNotice` under its checkbox while any of them is off. The notice only says so
// and offers to turn them on — switching a module on never switches another one on.

import { useId } from "react";
import { Button } from "./button";
import { FieldHint } from "./field-hint";
import {
  ALL_MODULE_IDS,
  FEATURE_MODULES,
  type FeatureModuleId,
  MODE_LABEL_KEY,
  deriveMode,
  missingUses,
} from "./feature-modules";
import { Checkbox } from "./form-controls";
import { t, type Lang, type TranslationKey } from "./i18n";

/** The sentence saying what a module uses. A module with `uses` but no entry here
 *  still gets the "X is off" part of its notice. */
const USES_SENTENCE_KEY: Partial<Record<FeatureModuleId, TranslationKey>> = {
  timelog: "functionsUsesTimelog",
};

// Complete by construction: `FEATURE_MODULES` is the registry `FeatureModuleId` describes, so a
// lookup cannot miss and needs no fallback label.
const LABEL_KEY_BY_ID = Object.fromEntries(
  FEATURE_MODULES.map((m) => [m.id, m.labelKey]),
) as Record<FeatureModuleId, TranslationKey>;

/** Two names keep the translated "{0} and {1}"; three or more are joined by the locale's own
 *  list rule (Oxford comma in en-US, "und" in de) instead of an English ", ". */
function moduleNames(lang: Lang, ids: readonly FeatureModuleId[]): string {
  const names = ids.map((id) => t(lang, LABEL_KEY_BY_ID[id]));
  if (names.length === 2) return t(lang, "functionsUsesJoin", names[0], names[1]);
  return new Intl.ListFormat(lang, { type: "conjunction" }).format(names);
}

/** What a module uses and which of that is off. `onTurnOn` is optional: without it the
 *  notice is read-only (no button). */
export function UsesNotice({
  lang,
  moduleId,
  missing,
  onTurnOn,
  id,
}: {
  lang: Lang;
  moduleId: FeatureModuleId;
  missing: readonly FeatureModuleId[];
  onTurnOn?: () => void;
  /** Lets the module's checkbox point at the notice with `aria-describedby`. */
  id?: string;
}) {
  if (missing.length === 0) return null;
  const sentenceKey = USES_SENTENCE_KEY[moduleId];
  const names = moduleNames(lang, missing);
  const offText =
    missing.length === 1 ? t(lang, "functionsUsesOneOff", names) : t(lang, "functionsUsesBothOff");
  return (
    <div id={id} role="status" className="ml-6 flex flex-col items-start gap-1.5 text-sm text-muted-foreground">
      <p>
        {sentenceKey ? `${t(lang, sentenceKey)} ` : ""}
        {offText}
      </p>
      {onTurnOn && (
        <Button
          variant="secondary"
          size="sm"
          aria-label={t(lang, "functionsUsesTurnOnLabel", names)}
          onClick={onTurnOn}
        >
          {t(lang, "functionsUsesTurnOn")}
        </Button>
      )}
    </div>
  );
}

export function FunctionsPicker({
  lang,
  features,
  onChange,
}: {
  lang: Lang;
  features: readonly FeatureModuleId[];
  onChange: (next: FeatureModuleId[]) => void;
}) {
  const mode = deriveMode(features);
  // Namespaces the description ids so two mounted pickers (a dialog over a view) cannot collide.
  const idBase = useId();
  const toggle = (id: FeatureModuleId) =>
    onChange(features.includes(id) ? features.filter((x) => x !== id) : [...features, id]);
  const turnOn = (missing: readonly FeatureModuleId[]) => {
    const next = new Set<FeatureModuleId>([...features, ...missing]);
    onChange(ALL_MODULE_IDS.filter((id) => next.has(id)));
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{t(lang, "modeBadgeLabel")}:</span>
        <span className="rounded-full bg-ui-green/15 px-3 py-1 text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">
          {t(lang, MODE_LABEL_KEY[mode])}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          aria-label={t(lang, "modeApplySimplePreset")}
          onClick={() => onChange([])}
        >
          {t(lang, "modePresetSimple")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          aria-label={t(lang, "modeApplyAdvancedPreset")}
          onClick={() => onChange([...ALL_MODULE_IDS])}
        >
          {t(lang, "modePresetAdvanced")}
        </Button>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-foreground">
          {t(lang, "modeModulesHeading")}
        </legend>
        {FEATURE_MODULES.map((m) => {
          const missing = missingUses(m.id, features);
          const noticeId = `${idBase}-uses-${m.id}`;
          // The checkbox is described by its hint and, while it shows, by the uses notice.
          const describedBy = [
            m.descKey ? `${idBase}-desc-${m.id}` : null,
            missing.length > 0 ? noticeId : null,
          ].filter((x): x is string => x !== null).join(" ");
          return (
            <div key={m.id} className="flex flex-col gap-1.5">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={features.includes(m.id)}
                  onChange={() => toggle(m.id)}
                  aria-describedby={describedBy || undefined}
                />
                <span>{t(lang, m.labelKey)}</span>
              </label>
              {/* A SEPARATE span linked by aria-describedby — nested in the <label> it would fold
                  into the checkbox's accessible name and break exact-name queries. */}
              {m.descKey && (
                <FieldHint as="span" id={`${idBase}-desc-${m.id}`} className="ml-6">
                  {t(lang, m.descKey)}
                </FieldHint>
              )}
              <UsesNotice id={noticeId} lang={lang} moduleId={m.id} missing={missing} onTurnOn={() => turnOn(missing)} />
            </div>
          );
        })}
      </fieldset>

      <p className="rounded-md bg-[var(--rag-amber)]/20 px-3 py-2 text-xs text-ui-dark-blue dark:text-ui-light-grey">
        {t(lang, "modeRetentionNote")}
      </p>
    </>
  );
}
