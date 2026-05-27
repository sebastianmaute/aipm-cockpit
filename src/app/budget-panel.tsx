"use client";
import { useMemo, useState } from "react";
import { type Lang, t } from "./i18n";
import { formatCurrency } from "./resource-cost";
import { computeBudgetReport, bucketActivePeriods, type BucketReport, type CciValue } from "./budget-report";
import { roleLabel } from "./resource-foundation";
import { eurToCurrency, resolveRate } from "./fx";
import type { Absence, BudgetBucket, Discipline, FxRates, Grade, Resource, ResourcePlan, Role } from "./types";
import { BudgetBucketModal } from "./budget-bucket-modal";

export interface BudgetPanelProps {
  lang: Lang;
  buckets: BudgetBucket[];
  roles: Role[];
  disciplines: Discipline[];
  grades: Grade[];
  resources: Resource[];
  plan: ResourcePlan;
  fxRates: FxRates | null;
  absences: Absence[];
  holidaySet: Set<string>;
  workdayHours: number;
  today: string;
  onChangeBuckets: (next: BudgetBucket[]) => void;
  onRefreshFx: () => void;
  fxLoading?: boolean;
}

function localeFor(lang: Lang): string {
  return lang === "de" ? "de-DE" : lang === "en-GB" ? "en-GB" : "en-US";
}

function Cci({ label, value, currency, locale }: { label: string; value: CciValue; currency: string; locale: string }) {
  const pct = value.percent == null ? "—" : `${value.percent.toFixed(1)}%`;
  const tone = value.amount >= 0 ? "text-AIPM-green" : "text-AIPM-pink";
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${tone}`}>{formatCurrency(value.amount, currency, locale)}</div>
      <div className="text-xs text-muted-foreground">{pct}</div>
    </div>
  );
}

function nextBucketId(buckets: readonly BudgetBucket[]): number {
  return buckets.reduce((m, b) => Math.max(m, b.id), 0) + 1;
}

function blankBucket(id: number, plan: ResourcePlan): BudgetBucket {
  return {
    id, name: `Bucket ${id}`, type: "tm", currency: "EUR",
    startDate: plan.startDate, endDate: plan.endDate, status: "open", allocations: [],
  };
}

export function BudgetPanel(props: BudgetPanelProps) {
  const { lang, buckets, roles, resources, plan, fxRates, absences, holidaySet, workdayHours } = props;
  const locale = localeFor(lang);

  const report = useMemo(
    () => computeBudgetReport(buckets, plan, roles, resources, workdayHours, holidaySet, absences),
    [buckets, plan, roles, resources, workdayHours, holidaySet, absences],
  );

  const bucketById = useMemo(() => new Map(buckets.map((b) => [b.id, b])), [buckets]);
  const projCur = plan.currency || "EUR"; // project rollup is in the plan base currency (EUR)

  const [dragId, setDragId] = useState<number | null>(null);
  const [editingBucketId, setEditingBucketId] = useState<number | null>(null);

  const stamp = () => new Date().toISOString();

  const addBucket = () => {
    const id = nextBucketId(buckets);
    props.onChangeBuckets([...buckets, blankBucket(id, plan)]);
    setEditingBucketId(id);
  };

  const updateBucket = (id: number, patch: Partial<BudgetBucket>) => {
    props.onChangeBuckets(buckets.map((b) => (b.id === id ? { ...b, ...patch, localModifiedAt: stamp() } : b)));
  };

  const removeBucket = (id: number) => {
    if (!window.confirm(t(lang, "budgetRemoveBucketConfirm"))) return;
    props.onChangeBuckets(
      buckets
        .filter((b) => b.id !== id)
        .map((b) => (b.successorId === id ? { ...b, successorId: null, localModifiedAt: stamp() } : b)),
    );
  };

  const setCell = (
    bucketId: number, roleId: number, periodKey: string,
    field: "budgetHours" | "actualHours", value: number,
  ) => {
    props.onChangeBuckets(
      buckets.map((b) => {
        if (b.id !== bucketId) return b;
        const allocations = b.allocations.map((a) =>
          a.roleId === roleId ? { ...a, [field]: { ...a[field], [periodKey]: value } } : a,
        );
        return { ...b, allocations, localModifiedAt: stamp() };
      }),
    );
  };

  const sortedBucketIds = () =>
    [...buckets].sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id)).map((b) => b.id);

  // Reassign contiguous `order` (0,1,2,…) from an ordered id list. Only buckets
  // whose order actually changes get a fresh `localModifiedAt` stamp.
  const applyBucketOrder = (orderedIds: number[]) => {
    const orderById = new Map(orderedIds.map((id, idx) => [id, idx]));
    const ts = stamp();
    props.onChangeBuckets(
      buckets.map((b) => {
        const newOrder = orderById.get(b.id) ?? b.order ?? 0;
        return b.order === newOrder ? b : { ...b, order: newOrder, localModifiedAt: ts };
      }),
    );
  };

  // Pointer drop: move `dragId` to where `targetId` currently sits.
  const onDropOnBucket = (targetId: number) => {
    if (dragId == null || dragId === targetId) return;
    const ids = sortedBucketIds();
    const fromIdx = ids.indexOf(dragId);
    const targetIdx = ids.indexOf(targetId);
    if (fromIdx < 0 || targetIdx < 0) return;
    ids.splice(fromIdx, 1);
    ids.splice(targetIdx, 0, dragId);
    applyBucketOrder(ids);
  };

  // Keyboard reorder: swap a bucket with its neighbour (delta -1 = up, +1 = down),
  // so the drag handle's ArrowUp/ArrowDown lets keyboard users reorder too.
  const moveBucket = (id: number, delta: number) => {
    const ids = sortedBucketIds();
    const i = ids.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    applyBucketOrder(ids);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={addBucket}
          className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90"
        >
          + {t(lang, "budgetAddBucket")}
        </button>
        <button
          type="button"
          onClick={props.onRefreshFx}
          disabled={props.fxLoading}
          className="inline-flex items-center gap-1.5 rounded-md border border-AIPM-dark-blue bg-surface px-3 py-1.5 text-sm font-medium text-AIPM-dark-blue hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={`h-4 w-4 ${props.fxLoading ? "animate-spin" : ""}`}>
            <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z" clipRule="evenodd" />
          </svg>
          {t(lang, "budgetFxRefresh")}
        </button>
      </div>
      <section>
        <h2 className="mb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
          {t(lang, "budgetTitle")} — {t(lang, "budgetProjectTotal")}
        </h2>
        <div className="grid grid-cols-3 gap-3">
          <Cci label={t(lang, "budgetCciMargin")} value={report.project.contributionMargin} currency={projCur} locale={locale} />
          <Cci label={t(lang, "budgetCciCpi")} value={report.project.costPerformance} currency={projCur} locale={locale} />
          <Cci label={t(lang, "budgetCciConsumption")} value={report.project.consumption} currency={projCur} locale={locale} />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        {report.buckets.map((br: BucketReport) => {
          const bucket = bucketById.get(br.bucketId)!;
          const rate = resolveRate(bucket, fxRates);
          const inCur = (eur: number) => formatCurrency(eurToCurrency(eur, bucket, fxRates), bucket.currency, locale);
          // CCI amounts are EUR from the engine — convert to the bucket currency for display.
          const cci = (v: CciValue): CciValue => ({ amount: eurToCurrency(v.amount, bucket, fxRates), percent: v.percent });
          return (
            <div
              key={br.bucketId}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDropOnBucket(br.bucketId)}
              className={`rounded-xl border p-4 ${
                dragId != null && dragId !== br.bucketId
                  ? "border-AIPM-dark-blue/60"
                  : "border-line"
              }`}
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    draggable
                    onDragStart={() => setDragId(br.bucketId)}
                    onDragEnd={() => setDragId(null)}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        moveBucket(br.bucketId, -1);
                      } else if (e.key === "ArrowDown") {
                        e.preventDefault();
                        moveBucket(br.bucketId, 1);
                      }
                    }}
                    aria-label={t(lang, "budgetReorderHandle")}
                    title={t(lang, "budgetReorderHandle")}
                    className="cursor-grab select-none rounded leading-none text-muted-foreground hover:text-AIPM-dark-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-AIPM-green active:cursor-grabbing dark:hover:text-AIPM-light-grey"
                  >
                    ⠿
                  </button>
                  <span className="font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
                    {br.name}{bucket.poNumber ? ` · ${bucket.poNumber}` : ""}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {t(lang, br.type === "fixed" ? "budgetTypeFixed" : "budgetTypeTm")} · {bucket.currency}
                  {rate !== 1 ? ` (×${rate})` : ""}
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2 text-sm">
                <div><div className="text-xs text-muted-foreground">{t(lang, "budgetBudgetHours")}</div>{br.budgetHours.toFixed(0)}</div>
                <div><div className="text-xs text-muted-foreground">{t(lang, "budgetPlanHours")}</div>{br.plannedHours.toFixed(0)}</div>
                <div><div className="text-xs text-muted-foreground">{t(lang, "budgetActualHours")}</div>{br.actualHours.toFixed(0)}</div>
                <div><div className="text-xs text-muted-foreground">{t(lang, "budgetWinLoss")}</div>{inCur(br.winLossValue)}</div>
              </div>
              {br.spilloverInHours !== 0 && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {t(lang, "budgetSpilloverIn")}: {br.spilloverInHours.toFixed(0)} h · {inCur(br.spilloverInValue)}
                </div>
              )}
              <div className="mt-3 grid grid-cols-3 gap-3">
                <Cci label={t(lang, "budgetCciMargin")} value={cci(br.contributionMargin)} currency={bucket.currency} locale={locale} />
                <Cci label={t(lang, "budgetCciCpi")} value={cci(br.costPerformance)} currency={bucket.currency} locale={locale} />
                <Cci label={t(lang, "budgetCciConsumption")} value={cci(br.consumption)} currency={bucket.currency} locale={locale} />
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="px-2 py-1 text-left">{t(lang, "budgetRole")}</th>
                      {bucketActivePeriods(bucket, plan).map((p) => (
                        <th key={p.key} className="px-2 py-1 text-right">{p.key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bucket.allocations.map((a) => (
                      <tr key={a.roleId} className="border-t border-line">
                        <td className="px-2 py-1">{roleLabel(roles.find((r) => r.id === a.roleId), props.disciplines, props.grades) || `#${a.roleId}`}</td>
                        {bucketActivePeriods(bucket, plan).map((p) => (
                          <td key={p.key} className="px-1 py-1">
                            <div className="flex flex-col gap-0.5">
                              <input
                                aria-label={`budget-${bucket.id}-${a.roleId}-${p.key}`}
                                type="number"
                                value={a.budgetHours[p.key] ?? ""}
                                onChange={(e) => setCell(bucket.id, a.roleId, p.key, "budgetHours", Number(e.target.value) || 0)}
                                className="w-16 rounded border border-line bg-surface px-1 text-right"
                              />
                              <input
                                aria-label={`actual-${bucket.id}-${a.roleId}-${p.key}`}
                                type="number"
                                value={a.actualHours[p.key] ?? ""}
                                onChange={(e) => setCell(bucket.id, a.roleId, p.key, "actualHours", Number(e.target.value) || 0)}
                                className="w-16 rounded border border-line bg-surface-muted px-1 text-right"
                              />
                            </div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => setEditingBucketId(bucket.id)}
                  className="rounded-md border border-transparent px-2 py-0.5 text-xs text-muted-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted"
                >
                  {t(lang, "budgetEditBucket")}
                </button>
                <button
                  type="button"
                  onClick={() => updateBucket(bucket.id, bucket.status === "open"
                    ? { status: "closed", closedDate: props.today }
                    : { status: "open", closedDate: undefined })}
                  className="rounded-md border border-transparent px-2 py-0.5 text-xs text-muted-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted"
                >
                  {t(lang, bucket.status === "open" ? "budgetClose" : "budgetReopen")}
                </button>
                <button
                  type="button"
                  onClick={() => removeBucket(bucket.id)}
                  title={t(lang, "budgetRemoveBucket")}
                  className="rounded-md border border-transparent px-2 py-0.5 text-xs text-muted-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted"
                >
                  {t(lang, "budgetRemoveBucket")}
                </button>
              </div>
            </div>
          );
        })}
        {report.buckets.length === 0 && (
          <p className="text-sm text-muted-foreground">{t(lang, "budgetAddBucket")}…</p>
        )}
      </section>
      {editingBucketId != null && bucketById.get(editingBucketId) && (
        <BudgetBucketModal
          lang={lang}
          bucket={bucketById.get(editingBucketId)!}
          allBuckets={buckets}
          roles={roles}
          disciplines={props.disciplines}
          grades={props.grades}
          resources={resources}
          onSave={(next) => {
            props.onChangeBuckets(buckets.map((b) => (b.id === next.id ? next : b)));
            setEditingBucketId(null);
          }}
          onClose={() => setEditingBucketId(null)}
        />
      )}
    </div>
  );
}
