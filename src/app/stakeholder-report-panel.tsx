"use client";

// Read-only stakeholder report: summary tiles, influence/interest 2x2 grid,
// RACI coverage per milestone, and a register table. Embeddable in ReportsPanel
// like RaidReportPanel. No mutation — purely derived from props.

import { type Lang, t, type TranslationKey } from "./i18n";
import { EmptyState } from "./empty-state";
import { Card } from "./card";
import { InfoTooltip } from "./info-tooltip";
import { RaciAccountableWarning } from "./raci-accountable-warning";
import { DataTable } from "./data-table";
import {
  quadrantFor,
  accountableCountByMilestone,
  raciWarningFor,
  type StakeholderQuadrant,
} from "./stakeholders";
import {
  STAKEHOLDER_CATEGORIES,
  type InfluenceInterest,
  type Milestone,
  type Stakeholder,
  type StakeholderCategory,
} from "./types";

const CATEGORY_KEY: Record<StakeholderCategory, TranslationKey> = {
  Internal: "stakeholderCategoryInternal",
  Customer: "stakeholderCategoryCustomer",
  Vendor: "stakeholderCategoryVendor",
  Sponsor: "stakeholderCategorySponsor",
  Regulator: "stakeholderCategoryRegulator",
  Other: "stakeholderCategoryOther",
};

const LEVEL_KEY: Record<InfluenceInterest, TranslationKey> = {
  Low: "levelLow",
  Medium: "levelMedium",
  High: "levelHigh",
};

const QUADRANTS: { id: StakeholderQuadrant; labelKey: TranslationKey }[] = [
  { id: "keep-satisfied", labelKey: "quadrantKeepSatisfied" },
  { id: "manage-closely", labelKey: "quadrantManageClosely" },
  { id: "monitor", labelKey: "quadrantMonitor" },
  { id: "keep-informed", labelKey: "quadrantKeepInformed" },
];

export interface StakeholderReportPanelProps {
  lang: Lang;
  stakeholders: readonly Stakeholder[];
  milestones: readonly Milestone[];
  embedded?: boolean;
}

export function StakeholderReportPanel({
  lang,
  stakeholders,
  milestones,
  embedded = false,
}: StakeholderReportPanelProps) {
  const byCategory = STAKEHOLDER_CATEGORIES.map((c) => ({
    category: c,
    count: stakeholders.filter((s) => s.category === c).length,
  }));

  const byQuadrant: Record<StakeholderQuadrant, Stakeholder[]> = {
    "manage-closely": [],
    "keep-satisfied": [],
    "keep-informed": [],
    monitor: [],
  };
  for (const s of stakeholders) byQuadrant[quadrantFor(s)].push(s);

  const content =
    stakeholders.length === 0 ? (
      <EmptyState compact title={t(lang, "stakeholdersEmpty")} />
    ) : (
      <div className="space-y-6">
        {/* Summary tiles */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card className="p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t(lang, "navStakeholders")}
            </p>
            <p className="mt-1 text-2xl font-semibold text-ui-dark-blue dark:text-ui-light-grey">
              {stakeholders.length}
            </p>
          </Card>
          {byCategory
            .filter((c) => c.count > 0)
            .map((c) => (
              <Card
                key={c.category}
                className="p-3"
              >
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t(lang, CATEGORY_KEY[c.category])}
                </p>
                <p className="mt-1 text-2xl font-semibold text-ui-dark-blue dark:text-ui-light-grey">
                  {c.count}
                </p>
              </Card>
            ))}
        </div>

        {/* Influence / Interest 2×2 grid */}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">
            {t(lang, "stakeholderMapTitle")}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {QUADRANTS.map((q) => (
              <div key={q.id} className="rounded-lg border border-line p-3">
                {/* Bare text-ui-dark-blue is ~1.1-1.3:1 on the dark --surface,
                    so these labels were invisible there. The dark companion
                    matches the <h3> three lines above in this same file — a
                    neutral here would have left a section heading brand-blue
                    while its own labels went grey. */}
                <p className="text-xs font-semibold text-ui-dark-blue dark:text-ui-light-grey">
                  {t(lang, q.labelKey)}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {byQuadrant[q.id].map((s) => (
                    <span
                      key={s.id}
                      className="inline-block rounded px-1.5 py-0.5 text-xs font-medium bg-surface-muted text-foreground"
                    >
                      {s.name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* RACI coverage table */}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">
            {t(lang, "stakeholderRaciTitle")}
          </h3>
          {milestones.length === 0 ? (
            <EmptyState compact title={t(lang, "raciNoMilestones")} />
          ) : (
            <div className="overflow-x-auto rounded-md border border-line">
              <DataTable
                className="min-w-full text-left text-sm"
                head={
                  <tr>
                    <th className="px-3 py-2 font-medium">
                      {t(lang, "navMilestones")}
                    </th>
                    <th className="px-3 py-2 font-medium text-right">A</th>
                    <th className="px-3 py-2 font-medium">&nbsp;</th>
                  </tr>
                }
                tbodyClassName="divide-y divide-line"
              >
                  {milestones.map((m) => {
                    const count = accountableCountByMilestone(
                      stakeholders,
                      m.id,
                    );
                    const warning = raciWarningFor(count);
                    return (
                      <tr key={m.id}>
                        <td className="px-3 py-2 font-medium text-foreground">
                          {m.name}
                        </td>
                        <td className="px-3 py-2 text-right">{count}</td>
                        <td className="px-3 py-2">
                          <RaciAccountableWarning lang={lang} warning={warning} />
                        </td>
                      </tr>
                    );
                  })}
              </DataTable>
            </div>
          )}
        </div>

        {/* Register table */}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">
            {t(lang, "navStakeholders")}
          </h3>
          <div className="overflow-x-auto rounded-md border border-line">
            <DataTable
              className="min-w-full text-left text-sm"
              head={
                <tr>
                  <th className="px-3 py-2 font-medium">
                    {t(lang, "stakeholderFieldName")}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t(lang, "stakeholderFieldOrganization")}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t(lang, "stakeholderFieldCategory")}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    <span className="inline-flex items-center gap-1">
                      {t(lang, "stakeholderFieldInfluence")}
                      <InfoTooltip text={t(lang, "stakeholderFieldInfluenceHint")} />
                    </span>
                  </th>
                  <th className="px-3 py-2 font-medium">
                    <span className="inline-flex items-center gap-1">
                      {t(lang, "stakeholderFieldInterest")}
                      <InfoTooltip text={t(lang, "stakeholderFieldInterestHint")} />
                    </span>
                  </th>
                </tr>
              }
              tbodyClassName="divide-y divide-line"
            >
                {stakeholders.map((s) => (
                  <tr key={s.id}>
                    <td className="px-3 py-2 font-medium text-foreground">
                      {s.name}
                    </td>
                    <td className="px-3 py-2 text-foreground">
                      {s.organization ?? ""}
                    </td>
                    <td className="px-3 py-2 text-foreground">
                      {t(lang, CATEGORY_KEY[s.category])}
                    </td>
                    <td className="px-3 py-2 text-foreground">
                      {t(lang, LEVEL_KEY[s.influence])}
                    </td>
                    <td className="px-3 py-2 text-foreground">
                      {t(lang, LEVEL_KEY[s.interest])}
                    </td>
                  </tr>
                ))}
            </DataTable>
          </div>
        </div>
      </div>
    );

  if (embedded) return content;
  return <div className="p-6">{content}</div>;
}
