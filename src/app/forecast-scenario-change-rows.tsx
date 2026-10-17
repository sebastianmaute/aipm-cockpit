"use client";

// One change row of the scenario editor (§502, spec §4.2): its fields, its validation message beside the field
// it belongs to (`aria-describedby`), and its live status from `buildScenarioSchedule`. Presentational: the
// editor owns the draft and passes every value and handler in. Every control is named "Change {n}: <field>"
// so two rows of one kind never share an accessible name (docs/AGENTS/accessibility.md).

import type { ReactNode } from "react";
import { type Lang, t, type TranslationKey } from "./i18n";
import { Input, Select } from "./form-controls";
import { Button } from "./button";
import { isAttributableMilestone } from "./forecast/milestones";
import { isValidIsoDate } from "./forecast/throughput";
import { shiftFor, type AddedPersonStatus, type ScheduleContext } from "./forecast-added-people";
import type { ScenarioRowStatus } from "./forecast-scenario-schedule";
import {
  ADDED_COUNT_MAX, ADDED_HOURS_MAX, ADDED_HOURS_MIN, AVAILABILITY_MAX, AVAILABILITY_MIN, DEFAULT_RAMP_WEEKS,
  PLACEHOLDER_RATE_MAX, RAMP_WEEKS_MAX, SCENARIO_NAME_MAX, SCOPE_TASKS_MAX,
  type AddPeopleChange, type AddedPeopleWho, type ScenarioChange, type ScopeChange, type ScenarioChangeError,
} from "./forecast-scenarios";
import { resourceDisplayName } from "./resource-foundation";
import { SUPPORTED_CURRENCIES, type BudgetCurrency, type Resource } from "./types";

export type DraftRow = { key: number; change: ScenarioChange };
export type RowField =
  | "percent" | "from" | "until" | "on" | "tasks" | "milestone" | "who" | "person" | "hours" | "label" | "count"
  | "rate" | "currency" | "ramp";
export type RowError = { field: RowField; error: ScenarioChangeError };
/** The row's live status, or null while the row is invalid (the schedule is built from valid rows only). */
export type RowLive = { status: ScenarioRowStatus; noEffect: boolean } | null;

/** A person's hours when picked: their Shift's Mon–Fri sum, else 40 (the default week), held inside 1–60. */
const DEFAULT_PERSON_HOURS = 40;

export function fieldId(prefix: string, key: number, field: RowField): string {
  return `${prefix}-r${key}-${field}`;
}

export function newChange(kind: ScenarioChange["kind"], today: string): ScenarioChange {
  if (kind === "availability") return { kind, percent: 100, from: today, until: "" };
  if (kind === "scope") return { kind, tasks: 1, on: today };
  return { kind, who: { resourceId: 0, hoursPerWeek: DEFAULT_PERSON_HOURS }, from: today, until: "", rampWeeks: DEFAULT_RAMP_WEEKS };
}

/** The field a row's first error is shown beside (and focused on Save). */
export function errorField(c: ScenarioChange, error: ScenarioChangeError): RowField {
  switch (error) {
    case "date":
      if (c.kind === "scope") return "on";
      return isValidIsoDate(c.from) ? "until" : "from";
    case "until-before-from": return "until";
    case "percent": return "percent";
    case "hours": return "hours";
    case "count": return "count";
    case "ramp": return "ramp";
    case "rate": return "rate";
    case "currency": return "currency";
    case "label": return "label";
    case "tasks": return "tasks";
    case "milestone-unknown": case "milestone-finished": return "milestone";
    case "resource-unknown": case "resource-archived": case "on-team": return "person";
  }
}

export function rowErrorText(lang: Lang, c: ScenarioChange, error: ScenarioChangeError): string {
  const range = (lo: number, hi: number) => t(lang, "forecastScenarioErrRange", lo, hi);
  switch (error) {
    case "date": return t(lang, "forecastScenarioErrDate");
    case "until-before-from": return t(lang, "forecastScenarioErrUntilBeforeFrom");
    case "percent": return range(AVAILABILITY_MIN, AVAILABILITY_MAX);
    case "hours": return range(ADDED_HOURS_MIN, ADDED_HOURS_MAX);
    case "count": return range(1, ADDED_COUNT_MAX);
    case "ramp": return range(0, RAMP_WEEKS_MAX);
    case "rate": return range(0, PLACEHOLDER_RATE_MAX);
    case "currency": return t(lang, "forecastScenarioErrCurrency");
    case "label": {
      const label = c.kind === "addPeople" && "label" in c.who ? c.who.label.trim() : "";
      return label === "" ? t(lang, "forecastScenarioErrNameEmpty") : t(lang, "forecastScenarioErrTooLong", SCENARIO_NAME_MAX);
    }
    case "tasks":
      // A whole non-zero number past the bound gets the bound; anything else is told what a valid entry is.
      return c.kind === "scope" && Number.isInteger(c.tasks) && c.tasks !== 0
        ? range(-SCOPE_TASKS_MAX, SCOPE_TASKS_MAX)
        : t(lang, "forecastScenarioErrTasks");
    case "milestone-unknown": return t(lang, "forecastScenarioErrMilestoneUnknown");
    case "milestone-finished": return t(lang, "forecastScenarioErrMilestoneFinished");
    case "resource-unknown": return t(lang, "forecastScenarioErrResourceUnknown");
    case "resource-archived": return t(lang, "forecastScenarioErrResourceArchived");
    case "on-team": return t(lang, "forecastScenarioRowOnTeam");
  }
}

function addedPersonText(lang: Lang, s: AddedPersonStatus, teamHours: number | null): string[] {
  if (s.kind === "inert") {
    const key: Record<typeof s.reason, TranslationKey> = {
      "person-gone": "forecastScenarioRowPersonGone",
      "on-team": "forecastScenarioRowOnTeam",
      ended: "forecastScenarioRowEnded",
      "needs-booked-hours": "forecastScenarioNeedsHours",
    };
    return [t(lang, key[s.reason])];
  }
  const out: string[] = [];
  if (s.rateNote === "external") out.push(t(lang, "forecastScenarioRowExternal"));
  if (s.rateNote === "no-rate") out.push(t(lang, "forecastScenarioRowNoRate", s.name));
  if (s.rateNote === "at-par") out.push(t(lang, "forecastScenarioRowAtPar", s.name));
  if (teamHours !== null) {
    out.push(t(lang, "forecastScenarioRowBasis", Math.round(teamHours), Math.round(s.weeklyHours),
      t(lang, "forecastPercent", Math.round(s.shareAtFullSpeed * 100))));
  }
  return out;
}

/** The lines under a row: ended, milestone gone, person gone, on the team, no cost, no rate, at par, or the basis. */
export function rowStatusLines(lang: Lang, live: RowLive, teamHours: number | null): string[] {
  if (live === null) return [];
  const { status } = live;
  if (status.kind === "availability") return status.ended ? [t(lang, "forecastScenarioRowEnded")] : [];
  if (status.kind === "scope") return status.milestoneGone ? [t(lang, "forecastScenarioRowMilestoneGone")] : [];
  // A sized row that applies on no simulated day adds nothing, so its basis would describe nobody.
  if (status.status.kind === "sized" && live.noEffect) return [t(lang, "forecastScenarioRowNoEffect")];
  return addedPersonText(lang, status.status, teamHours);
}

/** Hours a picked person is prefilled with: their Shift's Mon–Fri sum, else 40, held inside 1–60. */
export function prefillHours(r: Resource, ctx: ScheduleContext): number {
  const shift = shiftFor(r, ctx.directory);
  const sum = shift ? [1, 2, 3, 4, 5].reduce((s, i) => s + Math.max(0, shift.hoursPerWeekday[i]), 0) : 0;
  const hours = sum > 0 ? Math.round(sum) : DEFAULT_PERSON_HOURS;
  return Math.min(ADDED_HOURS_MAX, Math.max(ADDED_HOURS_MIN, hours));
}

const num = (raw: string): number => (raw.trim() === "" ? Number.NaN : Number(raw));
const shown = (n: number): string => (Number.isFinite(n) ? String(n) : "");

type FieldProps = {
  lang: Lang; n: number; prefix: string; rowKey: number; field: RowField; labelKey: TranslationKey;
  error: RowError | null; errorText: string | null;
  render: (control: { id: string; "aria-label": string; "aria-describedby"?: string; invalid: boolean }) => ReactNode;
};

/** A visible label plus the row-unique accessible name ("Change 2: From", which contains the label: WCAG 2.5.3). */
function Field({ lang, n, prefix, rowKey, field, labelKey, error, errorText, render }: FieldProps) {
  const id = fieldId(prefix, rowKey, field);
  const label = t(lang, labelKey);
  const bad = error?.field === field;
  return (
    <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
      {label}
      {render({
        id,
        "aria-label": t(lang, "forecastScenarioChangeRow", n, label),
        "aria-describedby": bad ? `${id}-err` : undefined,
        invalid: bad,
      })}
      {bad && <span id={`${id}-err`} className="font-medium text-ui-pink-strong">{errorText}</span>}
    </label>
  );
}

function personOption(lang: Lang, r: Resource, onTeam: ReadonlySet<number>): { label: string; disabled: boolean } {
  const name = resourceDisplayName(r);
  if (onTeam.has(r.id)) return { label: t(lang, "forecastScenarioPersonOnTeam", name), disabled: true };
  if (r.isExternal) return { label: t(lang, "forecastScenarioPersonExternal", name), disabled: false };
  return { label: name, disabled: false };
}

const KIND_KEY: Record<ScenarioChange["kind"], TranslationKey> = {
  availability: "forecastScenarioKindAvailability",
  addPeople: "forecastScenarioKindAddPeople",
  scope: "forecastScenarioKindScope",
};

export type ChangeRowProps = {
  lang: Lang; n: number; prefix: string; row: DraftRow; error: RowError | null; live: RowLive;
  context: ScheduleContext; baseCurrency: BudgetCurrency;
  onChange: (c: ScenarioChange) => void; onRemove: () => void;
};

function DateFields({ p, c }: { p: ChangeRowProps; c: Exclude<ScenarioChange, { kind: "scope" }> }) {
  const common = { lang: p.lang, n: p.n, prefix: p.prefix, rowKey: p.row.key, error: p.error, errorText: p.error && rowErrorText(p.lang, c, p.error.error) };
  return (
    <>
      <Field {...common} field="from" labelKey="forecastScenarioFrom" render={(a) => (
        <Input type="date" size="xs" {...a} value={c.from} onChange={(e) => p.onChange({ ...c, from: e.target.value })} />
      )} />
      <Field {...common} field="until" labelKey="forecastScenarioUntil" render={(a) => (
        <Input type="date" size="xs" {...a} value={c.until} onChange={(e) => p.onChange({ ...c, until: e.target.value })} />
      )} />
    </>
  );
}

function WhoFields({ p, c }: { p: ChangeRowProps; c: AddPeopleChange }) {
  const { lang, context } = p;
  const common = { lang, n: p.n, prefix: p.prefix, rowKey: p.row.key, error: p.error, errorText: p.error && rowErrorText(lang, c, p.error.error) };
  const who = c.who;
  const setWho = (next: AddedPeopleWho) => p.onChange({ ...c, who: next });
  const isDirectory = "resourceId" in who;
  const people = context.directory.resources.filter((r) => r.active !== false);
  const hours = (
    <Field {...common} field="hours" labelKey="forecastScenarioHoursPerWeek" render={(a) => (
      <Input type="number" size="xs" className="w-20" {...a} value={shown(who.hoursPerWeek)}
        onChange={(e) => setWho({ ...who, hoursPerWeek: num(e.target.value) })} />
    )} />
  );
  return (
    <>
      <Field {...common} field="who" labelKey="forecastScenarioWho" render={(a) => (
        <Select size="xs" {...a} value={isDirectory ? "directory" : "placeholder"} onChange={(e) => setWho(e.target.value === "directory"
          ? { resourceId: 0, hoursPerWeek: who.hoursPerWeek }
          : { label: "", count: 1, rate: 0, currency: p.baseCurrency, hoursPerWeek: who.hoursPerWeek })}>
          <option value="directory">{t(lang, "forecastScenarioDirectory")}</option>
          <option value="placeholder">{t(lang, "forecastScenarioPlaceholder")}</option>
        </Select>
      )} />
      {isDirectory ? (
        <Field {...common} field="person" labelKey="forecastScenarioPerson" render={(a) => (
          <Select size="xs" {...a} value={who.resourceId > 0 ? String(who.resourceId) : ""} onChange={(e) => {
            const r = people.find((x) => String(x.id) === e.target.value);
            setWho(r ? { resourceId: r.id, hoursPerWeek: prefillHours(r, context) } : { ...who, resourceId: 0 });
          }}>
            <option value="">{t(lang, "forecastScenarioChoosePerson")}</option>
            {/* A saved person who is gone or archived stays shown, so the select never reads a different value. */}
            {who.resourceId > 0 && !people.some((r) => r.id === who.resourceId) && (
              <option value={String(who.resourceId)} disabled>{t(lang, "forecastScenarioRowPersonGone")}</option>
            )}
            {people.map((r) => {
              const o = personOption(lang, r, context.onTeam);
              return <option key={r.id} value={String(r.id)} disabled={o.disabled}>{o.label}</option>;
            })}
          </Select>
        )} />
      ) : (
        <>
          <Field {...common} field="label" labelKey="forecastScenarioLabel" render={(a) => (
            <Input size="xs" {...a} value={who.label} onChange={(e) => setWho({ ...who, label: e.target.value })} />
          )} />
          <Field {...common} field="count" labelKey="forecastScenarioCount" render={(a) => (
            <Input type="number" size="xs" className="w-16" {...a} value={shown(who.count)} onChange={(e) => setWho({ ...who, count: num(e.target.value) })} />
          )} />
          <Field {...common} field="rate" labelKey="forecastScenarioRate" render={(a) => (
            <Input type="number" size="xs" className="w-24" {...a} value={shown(who.rate)} onChange={(e) => setWho({ ...who, rate: num(e.target.value) })} />
          )} />
          <Field {...common} field="currency" labelKey="forecastScenarioCurrency" render={(a) => (
            <Select size="xs" {...a} value={who.currency} onChange={(e) => setWho({ ...who, currency: e.target.value as BudgetCurrency })}>
              {SUPPORTED_CURRENCIES.map((cur) => <option key={cur} value={cur}>{cur}</option>)}
            </Select>
          )} />
        </>
      )}
      {hours}
    </>
  );
}

function KindFields({ p }: { p: ChangeRowProps }) {
  const { lang, context } = p;
  const c = p.row.change;
  const common = { lang, n: p.n, prefix: p.prefix, rowKey: p.row.key, error: p.error, errorText: p.error && rowErrorText(lang, c, p.error.error) };
  if (c.kind === "availability") {
    return (
      <>
        <Field {...common} field="percent" labelKey="forecastCapacityPercent" render={(a) => (
          <Input type="number" size="xs" className="w-20" {...a} value={shown(c.percent)} onChange={(e) => p.onChange({ ...c, percent: num(e.target.value) })} />
        )} />
        <DateFields p={p} c={c} />
      </>
    );
  }
  if (c.kind === "scope") {
    const milestones = context.milestones.filter(isAttributableMilestone);
    const stale = c.milestoneId !== undefined && !milestones.some((m) => m.id === c.milestoneId);
    return (
      <>
        <Field {...common} field="tasks" labelKey="forecastScenarioTasks" render={(a) => (
          <Input type="number" size="xs" className="w-20" {...a} value={shown(c.tasks)} onChange={(e) => p.onChange({ ...c, tasks: num(e.target.value) })} />
        )} />
        <Field {...common} field="on" labelKey="forecastScenarioOn" render={(a) => (
          <Input type="date" size="xs" {...a} value={c.on} onChange={(e) => p.onChange({ ...c, on: e.target.value })} />
        )} />
        <Field {...common} field="milestone" labelKey="forecastScenarioMilestone" render={(a) => (
          <Select size="xs" {...a} value={c.milestoneId === undefined ? "" : String(c.milestoneId)} onChange={(e) => {
            const rest: ScopeChange = { kind: "scope", tasks: c.tasks, on: c.on };
            p.onChange(e.target.value === "" ? rest : { ...rest, milestoneId: Number(e.target.value) });
          }}>
            <option value="">{t(lang, "forecastScenarioNoMilestone")}</option>
            {stale && <option value={String(c.milestoneId)} disabled>{t(lang, "forecastScenarioMilestoneGoneOption")}</option>}
            {milestones.map((m) => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
          </Select>
        )} />
      </>
    );
  }
  return (
    <>
      <WhoFields p={p} c={c} />
      <DateFields p={p} c={c} />
      <Field {...common} field="ramp" labelKey="forecastScenarioRampWeeks" render={(a) => (
        <Input type="number" size="xs" className="w-16" {...a} value={shown(c.rampWeeks)} onChange={(e) => p.onChange({ ...c, rampWeeks: num(e.target.value) })} />
      )} />
    </>
  );
}

export function ScenarioChangeRow(p: ChangeRowProps) {
  const { lang, n, live, context } = p;
  const lines = rowStatusLines(lang, live, context.teamHours);
  const inert = live !== null && (
    (live.status.kind === "availability" && live.status.ended)
    || (live.status.kind === "addPeople" && (live.status.status.kind === "inert" || live.noEffect))
  );
  return (
    <li data-change-row={p.row.key} className="space-y-1 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className={`text-sm font-medium ${inert ? "text-muted-foreground" : "text-foreground"}`}>
          {t(lang, "forecastScenarioChangeRow", n, t(lang, KIND_KEY[p.row.change.kind]))}
        </span>
        <Button variant="ghost" size="xs" aria-label={t(lang, "forecastScenarioChangeRow", n, t(lang, "forecastScenarioRemove"))} onClick={p.onRemove}>
          <span aria-hidden="true">✕ </span>{t(lang, "forecastScenarioRemove")}
        </Button>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <KindFields p={p} />
      </div>
      {lines.map((line) => <p key={line} className="text-xs text-muted-foreground">{line}</p>)}
    </li>
  );
}
