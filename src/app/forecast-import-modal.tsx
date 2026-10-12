"use client";

// The forecast import dialog (§500), opened from a budget bucket card's
// "Import forecast…". Steps: Source (file, sheet) → Mapping (hand route) or
// Claude → Preview → Apply. All logic is `useForecastImport`; this file only
// renders it. Mounted only while open, so every open starts from Source.
//
// ★ The preview's sections are in a fixed order — blockers, unresolved people,
// rate notes, what was not imported, Claude's notes, the new lines and people
// joining them, then the cell diff — so the reasons a cell will NOT be written
// are read before the cells that will.
// ★ Every per-person picker is named with a `buildRowTokens` token, and every
// control has an accessible name; the Apply button is disabled while any
// blocker stands, and `apply()` re-checks against the live bucket anyway.

import { useId, type ReactNode } from "react";
import { type Lang, localeFor, t, type TranslationKey } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { Button } from "./button";
import { Banner } from "./banner";
import { Input, Select } from "./form-controls";
import { SegmentedControl } from "./segmented-control";
import { AiTriggerButton } from "./ai-trigger-button";
import { ExclamationTriangleIcon, SparklesIcon } from "./icons";
import { useDraggable } from "./use-draggable";
import { useResizable } from "./use-resizable";
import { buildRowTokens, rowLabel } from "./row-tokens";
import { resourceDisplayName, roleLabel } from "./resource-foundation";
import { columnLetters } from "./budget-import/forecast-rows";
import { normalisePerson, type AllocationKey, type CellChange, type ImportBlocker, type ImportPlan, type UnresolvedPerson } from "./budget-import/forecast-plan";
import type { ColumnMapping, DropReason } from "./budget-import/forecast-types";
import { MAX_IMPORT_HOURS_PER_CELL, type RejectedRow, type SourceRejection } from "./budget-import/forecast-validate";
import type { Discipline, Grade, Resource, Role } from "./types";
import { useForecastImport, wideMappingFor, type ForecastImport, type ForecastImportDeps } from "./use-forecast-import";

export interface ForecastImportModalProps extends ForecastImportDeps {
  lang: Lang;
  open: boolean;
  onClose: () => void;
  /** For naming allocations in the diff. */
  disciplines: readonly Discipline[];
  grades: readonly Grade[];
}

const ACCEPT = ".xlsx,.xlsm,.csv";
const MAX_HEADER_ROW_CHOICES = 50;
/** Columns a mapping select offers (plus any column already chosen): a sheet
 *  thousands of columns wide would otherwise render that many options per select. */
const MAX_COLUMN_CHOICES = 200;

const BLOCKER_KEY: Record<ImportBlocker, TranslationKey> = {
  "follows-plan": "forecastImportBlockerFollowsPlan",
  closed: "forecastImportBlockerClosed",
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

export function ForecastImportModal(props: ForecastImportModalProps) {
  if (!props.open) return null;
  return <ForecastImportDialog {...props} />;
}

function ForecastImportDialog({ lang, onClose, disciplines, grades, ...deps }: ForecastImportModalProps) {
  const fi = useForecastImport(deps);
  const title = t(lang, "forecastImportTitle");
  const fileId = useId();
  const { offset, reset: dragReset, handleProps } = useDraggable(true, "aipm-cockpit:modal-pos:forecast-import");
  const { ref: sizeRef, reset: sizeReset } = useResizable("aipm-cockpit:modal-size:forecast-import");
  const close = () => {
    fi.cancel();
    onClose();
  };
  const onApply = () => {
    if (fi.apply() === "applied") onClose();
  };
  const canApply = !fi.bucketGone && fi.step === "preview" && fi.importPlan !== null && fi.importPlan.blockers.length === 0 && !fi.busy;
  const sheet = fi.sheets[fi.sheetIndex];

  return (
    <Modal open onClose={close} ariaLabel={title}>
      <div
        ref={sizeRef}
        data-modal-panel
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        className="relative flex h-[720px] min-h-[420px] max-h-[95vh] w-[760px] min-w-[460px] max-w-[95vw] resize flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <ModalHeader
          lang={lang}
          title={title}
          onClose={close}
          dragHandleProps={handleProps}
          onResetLayout={() => {
            dragReset();
            sizeReset();
          }}
        />
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6 text-sm">
          <div>
            <p className="text-muted-foreground">{t(lang, "forecastImportIntro")}</p>
            <p className="mt-1 font-medium text-foreground">{t(lang, "forecastImportTarget", deps.bucket.name)}</p>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={fileId} className="font-medium text-foreground">{t(lang, "forecastImportFile")}</label>
            <input
              id={fileId}
              type="file"
              accept={ACCEPT}
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                // Cleared so choosing the same file again (after fixing it) still fires a change.
                e.currentTarget.value = "";
                if (file) void fi.loadFile(file);
              }}
              className="text-sm text-foreground file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-foreground hover:file:bg-surface-muted"
            />
          </div>
          {fi.busy && !fi.claudeBusy && <p role="status" className="text-muted-foreground">{t(lang, "forecastImportReading")}</p>}
          {fi.error && (
            <Banner severity="error">{"key" in fi.error ? t(lang, fi.error.key, ...(fi.error.args ?? [])) : fi.error.message}</Banner>
          )}
          {fi.bucketGone && <Banner severity="error">{t(lang, "forecastImportBucketGone")}</Banner>}
          {sheet && <RouteBar lang={lang} fi={fi} />}
          {sheet?.truncated && <Banner severity="warn">{t(lang, "forecastImportTruncated")}</Banner>}
          {sheet && fi.step === "mapping" && <MappingStep lang={lang} fi={fi} rows={sheet.rows} />}
          {fi.step === "preview" && fi.importPlan && (
            <PreviewStep lang={lang} fi={fi} plan={fi.importPlan} resources={deps.resources} roles={deps.roles} disciplines={disciplines} grades={grades} />
          )}
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-line px-6 py-4">
          <Button variant="secondary" size="sm" onClick={close}>
            {t(lang, "cancel")}
          </Button>
          <Button size="sm" onClick={onApply} disabled={!canApply}>
            {t(lang, "forecastImportApply")}
          </Button>
        </footer>
      </div>
    </Modal>
  );
}

function RouteBar({ lang, fi }: { lang: Lang; fi: ForecastImport }) {
  const sheetId = useId();
  return (
    <div className="flex flex-wrap items-end gap-2">
      {fi.sheets.length > 1 && (
        <div className="flex flex-col gap-1">
          <label htmlFor={sheetId} className="font-medium text-foreground">{t(lang, "forecastImportSheet")}</label>
          <Select id={sheetId} size="xs" value={String(fi.sheetIndex)} onChange={(e) => fi.selectSheet(Number(e.target.value))}>
            {fi.sheets.map((s, i) => (
              <option key={i} value={i}>{s.name}</option>
            ))}
          </Select>
        </div>
      )}
      <Button variant="secondary" size="xs" onClick={fi.detectColumns} disabled={fi.busy}>
        {t(lang, "forecastImportDetect")}
      </Button>
      {fi.step === "preview" && fi.route === "hand" && (
        <Button variant="secondary" size="xs" onClick={fi.editMapping} disabled={fi.busy}>
          {t(lang, "forecastImportEditColumns")}
        </Button>
      )}
      <AiTriggerButton
        lang={lang}
        busy={fi.claudeBusy}
        onRun={() => void fi.askClaude()}
        onCancel={fi.cancel}
        idleLabelKey="forecastImportAskClaude"
        idleIcon={<SparklesIcon aria-hidden="true" className="h-4 w-4" />}
        disabled={!fi.aiAvailable || (fi.busy && !fi.claudeBusy)}
        // The reason is the button's accessible description, not only text beside it.
        description={fi.aiAvailable ? undefined : t(lang, "forecastImportAiOff")}
      />
      {!fi.aiAvailable && <p className="text-xs text-muted-foreground">{t(lang, "forecastImportAiOff")}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ mapping

type Draft = { layout: "wide" | "long"; headerRow: number; person: number; email?: number; rate?: number; period: number; hours: number; year?: number };

function draftOf(mapping: ColumnMapping | null): Draft {
  return {
    layout: mapping?.layout ?? "wide",
    headerRow: mapping?.headerRow ?? 0,
    person: mapping?.person ?? 0,
    email: mapping?.email,
    rate: mapping?.rate,
    period: mapping?.period ?? 1,
    hours: mapping?.hours ?? 2,
    year: mapping?.year,
  };
}

function mappingOf(d: Draft, rows: readonly string[][]): ColumnMapping {
  if (d.layout === "wide") return wideMappingFor(rows, d.headerRow, { person: d.person, email: d.email, rate: d.rate }, d.year);
  const mapping: ColumnMapping = { layout: "long", headerRow: d.headerRow, person: d.person, period: d.period, hours: d.hours };
  if (d.email !== undefined) mapping.email = d.email;
  if (d.rate !== undefined) mapping.rate = d.rate;
  if (d.year !== undefined) mapping.year = d.year;
  return mapping;
}

function ColumnSelect({ label, value, columns, optional, noneLabel, onChange }: {
  label: string;
  value: number | undefined;
  columns: readonly { col: number; text: string }[];
  optional: boolean;
  noneLabel: string;
  onChange: (col: number | undefined) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-foreground">{label}</label>
      <Select id={id} size="xs" value={value === undefined ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}>
        {optional && <option value="">{noneLabel}</option>}
        {columns.map((c) => (
          <option key={c.col} value={c.col}>{c.text}</option>
        ))}
      </Select>
    </div>
  );
}

function MappingStep({ lang, fi, rows }: { lang: Lang; fi: ForecastImport; rows: readonly string[][] }) {
  const draft = draftOf(fi.mapping);
  const headerId = useId();
  const yearId = useId();
  const header = rows[draft.headerRow] ?? [];
  const width = rows.reduce((max, r) => Math.max(max, r.length), 0);
  const chosen = [draft.person, draft.email, draft.rate, ...(draft.layout === "long" ? [draft.period, draft.hours] : [])];
  const offered = new Set([
    ...Array.from({ length: Math.min(width, MAX_COLUMN_CHOICES) }, (_, col) => col),
    ...chosen.filter((c): c is number => c !== undefined && c < width),
  ]);
  const columns = [...offered].sort((a, b) => a - b).map((col) => ({ col, text: `${columnLetters(col)}: ${header[col] ?? ""}` }));
  const commit = (patch: Partial<Draft>) => fi.setMapping(mappingOf({ ...draft, ...patch }, rows));
  const none = t(lang, "forecastImportColNone");
  const next = mappingOf(draft, rows);
  const periodLabels = (next.periodCols ?? []).map((c) => header[c]).join(", ");
  return (
    <section className="space-y-3">
      {!fi.layoutDetected && <Banner severity="info">{t(lang, "forecastImportNoLayout")}</Banner>}
      <SegmentedControl
        ariaLabel={t(lang, "forecastImportLayout")}
        value={draft.layout}
        options={[
          { value: "wide", label: t(lang, "forecastImportLayoutWide") },
          { value: "long", label: t(lang, "forecastImportLayoutLong") },
        ]}
        onChange={(layout) => commit({ layout })}
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={headerId} className="text-foreground">{t(lang, "forecastImportHeaderRow")}</label>
          <Select id={headerId} size="xs" value={String(draft.headerRow)} onChange={(e) => commit({ headerRow: Number(e.target.value) })}>
            {rows.slice(0, MAX_HEADER_ROW_CHOICES).map((_, i) => (
              <option key={i} value={i}>{String(i + 1)}</option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={yearId} className="text-foreground">{t(lang, "forecastImportYear")}</label>
          <Input
            id={yearId}
            type="number"
            size="xs"
            value={draft.year === undefined ? "" : String(draft.year)}
            onChange={(e) => {
              const year = Number(e.target.value);
              commit({ year: e.target.value === "" || !Number.isInteger(year) ? undefined : year });
            }}
          />
        </div>
        <ColumnSelect label={t(lang, "forecastImportColPerson")} value={draft.person} columns={columns} optional={false} noneLabel={none} onChange={(c) => commit({ person: c ?? 0 })} />
        <ColumnSelect label={t(lang, "forecastImportColEmail")} value={draft.email} columns={columns} optional noneLabel={none} onChange={(email) => commit({ email })} />
        <ColumnSelect label={t(lang, "forecastImportColRate")} value={draft.rate} columns={columns} optional noneLabel={none} onChange={(rate) => commit({ rate })} />
        {draft.layout === "long" && (
          <>
            <ColumnSelect label={t(lang, "forecastImportColPeriod")} value={draft.period} columns={columns} optional={false} noneLabel={none} onChange={(c) => commit({ period: c ?? 0 })} />
            <ColumnSelect label={t(lang, "forecastImportColHours")} value={draft.hours} columns={columns} optional={false} noneLabel={none} onChange={(c) => commit({ hours: c ?? 0 })} />
          </>
        )}
      </div>
      {width > MAX_COLUMN_CHOICES && <p className="text-muted-foreground">{t(lang, "forecastImportColumnsCapped", String(MAX_COLUMN_CHOICES))}</p>}
      {draft.layout === "wide" && <p className="text-muted-foreground">{t(lang, "forecastImportPeriodColsFound", periodLabels || none)}</p>}
      <div>
        <h3 className="font-medium text-foreground">{t(lang, "forecastImportSample")}</h3>
        {fi.sample.length === 0 ? (
          <p className="text-muted-foreground">{t(lang, "forecastImportSampleEmpty")}</p>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {fi.sample.map((r, i) => (
              <li key={i}>{`${r.person} · ${r.period} · ${r.hours} h${r.source ? ` (${r.source})` : ""}`}</li>
            ))}
          </ul>
        )}
      </div>
      <Button variant="secondary" size="xs" onClick={() => fi.showPreview(next)}>
        {t(lang, "forecastImportShowPreview")}
      </Button>
    </section>
  );
}

// ------------------------------------------------------------------ preview

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

function PreviewStep({ lang, fi, plan, resources, roles, disciplines, grades }: {
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
  const hasNotImported = fi.rejected.length + fi.dropped.length + fi.ignoredColumns.length + plan.outOfRange.length + plan.skipped.length + fi.duplicates.length > 0;
  const delta = plan.hoursDelta;
  return (
    <div className="space-y-4">
      {fi.route === "claude" && <p className="text-muted-foreground">{t(lang, "forecastImportClaudeRoute")}</p>}
      {plan.blockers.map((b) => (
        <Banner key={b} severity="warn">{t(lang, BLOCKER_KEY[b])}</Banner>
      ))}
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
            {fi.duplicates.map((d, i) => (
              <li key={`u${i}`}>
                {t(lang, "forecastImportDuplicate", d.person, d.period, String(d.count))}
                {d.sources.length > 0 ? ` · ${t(lang, "forecastImportSources", d.sources.join(", "))}` : ""}
              </li>
            ))}
            {plan.skipped.length > 0 && <li>{t(lang, "forecastImportSkippedPeople", plan.skipped.join(", "))}</li>}
            {plan.outOfRange.length > 0 && (
              <li>{t(lang, "forecastImportOutOfRange", plan.outOfRange.map((o) => `${o.person} ${o.period}`).join(", "))}</li>
            )}
          </ul>
        </Section>
      )}
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
