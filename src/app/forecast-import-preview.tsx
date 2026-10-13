"use client";

// The forecast import dialog's PREVIEW step (§500): what the import would write
// and every reason something will not be. Rendered by `ForecastImportModal`;
// all logic is `useForecastImport`.
//
// ★ The preview's sections are in a fixed order — blockers, unresolved people,
// rate notes, what was not imported, Claude's notes, the new lines and people
// joining them, then the cell diff — so the reasons a cell will NOT be written
// are read before the cells that will.
// ★ Every per-person picker is named with a `buildRowTokens` token, and every
// control has an accessible name.

import { useId, type ReactNode } from "react";
import { type Lang, localeFor, t, type TranslationKey } from "./i18n";
import { Banner } from "./banner";
import { Button } from "./button";
import { Select } from "./form-controls";
import { ExclamationTriangleIcon } from "./icons";
import { buildRowTokens, rowLabel } from "./row-tokens";
import { resourceDisplayName, roleLabel } from "./resource-foundation";
import { columnLetters } from "./budget-import/forecast-rows";
import { normalisePerson, type AllocationKey, type CellChange, type ImportBlocker, type ImportPlan, type UnresolvedPerson } from "./budget-import/forecast-plan";
import type { AssumedYear, DropReason } from "./budget-import/forecast-types";
import { MAX_IMPORT_HOURS_PER_CELL, type RejectedRow, type SourceRejection } from "./budget-import/forecast-validate";
import type { Discipline, Grade, Resource, Role } from "./types";
import type { ForecastImport } from "./use-forecast-import";

const BLOCKER_KEY: Record<ImportBlocker, TranslationKey> = {
  "follows-plan": "forecastImportBlockerFollowsPlan",
  closed: "forecastImportBlockerClosed",
  "same-row-period": "forecastImportBlockerSameRow",
  "nothing-to-apply": "forecastImportBlockerNothing",
};
const WHY_KEY: Record<UnresolvedPerson["why"], TranslationKey> = {
  "no-match": "forecastImportWhyNoMatch",
  ambiguous: "forecastImportWhyAmbiguous",
  "no-role": "forecastImportWhyNoRole",
};
const REJECT_KEY: Record<Exclude<RejectedRow["reason"], "source">, TranslationKey> = {
  shape: "forecastImportRejectShape",
  hours: "forecastImportRejectHours",
  period: "forecastImportRejectPeriod",
  person: "forecastImportRejectPerson",
};
const SOURCE_KEY: Record<SourceRejection, TranslationKey> = {
  "bad-ref": "forecastImportRejectSourceRef",
  "value-mismatch": "forecastImportRejectSourceValue",
  "person-not-on-row": "forecastImportRejectSourcePerson",
  "period-not-near": "forecastImportRejectSourcePeriod",
  "cell-reused": "forecastImportRejectSourceReused",
};
const DROP_KEY: Record<DropReason["reason"], TranslationKey> = {
  total: "forecastImportDropTotal",
  "blank-person": "forecastImportDropBlankPerson",
  "bad-period": "forecastImportDropBadPeriod",
  "bad-number": "forecastImportDropBadNumber",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-1">
      <h3 id={id} className="font-medium text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function describeRejected(lang: Lang, r: RejectedRow): string {
  const raw = r.row;
  const rec = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const parts = rec
    ? [rec.person, rec.period, rec.hours === undefined ? undefined : `${String(rec.hours)} h`]
        .filter((v) => v !== undefined && v !== null && v !== "")
        .map(String)
    : [];
  const why = r.reason === "source" ? t(lang, SOURCE_KEY[r.detail]) : t(lang, REJECT_KEY[r.reason], String(MAX_IMPORT_HOURS_PER_CELL));
  const text = t(lang, "forecastImportRejectedRow", parts.length > 0 ? parts.join(" · ") : "—", why);
  return rec && typeof rec.source === "string" ? `${text} (${rec.source})` : text;
}

/** Which year headers without one were read in. A detected layout goes straight
 *  to the preview, so this is where that assumption is shown; the hand route
 *  links to the year field on the mapping step. */
function AssumedYearLine({ lang, fi, assumed }: { lang: Lang; fi: ForecastImport; assumed: AssumedYear }) {
  const text = t(lang, assumed.rolled ? "forecastImportAssumedYearFrom" : "forecastImportAssumedYear", String(assumed.year));
  return (
    <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
      <span>{text}</span>
      {fi.route === "hand" && (
        <Button variant="secondary" size="xs" onClick={fi.editMapping}>
          {t(lang, "forecastImportChangeYear")}
        </Button>
      )}
    </div>
  );
}

/** Cells of one sheet row that landed on the same person and period: the import
 *  is blocked, and the hand route can go back to the mapping from here. */
function CollisionsSection({ lang, fi }: { lang: Lang; fi: ForecastImport }) {
  return (
    <Section title={t(lang, "forecastImportCollisions")}>
      <ul className="space-y-0.5">
        {fi.collisions.map((c) => (
          <li key={`${c.person}|${c.period}`}>{t(lang, "forecastImportCollision", c.person, c.period, c.sources.join(", "))}</li>
        ))}
      </ul>
      {fi.route === "hand" && (
        <Button variant="secondary" size="xs" onClick={fi.editMapping}>
          {t(lang, "forecastImportChangeMapping")}
        </Button>
      )}
    </Section>
  );
}

/** Rows of DIFFERENT sheet rows summed into one person and period: imported,
 *  so listed apart from what was not. */
function CombinedSection({ lang, fi }: { lang: Lang; fi: ForecastImport }) {
  return (
    <Section title={t(lang, "forecastImportCombined")}>
      <ul className="space-y-0.5 text-muted-foreground">
        {fi.duplicates.map((d, i) => (
          <li key={`u${i}`}>
            {t(lang, "forecastImportDuplicate", d.person, d.period, String(d.count))}
            {d.sources.length > 0 ? ` · ${t(lang, "forecastImportSources", d.sources.join(", "))}` : ""}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function allocLabel(alloc: AllocationKey, roles: readonly Role[], disciplines: readonly Discipline[], grades: readonly Grade[]): string {
  if (alloc.kind === "role") return roleLabel(roles.find((r) => r.id === alloc.roleId), disciplines, grades) || `#${alloc.roleId}`;
  return disciplines.find((d) => d.id === alloc.disciplineId)?.name || `#${alloc.disciplineId}`;
}

function resourceName(id: number, resources: readonly Resource[]): string {
  const resource = resources.find((r) => r.id === id);
  return resource ? resourceDisplayName(resource) : `#${id}`;
}

function allocKey(alloc: AllocationKey): string {
  return alloc.kind === "role" ? `r:${alloc.roleId}` : `d:${alloc.disciplineId}`;
}

export function PreviewStep({ lang, fi, plan, resources, roles, disciplines, grades }: {
  lang: Lang;
  fi: ForecastImport;
  plan: ImportPlan;
  resources: readonly Resource[];
  roles: readonly Role[];
  disciplines: readonly Discipline[];
  grades: readonly Grade[];
}) {
  const locale = localeFor(lang);
  const fmt = (n: number) => n.toLocaleString(locale, { maximumFractionDigits: 2 });
  const groups = new Map<string, { alloc: AllocationKey; changes: CellChange[] }>();
  for (const c of plan.changes) {
    const key = allocKey(c.alloc);
    const group = groups.get(key) ?? { alloc: c.alloc, changes: [] };
    group.changes.push(c);
    groups.set(key, group);
  }
  const hasNotImported = fi.rejected.length + fi.dropped.length + fi.ignoredColumns.length + plan.outOfRange.length + plan.skipped.length > 0;
  const delta = plan.hoursDelta;
  return (
    <div className="space-y-4">
      {fi.route === "claude" && <p className="text-muted-foreground">{t(lang, "forecastImportClaudeRoute")}</p>}
      {fi.assumedYear && <AssumedYearLine lang={lang} fi={fi} assumed={fi.assumedYear} />}
      {plan.blockers.map((b) => (
        <Banner key={b} severity="warn">{t(lang, BLOCKER_KEY[b])}</Banner>
      ))}
      {fi.collisions.length > 0 && <CollisionsSection lang={lang} fi={fi} />}
      {fi.unresolvedPeople.length > 0 && <UnresolvedSection lang={lang} fi={fi} resources={resources} roles={roles} />}
      {plan.rateNotes.length > 0 && (
        <Section title={t(lang, "forecastImportRateNotes")}>
          <ul className="space-y-0.5">
            {plan.rateNotes.map((n) => (
              <li key={`${n.resourceId}|${n.sheetRate}`}>
                {t(lang, "forecastImportRateNote", n.person, fmt(n.sheetRate), fmt(n.internalRate), fmt(n.externalRate))}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {hasNotImported && (
        <Section title={t(lang, "forecastImportNotImported")}>
          <ul className="space-y-0.5 text-muted-foreground">
            {fi.ignoredColumns.map((c) => (
              <li key={`c${c.col}`}>{t(lang, "forecastImportIgnoredColumn", columnLetters(c.col), c.header || "—")}</li>
            ))}
            {fi.dropped.map((d, i) => (
              <li key={`d${i}`}>{t(lang, "forecastImportRowRef", String(d.row), t(lang, DROP_KEY[d.reason]))}</li>
            ))}
            {fi.rejected.map((r, i) => (
              <li key={`r${i}`}>{describeRejected(lang, r)}</li>
            ))}
            {plan.skipped.length > 0 && <li>{t(lang, "forecastImportSkippedPeople", plan.skipped.join(", "))}</li>}
            {plan.outOfRange.length > 0 && (
              <li>{t(lang, "forecastImportOutOfRange", plan.outOfRange.map((o) => `${o.person} ${o.period}`).join(", "))}</li>
            )}
          </ul>
        </Section>
      )}
      {fi.duplicates.length > 0 && <CombinedSection lang={lang} fi={fi} />}
      {fi.notes.trim() !== "" && (
        <Section title={t(lang, "forecastImportNotes")}>
          <p className="whitespace-pre-wrap">{fi.notes}</p>
        </Section>
      )}
      {plan.newAllocations.length + plan.addResources.length > 0 && (
        <Section title={t(lang, "forecastImportMembership")}>
          <ul className="space-y-0.5">
            {plan.newAllocations.map((a) => (
              <li key={`n${allocKey(a)}`}>{t(lang, "forecastImportNewAllocation", allocLabel(a, roles, disciplines, grades))}</li>
            ))}
            {plan.addResources.map((a) => (
              <li key={`a${allocKey(a.alloc)}`}>
                {t(lang, "forecastImportAddResources", allocLabel(a.alloc, roles, disciplines, grades), a.resourceIds.map((id) => resourceName(id, resources)).join(", "))}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {plan.changes.length > 0 && (
        <Section title={t(lang, "forecastImportChanges")}>
          {[...groups.values()].map((g) => (
            <div key={allocKey(g.alloc)} className="mt-2">
              <h4 className="font-medium text-foreground">{allocLabel(g.alloc, roles, disciplines, grades)}</h4>
              <ul className="space-y-0.5">
                {g.changes.map((c) => (
                  <li key={c.period} className="flex flex-wrap items-center gap-2">
                    <span className="tabular-nums text-muted-foreground">{c.period}</span>
                    <span className="tabular-nums">{`${c.old === undefined ? "—" : fmt(c.old)} → ${fmt(c.next)}`}</span>
                    {c.partial && (
                      <span className="inline-flex items-center gap-1 text-xs text-foreground">
                        <ExclamationTriangleIcon aria-hidden="true" className="h-3.5 w-3.5" />
                        <span>{t(lang, "forecastImportPartial")}</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="mt-2 font-medium text-foreground">{t(lang, "forecastImportTotalDelta", `${delta > 0 ? "+" : ""}${fmt(delta)}`)}</p>
        </Section>
      )}
    </div>
  );
}

function UnresolvedSection({ lang, fi, resources, roles }: {
  lang: Lang;
  fi: ForecastImport;
  resources: readonly Resource[];
  roles: readonly Role[];
}) {
  const roleIds = new Set(roles.map((r) => r.id));
  // Only a resource with a role can take hours; a role-less pick would stay unresolved.
  const pickable = resources
    .filter((r) => r.roleId != null && roleIds.has(r.roleId))
    .sort((a, b) => resourceDisplayName(a).localeCompare(resourceDisplayName(b), undefined, { sensitivity: "base" }));
  const tokens = buildRowTokens(fi.unresolvedPeople.map((p) => ({ id: normalisePerson(p.person), name: p.person })));
  return (
    <Section title={t(lang, "forecastImportUnresolved")}>
      <p className="text-muted-foreground">{t(lang, "forecastImportUnresolvedHint")}</p>
      <ul className="space-y-2">
        {fi.unresolvedPeople.map((p) => {
          const key = normalisePerson(p.person);
          const value = fi.overrides.get(key) ?? "skip";
          // Candidates first: an ambiguous name is most likely one of them.
          const first = pickable.filter((r) => p.candidates.includes(r.id));
          const rest = pickable.filter((r) => !p.candidates.includes(r.id));
          return (
            <li key={key} className="flex flex-wrap items-center gap-3">
              <span className="min-w-0">
                <span className="font-medium text-foreground">{p.person}</span>
                {p.email ? <span className="text-muted-foreground"> · {p.email}</span> : null}
                <span className="block text-xs text-muted-foreground">{t(lang, WHY_KEY[p.why])}</span>
              </span>
              <Select
                size="xs"
                aria-label={rowLabel(t(lang, "forecastImportMatchPerson"), tokens.get(key) ?? p.person)}
                value={String(value)}
                onChange={(e) => fi.setOverride(p.person, e.target.value === "skip" ? "skip" : Number(e.target.value))}
              >
                <option value="skip">{t(lang, "forecastImportSkip")}</option>
                {[...first, ...rest].map((r) => (
                  <option key={r.id} value={r.id}>{resourceDisplayName(r)}</option>
                ))}
              </Select>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
