"use client";

// The scenario editor (§502, spec §4.2): a name, a list of dated change rows and Save / Cancel, on the shared
// `Modal` (Escape and Tab per docs/AGENTS/ui-shell.md "dismissal"). The draft is local state seeded at mount —
// the view mounts the editor with `key={scenario?.id ?? "new-" + openId}`, so nothing is set in an effect.
// Save validates first (`validateScenarioDraft`, then every row with `validateScenarioChange`, except a stale
// milestone or person reference the row already had when stored): the hook's create/update refuse an invalid
// draft WITHOUT a toast, so the editor is where the user is told why — and a refusal that still happens (a
// concurrent writer between open and Save) comes back from `onSave` and keeps the editor open with its reason.

import { useId, useMemo, useState } from "react";
import { type Lang, t } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { Button } from "./button";
import { ScenarioDialogActions, ScenarioNameField, draftErrorText, useFocusAfterCommit } from "./forecast-scenario-name-dialog";
import type { ScheduleContext } from "./forecast-added-people";
import { changeDayWindow } from "./forecast-added-people";
import { buildScenarioSchedule } from "./forecast-scenario-schedule";
import {
  MAX_SCENARIO_CHANGES, validateScenarioChange, validateScenarioDraft,
  type ForecastScenario, type ScenarioChange, type ScenarioChangeError, type ScenarioError, type ValidationContext,
} from "./forecast-scenarios";
import type { ScenarioDraft } from "./use-forecast-scenarios";
import {
  ScenarioChangeRow, errorField, fieldId, newChange, type DraftRow, type RowError, type RowLive,
} from "./forecast-scenario-change-rows";

export type ForecastScenarioEditorProps = {
  lang: Lang;
  open: boolean;
  /** null = a new scenario. */
  scenario: ForecastScenario | null;
  openId: number;
  /** `comparison.context`: the window the columns used, so a row's status matches its column. */
  context: ScheduleContext;
  list: readonly ForecastScenario[];
  /** null = saved (the caller closes the editor); a string = the write was refused, shown above Save. */
  onSave: (d: ScenarioDraft) => string | null;
  onCancel: () => void;
};

type Errors = { draft: ScenarioError | null; rows: ReadonlyMap<number, RowError> };
const NO_ERRORS: Errors = { draft: null, rows: new Map() };

/** Reference errors describe a row the engine still reads (as unattributed, inert, …): exactly what its status
 *  says. Any other error (an unfinished date or number) keeps the row out of the schedule. */
const REFERENCE_ERRORS: ReadonlySet<ScenarioChangeError> = new Set([
  "milestone-unknown", "milestone-finished", "resource-unknown", "resource-archived", "on-team",
]);

/** True when `c` keeps the milestone or directory person its stored row had. Such a reference may have gone
 *  stale since it was saved (achieved, deleted, archived, joined the team); spec §4.1/§4.1a keep an old scenario
 *  usable, so Save accepts it and the row stays marked. Only a newly chosen or changed reference is validated. */
export function keepsStoredReference(stored: ScenarioChange | undefined, c: ScenarioChange): boolean {
  if (stored === undefined) return false;
  if (c.kind === "scope" && stored.kind === "scope") return c.milestoneId !== undefined && c.milestoneId === stored.milestoneId;
  if (c.kind === "addPeople" && stored.kind === "addPeople") {
    return "resourceId" in c.who && "resourceId" in stored.who && c.who.resourceId === stored.who.resourceId;
  }
  return false;
}

function isSchedulable(c: ScenarioChange, vctx: ValidationContext): boolean {
  // A row with no person picked yet is unfinished, not "person gone".
  if (c.kind === "addPeople" && "resourceId" in c.who && !(c.who.resourceId > 0)) return false;
  const error = validateScenarioChange(c, vctx);
  return error === null || REFERENCE_ERRORS.has(error);
}

/** Each row's live status: the schedule is built from the schedulable rows only, and mapped back to the row
 *  it came from. */
function liveStatuses(rows: readonly DraftRow[], context: ScheduleContext, vctx: ValidationContext) {
  const valid = rows.filter((r) => isSchedulable(r.change, vctx));
  const schedule = buildScenarioSchedule(valid.map((r) => r.change), context);
  const live = new Map<number, RowLive>();
  valid.forEach((r, i) => {
    const c = r.change;
    const window = c.kind === "scope" ? null : changeDayWindow(context.dates, c.from, c.until);
    const resourceId = c.kind === "addPeople" && "resourceId" in c.who ? c.who.resourceId : null;
    const archived = resourceId !== null && vctx.resources.some((x) => x.id === resourceId && x.active === false);
    live.set(r.key, { status: schedule.rows[i], noEffect: window !== null && window.first > window.last, archived });
  });
  return { live, doublesTeam: schedule.addedShareAtFullSpeed > 1 };
}

export function ForecastScenarioEditor(p: ForecastScenarioEditorProps) {
  const { lang, scenario, context } = p;
  const prefix = useId();
  const titleId = `${prefix}-title`;
  const nameId = `${prefix}-name`;
  const capId = `${prefix}-cap`;
  const [name, setName] = useState(scenario?.name ?? "");
  const [rows, setRows] = useState<{ list: readonly DraftRow[]; next: number }>(() => {
    const list = (scenario?.changes ?? []).map((change, key) => ({ key, change }));
    return { list, next: list.length };
  });
  const [errors, setErrors] = useState<Errors>(NO_ERRORS);
  const [refused, setRefused] = useState<string | null>(null);
  const { requests: refusals, requestFocus } = useFocusAfterCommit();
  const vctx = useMemo<ValidationContext>(
    () => ({ milestones: context.milestones, resources: context.directory.resources, onTeam: context.onTeam }),
    [context],
  );
  const { live, doublesTeam } = useMemo(() => liveStatuses(rows.list, context, vctx), [rows.list, context, vctx]);
  if (!p.open) return null;

  const atCap = rows.list.length >= MAX_SCENARIO_CHANGES;
  const exceptId = scenario?.id ?? null;
  const add = (kind: ScenarioChange["kind"]) =>
    setRows((prev) => ({ list: [...prev.list, { key: prev.next, change: newChange(kind, context.today) }], next: prev.next + 1 }));
  const update = (key: number, change: ScenarioChange) => {
    setRows((prev) => ({ ...prev, list: prev.list.map((r) => (r.key === key ? { key, change } : r)) }));
    setErrors((prev) => {
      if (!prev.rows.has(key)) return prev;
      const next = new Map(prev.rows);
      next.delete(key);
      return { ...prev, rows: next };
    });
  };
  const remove = (key: number) => setRows((prev) => ({ ...prev, list: prev.list.filter((r) => r.key !== key) }));

  const save = () => {
    const changes = rows.list.map((r) => r.change);
    const draft = validateScenarioDraft({ name, changes }, p.list, exceptId);
    const rowErrors = new Map<number, RowError>();
    for (const r of rows.list) {
      const error = validateScenarioChange(r.change, vctx);
      // Seeded rows keep their index as key and new keys start past them, so `changes[key]` is the stored row.
      const kept = error !== null && REFERENCE_ERRORS.has(error) && keepsStoredReference(scenario?.changes[r.key], r.change);
      if (error && !kept) rowErrors.set(r.key, { field: errorField(r.change, error), error });
    }
    setRefused(null);
    if (draft === null && rowErrors.size === 0) {
      setErrors(NO_ERRORS);
      setRefused(p.onSave({ name: name.trim(), changes }));
      return;
    }
    setErrors({ draft, rows: rowErrors });
    // The first invalid control takes focus: the name, then the rows in order. Focus moves after the commit
    // (`useFocusAfterCommit`), so the field is announced with its `aria-invalid` and its message.
    const nameBad = draft === "name-empty" || draft === "name-long" || draft === "name-taken";
    const firstRow = rows.list.find((r) => rowErrors.has(r.key));
    const firstRowField = firstRow ? rowErrors.get(firstRow.key)?.field : undefined;
    const target = nameBad ? nameId
      : firstRow && firstRowField ? fieldId(prefix, firstRow.key, firstRowField)
        : null;
    if (target) requestFocus(target);
  };

  const nameBad = errors.draft === "name-empty" || errors.draft === "name-long" || errors.draft === "name-taken";
  const otherDraftError = errors.draft !== null && !nameBad ? draftErrorText(lang, errors.draft) : refused;
  const addButton = (kind: ScenarioChange["kind"], key: "forecastScenarioAddAvailability" | "forecastScenarioAddPeople" | "forecastScenarioAddScope") => (
    <Button variant="secondary" size="xs" disabled={atCap} aria-describedby={atCap ? capId : undefined} onClick={() => add(kind)}>
      {t(lang, key)}
    </Button>
  );

  return (
    <Modal open onClose={p.onCancel} ariaLabelledby={titleId} align="start" backdropScroll>
      <div data-modal-panel className="relative my-8 flex w-[760px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface">
        <ModalHeader
          lang={lang}
          title={t(lang, scenario ? "forecastScenarioEditorTitleEdit" : "forecastScenarioEditorTitleNew")}
          titleId={titleId}
          onClose={p.onCancel}
        />
        <div className="flex flex-col gap-3 p-6">
          <ScenarioNameField
            lang={lang} id={nameId} value={name} message={nameBad && errors.draft ? draftErrorText(lang, errors.draft) : null} alertKey={refusals}
            onChange={(v) => {
              setName(v);
              if (nameBad) setErrors((prev) => ({ ...prev, draft: null }));
            }}
          />
          {doublesTeam && <p className="text-xs font-medium text-foreground">{t(lang, "forecastScenarioDoublesTeam")}</p>}
          {rows.list.length > 0 && (
            <ol className="divide-y divide-line rounded-md border border-line">
              {rows.list.map((row, i) => (
                <ScenarioChangeRow
                  key={row.key} lang={lang} n={i + 1} prefix={prefix} row={row} error={errors.rows.get(row.key) ?? null}
                  live={live.get(row.key) ?? null} context={context} baseCurrency={context.directory.baseCurrency}
                  onChange={(c) => update(row.key, c)} onRemove={() => remove(row.key)}
                />
              ))}
            </ol>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {addButton("availability", "forecastScenarioAddAvailability")}
            {addButton("addPeople", "forecastScenarioAddPeople")}
            {addButton("scope", "forecastScenarioAddScope")}
            {/* Visible, not a title: a disabled button takes no focus and a title shows only on hover. */}
            {atCap && <span id={capId} className="text-xs text-muted-foreground">{t(lang, "forecastScenarioErrTooMany", MAX_SCENARIO_CHANGES)}</span>}
          </div>
          {otherDraftError && <p role="alert" className="text-xs font-medium text-ui-pink-strong">{otherDraftError}</p>}
          <ScenarioDialogActions lang={lang} onCancel={p.onCancel} onSave={save} />
        </div>
      </div>
    </Modal>
  );
}
