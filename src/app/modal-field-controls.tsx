"use client";

// Reusable control cluster for an edit modal's header: a three-way tier switch
// (Simple / Advanced / Full) plus a cog popover that toggles individual fields.
// It owns no persistence — every action delegates to `useModalVisibility`, which
// reads from and writes to the workspace field-visibility config. Closing the cog
// on outside-click is intentionally not implemented (a click-toggle is enough).

import { useState } from "react";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import { MODAL_FIELDS, type FieldTier, type ModalId } from "./modal-fields";
import { useModalVisibility } from "./use-modal-visibility";
import { useSettings } from "./use-settings";

interface ModalFieldControlsProps {
  modalId: ModalId;
  lang: Lang;
}

const TIERS: readonly FieldTier[] = ["simple", "advanced", "full"];
const TIER_LABEL: Record<FieldTier, "fieldViewSimple" | "fieldViewAdvanced" | "fieldViewFull"> = {
  simple: "fieldViewSimple",
  advanced: "fieldViewAdvanced",
  full: "fieldViewFull",
};

const SEGMENT_BASE =
  "px-2.5 py-1 text-xs font-medium focus:outline-none focus:relative focus:z-10 focus:ring-1 focus:ring-AIPM-green";
const SEGMENT_ACTIVE = "bg-AIPM-dark-blue text-white";
const SEGMENT_INACTIVE = "text-foreground hover:bg-surface-muted";

export function ModalFieldControls({ modalId, lang }: ModalFieldControlsProps) {
  const { mode, isVisible, setMode, toggleField, reset } = useModalVisibility(modalId);
  const { settings } = useSettings();
  const [cogOpen, setCogOpen] = useState(false);

  // Per-device opt-out: hide the field-tier switch + per-field cog entirely.
  if (settings.showFieldConfig === false) return null;

  return (
    <div className="flex items-center gap-2">
      <div
        role="group"
        aria-label={t(lang, "fieldViewLabel")}
        className="inline-flex overflow-hidden rounded-md border border-line bg-surface text-xs"
      >
        {TIERS.map((tier, idx) => (
          <button
            key={tier}
            type="button"
            aria-pressed={mode === tier}
            onClick={() => setMode(tier)}
            className={[
              SEGMENT_BASE,
              idx > 0 ? "border-l border-line" : "",
              mode === tier ? SEGMENT_ACTIVE : SEGMENT_INACTIVE,
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {t(lang, TIER_LABEL[tier])}
          </button>
        ))}
        {mode === "custom" && (
          <span className={`${SEGMENT_BASE} border-l border-line ${SEGMENT_ACTIVE}`} aria-current="true">
            {t(lang, "fieldViewCustom")}
          </span>
        )}
      </div>

      <div className="relative">
        <button
          type="button"
          aria-label={t(lang, "configureFields")}
          aria-expanded={cogOpen}
          onClick={() => setCogOpen((o) => !o)}
          className="inline-flex items-center justify-center rounded-md border border-line bg-surface px-2 py-1 text-sm text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted focus:outline-none focus:ring-1 focus:ring-AIPM-green"
        >
          <span aria-hidden="true">⚙</span>
        </button>
        {cogOpen && (
          <div
            role="group"
            aria-label={t(lang, "configureFields")}
            className="absolute right-0 top-full z-40 mt-2 w-56 rounded-lg border border-line bg-surface p-3 shadow-sm"
          >
            <ul className="max-h-64 space-y-1 overflow-auto text-sm">
              {MODAL_FIELDS[modalId].map((f) => (
                <li key={f.id}>
                  <label className="flex items-center gap-2 text-foreground">
                    <input
                      type="checkbox"
                      checked={isVisible(f.id)}
                      disabled={f.required}
                      onChange={() => toggleField(f.id)}
                      className="accent-AIPM-green"
                    />
                    <span>{t(lang, f.labelKey)}</span>
                  </label>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={reset}
              className="mt-3 w-full rounded-md border border-line bg-surface px-2.5 py-1 text-xs font-medium text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted focus:outline-none focus:ring-1 focus:ring-AIPM-green"
            >
              {t(lang, "resetToDefault")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
