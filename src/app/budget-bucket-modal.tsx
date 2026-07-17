"use client";

import { useId, useState } from "react";
import { type Lang, t } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { useDraggable } from "./use-draggable";
import { useResizable } from "./use-resizable";
import { SegmentedControl } from "./segmented-control";
import {
  BUDGET_TYPES,
  SUPPORTED_CURRENCIES,
  type BudgetBucket,
  type BudgetCurrency,
  type Discipline,
  type DisciplineAllocation,
  type Grade,
  type PlanningMode,
  type Resource,
  type Role,
} from "./types";
import { roleLabel, resourceDisplayName } from "./resource-foundation";
import { CharCounter, FieldNotice, useAdjustmentTracker } from "./field-feedback";
import { describeTextCap, describeClamp } from "./sanitize-report";
import { BUDGET_NAME_MAX, PO_NUMBER_MAX, AMOUNT_MAX } from "./sanitize";
import { useToastContext } from "./toast-context";
import { ModalFieldControls } from "./modal-field-controls";
import { useModalVisibility } from "./use-modal-visibility";
import { InfoTooltip } from "./info-tooltip";
import { INTERACTIVE } from "./interaction-styles";
import { Checkbox, fieldClass } from "./form-controls";
import { useConfirm } from "./confirm-dialog";

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

const inputClass = fieldClass();

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
  const [disciplineToAdd, setDisciplineToAdd] = useState<string>("");
  const [notice, setNotice] = useState<Record<string, string>>({});
  const { offset, reset: dragReset, handleProps } = useDraggable(true, "aipm-cockpit:modal-pos:budget-bucket");
  const { ref: sizeRef, reset: sizeReset } = useResizable("aipm-cockpit:modal-size:budget-bucket");
  const { isVisible } = useModalVisibility("budget");
  const showToast = useToastContext();
  const confirm = useConfirm();
  const adj = useAdjustmentTracker();
  const fixedPriceNoticeId = useId();
  const fxNoticeId = useId();
  const rateIntNoticeId = useId();
  const rateExtNoticeId = useId();

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

  const toggleDisciplineResource = (disciplineId: number, resourceId: number) =>
    setDraft((d) => ({
      ...d,
      disciplineAllocations: (d.disciplineAllocations ?? []).map((a) =>
        a.disciplineId !== disciplineId
          ? a
          : {
              ...a,
              resourceIds: a.resourceIds.includes(resourceId)
                ? a.resourceIds.filter((rid) => rid !== resourceId)
                : [...a.resourceIds, resourceId],
            },
      ),
    }));

  const isBlended = draft.planningMode === "blended";
  const hasDetailedHours = draft.allocations.some(
    (a) => Object.keys(a.budgetHours).length > 0 || Object.keys(a.actualHours).length > 0,
  );
  const hasBlendedHours = (draft.disciplineAllocations ?? []).some(
    (a) => Object.keys(a.budgetHours).length > 0 || Object.keys(a.actualHours).length > 0,
  );

  const togglePlanningMode = async () => {
    if (!isBlended) {
      if (hasDetailedHours && !(await confirm({ message: t(lang, "budgetSwitchToBlendedWarn") }))) return;
      setDraft((d) => ({
        ...d,
        planningMode: "blended" as PlanningMode,
        allocations: d.allocations.map((a) => ({ ...a, budgetHours: {}, actualHours: {} })),
        disciplineAllocations: d.disciplineAllocations ?? [],
      }));
    } else {
      if (hasBlendedHours && !(await confirm({ message: t(lang, "budgetSwitchToDetailedWarn") }))) return;
      setDraft((d) => ({
        ...d,
        planningMode: "detailed" as PlanningMode,
        disciplineAllocations: (d.disciplineAllocations ?? []).map((a) => ({ ...a, budgetHours: {}, actualHours: {} })),
      }));
    }
  };

  const allocatedDisciplineIds = new Set((draft.disciplineAllocations ?? []).map((a) => a.disciplineId));
  const addableDisciplines = disciplines.filter((x) => !allocatedDisciplineIds.has(x.id));

  const addDiscipline = () => {
    const id = Number(disciplineToAdd);
    if (!id || allocatedDisciplineIds.has(id)) return;
    setDraft((d) => ({
      ...d,
      disciplineAllocations: [
        ...(d.disciplineAllocations ?? []),
        { disciplineId: id, resourceIds: [], budgetHours: {}, actualHours: {} } satisfies DisciplineAllocation,
      ],
    }));
    setDisciplineToAdd("");
  };

  const removeDiscipline = (disciplineId: number) =>
    setDraft((d) => ({
      ...d,
      disciplineAllocations: (d.disciplineAllocations ?? []).filter((a) => a.disciplineId !== disciplineId),
    }));

  const save = () => {
    setError(null);
    if (!draft.name.trim()) {
      setError(t(lang, "budgetNameRequired"));
      return;
    }
    if (draft.startDate > draft.endDate) {
      setError(t(lang, "budgetDateRangeInvalid"));
      return;
    }
    if (draft.type === "fixed" && draft.fixedPriceAmount != null &&
        (!Number.isFinite(draft.fixedPriceAmount) || draft.fixedPriceAmount < 0)) {
      return setError(t(lang, "budgetAmountInvalid"));
    }
    if (draft.fxRateOverride != null &&
        (!Number.isFinite(draft.fxRateOverride) || draft.fxRateOverride <= 0)) {
      return setError(t(lang, "budgetFxOverrideInvalid"));
    }
    const badOverride = (v: number | undefined) => v != null && (!Number.isFinite(v) || v < 0);
    if (badOverride(draft.rateOverrideInternal) || badOverride(draft.rateOverrideExternal)) {
      return setError(t(lang, "budgetRateOverrideInvalid"));
    }
    adj.reset();
    const savedName = adj.track(describeTextCap(draft.name, BUDGET_NAME_MAX)).trim();
    const savedPoNumber = draft.poNumber != null
      ? adj.track(describeTextCap(draft.poNumber, PO_NUMBER_MAX)).trim() || undefined
      : undefined;
    if (adj.count() > 0) showToast("info", t(lang, "fieldsAdjusted", adj.count()));
    onSave({ ...draft, name: savedName, poNumber: savedPoNumber, localModifiedAt: new Date().toISOString() });
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
        ref={sizeRef}
        data-modal-panel
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        className="relative flex max-h-[95vh] w-[640px] min-w-[460px] max-w-[95vw] resize flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <ModalHeader
          lang={lang}
          title={t(lang, "budgetEditBucket")}
          onClose={onClose}
          dragHandleProps={handleProps}
          onResetLayout={() => {
            dragReset();
            sizeReset();
          }}
        />

        <ModalFieldControls modalId="budget" lang={lang} />

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-6 sm:grid-cols-2">
          {/* Bucket name */}
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span>{t(lang, "budgetBucketName")}</span>
            <input
              className={inputClass}
              value={draft.name}
              aria-describedby="bucket-name-counter"
              onChange={(e) =>
                setDraft((d) => ({ ...d, name: e.target.value }))
              }
              onBlur={(e) =>
                setDraft((d) => ({ ...d, name: describeTextCap(e.target.value, BUDGET_NAME_MAX).value.trim() }))
              }
            />
            <CharCounter value={draft.name} max={BUDGET_NAME_MAX} id="bucket-name-counter" lang={lang} />
          </label>

          {/* PO number */}
          {isVisible("poNumber") && (
          <label className="flex flex-col gap-1 text-sm">
            <span>{t(lang, "budgetPoNumber")}</span>
            <input
              className={inputClass}
              value={draft.poNumber ?? ""}
              aria-describedby="bucket-po-counter"
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  poNumber: e.target.value || undefined,
                }))
              }
              onBlur={(e) =>
                setDraft((d) => ({
                  ...d,
                  poNumber: describeTextCap(e.target.value, PO_NUMBER_MAX).value.trim() || undefined,
                }))
              }
            />
            <CharCounter value={draft.poNumber ?? ""} max={PO_NUMBER_MAX} id="bucket-po-counter" lang={lang} />
          </label>
          )}

          {/* Type + (conditional) fixed-price amount */}
          {isVisible("type") && (
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
          )}

          {/* Currency */}
          {isVisible("currency") && (
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
          )}

          {/* Fixed-price amount (conditional on Type=fixed and the Type field visibility) */}
          {isVisible("type") && isFixed && (
            <label className="flex flex-col gap-1 text-sm">
              <span>{t(lang, "budgetFixedPriceAmount")}</span>
              <input
                className={inputClass}
                type="number"
                min={0}
                value={draft.fixedPriceAmount ?? ""}
                aria-invalid={!!notice.fixedPriceAmount || undefined}
                aria-describedby={notice.fixedPriceAmount ? fixedPriceNoticeId : undefined}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    fixedPriceAmount:
                      e.target.value === ""
                        ? undefined
                        : Number(e.target.value),
                  }))
                }
                onBlur={(e) => {
                  const r = describeClamp(e.target.value, { min: 0, max: AMOUNT_MAX, round: 2 });
                  setDraft((d) => ({ ...d, fixedPriceAmount: r.value }));
                  const adj = r.adjustment?.kind === "clamped" ? r.adjustment : null;
                  setNotice((n) => ({
                    ...n,
                    fixedPriceAmount: adj
                      ? t(lang, adj.bound === "max" ? "fieldAdjustedMax" : "fieldAdjustedMin", adj.to)
                      : "",
                  }));
                }}
              />
              <FieldNotice id={fixedPriceNoticeId}>{notice.fixedPriceAmount}</FieldNotice>
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
          {isVisible("successor") && (
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
          )}

          {/* Manual FX rate */}
          {isVisible("fxOverride") && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1">{t(lang, "budgetFxOverride")}<InfoTooltip text={t(lang, "budgetFxOverrideHint")} /></span>
            <input
              className={inputClass}
              type="number"
              min="0.0001"
              step="0.0001"
              value={draft.fxRateOverride ?? ""}
              aria-label={t(lang, "budgetFxOverride")}
              aria-invalid={!!notice.fxRateOverride || undefined}
              aria-describedby={notice.fxRateOverride ? fxNoticeId : undefined}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  fxRateOverride:
                    e.target.value === ""
                      ? undefined
                      : Number(e.target.value),
                }))
              }
              onBlur={(e) => {
                const r = describeClamp(e.target.value, { min: 0, max: AMOUNT_MAX, round: 2 });
                setDraft((d) => ({ ...d, fxRateOverride: r.value }));
                const clamped = r.adjustment?.kind === "clamped" ? r.adjustment : null;
                setNotice((n) => ({
                  ...n,
                  fxRateOverride: clamped
                    ? t(lang, clamped.bound === "max" ? "fieldAdjustedMax" : "fieldAdjustedMin", clamped.to)
                    : "",
                }));
              }}
            />
            <FieldNotice id={fxNoticeId}>{notice.fxRateOverride}</FieldNotice>
          </label>
          )}

          {/* Detailed planning toggle (gates the allocation blocks under `planningDetail`) */}
          {isVisible("planningDetail") && (
          <div className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="flex items-center gap-1">{t(lang, "budgetDetailedPlanning")}<InfoTooltip text={t(lang, "budgetDetailedPlanningHint")} /></span>
            <button
              type="button"
              onClick={togglePlanningMode}
              aria-pressed={!isBlended}
              aria-label={t(lang, "budgetDetailedPlanning")}
              className={`w-fit rounded-md border px-3 py-1.5 text-xs font-medium ${INTERACTIVE} ${
                !isBlended
                  ? "border-AIPM-dark-blue bg-AIPM-dark-blue text-white"
                  : "border-line bg-surface text-foreground hover:bg-surface-muted"
              }`}
            >
              {t(lang, !isBlended ? "budgetModeDetailed" : "budgetModeBlended")}
            </button>
          </div>
          )}

          {/* Rate overrides (internal + external, grouped) */}
          {isVisible("rateOverrides") && (
          <>
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1">{t(lang, "budgetRateOverrideInternal")}<InfoTooltip text={t(lang, "budgetRateOverrideHint")} /></span>
            <div className="flex items-center gap-1">
              <input
                className={inputClass}
                type="number"
                min={0}
                step="0.01"
                aria-label={t(lang, "budgetRateOverrideInternal")}
                aria-invalid={!!notice.rateOverrideInternal || undefined}
                aria-describedby={notice.rateOverrideInternal ? rateIntNoticeId : undefined}
                value={draft.rateOverrideInternal ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, rateOverrideInternal: e.target.value === "" ? undefined : Number(e.target.value) }))
                }
                onBlur={(e) => {
                  const r = describeClamp(e.target.value, { min: 0, max: AMOUNT_MAX, round: 2 });
                  setDraft((d) => ({ ...d, rateOverrideInternal: r.value }));
                  const clamped = r.adjustment?.kind === "clamped" ? r.adjustment : null;
                  setNotice((n) => ({
                    ...n,
                    rateOverrideInternal: clamped
                      ? t(lang, clamped.bound === "max" ? "fieldAdjustedMax" : "fieldAdjustedMin", clamped.to)
                      : "",
                  }));
                }}
              />
              <span className="text-xs text-muted-foreground">{t(lang, "budgetUnitPerHour")}</span>
            </div>
            <FieldNotice id={rateIntNoticeId}>{notice.rateOverrideInternal}</FieldNotice>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1">{t(lang, "budgetRateOverrideExternal")}<InfoTooltip text={t(lang, "budgetRateOverrideHint")} /></span>
            <div className="flex items-center gap-1">
              <input
                className={inputClass}
                type="number"
                min={0}
                step="0.01"
                aria-label={t(lang, "budgetRateOverrideExternal")}
                aria-invalid={!!notice.rateOverrideExternal || undefined}
                aria-describedby={notice.rateOverrideExternal ? rateExtNoticeId : undefined}
                value={draft.rateOverrideExternal ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, rateOverrideExternal: e.target.value === "" ? undefined : Number(e.target.value) }))
                }
                onBlur={(e) => {
                  const r = describeClamp(e.target.value, { min: 0, max: AMOUNT_MAX, round: 2 });
                  setDraft((d) => ({ ...d, rateOverrideExternal: r.value }));
                  const clamped = r.adjustment?.kind === "clamped" ? r.adjustment : null;
                  setNotice((n) => ({
                    ...n,
                    rateOverrideExternal: clamped
                      ? t(lang, clamped.bound === "max" ? "fieldAdjustedMax" : "fieldAdjustedMin", clamped.to)
                      : "",
                  }));
                }}
              />
              <span className="text-xs text-muted-foreground">{t(lang, "budgetUnitPerHour")}</span>
            </div>
            <FieldNotice id={rateExtNoticeId}>{notice.rateOverrideExternal}</FieldNotice>
          </label>
          </>
          )}

          {/* Role allocations (detailed mode) — only when planning detail is visible */}
          {isVisible("planningDetail") && !isBlended && (
          <div className="flex flex-col gap-2 text-sm sm:col-span-2">
            <span className="font-medium">{t(lang, "budgetAllocations")}</span>

            {draft.allocations.map((a) => (
              <div
                key={a.roleId}
                className="rounded-md border border-line p-2"
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
                    className={`rounded-md border border-transparent px-2 py-0.5 text-xs text-muted-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted ${INTERACTIVE}`}
                  >
                    {t(lang, "budgetRemoveRole")}
                  </button>
                </div>

                {resources.length > 0 && (
                  <div className="mt-1">
                    <div className="text-xs text-muted-foreground">
                      {t(lang, "budgetResources")}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {resources.map((r) => (
                        <label
                          key={r.id}
                          className="flex items-center gap-1 text-xs"
                        >
                          <Checkbox
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
                    ? t(lang, roles.length === 0 ? "budgetNoRolesDefined" : "budgetNoRolesLeft")
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
                className={`rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90 disabled:opacity-50 ${INTERACTIVE}`}
              >
                + {t(lang, "budgetAddRole")}
              </button>
            </div>
            {/* Empty rate card: roles are defined under Resources → Manage roles,
                not here, so guide the user there instead of a dead dropdown. */}
            {roles.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {t(lang, "budgetNoRolesDefinedHint", t(lang, "resourcesManageRoles"))}
              </p>
            )}
          </div>
          )}

          {/* Discipline allocations (blended mode) — only when planning detail is visible */}
          {isVisible("planningDetail") && isBlended && (
            <div className="flex flex-col gap-2 text-sm sm:col-span-2">
              <span className="font-medium">{t(lang, "budgetModeBlended")}</span>
              {(draft.disciplineAllocations ?? []).map((a) => (
                <div key={a.disciplineId} className="rounded-md border border-line p-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {disciplines.find((x) => x.id === a.disciplineId)?.name ?? `#${a.disciplineId}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeDiscipline(a.disciplineId)}
                      className={`rounded-md border border-transparent px-2 py-0.5 text-xs text-muted-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted ${INTERACTIVE}`}
                    >
                      {t(lang, "budgetRemoveDiscipline")}
                    </button>
                  </div>
                  {resources.length > 0 && (
                    <div className="mt-1">
                      <div className="text-xs text-muted-foreground">{t(lang, "budgetResources")}</div>
                      <div className="flex flex-wrap gap-2">
                        {resources.map((r) => (
                          <label key={r.id} className="flex items-center gap-1 text-xs">
                            <Checkbox
                              checked={a.resourceIds.includes(r.id)}
                              onChange={() => toggleDisciplineResource(a.disciplineId, r.id)}
                            />
                            {resourceDisplayName(r)}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <div className="flex items-center gap-2">
                <select
                  className={`${inputClass} flex-1`}
                  value={disciplineToAdd}
                  onChange={(e) => setDisciplineToAdd(e.target.value)}
                  disabled={addableDisciplines.length === 0}
                  aria-label={t(lang, "budgetAddDiscipline")}
                >
                  <option value="">{addableDisciplines.length === 0 ? t(lang, disciplines.length === 0 ? "budgetNoDisciplinesDefined" : "budgetNoDisciplinesLeft") : "—"}</option>
                  {addableDisciplines.map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={addDiscipline}
                  disabled={disciplineToAdd === ""}
                  className={`rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90 disabled:opacity-50 ${INTERACTIVE}`}
                >
                  + {t(lang, "budgetAddDiscipline")}
                </button>
              </div>
              {disciplines.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {t(lang, "budgetNoDisciplinesDefinedHint", t(lang, "resourcesManageRoles"))}
                </p>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-AIPM-pink-strong sm:col-span-2">{error}</p>
          )}
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-line px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className={`rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`}
          >
            {t(lang, "cancel")}
          </button>
          <button
            type="button"
            onClick={save}
            className={`rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-3 py-1.5 text-sm font-medium text-white hover:bg-AIPM-dark-blue/90 ${INTERACTIVE}`}
          >
            {t(lang, "budgetSave")}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
