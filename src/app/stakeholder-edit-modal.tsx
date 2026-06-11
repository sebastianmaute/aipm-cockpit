"use client";

// Stakeholder edit modal — create / edit / delete a Stakeholder with embedded
// RACI-by-milestone sub-section. Mirrors ChangeEditModal's structure (sticky/
// draggable header, two-column grid form, validation error alert, Delete-left /
// Cancel+Save-right footer). Built as a standalone component using the shared
// Modal + ModalHeader + useDraggable, like change-edit-modal.tsx.

import { useEffect, useState } from "react";
import { type Lang, t, type TranslationKey } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import {
  RACI_ROLES,
  STAKEHOLDER_CATEGORIES,
  type InfluenceInterest,
  type Milestone,
  type RaciRole,
  type Resource,
  type Stakeholder,
  type StakeholderCategory,
} from "./types";
import { InfluenceInterestMatrix } from "./influence-interest-matrix";
import { useDraggable } from "./use-draggable";
import { setRaciRole } from "./stakeholders";
import { ResourcePicker } from "./resource-picker";
import { CharCounter, useAdjustmentTracker } from "./field-feedback";
import { DocumentLinksFieldGated } from "./document-links-field-gated";
import { describeTextCap } from "./sanitize-report";
import { BUDGET_NAME_MAX, TEXTAREA_MAX } from "./sanitize";
import { useToastContext } from "./toast-context";

export interface StakeholderEditModalProps {
  lang: Lang;
  draft: Stakeholder;
  isNew: boolean;
  milestones: readonly Milestone[];
  resources: readonly Resource[];
  onChange: (next: Stakeholder) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

const CATEGORY_LABEL_KEYS: Record<StakeholderCategory, TranslationKey> = {
  Internal: "stakeholderCategoryInternal",
  Customer: "stakeholderCategoryCustomer",
  Vendor: "stakeholderCategoryVendor",
  Sponsor: "stakeholderCategorySponsor",
  Regulator: "stakeholderCategoryRegulator",
  Other: "stakeholderCategoryOther",
};

const LEVEL_LABEL_KEYS: Record<InfluenceInterest, TranslationKey> = {
  Low: "levelLow",
  Medium: "levelMedium",
  High: "levelHigh",
};

const RACI_LABEL_KEYS: Record<RaciRole, TranslationKey> = {
  R: "raciRoleR",
  A: "raciRoleA",
  C: "raciRoleC",
  I: "raciRoleI",
};

const INPUT_CLASS = "rounded-md border border-line bg-surface px-3 py-2 text-sm";

export function StakeholderEditModal({
  lang,
  draft,
  isNew,
  milestones,
  resources,
  onChange,
  onSave,
  onCancel,
  onDelete,
}: StakeholderEditModalProps) {
  const [error, setError] = useState<string | null>(null);
  const showToast = useToastContext();
  const adj = useAdjustmentTracker();

  const { offset, handleProps } = useDraggable(true);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function update<K extends keyof Stakeholder>(key: K, value: Stakeholder[K]) {
    setError(null);
    onChange({ ...draft, [key]: value });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.name.trim()) {
      setError(t(lang, "raidErrorTitleRequired"));
      return;
    }
    setError(null);
    adj.reset();
    adj.track(describeTextCap(draft.name, BUDGET_NAME_MAX));
    adj.track(describeTextCap(draft.organization ?? "", BUDGET_NAME_MAX));
    adj.track(describeTextCap(draft.title ?? "", BUDGET_NAME_MAX));
    adj.track(describeTextCap(draft.email ?? "", BUDGET_NAME_MAX));
    adj.track(describeTextCap(draft.notes ?? "", TEXTAREA_MAX));
    if (adj.count() > 0) showToast("info", t(lang, "fieldsAdjusted", adj.count()));
    onSave();
  }

  const title = isNew ? t(lang, "stakeholdersAdd") : t(lang, "navStakeholders");
  const saveDisabled = !draft.name.trim();

  return (
    <Modal
      open
      onClose={onCancel}
      ariaLabel={title}
      align="center"
      backdropClassName="bg-AIPM-dark-blue/40"
      zIndex={50}
    >
      <div
        data-modal-panel
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        className="relative flex w-[720px] min-w-[460px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <ModalHeader
          lang={lang}
          title={title}
          onClose={onCancel}
          dragHandleProps={handleProps}
        />

        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-1 gap-4 overflow-y-auto p-6 sm:grid-cols-2"
        >
          {/* Name */}
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-foreground">
              {t(lang, "stakeholderFieldName")} *
            </span>
            <ResourcePicker
              lang={lang}
              value={{ name: draft.name, email: draft.email ?? "", resourceId: draft.resourceId }}
              resources={resources}
              contacts={[]}
              onChange={(next) =>
                onChange({ ...draft, name: next.name, resourceId: next.resourceId })
              }
              maxLength={BUDGET_NAME_MAX}
              aria-required
              aria-describedby="stakeholder-name-counter"
            />
            <CharCounter value={draft.name} max={BUDGET_NAME_MAX} id="stakeholder-name-counter" lang={lang} />
          </label>

          {/* Organization */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t(lang, "stakeholderFieldOrganization")}
            </span>
            <input
              type="text"
              value={draft.organization ?? ""}
              onChange={(e) => update("organization", e.target.value || undefined)}
              onBlur={(e) => {
                const trimmed = describeTextCap(e.target.value, BUDGET_NAME_MAX).value.trim();
                update("organization", trimmed || undefined);
              }}
              aria-describedby="stakeholder-organization-counter"
              className={INPUT_CLASS}
            />
            <CharCounter value={draft.organization ?? ""} max={BUDGET_NAME_MAX} id="stakeholder-organization-counter" lang={lang} />
          </label>

          {/* Title */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t(lang, "stakeholderFieldTitle")}
            </span>
            <input
              type="text"
              value={draft.title ?? ""}
              onChange={(e) => update("title", e.target.value || undefined)}
              onBlur={(e) => {
                const trimmed = describeTextCap(e.target.value, BUDGET_NAME_MAX).value.trim();
                update("title", trimmed || undefined);
              }}
              aria-describedby="stakeholder-title-counter"
              className={INPUT_CLASS}
            />
            <CharCounter value={draft.title ?? ""} max={BUDGET_NAME_MAX} id="stakeholder-title-counter" lang={lang} />
          </label>

          {/* Email */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t(lang, "stakeholderFieldEmail")}
            </span>
            <input
              type="text"
              value={draft.email ?? ""}
              onChange={(e) => update("email", e.target.value || undefined)}
              onBlur={(e) => {
                const trimmed = describeTextCap(e.target.value, BUDGET_NAME_MAX).value.trim();
                update("email", trimmed || undefined);
              }}
              aria-describedby="stakeholder-email-counter"
              className={INPUT_CLASS}
            />
            <CharCounter value={draft.email ?? ""} max={BUDGET_NAME_MAX} id="stakeholder-email-counter" lang={lang} />
          </label>

          {/* Category */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t(lang, "stakeholderFieldCategory")}
            </span>
            <select
              aria-label={t(lang, "stakeholderFieldCategory")}
              value={draft.category}
              onChange={(e) => update("category", e.target.value as StakeholderCategory)}
              className={INPUT_CLASS}
            >
              {STAKEHOLDER_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {t(lang, CATEGORY_LABEL_KEYS[cat])}
                </option>
              ))}
            </select>
          </label>

          {/* Influence / Interest matrix — one click sets both */}
          <div className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-foreground">
              {t(lang, "stakeholderFieldInfluence")} / {t(lang, "stakeholderFieldInterest")}
            </span>
            <InfluenceInterestMatrix
              lang={lang}
              influence={draft.influence}
              interest={draft.interest}
              onPick={(influence, interest) => onChange({ ...draft, influence, interest })}
            />
            <span className="text-xs text-muted-foreground">
              {t(lang, "stakeholderFieldInfluence")}: {t(lang, LEVEL_LABEL_KEYS[draft.influence])}
              {" · "}
              {t(lang, "stakeholderFieldInterest")}: {t(lang, LEVEL_LABEL_KEYS[draft.interest])}
            </span>
          </div>

          {/* Notes */}
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-foreground">
              {t(lang, "stakeholderFieldNotes")}
            </span>
            <textarea
              rows={2}
              value={draft.notes ?? ""}
              onChange={(e) => update("notes", e.target.value || undefined)}
              onBlur={(e) => {
                const capped = describeTextCap(e.target.value, TEXTAREA_MAX).value;
                update("notes", capped || undefined);
              }}
              aria-describedby="stakeholder-notes-counter"
              className={INPUT_CLASS}
            />
            <CharCounter value={draft.notes ?? ""} max={TEXTAREA_MAX} id="stakeholder-notes-counter" lang={lang} />
          </label>

          {/* Document links */}
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-foreground">{t(lang, "documents")}</span>
            <DocumentLinksFieldGated
              value={draft.documentLinks ?? []}
              onChange={(links) => update("documentLinks", links)}
              lang={lang}
            />
          </label>

          {/* RACI by milestone */}
          <div className="sm:col-span-2">
            <span className="mb-2 block text-sm font-medium text-foreground">
              {t(lang, "raciSectionTitle")}
            </span>
            {milestones.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t(lang, "raciNoMilestones")}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {milestones.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 text-sm">
                    <span className="w-40 truncate text-foreground">{m.name}</span>
                    <select
                      aria-label={`${m.name} (RACI)`}
                      value={draft.raci[String(m.id)] ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        onChange(
                          setRaciRole(draft, m.id, val === "" ? null : (val as RaciRole)),
                        );
                      }}
                      className={INPUT_CLASS}
                    >
                      <option value="">{t(lang, "raciNone")}</option>
                      {RACI_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {t(lang, RACI_LABEL_KEYS[role])}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-md bg-AIPM-pink/10 px-3 py-2 text-sm text-AIPM-pink dark:bg-AIPM-pink/15 sm:col-span-2"
            >
              {error}
            </p>
          )}

          <footer className="flex items-center justify-between gap-2 border-t border-line pt-3 sm:col-span-2">
            <div>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(t(lang, "stakeholderConfirmDelete"))) onDelete();
                }}
                disabled={isNew}
                aria-label={t(lang, "stakeholdersDelete")}
                className="rounded-md border border-AIPM-pink/40 bg-surface px-3 py-1.5 text-sm font-medium text-AIPM-pink hover:bg-AIPM-pink/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-AIPM-pink/50"
              >
                {t(lang, "delete")}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted"
              >
                {t(lang, "cancel")}
              </button>
              <button
                type="submit"
                disabled={saveDisabled}
                className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-3 py-1.5 text-sm font-medium text-white hover:bg-AIPM-dark-blue/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t(lang, "raidSave")}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </Modal>
  );
}
