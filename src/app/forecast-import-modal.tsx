"use client";

// The forecast import dialog (§500), opened from a budget bucket card's
// "Import forecast…". Steps: Source (file, sheet) → Mapping (detected, set by
// hand, or proposed by Claude) → Preview → Apply. All logic is
// `useForecastImport`; this file only renders it. Mounted only while open, so
// every open starts from Source. The preview step is `forecast-import-preview.tsx`.
//
// ★ Every control has an accessible name; the Apply button is disabled while
// any blocker stands, and `apply()` re-checks against the live bucket anyway.
// ★ It is disabled too while the mapping's open questions wait for the user
// (`fi.ambiguous`, fix 7), and while Claude's mapping waits for "These columns
// are right" (`fi.claudeUnconfirmed`), with the reason as its accessible
// description.

import { useId, useRef } from "react";
import { type Lang, t, tPlural, type TranslationKey } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { Button } from "./button";
import { Banner } from "./banner";
import { Input, Select } from "./form-controls";
import { SegmentedControl } from "./segmented-control";
import { AiTriggerButton } from "./ai-trigger-button";
import { SparklesIcon } from "./icons";
import { useDraggable } from "./use-draggable";
import { useResizable } from "./use-resizable";
import { columnLetters } from "./budget-import/forecast-rows";
import type { ColumnAmbiguity, ColumnMapping } from "./budget-import/forecast-types";
import type { SheetGrid } from "./budget-import/sheet-grid";
import type { Discipline, Grade } from "./types";
import { PreviewStep } from "./forecast-import-preview";
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
  const mustConfirm = fi.ambiguous.length > 0 || fi.claudeUnconfirmed;
  const canApply = !fi.bucketGone && fi.step === "preview" && fi.importPlan !== null && fi.importPlan.blockers.length === 0 && !fi.busy && !mustConfirm;
  const sheet = fi.sheets[fi.sheetIndex];
  const confirmReasonId = useId();
  const targetId = useId();

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
          <p className="text-muted-foreground">{t(lang, "forecastImportIntro")}</p>
          {/* §719 — starts on the card's bucket; the preview and Apply follow the choice. */}
          <div className="flex flex-col gap-1">
            <label htmlFor={targetId} className="font-medium text-foreground">{t(lang, "forecastImportTarget")}</label>
            <Select id={targetId} size="xs" className="max-w-sm" value={String(fi.targetBucketId)} onChange={(e) => fi.selectBucket(Number(e.target.value))} disabled={fi.busy}>
              {/* A removed target keeps an option of its own, so picking any live bucket is a change. */}
              {fi.bucketGone && <option value={fi.targetBucketId} disabled>{t(lang, "forecastImportTargetRemoved")}</option>}
              {fi.targetBuckets.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
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
          {sheet && fi.step === "mapping" && <MappingStep lang={lang} fi={fi} sheet={sheet} />}
          {fi.step === "preview" && fi.importPlan && (
            <PreviewStep lang={lang} fi={fi} plan={fi.importPlan} resources={deps.resources} roles={deps.roles} disciplines={disciplines} grades={grades} />
          )}
        </div>
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-6 py-4">
          {/* Why Apply waits: also the button's accessible description. */}
          {mustConfirm && (
            <p id={confirmReasonId} className="mr-auto text-xs text-muted-foreground">
              {t(lang, fi.claudeUnconfirmed ? "forecastImportConfirmClaudeFirst" : "forecastImportConfirmFirst")}
            </p>
          )}
          <Button variant="secondary" size="sm" onClick={close}>
            {t(lang, "cancel")}
          </Button>
          <Button size="sm" onClick={onApply} disabled={!canApply} aria-describedby={mustConfirm ? confirmReasonId : undefined}>
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
      {fi.step === "preview" && (
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

type Draft = {
  layout: "wide" | "long";
  headerRow: number;
  person: number;
  email?: number;
  rate?: number;
  period: number;
  hours: number;
  year?: number;
  yearCol?: number;
};

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
    yearCol: mapping?.yearCol,
  };
}

/** The wide mapping's period columns kept as they are: `current` is wide on the
 *  same header row and year. ★★ An edit of the person, email or rate column
 *  once rebuilt them from the header, which replaced Claude's choice of one
 *  block of a `Plan | Ist` sheet with every period header (final review 2, M2).
 *  A layout, header-row or year change rebuilds them: the year decides which
 *  headers are periods. A column the edit takes for another field leaves them. */
function keptPeriodCols(d: Draft, current: ColumnMapping | null): number[] | null {
  if (current === null || current.layout !== "wide" || current.headerRow !== d.headerRow || current.year !== d.year) return null;
  const taken = new Set([d.person, d.email, d.rate]);
  return (current.periodCols ?? []).filter((col) => !taken.has(col));
}

function mappingOf(d: Draft, sheet: SheetGrid, current: ColumnMapping | null): ColumnMapping {
  if (d.layout === "wide") {
    const rebuilt = wideMappingFor(sheet.rows, d.headerRow, { person: d.person, email: d.email, rate: d.rate }, d.year, sheet.numbers);
    const kept = keptPeriodCols(d, current);
    return kept === null ? rebuilt : { ...rebuilt, periodCols: kept };
  }
  const mapping: ColumnMapping = { layout: "long", headerRow: d.headerRow, person: d.person, period: d.period, hours: d.hours };
  if (d.email !== undefined) mapping.email = d.email;
  if (d.rate !== undefined) mapping.rate = d.rate;
  if (d.year !== undefined) mapping.year = d.year;
  if (d.yearCol !== undefined) mapping.yearCol = d.yearCol;
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

// The continuation key is singular/plural (`tPlural`), so it is looked up in `noticeText`.
const AMBIGUOUS_KEY: Record<Exclude<ColumnAmbiguity["field"], "continuation">, TranslationKey> = {
  hours: "forecastImportAmbiguousHours",
  period: "forecastImportAmbiguousPeriod",
  header: "forecastImportAmbiguousHeader",
  rows: "forecastImportAmbiguousRows",
  sheet: "forecastImportAmbiguousSheet",
};
/** Rows a continuation notice names before it ends in "…": a merged person
 *  column can leave every second row of a long sheet without a person. */
const MAX_NAMED_ROWS = 5;

/** A notice's text: rows and continuations quote their samples (a continuation
 *  without any reads the plain variant), and one row with no person reads
 *  the singular (rr14 N4). */
function noticeText(lang: Lang, a: ColumnAmbiguity, names: string): string {
  if (a.field === "rows") return t(lang, AMBIGUOUS_KEY.rows, names, a.samples.join(", "));
  if (a.field === "continuation") {
    const n = a.candidates.length;
    return a.samples.length === 0
      ? tPlural(lang, "forecastImportAmbiguousContinuationPlain", n, names)
      : tPlural(lang, "forecastImportAmbiguousContinuation", n, names, a.samples.join(", "));
  }
  return t(lang, AMBIGUOUS_KEY[a.field], names);
}

/** A wide period question that only the named reasons explain: its own notices
 *  say what the press reads, and the generic Wide notice stays away (rr14 N1). */
function isExplainedOnly(a: ColumnAmbiguity): boolean {
  return a.field === "period" && (a.blankHeaded !== undefined || a.pastTwelve !== undefined) && a.alsoUnsure !== true;
}

/** The notices of a wide period question's named reasons (rr14 N1): the
 *  blank-headed number columns beside the period columns (final review 3,
 *  I1), and an `N/YYYY` run past 12 (M4), each saying what confirming reads. */
function reasonNotices(lang: Lang, a: ColumnAmbiguity, periodCols: readonly number[], nameOf: (col: number) => string): string[] {
  if (a.field !== "period") return [];
  const letters = (cols: readonly number[]) => cols.map(columnLetters).join(", ");
  const out: string[] = [];
  if (a.blankHeaded) out.push(tPlural(lang, "forecastImportAmbiguousBlankHeaded", a.blankHeaded.length, letters(a.blankHeaded), periodCols.map(nameOf).join(", ")));
  const run = a.pastTwelve ?? [];
  if (run.length > 0) out.push(t(lang, "forecastImportAmbiguousPastTwelve", nameOf(run[0]), nameOf(run[run.length - 1])));
  return out;
}

/** The Wide notice's candidate columns, by letter and header (round 7: it once named none). */
function wideNames(columns: readonly ColumnAmbiguity[], nameOf: (col: number) => string): string {
  return [...new Set(columns.flatMap((a) => a.candidates))].sort((a, b) => a - b).map(nameOf).join(", ");
}

/** One notice per field more than one column could be, naming the candidates
 *  by letter and header (`D: Jan 2026`, as the period-columns line: a
 *  `Plan | Ist` sheet repeats its month headers, final review 2), and the
 *  button that confirms the mapping as it stands. Choosing the field's column
 *  confirms it too, on the hand route.
 *  ★ In the Wide layout there is no hours or period select to choose from, so
 *  ONE notice asks to check the mapping instead (rr8 m2). One person's
 *  differing rows (round 9 I-W) name their columns and sample values in either
 *  layout; only the button accepts their sum. Rows with no person (final
 *  review 3, I2) name their rows, and two detectable sheets (M1) their sheets.
 *  ★★ Claude's mapping opens with its own notice and the button, with or
 *  without a question: only the press confirms it. ★ The press unmounts the
 *  notice, so `onConfirmed` moves the focus on (final review 3, M5). */
function AmbiguityNotice({ lang, fi, header, layout, onConfirmed }: {
  lang: Lang;
  fi: ForecastImport;
  header: readonly string[];
  layout: Draft["layout"];
  onConfirmed: () => void;
}) {
  const nameOf = (col: number): string => {
    const label = (header[col] ?? "").trim();
    return label === "" ? columnLetters(col) : `${columnLetters(col)}: ${label}`;
  };
  const rowNames = (rows: readonly number[], max = Infinity): string =>
    [...rows.slice(0, max).map((row) => String(row + 1)), ...(rows.length > max ? ["…"] : [])].join(", ");
  // A header or continuation ambiguity names its candidate ROWS (1-based), a
  // sheet ambiguity its sheets, in either layout.
  const namesOf = (a: ColumnAmbiguity): string => {
    if (a.field === "header") return rowNames(a.candidates);
    if (a.field === "continuation") return rowNames(a.candidates, MAX_NAMED_ROWS);
    if (a.field === "sheet") return a.candidates.map((i) => fi.sheets[i]?.name ?? String(i + 1)).join(", ");
    return a.candidates.map(nameOf).join(", ");
  };
  const columns = fi.ambiguous.filter((a) => (a.field === "hours" || a.field === "period") && !isExplainedOnly(a));
  const reasons = layout === "wide" ? fi.ambiguous.flatMap((a) => reasonNotices(lang, a, fi.mapping?.periodCols ?? [], nameOf)) : [];
  const shown = layout === "wide" ? fi.ambiguous.filter((a) => a.field !== "hours" && a.field !== "period") : fi.ambiguous;
  // The notes sit inside a sentence that ends with its own full stop.
  const notesText = fi.notes.trim().replace(/[.!]+$/, "");
  return (
    <div className="space-y-2">
      {fi.claudeUnconfirmed && (
        <Banner severity="info">
          {notesText === "" ? t(lang, "forecastImportClaudeProposedPlain") : t(lang, "forecastImportClaudeProposed", notesText)}
        </Banner>
      )}
      {layout === "wide" && columns.length > 0 && (
        <Banner severity="warn">{t(lang, "forecastImportAmbiguousWide", wideNames(columns, nameOf))}</Banner>
      )}
      {reasons.map((text) => (
        <Banner key={text} severity="warn">{text}</Banner>
      ))}
      {shown.map((a) => (
        <Banner key={a.field} severity="warn">{noticeText(lang, a, namesOf(a))}</Banner>
      ))}
      <Button
        variant="secondary"
        size="xs"
        onClick={() => {
          fi.confirmColumns();
          onConfirmed();
        }}
      >
        {t(lang, "forecastImportConfirmColumns")}
      </Button>
    </div>
  );
}

function MappingStep({ lang, fi, sheet }: { lang: Lang; fi: ForecastImport; sheet: SheetGrid }) {
  const rows = sheet.rows;
  const draft = draftOf(fi.mapping);
  const headerId = useId();
  const yearId = useId();
  // "These columns are right" unmounts its notice; the focus moves on here.
  const previewRef = useRef<HTMLButtonElement>(null);
  const header = rows[draft.headerRow] ?? [];
  const width = rows.reduce((max, r) => Math.max(max, r.length), 0);
  const chosen = [draft.person, draft.email, draft.rate, ...(draft.layout === "long" ? [draft.period, draft.hours, draft.yearCol] : [])];
  const offered = new Set([
    ...Array.from({ length: Math.min(width, MAX_COLUMN_CHOICES) }, (_, col) => col),
    ...chosen.filter((c): c is number => c !== undefined && c < width),
  ]);
  const columns = [...offered].sort((a, b) => a - b).map((col) => ({ col, text: `${columnLetters(col)}: ${header[col] ?? ""}` }));
  const commit = (patch: Partial<Draft>) => fi.setMapping(mappingOf({ ...draft, ...patch }, sheet, fi.mapping));
  const none = t(lang, "forecastImportColNone");
  // ★★ Claude's mapping is previewed as it stands: rebuilt from the draft, a
  // wide mapping would take every period header instead of Claude's columns.
  const next = fi.route === "claude" && fi.mapping !== null ? fi.mapping : mappingOf(draft, sheet, fi.mapping);
  // By letter too: a `Plan | Ist` sheet repeats its month headers (final review 2, M1).
  const periodLabels = (next.periodCols ?? []).map((c) => `${columnLetters(c)}: ${header[c] ?? ""}`).join(", ");
  return (
    <section className="space-y-3">
      {!fi.layoutDetected && fi.route === "hand" && <Banner severity="info">{t(lang, "forecastImportNoLayout")}</Banner>}
      {(fi.ambiguous.length > 0 || fi.claudeUnconfirmed) && (
        <AmbiguityNotice lang={lang} fi={fi} header={header} layout={draft.layout} onConfirmed={() => previewRef.current?.focus()} />
      )}
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
            <ColumnSelect label={t(lang, "forecastImportColYear")} value={draft.yearCol} columns={columns} optional noneLabel={none} onChange={(yearCol) => commit({ yearCol })} />
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
      <Button ref={previewRef} variant="secondary" size="xs" onClick={() => fi.showPreview(next)}>
        {t(lang, "forecastImportShowPreview")}
      </Button>
    </section>
  );
}
