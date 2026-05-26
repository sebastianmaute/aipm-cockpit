"use client";
import { useMemo } from "react";
import { type Lang, t } from "./i18n";
import { formatCurrency } from "./resource-cost";
import { computeBudgetReport, bucketActivePeriods, type BucketReport, type CciValue } from "./budget-report";
import { roleLabel } from "./resource-foundation";
import { eurToCurrency, resolveRate } from "./fx";
import type { Absence, BudgetBucket, Discipline, FxRates, Grade, Resource, ResourcePlan, Role } from "./types";

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
}

function localeFor(lang: Lang): string {
  return lang === "de" ? "de-DE" : lang === "en-GB" ? "en-GB" : "en-US";
}

function Cci({ label, value, currency, locale }: { label: string; value: CciValue; currency: string; locale: string }) {
  const pct = value.percent == null ? "—" : `${value.percent.toFixed(1)}%`;
  const tone = value.amount >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-AIPM-pink";
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`text-lg font-semibold ${tone}`}>{formatCurrency(value.amount, currency, locale)}</div>
      <div className="text-xs text-zinc-500">{pct}</div>
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

  const stamp = () => new Date().toISOString();

  const addBucket = () => {
    props.onChangeBuckets([...buckets, blankBucket(nextBucketId(buckets), plan)]);
  };

  const updateBucket = (id: number, patch: Partial<BudgetBucket>) => {
    props.onChangeBuckets(buckets.map((b) => (b.id === id ? { ...b, ...patch, localModifiedAt: stamp() } : b)));
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={addBucket}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-AIPM-dark-blue shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-AIPM-light-grey dark:hover:bg-zinc-800"
        >
          {t(lang, "budgetAddBucket")}
        </button>
        <button
          type="button"
          onClick={props.onRefreshFx}
          className="rounded-md px-3 py-1.5 text-sm text-zinc-500 hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey"
        >
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
            <div key={br.bucketId} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="mb-2 flex items-center justify-between">
                <div className="font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
                  {br.name}{bucket.poNumber ? ` · ${bucket.poNumber}` : ""}
                </div>
                <div className="text-xs text-zinc-500">
                  {t(lang, br.type === "fixed" ? "budgetTypeFixed" : "budgetTypeTm")} · {bucket.currency}
                  {rate !== 1 ? ` (×${rate})` : ""}
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2 text-sm">
                <div><div className="text-xs text-zinc-500">{t(lang, "budgetBudgetHours")}</div>{br.budgetHours.toFixed(0)}</div>
                <div><div className="text-xs text-zinc-500">{t(lang, "budgetPlanHours")}</div>{br.plannedHours.toFixed(0)}</div>
                <div><div className="text-xs text-zinc-500">{t(lang, "budgetActualHours")}</div>{br.actualHours.toFixed(0)}</div>
                <div><div className="text-xs text-zinc-500">{t(lang, "budgetWinLoss")}</div>{inCur(br.winLossValue)}</div>
              </div>
              {br.spilloverInHours !== 0 && (
                <div className="mt-1 text-xs text-zinc-500">
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
                    <tr className="text-zinc-500">
                      <th className="px-2 py-1 text-left">{t(lang, "budgetRole")}</th>
                      {bucketActivePeriods(bucket, plan).map((p) => (
                        <th key={p.key} className="px-2 py-1 text-right">{p.key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bucket.allocations.map((a) => (
                      <tr key={a.roleId} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="px-2 py-1">{roleLabel(roles.find((r) => r.id === a.roleId), props.disciplines, props.grades) || `#${a.roleId}`}</td>
                        {bucketActivePeriods(bucket, plan).map((p) => (
                          <td key={p.key} className="px-1 py-1">
                            <div className="flex flex-col gap-0.5">
                              <input
                                aria-label={`budget-${bucket.id}-${a.roleId}-${p.key}`}
                                type="number"
                                value={a.budgetHours[p.key] ?? ""}
                                onChange={(e) => setCell(bucket.id, a.roleId, p.key, "budgetHours", Number(e.target.value) || 0)}
                                className="w-16 rounded border border-zinc-200 bg-white px-1 text-right dark:border-zinc-700 dark:bg-zinc-900"
                              />
                              <input
                                aria-label={`actual-${bucket.id}-${a.roleId}-${p.key}`}
                                type="number"
                                value={a.actualHours[p.key] ?? ""}
                                onChange={(e) => setCell(bucket.id, a.roleId, p.key, "actualHours", Number(e.target.value) || 0)}
                                className="w-16 rounded border border-zinc-200 bg-zinc-50 px-1 text-right dark:border-zinc-700 dark:bg-zinc-800"
                              />
                            </div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                onClick={() => updateBucket(bucket.id, bucket.status === "open"
                  ? { status: "closed", closedDate: props.today }
                  : { status: "open", closedDate: undefined })}
                className="mt-2 text-xs text-zinc-500 hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey"
              >
                {t(lang, bucket.status === "open" ? "budgetClose" : "budgetReopen")}
              </button>
            </div>
          );
        })}
        {report.buckets.length === 0 && (
          <p className="text-sm text-zinc-500">{t(lang, "budgetAddBucket")}…</p>
        )}
      </section>
    </div>
  );
}
