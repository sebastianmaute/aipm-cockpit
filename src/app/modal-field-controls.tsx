"use client";

// The edit modals' field-visibility control: a trigger showing the ACTIVE tier
// (Simple / Advanced / Full / Custom) which opens a popover holding the tier
// switch plus a per-field checklist. It owns no persistence — every action
// delegates to `useModalVisibility`, which reads and writes the workspace
// field-visibility config.
//
// Mounted through `ModalHeader`'s `headerExtra` slot, so it sits in the header's
// right-hand cluster and costs NO vertical space. It previously owned a bordered
// strip below the header; that strip is gone, and with it the reason the strip
// was owned here (so the per-device opt-out left no empty band behind). The
// opt-out now simply removes the trigger.
//
// The tier switch is the shared `SegmentedControl` (a radiogroup with APG arrow
// navigation) — do not hand-roll `aria-pressed` buttons back in. Custom mode
// deliberately has NO option of its own: `SegmentedControl` handles a value
// matching no option by leaving the group unchecked, and the trigger's own label
// says "Custom".

import { useCallback, useRef, useState } from "react";
import { Cog6ToothIcon } from "@heroicons/react/24/outline";
import type { Lang, TranslationKey } from "./i18n";
import { t } from "./i18n";
import { MODAL_FIELDS, type FieldTier, type ModalId } from "./modal-fields";
import { Button } from "./button";
import { Checkbox } from "./form-controls";
import { PopoverPanel } from "./popover-panel";
import { SegmentedControl } from "./segmented-control";
import { useModalVisibility } from "./use-modal-visibility";
import { useSettings } from "./use-settings";

interface ModalFieldControlsProps {
  modalId: ModalId;
  lang: Lang;
}

const TIERS: readonly FieldTier[] = ["simple", "advanced", "full"];
const TIER_LABEL: Record<FieldTier | "custom", TranslationKey> = {
  simple: "fieldViewSimple",
  advanced: "fieldViewAdvanced",
  full: "fieldViewFull",
  custom: "fieldViewCustom",
};

export function ModalFieldControls({ modalId, lang }: ModalFieldControlsProps) {
  const { mode, isVisible, setMode, toggleField, reset } = useModalVisibility(modalId);
  const { settings } = useSettings();
  const [cogOpen, setCogOpen] = useState(false);
  const cogTriggerRef = useRef<HTMLButtonElement>(null);
  const closeCog = useCallback(() => setCogOpen(false), []);

  // Per-device opt-out: hide the control entirely.
  if (settings.showFieldConfig === false) return null;

  const tierLabel = t(lang, TIER_LABEL[mode]);

  return (
    <div className="relative inline-block">
      <Button
        ref={cogTriggerRef}
        variant="secondary"
        size="xs"
        // The visible label is the tier, so it LEADS the accessible name (WCAG
        // 2.5.3 label-in-name); the control's purpose follows it.
        aria-label={`${tierLabel} – ${t(lang, "configureFields")}`}
        title={t(lang, "configureFields")}
        aria-haspopup="dialog"
        aria-expanded={cogOpen}
        onClick={() => setCogOpen((o) => !o)}
        className="inline-flex items-center gap-1.5"
      >
        {tierLabel}
        <Cog6ToothIcon aria-hidden="true" className="h-4 w-4" />
      </Button>
      <PopoverPanel
        open={cogOpen}
        anchorRef={cogTriggerRef}
        onClose={closeCog}
        role="dialog"
        ariaLabel={t(lang, "configureFields")}
        // w-72 (not w-56): three German tier labels at the primitive's text-sm
        // px-3 are wider than 224px. The primitive wraps rather than clipping.
        className="w-72 p-3 shadow-[var(--shadow-control)]"
      >
        <SegmentedControl<FieldTier | "custom">
          value={mode}
          ariaLabel={t(lang, "fieldViewLabel")}
          options={TIERS.map((tier) => ({ value: tier, label: t(lang, TIER_LABEL[tier]) }))}
          // "custom" is never an option, so this only narrows the primitive's
          // generic back to what `setMode` accepts — cast-free.
          onChange={(next) => {
            if (next !== "custom") setMode(next);
          }}
          className="w-full"
        />
        <ul className="mt-3 max-h-64 space-y-1 overflow-auto border-t border-line pt-3 text-sm">
          {MODAL_FIELDS[modalId].map((f) => (
            <li key={f.id}>
              <label className="flex items-center gap-2 text-foreground">
                <Checkbox
                  checked={isVisible(f.id)}
                  disabled={f.required}
                  onChange={() => toggleField(f.id)}
                />
                <span>{t(lang, f.labelKey)}</span>
              </label>
            </li>
          ))}
        </ul>
        <Button variant="secondary" size="xs" onClick={reset} className="mt-3 w-full">
          {t(lang, "resetToDefault")}
        </Button>
      </PopoverPanel>
    </div>
  );
}
