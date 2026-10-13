"use client";

// The forecast import dialog (§500), opened from a budget bucket card's
// "Import forecast…". Steps: Source (file, sheet) → Mapping (hand route) or
// Claude → Preview → Apply. All logic is `useForecastImport`; this file only
// renders it. Mounted only while open, so every open starts from Source. The
// preview step is `forecast-import-preview.tsx`.
//
// ★ Every control has an accessible name; the Apply button is disabled while
// any blocker stands, and `apply()` re-checks against the live bucket anyway.
// ★ It is disabled too while detection's ambiguous columns wait for the user
// (`fi.ambiguous`, fix 7), with the reason as its accessible description.

import { useId } from "react";
import { type Lang, t, type TranslationKey } from "./i18n";
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
  const mustConfirm = fi.ambiguous.length > 0;
  const canApply = !fi.bucketGone && fi.step === "preview" && fi.importPlan !== null && fi.importPlan.blockers.length === 0 && !fi.busy && !mustConfirm;
  const sheet = fi.sheets[fi.sheetIndex];
  const confirmReasonId = useId();

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
          {sheet && fi.step === "mapping" && <MappingStep lang={lang} fi={fi} sheet={sheet} />}
          {fi.step === "preview" && fi.importPlan && (
            <PreviewStep lang={lang} fi={fi} plan={fi.importPlan} resources={deps.resources} roles={deps.roles} disciplines={disciplines} grades={grades} />
          )}
        </div>
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-6 py-4">
          {/* Why Apply waits: also the button's accessible description. */}
          {mustConfirm && <p id={confirmReasonId} className="mr-auto text-xs text-muted-foreground">{t(lang, "forecastImportConfirmFirst")}</p>}
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

function mappingOf(d: Draft, sheet: SheetGrid): ColumnMapping {
  if (d.layout === "wide") {
    return wideMappingFor(sheet.rows, d.headerRow, { person: d.person, email: d.email, rate: d.rate }, d.year, sheet.numbers);
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

const AMBIGUOUS_KEY: Record<ColumnAmbiguity["field"], TranslationKey> = {
  hours: "forecastImportAmbiguousHours",
  period: "forecastImportAmbiguousPeriod",
  header: "forecastImportAmbiguousHeader",
};

/** The Wide notice's candidate columns, by header (round 7: it once named none). */
function wideNames(columns: readonly ColumnAmbiguity[], nameOf: (col: number) => string): string {
  return [...new Set(columns.flatMap((a) => a.candidates))].sort((a, b) => a - b).map(nameOf).join(", ");
}

/** One notice per field more than one column could be, naming the candidates
 *  by header (or column letter), and the button that confirms the mapping as
 *  it stands. Choosing the field's column confirms it too. ★ In the Wide
 *  layout there is no hours or period select to choose from, so ONE notice
 *  asks to check the mapping instead (rr8 m2). */
function AmbiguityNotice({ lang, fi, header, layout }: { lang: Lang; fi: ForecastImport; header: readonly string[]; layout: Draft["layout"] }) {
  const nameOf = (col: number): string => (header[col] ?? "").trim() || columnLetters(col);
  // A header ambiguity names its candidate ROWS (1-based), in either layout.
  const namesOf = (a: ColumnAmbiguity): string =>
    (a.field === "header" ? a.candidates.map((row) => String(row + 1)) : a.candidates.map(nameOf)).join(", ");
  const columns = fi.ambiguous.filter((a) => a.field !== "header");
  const shown = layout === "wide" ? fi.ambiguous.filter((a) => a.field === "header") : fi.ambiguous;
  return (
    <div className="space-y-2">
      {layout === "wide" && columns.length > 0 && (
        <Banner severity="warn">{t(lang, "forecastImportAmbiguousWide", wideNames(columns, nameOf))}</Banner>
      )}
      {shown.map((a) => (
        <Banner key={a.field} severity="warn">{t(lang, AMBIGUOUS_KEY[a.field], namesOf(a))}</Banner>
      ))}
      <Button variant="secondary" size="xs" onClick={fi.confirmColumns}>
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
  const header = rows[draft.headerRow] ?? [];
  const width = rows.reduce((max, r) => Math.max(max, r.length), 0);
  const chosen = [draft.person, draft.email, draft.rate, ...(draft.layout === "long" ? [draft.period, draft.hours, draft.yearCol] : [])];
  const offered = new Set([
    ...Array.from({ length: Math.min(width, MAX_COLUMN_CHOICES) }, (_, col) => col),
    ...chosen.filter((c): c is number => c !== undefined && c < width),
  ]);
  const columns = [...offered].sort((a, b) => a - b).map((col) => ({ col, text: `${columnLetters(col)}: ${header[col] ?? ""}` }));
  const commit = (patch: Partial<Draft>) => fi.setMapping(mappingOf({ ...draft, ...patch }, sheet));
  const none = t(lang, "forecastImportColNone");
  const next = mappingOf(draft, sheet);
  const periodLabels = (next.periodCols ?? []).map((c) => header[c]).join(", ");
  return (
    <section className="space-y-3">
      {!fi.layoutDetected && <Banner severity="info">{t(lang, "forecastImportNoLayout")}</Banner>}
      {fi.ambiguous.length > 0 && <AmbiguityNotice lang={lang} fi={fi} header={header} layout={draft.layout} />}
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
      <Button variant="secondary" size="xs" onClick={() => fi.showPreview(next)}>
        {t(lang, "forecastImportShowPreview")}
      </Button>
    </section>
  );
}
