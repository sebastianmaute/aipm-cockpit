"use client";

import { useState } from "react";
import { type Lang, t } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { useDraggable } from "./use-draggable";
import { SegmentedControl } from "./segmented-control";
import {
  BUDGET_TYPES,
  SUPPORTED_CURRENCIES,
  type BudgetBucket,
  type BudgetCurrency,
  type Discipline,
  type Grade,
  type Resource,
  type Role,
} from "./types";
import { roleLabel, resourceDisplayName } from "./resource-foundation";

interface BudgetBucketModalProps {
  lang: Lang;
  bucket: BudgetBucket;
  allBuckets: readonly BudgetBucket[];
  roles: readonly Role[];
  disciplines: readonly Discipline[];
  grades: readonly Grade[];
  resources: readonly Resource[];
  onSave: (bucket: BudgetBucket) => void;
  onClose: () => void;
}

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export function BudgetBucketModal({
  lang,
  bucket,
  allBuckets,
  roles,
  disciplines,
  grades,
  resources,
  onSave,
  onClose,
}: BudgetBucketModalProps) {
  const [draft, setDraft] = useState<BudgetBucket>(bucket);
  const [error, setError] = useState<string | null>(null);
  const [roleToAdd, setRoleToAdd] = useState<string>("");
  const { offset, handleProps } = useDraggable(true);

  const allocatedRoleIds = new Set(draft.allocations.map((a) => a.roleId));
  const addableRoles = roles.filter((r) => !allocatedRoleIds.has(r.id));

  const addRole = () => {
    const id = Number(roleToAdd);
    if (!id || allocatedRoleIds.has(id)) return;
    setDraft((d) => ({
      ...d,
      allocations: [
        ...d.allocations,
        { roleId: id, resourceIds: [], budgetHours: {}, actualHours: {} },
      ],
    }));
    setRoleToAdd("");
  };

  const removeRole = (roleId: number) =>
    setDraft((d) => ({
      ...d,
      allocations: d.allocations.filter((a) => a.roleId !== roleId),
    }));

  const toggleResource = (roleId: number, resourceId: number) =>
    setDraft((d) => ({
      ...d,
      allocations: d.allocations.map((a) =>
        a.roleId !== roleId
          ? a
          : {
              ...a,
              resourceIds: a.resourceIds.includes(resourceId)
                ? a.resourceIds.filter((rid) => rid !== resourceId)
                : [...a.resourceIds, resourceId],
            },
      ),
    }));

  const save = () => {
    if (!draft.name.trim()) {
      setError(t(lang, "budgetNameRequired"));
      return;
    }
    if (draft.startDate > draft.endDate) {
      setError(t(lang, "budgetDateRangeInvalid"));
      return;
    }
    onSave({ ...draft, localModifiedAt: new Date().toISOString() });
  };

  const isFixed = draft.type === "fixed";

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel={t(lang, "budgetEditBucket")}
      backdropClassName="bg-AIPM-dark-blue/40 overflow-y-auto"
    >
      <div
        data-modal-panel
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        className="relative flex w-[640px] min-w-[460px] max-w-[95vw] resize flex-col overflow-hidden rounded-xl border border-AIPM-light-grey bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <ModalHeader
          lang={lang}
          title={t(lang, "budgetEditBucket")}
          onClose={onClose}
          dragHandleProps={handleProps}
        />

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-6 sm:grid-cols-2">
          {/* Bucket name */}
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span>{t(lang, "budgetBucketName")}</span>
            <input
              className={inputClass}
              value={draft.name}
              onChange={(e) =>
                setDraft((d) => ({ ...d, name: e.target.value }))
              }
            />
          </label>

          {/* PO number */}
          <label className="flex flex-col gap-1 text-sm">
            <span>{t(lang, "budgetPoNumber")}</span>
            <input
              className={inputClass}
              value={draft.poNumber ?? ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  poNumber: e.target.value || undefined,
                }))
              }
            />
          </label>

          {/* Type */}
          <div className="flex flex-col gap-1 text-sm">
            <span>{t(lang, "budgetType")}</span>
            <SegmentedControl
              value={draft.type}
              ariaLabel={t(lang, "budgetType")}
              options={BUDGET_TYPES.map((bt) => ({
                value: bt,
                label: t(
                  lang,
                  bt === "fixed" ? "budgetTypeFixed" : "budgetTypeTm",
                ),
              }))}
              onChange={(type) => setDraft((d) => ({ ...d, type }))}
            />
          </div>

          {/* Currency */}
          <label className="flex flex-col gap-1 text-sm">
            <span>{t(lang, "budgetCurrency")}</span>
            <select
              className={inputClass}
              value={draft.currency}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  currency: e.target.value as BudgetCurrency,
                }))
              }
            >
              {SUPPORTED_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          {/* Fixed-price amount (conditional) */}
          {isFixed && (
            <label className="flex flex-col gap-1 text-sm">
              <span>{t(lang, "budgetFixedPriceAmount")}</span>
              <input
                className={inputClass}
                type="number"
                min={0}
                value={draft.fixedPriceAmount ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    fixedPriceAmount:
                      e.target.value === ""
                        ? undefined
                        : Number(e.target.value),
                  }))
                }
              />
            </label>
          )}

          {/* Start date */}
          <label className="flex flex-col gap-1 text-sm">
            <span>{t(lang, "budgetStartDate")}</span>
            <input
              className={inputClass}
              type="date"
              value={draft.startDate}
              onChange={(e) =>
                setDraft((d) => ({ ...d, startDate: e.target.value }))
              }
            />
          </label>

          {/* End date */}
          <label className="flex flex-col gap-1 text-sm">
            <span>{t(lang, "budgetEndDate")}</span>
            <input
              className={inputClass}
              type="date"
              value={draft.endDate}
              onChange={(e) =>
                setDraft((d) => ({ ...d, endDate: e.target.value }))
              }
            />
          </label>

          {/* Successor bucket */}
          <label className="flex flex-col gap-1 text-sm">
            <span>{t(lang, "budgetSuccessor")}</span>
            <select
              className={inputClass}
              value={draft.successorId ?? ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  successorId:
                    e.target.value === "" ? null : Number(e.target.value),
                }))
              }
            >
              <option value="">{t(lang, "budgetSuccessorNone")}</option>
              {allBuckets
                .filter((b) => b.id !== draft.id)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </label>

          {/* Manual FX rate */}
          <label className="flex flex-col gap-1 text-sm">
            <span>{t(lang, "budgetFxOverride")}</span>
            <input
              className={inputClass}
              type="number"
              min={0}
              step="0.0001"
              value={draft.fxRateOverride ?? ""}
              title={t(lang, "budgetFxOverrideHint")}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  fxRateOverride:
                    e.target.value === ""
                      ? undefined
                      : Number(e.target.value),
                }))
              }
            />
            <span className="text-xs text-AIPM-medium-grey">
              {t(lang, "budgetFxOverrideHint")}
            </span>
          </label>

          {/* Role allocations */}
          <div className="flex flex-col gap-2 text-sm sm:col-span-2">
            <span className="font-medium">{t(lang, "budgetAllocations")}</span>

            {draft.allocations.map((a) => (
              <div
                key={a.roleId}
                className="rounded-md border border-zinc-200 p-2 dark:border-zinc-800"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {roleLabel(
                      roles.find((r) => r.id === a.roleId),
                      disciplines,
                      grades,
                    ) || `#${a.roleId}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeRole(a.roleId)}
                    className="rounded-md border border-transparent px-2 py-0.5 text-xs text-zinc-500 hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    {t(lang, "budgetRemoveRole")}
                  </button>
                </div>

                {resources.length > 0 && (
                  <div className="mt-1">
                    <div className="text-xs text-AIPM-medium-grey">
                      {t(lang, "budgetResources")}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {resources.map((r) => (
                        <label
                          key={r.id}
                          className="flex items-center gap-1 text-xs"
                        >
                          <input
                            type="checkbox"
                            checked={a.resourceIds.includes(r.id)}
                            onChange={() => toggleResource(a.roleId, r.id)}
                          />
                          {resourceDisplayName(r)}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Add role row */}
            <div className="flex items-center gap-2">
              <select
                className={`${inputClass} flex-1`}
                value={roleToAdd}
                onChange={(e) => setRoleToAdd(e.target.value)}
                disabled={addableRoles.length === 0}
                aria-label={t(lang, "budgetAddRole")}
              >
                <option value="">
                  {addableRoles.length === 0
                    ? t(lang, "budgetNoRolesLeft")
                    : "—"}
                </option>
                {addableRoles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {roleLabel(r, disciplines, grades) || `#${r.id}`}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={addRole}
                disabled={roleToAdd === ""}
                className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-AIPM-dark-blue/90 disabled:opacity-50"
              >
                + {t(lang, "budgetAddRole")}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-sm text-AIPM-pink sm:col-span-2">{error}</p>
          )}
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-AIPM-light-grey px-6 py-4 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-AIPM-dark-grey shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-AIPM-light-grey dark:hover:bg-zinc-800"
          >
            {t(lang, "cancel")}
          </button>
          <button
            type="button"
            onClick={save}
            className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-AIPM-dark-blue/90"
          >
            {t(lang, "raidSave")}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
