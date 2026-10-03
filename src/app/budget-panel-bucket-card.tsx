"use client";

// One budget bucket's card: the header and its reorder handle, the four summary tiles, the CCI tiles,
// the per-role hours table and the Edit / Close / Remove row. Extracted from `budget-panel.tsx` as the
// `*-rows` half of the panel-split convention (open-followups §274). PURE presentational: it owns no
// state, and every value it reads arrives as a prop.
//
// ★★ The two token maps stay built by the panel, which holds the LIST: a card cannot disambiguate
// itself (§262). `bucketToken` is this card's entry, and `roleTokens` is the panel-wide map its
// people-disclosure triggers read.
import { Fragment, type MouseEvent } from "react";
import { type Lang, t } from "./i18n";
import { formatCurrency } from "./resource-cost";
import { bucketActivePeriods, costIsKnowable, type BucketReport, type CciValue } from "./budget-report";
import { CostUnknownNotice } from "./budget-cost-notice";
import { ManualPercentCell, Cci } from "./budget-panel-cards";
import { type Period } from "./resource-capacity";
import { type ListReorderDnd } from "./use-list-reorder-dnd";
import { DragHandle } from "./drag-handle";
import { BucketRolePeople, PeopleDisclosureLabel, filterSortAllocations } from "./budget-panel-people-rows";
import type { ActualsByBucket } from "./timelog-actuals";
import { roleLabel } from "./resource-foundation";
import { eurToCurrency, resolveRate, resolveRateSource } from "./fx";
import { bucketCurrencyLabel } from "./budget-currency-label";
import type { BucketAllocation, BudgetBucket, Discipline, FxRates, Grade, Resource, ResourcePlan, Role, Task } from "./types";
import { isContractPriced } from "./types";
import { BUDGET_TYPE_LABEL } from "./budget-type-label";
import { ColumnResizeHandle } from "./task-manager-ui";
import { DataTable } from "./data-table";
import { RagBadge } from "./rag-badge";
import { SortResizeTh, type SortDir } from "./report-table";
import {
  ratioHealth, marginHealth, costPerformanceHealth, costPerformanceIndexHealth,
  winLossHealth, planVsBudgetHealth,
} from "./budget-health";
import { InfoTooltip } from "./info-tooltip";
import { Button } from "./button";
import { rowLabel } from "./row-tokens";
import { ROW_RULE_CLASS, rowRuleClass } from "./table-styles";
import {
  DOT_COL_PX, TOTAL_COL_PX, HoursTd, BucketRowLeadCells, BucketTotalRow, bucketBudgetGrid,
  type TotalsRow,
} from "./budget-panel-totals";
import { actualHoursAt, actualHoursIn, hasDayKeysIn } from "./actual-hours";

function sumPeriods(hours: Record<string, number>, periods: { key: string }[]): number {
  return periods.reduce((s, p) => s + actualHoursIn(hours, p.key), 0);
}

/** Builds the Cci-shaped value for the internal-cost-index tile (`budgetCciInternalCostIndex`;
 *  it was the "CPI" tile, then the "Cost recovery" tile under an earlier key
 *  before this branch renamed it again — bare "CPI" now means the forecast's
 *  price-based index (spec §11), and a test in this panel asserts the panel
 *  renders no `/CPI/` at all): `costPerformanceIndex` is a
 *  0-1 ratio (not the 0-100 percent every other CciValue.percent carries), so
 *  it is scaled ×100 here at the one render boundary rather than in the pure
 *  engine. `earnedValue` is EUR, like every other CciValue.amount — callers
 *  convert it to the bucket's display currency the same way they already do
 *  for margin/burn (`cci(...)`). */
export function cpiCciValue(earnedValue: number | null, costPerformanceIndex: number | null): CciValue {
  return { amount: earnedValue ?? 0, percent: costPerformanceIndex === null ? null : costPerformanceIndex * 100 };
}

type CellField = "budgetHours" | "actualHours";

export interface BudgetBucketCardProps {
  lang: Lang;
  locale: string;
  br: BucketReport;
  bucket: BudgetBucket;
  /** This card's WCAG 2.4.6 token, from the panel's list-wide map. */
  bucketToken: string;
  /** The panel's list-wide people-disclosure tokens, keyed `bucketId:roleId`. */
  roleTokens: ReadonlyMap<string, string>;
  /** This bucket's detailed (per-role) rows, already filtered and sorted. Empty for a blended bucket. */
  detailedRows: readonly BucketAllocation[];
  plan: ResourcePlan;
  fxRates: FxRates | null;
  roles: readonly Role[];
  disciplines: readonly Discipline[];
  grades: readonly Grade[];
  resources: readonly Resource[];
  tasks: readonly Task[];
  today: string;
  budgetFollowsPlan: boolean;
  /** The panel's effective-budget accessor, the one the report aggregates through. */
  cellBudget: (
    alloc: { resourceIds: readonly number[]; budgetHours: Record<string, number> },
    period: Period, periods: readonly Period[],
  ) => number;
  roleFilter: string;
  roleSort: SortDir;
  onSortRole: () => void;
  colWidths: { role: number; period: number };
  startResize: (col: string, e: MouseEvent) => void;
  openPeople: ReadonlySet<string>;
  togglePeople: (key: string) => void;
  reorder: ListReorderDnd<number>;
  actualsByBucket: ActualsByBucket;
  plannedByResourcePeriod: Readonly<Record<number, Record<string, number>>>;
  actualsFetchedAt?: string;
  onEdit: (bucketId: number) => void;
  onUpdateBucket: (bucketId: number, patch: Partial<BudgetBucket>) => void;
  onRemoveBucket: (bucketId: number) => void;
  onSetCell: (bucketId: number, roleId: number, periodKey: string, field: CellField, value: number) => void;
  onSetDisciplineCell: (bucketId: number, disciplineId: number, periodKey: string, field: CellField, value: number) => void;
}

export function BudgetBucketCard({
  lang, locale, br, bucket, bucketToken, roleTokens, detailedRows, plan, fxRates, roles, disciplines, grades,
  resources, tasks, today, budgetFollowsPlan, cellBudget, roleFilter, roleSort, onSortRole, colWidths,
  startResize, openPeople, togglePeople, reorder, actualsByBucket, plannedByResourcePeriod, actualsFetchedAt,
  onEdit, onUpdateBucket, onRemoveBucket, onSetCell, onSetDisciplineCell,
}: BudgetBucketCardProps) {
  const disciplineNamesFor = (ids: readonly number[]) =>
    ids.map((id) => disciplines.find((d) => d.id === id)?.name).filter((n): n is string => !!n);
  const isBlended = bucket.planningMode === "blended";
  const rate = resolveRate(bucket, fxRates);
  // The card keeps the "no FX rate — converted at 1:1" marker for a T&M bucket too (unlike the report's EUR detail table): its figures display through `eurToCurrency` at this same rate, 1 when unresolved, so the label is accurate here.
  const rateSource = resolveRateSource(bucket, fxRates);
  const periods = bucketActivePeriods(bucket, plan);
  const inCur = (eur: number) => formatCurrency(eurToCurrency(eur, bucket, fxRates), bucket.currency, locale);
  // CCI amounts are EUR from the engine — convert to the bucket currency for display.
  const cci = (v: CciValue): CciValue => ({ amount: eurToCurrency(v.amount, bucket, fxRates), percent: v.percent });
  const blendedRows = filterSortAllocations(
    bucket.disciplineAllocations ?? [],
    (a) => disciplines.find((d) => d.id === a.disciplineId)?.name || `#${a.disciplineId}`,
    roleFilter, roleSort,
  );
  // Only one of the two branches renders, so the totals follow the same
  // choice the rows do. Both allocation shapes carry the three fields
  // TotalsRow names, so the union widens without a cast.
  const rowsForTotals: readonly TotalsRow[] = isBlended ? blendedRows : detailedRows;
  // §71 — ONE evaluation of `cellBudget` per (row, period). The cell, the
  // row total and the column totals all read this same grid, so the two
  // axes agree structurally rather than because three call sites happen to
  // pass the same accessor.
  const totals = bucketBudgetGrid(rowsForTotals, periods, (r, p) => cellBudget(r, p, periods));
  return (
    <div
      key={br.bucketId}
      data-bucket-card={br.bucketId}
      {...reorder.itemProps(br.bucketId)}
      className={`rounded-xl border p-4 ${
        reorder.isDragging && reorder.dragId !== br.bucketId
          ? "border-ui-dark-blue/60"
          : "border-line"
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DragHandle
            {...reorder.handleProps(br.bucketId)}
            // ★ Bucket-UNIQUE, not merely bucket-qualified: two buckets may share a
            // name, so the token — not `br.name` — is what makes this WCAG 2.4.6-clean.
            ariaLabel={rowLabel(t(lang, "budgetReorderHandle"), bucketToken)}
            title={t(lang, "budgetReorderHandle")}
            // `select-none` and the focus-visible ring are the primitive's own
            // base; `leading-none` went with the text glyph it used to tune.
            className="cursor-grab rounded text-muted-foreground hover:text-ui-dark-blue active:cursor-grabbing dark:hover:text-ui-light-grey"
          />
          <span className="font-semibold text-ui-dark-blue dark:text-ui-light-grey">
            {br.name}{bucket.poNumber ? ` · ${bucket.poNumber}` : ""}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          {t(lang, BUDGET_TYPE_LABEL[br.type])} · {bucketCurrencyLabel(lang, bucket.currency, rate, rateSource)}
          {" · "}{t(lang, isBlended ? "budgetModeBlended" : "budgetModeDetailed")}
          <ManualPercentCell
            lang={lang}
            bucket={bucket}
            rowToken={bucketToken}
            tasks={tasks}
            onCommit={(pct) => onUpdateBucket(bucket.id, { percentComplete: pct })}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div><div className="text-xs text-muted-foreground">{t(lang, "budgetBudgetHours")}</div>{br.budgetHours.toFixed(0)}</div>
        {/* ★ These three summary-tile hints render once per BUCKET, so each
            is qualified with the bucket token. The Actual-hours one has a
            panel-wide twin in the legend above, which stays BARE: the
            legend states the column's meaning once for the whole panel and
            is the only unqualified instance left (open-followups §246). */}
        <div><div className="flex items-center gap-1 text-xs text-muted-foreground">{t(lang, "budgetPlanHours")}<InfoTooltip text={t(lang, "budgetPlanHoursHint")} label={rowLabel(t(lang, "budgetPlanHoursHint"), bucketToken)} /></div><span className="inline-flex items-center gap-1.5">{br.plannedHours.toFixed(0)}{!br.budgetMirrorsPlan && <RagBadge value={planVsBudgetHealth(br.plannedHours, br.budgetHours)} lang={lang} title={t(lang, "budgetPlanHours")} />}</span></div>
        <div><div className="flex items-center gap-1 text-xs text-muted-foreground">{t(lang, "budgetActualHours")}<InfoTooltip text={t(lang, "budgetActualHoursHint")} label={rowLabel(t(lang, "budgetActualHoursHint"), bucketToken)} /></div><span className="inline-flex items-center gap-1.5">{br.actualHours.toFixed(0)}<RagBadge value={ratioHealth(br.actualHours, br.budgetHours)} lang={lang} title={t(lang, "budgetActualHours")} /></span></div>
        {/* A fixed-price bucket's win/loss IS revenue − cost, so it is
            unknowable without an internal rate. A T&M bucket's is
            budgetValue − consumedValue on EXTERNAL rates and stays
            valid — gating it there would hide a real figure. */}
        <div><div className="flex items-center gap-1 text-xs text-muted-foreground">{t(lang, "budgetWinLoss")}<InfoTooltip text={t(lang, "budgetWinLossHint")} label={rowLabel(t(lang, "budgetWinLossHint"), bucketToken)} /></div><span className="inline-flex items-center gap-1.5">{!costIsKnowable(br) && isContractPriced(br.type) ? "—" : <>{inCur(br.winLossValue)}<RagBadge value={winLossHealth(br.consumedValue, br.budgetValue)} lang={lang} title={t(lang, "budgetWinLoss")} /></>}</span></div>
      </div>
      {br.spilloverInHours !== 0 && (
        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <span>{t(lang, "budgetSpilloverIn")}</span>
          {/* Qualified like its siblings even though it renders only when
              the bucket has spillover — two buckets that BOTH have some
              is an ordinary case, not an edge one. */}
          <InfoTooltip text={t(lang, "budgetSpilloverInHint")} label={rowLabel(t(lang, "budgetSpilloverInHint"), bucketToken)} />
          <span>: {br.spilloverInHours.toFixed(0)} h · {inCur(br.spilloverInValue)}</span>
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Cci label={t(lang, "budgetCciMargin")} hint={t(lang, "budgetCciMarginHint")} scopeName={bucketToken} value={cci(br.contributionMargin)} currency={bucket.currency} locale={locale} lang={lang} rag={marginHealth(br.contributionMargin.percent)} unknown={!costIsKnowable(br)} />
        <Cci label={t(lang, "budgetCciBurn")} hint={t(lang, "budgetCciBurnHint")} scopeName={bucketToken} value={cci(br.costPerformance)} currency={bucket.currency} locale={locale} lang={lang} rag={costPerformanceHealth(br.costPerformance.percent)} primary="percent" unknown={!costIsKnowable(br)} />
        {/* Earned value needs progress (linked tasks or a manual %),
            on top of the same internal-rate basis burn/margin need —
            so it is gated on its OWN null-ness, not `costIsKnowable`
            alone (a rated bucket with no progress set is still "—"). */}
        <Cci label={t(lang, "budgetCciInternalCostIndex")} hint={t(lang, "budgetCciInternalCostIndexHint")} scopeName={bucketToken} value={cci(cpiCciValue(br.earnedValue, br.costPerformanceIndex))} currency={bucket.currency} locale={locale} lang={lang} rag={costPerformanceIndexHealth(br.costPerformanceIndex)} primary="percent" unknown={br.costPerformanceIndex === null} />
        {/* Consumption is an EXTERNAL-rate ratio — knowable without a
            rate card, so it is deliberately not gated. */}
        <Cci label={t(lang, "budgetCciConsumption")} hint={t(lang, "budgetCciConsumptionHint")} scopeName={bucketToken} value={cci(br.consumption)} currency={bucket.currency} locale={locale} lang={lang} rag={ratioHealth(br.consumedValue, br.budgetValue)} primary="percent" />
      </div>
      <CostUnknownNotice
        lang={lang}
        reason={br.costUnknownReason}
        disciplineNames={disciplineNamesFor(br.unpricedDisciplineIds)}
      />
      <div className="mt-3 overflow-x-auto">
        <DataTable
          // `w-max`, NOT `w-full`. A `width: 100%` table whose columns
          // sum to less than the container spreads the leftover across
          // ALL of them — including the three pinned ones, whose offsets
          // are arithmetic over their DECLARED widths. This is a SECOND
          // mechanism, independent of the content clamps below: measured
          // in Chromium with those clamps already applied, 3 periods in
          // a 1400px container still rendered the 28px dot column at 53
          // and a 60px role column at 113.5. Sizing to content leaves no
          // leftover to spread; the cost is that a short plan no longer
          // stretches to fill the pane.
          className="w-max text-xs"
          // The role rows carry per-role people disclosures, whose
          // aria-controls target has to be a `<tbody>` — so this table
          // owns its bodies (a tbody inside DataTable's own tbody drops
          // off the column grid entirely; see `ownBodies`).
          ownBodies
          head={<>
            <tr>
              <th
                className="sticky px-1 py-1 text-left font-medium print:static"
                style={{ left: 0, width: DOT_COL_PX, minWidth: DOT_COL_PX }}
              >
                {/* Visually hidden: this column shows RAG dots, and each
                    badge carries its own title. The visible word was
                    what rendered the column at 41.3px against a declared
                    28, so the role column — pinned at DOT_COL_PX — sat
                    over its right 13px once scrolled, clipping the tail
                    of the word. Widening the constant instead would tune
                    it to ONE string: this key happens to be "Status" in
                    both EN and DE today, but nothing holds it there, and
                    a constant cannot track a translation. Taking the
                    label out of layout makes 28 true in every language. */}
                <span className="sr-only">{t(lang, "budgetRoleStatus")}</span>
              </th>
              {/* ★ One table renders per BUCKET, so without this every
                  bucket contributes a sort button named just "Role"
                  (WCAG 2.4.6). The token is the CONTEXT only — the
                  primitive joins it onto the visible label itself, which
                  is what keeps 2.5.3 containment true by construction.
                  Hence no `rowLabel` here: pre-joining would repeat the
                  label. */}
              <SortResizeTh
                label={t(lang, isBlended ? "budgetDiscipline" : "budgetRole")}
                nameContext={bucketToken}
                sortCol="role"
                width={colWidths.role}
                stickyLeft={DOT_COL_PX}
                sortKey="role"
                sortDir={roleSort}
                onSort={onSortRole}
                onResize={startResize}
              />
              {/* Fixed Total column. Its offset tracks the LIVE role width —
                  the role column is user-resizable, so a hardcoded offset
                  drifts the moment it is dragged. The offset is only true
                  because the two columns to its left are clamped to their
                  declared widths; nothing pins to the RIGHT of this one,
                  so it needs no clamp of its own. */}
              <th
                className="sticky px-3 py-2 font-medium print:static"
                style={{
                  left: DOT_COL_PX + colWidths.role,
                  width: TOTAL_COL_PX,
                  minWidth: TOTAL_COL_PX,
                }}
              >
                {t(lang, "budgetTotal")}
              </th>
              {periods.map((p) => (
                <th
                  key={p.key}
                  className="relative px-3 py-2 font-medium"
                  style={{ width: colWidths.period, minWidth: colWidths.period }}
                >
                  {p.key}
                  <ColumnResizeHandle col="period" onMouseDown={startResize} />
                </th>
              ))}
            </tr>
          </>}
        >
            {!isBlended && detailedRows.map((a, rowIdx) => {
              // Effective budget (mirrors planned when follow-plan is on) so the
              // row RAG agrees with the cells + bucket dot — not the stored hours.
              const totBudget = totals.rowBudgetTotal(a);
              const totActual = sumPeriods(a.actualHours, periods);
              const mirror = budgetFollowsPlan && a.resourceIds.length > 0;
              const label = roleLabel(roles.find((r) => r.id === a.roleId), disciplines, grades) || `#${a.roleId}`;
              const openKey = `${bucket.id}:${a.roleId}`;
              const open = openPeople.has(openKey);
              const roleToken = roleTokens.get(openKey) ?? label;
              return (
              <Fragment key={a.roleId}>
              <tbody>
              {/* ★★★ `rowRuleClass`, NOT `ROW_RULE_CLASS`: each role row is the ONLY
                  child of its own `<tbody>`, so `last:` matches EVERY row and the
                  shared constant draws nothing. Shipped green that way — §68. */}
              <tr className={rowRuleClass(rowIdx === detailedRows.length - 1)}>
                <BucketRowLeadCells
                  label={
                    <PeopleDisclosureLabel
                      lang={lang} label={label} token={roleToken} bucketId={bucket.id} roleId={a.roleId}
                      open={open} onToggle={() => togglePeople(openKey)}
                    />
                  }
                  budget={totBudget} actual={totActual} lang={lang} roleWidth={colWidths.role}
                />
                {periods.map((p, pi) => (
                  <HoursTd
                    key={p.key}
                    cellName={rowLabel(rowLabel(bucketToken, roleToken), p.key)}
                    budget={totals.budgetAt(a, pi)}
                    actual={actualHoursAt(a.actualHours, p.key)}
                    actualReadOnlyReason={hasDayKeysIn(a.actualHours, p.key) ? t(lang, "budgetActualFromTimelog") : undefined}
                    readOnly={mirror}
                    onBudget={(v) => onSetCell(bucket.id, a.roleId, p.key, "budgetHours", v)}
                    onActual={(v) => onSetCell(bucket.id, a.roleId, p.key, "actualHours", v)}
                    lang={lang}
                    periodEnd={p.end}
                    today={today}
                  />
                ))}
              </tr>
              </tbody>
              <BucketRolePeople
                bucketId={bucket.id}
                allocation={a}
                resources={resources}
                actualsByPeriod={actualsByBucket[bucket.id] ?? {}}
                plannedByResourcePeriod={plannedByResourcePeriod}
                periods={periods}
                collapsed={!open}
                roleWidth={colWidths.role}
                lang={lang}
                fetchedAt={actualsFetchedAt}
              />
              </Fragment>
              );
            })}
            {isBlended && <tbody>{blendedRows.map((a) => {
              // Effective budget (mirrors planned when follow-plan is on) so the
              // row RAG agrees with the cells + bucket dot — not the stored hours.
              const totBudget = totals.rowBudgetTotal(a);
              const totActual = sumPeriods(a.actualHours, periods);
              // Each blended row IS one disciplineAllocation carrying its own
              // resourceIds, and allocationPlannedHours already sums over them —
              // so the mirror rule is identical to the role rows.
              const mirror = budgetFollowsPlan && a.resourceIds.length > 0;
              // One allocation per discipline per bucket, so with the bucket token
              // this name is unique across the panel (§109).
              const disciplineName = disciplines.find((d) => d.id === a.disciplineId)?.name || `#${a.disciplineId}`;
              return (
              <tr key={a.disciplineId} className={ROW_RULE_CLASS}>
                <BucketRowLeadCells
                  label={disciplineName}
                  budget={totBudget} actual={totActual} lang={lang} roleWidth={colWidths.role}
                />
                {periods.map((p, pi) => (
                  <HoursTd
                    key={p.key}
                    cellName={rowLabel(rowLabel(bucketToken, disciplineName), p.key)}
                    budget={totals.budgetAt(a, pi)}
                    actual={actualHoursAt(a.actualHours, p.key)}
                    actualReadOnlyReason={hasDayKeysIn(a.actualHours, p.key) ? t(lang, "budgetActualFromTimelog") : undefined}
                    readOnly={mirror}
                    onBudget={(v) => onSetDisciplineCell(bucket.id, a.disciplineId, p.key, "budgetHours", v)}
                    onActual={(v) => onSetDisciplineCell(bucket.id, a.disciplineId, p.key, "actualHours", v)}
                    lang={lang}
                    periodEnd={p.end}
                    today={today}
                  />
                ))}
              </tr>
              );
            })}</tbody>}
            {rowsForTotals.length > 0 && (
              <tbody>
                <BucketTotalRow
                  columns={totals.columns}
                  grandBudget={totals.grandBudget}
                  grandActual={totals.grandActual}
                  lang={lang}
                  roleWidth={colWidths.role}
                  // §70 — `rowsForTotals` is already narrowed by
                  // `filterSortAllocations`, so this total covers the matching
                  // roles only while the CCI tiles above it read the whole
                  // bucket. Trimmed, because a filter of only spaces narrows
                  // nothing and must not relabel the total.
                  filtered={roleFilter.trim() !== ""}
                />
              </tbody>
            )}
        </DataTable>
      </div>
      {/* ★★ These three carry NO `aria-label` before this change — their
          accessible name came from their rendered CONTENT, which is why
          an attribute-matching grep could not find them (AGENTS.md's
          three-leg enumeration rule, leg 2). N buckets put N "Edit
          bucket"/"Close bucket"/"Remove bucket" controls on the page.
          ★ The token is APPENDED and the visible text is untouched:
          WCAG 2.5.3 asks for CONTAINMENT, not a prefix, so
          "Edit bucket – PAM" conforms. */}
      <div className="mt-2 flex items-center gap-4">
        <Button
          variant="secondary"
          size="xs"
          aria-label={rowLabel(t(lang, "budgetEditBucket"), bucketToken)}
          onClick={() => onEdit(bucket.id)}
        >
          {t(lang, "budgetEditBucket")}
        </Button>
        <Button
          variant="secondary"
          size="xs"
          // The verb follows the bucket's own status, so the qualified
          // name tracks it too rather than pinning one of the two.
          aria-label={rowLabel(t(lang, bucket.status === "open" ? "budgetClose" : "budgetReopen"), bucketToken)}
          onClick={() => onUpdateBucket(bucket.id, bucket.status === "open"
            ? { status: "closed", closedDate: today }
            : { status: "open", closedDate: undefined })}
        >
          {t(lang, bucket.status === "open" ? "budgetClose" : "budgetReopen")}
        </Button>
        {/* ★ `destructive`, not `secondary`: this is the only action in
            the row that destroys data, and rendering it identically to
            Edit and Close made the row's one irreversible control
            indistinguishable. It stays `confirm()`-gated either way —
            the variant is the affordance, not the safeguard. */}
        <Button
          variant="destructive"
          size="xs"
          // ★ The `title` below is left BARE on purpose: `aria-label`
          // wins the accessible name, so the title is only the hover
          // tooltip and does not need the token.
          aria-label={rowLabel(t(lang, "budgetRemoveBucket"), bucketToken)}
          onClick={() => onRemoveBucket(bucket.id)}
          title={t(lang, "budgetRemoveBucket")}
        >
          {t(lang, "budgetRemoveBucket")}
        </Button>
      </div>
    </div>
  );
}
