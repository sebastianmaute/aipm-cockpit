"use client";

// Presentational pieces of the Plan with AI review window that belong to task moves (§769): the move rows, and the
// effect summary (cost line, over-capacity warnings). Pure props in, no context, no writes.
import { type Lang, t, tPlural, localeFor } from "./i18n";
import { Checkbox } from "./form-controls";
import { ExclamationTriangleIcon } from "./icons";
import { buildRowTokens, rowLabel } from "./row-tokens";
import { formatCurrency } from "./resource-cost";
import { defaultPeriodLabel, formatMovedHours, hoursMoveNotice, movedHoursNotes, type HoursMoveNoticeCtx } from "./reassign-hours-notice";
import { type GroundedMove } from "./alloc-plan/alloc-ground-moves";
import { type AltEffect } from "./alloc-plan/alloc-effect";
import { type HoursMovePlan } from "./reassign-hours";
import { formatAbsenceClash } from "./absence-clash-notice";

function noticeCtx(move: GroundedMove, lang: Lang): HoursMoveNoticeCtx {
  return {
    lang,
    resourceName: (id) => (id === move.fromResourceId ? move.fromLabel : id === move.toResourceId ? move.toLabel : `#${id}`),
    periodLabel: (key) => defaultPeriodLabel(key, lang),
    taskName: () => move.taskName,
  };
}

/** The plan a move's row reads: while ticked, its own share of the ticked moves planned TOGETHER (`combined`), which
 *  is what apply moves — a move that passes on hours an earlier ticked move gave carries them; unticked, its plan
 *  alone. Falls back to that too when the combined plan has no entry for it (its task is gone from the live tasks). */
function planFor(move: GroundedMove, ticked: boolean, combined: HoursMovePlan): HoursMovePlan {
  const own = ticked ? combined.moves.filter((m) => m.taskId === move.taskId) : [];
  return own.length > 0 ? { ...combined, moves: own, overCapacity: [] } : move.plan;
}

/** The hours a move carries, as §774 words them: "16 h: Sep 8 h, Oct 8 h", then its notes; for a move that moves
 *  nothing, §774's own reason. An UNLINKED owner gets the fixed line instead of a reason (see `GroundedMove.linked`). */
function MoveHours({ lang, move, plan }: { lang: Lang; move: GroundedMove; plan: HoursMovePlan }) {
  if (!move.linked) return <p className="mt-1 text-xs text-muted-foreground">{t(lang, "allocPlanMoveUnlinked")}</p>;
  const ctx = noticeCtx(move, lang);
  const own = plan.moves.find((m) => m.taskId === move.taskId);
  if (own && own.movedHours > 0) {
    const periods = own.perPeriod
      .map((p) => t(lang, "allocPlanMovePeriod", ctx.periodLabel(p.periodKey), formatMovedHours(p.hours, lang)))
      .join(", ");
    const notes = movedHoursNotes(own, ctx);
    return (
      <>
        <p className="mt-1 text-sm text-foreground">{t(lang, "allocPlanMoveHours", formatMovedHours(own.movedHours, lang), periods)}</p>
        {notes.map((note) => (
          <p key={note} className="mt-1 text-xs text-muted-foreground">
            {note}
          </p>
        ))}
      </>
    );
  }
  const reason = hoursMoveNotice(plan, ctx);
  return reason ? <p className="mt-1 text-xs text-muted-foreground">{reason}</p> : null;
}

/** §773 — the task's dates that fall on the receiver's absence (`GroundedMove.clashes`). A warning only: the row
 *  stays tickable. Icon plus text, never colour alone. */
function MoveClashes({ lang, move }: { lang: Lang; move: GroundedMove }) {
  return move.clashes.map((c, i) => (
    <p key={i} className="mt-1 flex items-start gap-1.5 text-xs text-foreground">
      <ExclamationTriangleIcon aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{formatAbsenceClash(c, lang)}</span>
    </p>
  ));
}

export interface AllocPlanMoveRowsProps {
  lang: Lang;
  moves: readonly GroundedMove[];
  selected: ReadonlySet<string>;
  /** Moves whose inputs changed since they were proposed: marked, unticked and not tickable. */
  staleMoves: ReadonlySet<string>;
  /** The ticked linked moves planned together (`AltEffect.movePlan`). */
  movePlan: HoursMovePlan;
  onToggle: (key: string) => void;
  busy: boolean;
}

export function AllocPlanMoveRows({ lang, moves, selected, staleMoves, movePlan, onToggle, busy }: AllocPlanMoveRowsProps) {
  // A task with no owner at all has an empty label: it reads as unassigned, never as a blank before the arrow.
  const fromText = (m: GroundedMove) => (m.fromLabel.trim() === "" ? t(lang, "workloadTriageUnassigned") : m.fromLabel);
  const rowText = (m: GroundedMove) => t(lang, "allocPlanMoveRow", m.taskId, m.taskName, fromText(m), m.toLabel);
  const tokens = buildRowTokens(moves.map((m) => ({ id: m.key, name: rowText(m) })));
  return (
    <ul className="mt-2 space-y-2">
      {moves.map((m) => (
        <li key={m.key} className="rounded-md border border-line bg-surface-muted px-3 py-2">
          <label className="flex cursor-pointer items-start gap-2">
            <Checkbox
              checked={selected.has(m.key) && !staleMoves.has(m.key)}
              disabled={busy || staleMoves.has(m.key)}
              onChange={() => onToggle(m.key)}
              aria-label={rowLabel(t(lang, "allocPlanInclude"), tokens.get(m.key) ?? rowText(m))}
              className="mt-0.5 shrink-0"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-foreground">{rowText(m)}</span>
              {staleMoves.has(m.key) ? (
                <p className="mt-1 text-xs text-muted-foreground">{t(lang, "allocPlanMoveChanged")}</p>
              ) : (
                <>
                  <MoveHours lang={lang} move={m} plan={planFor(m, selected.has(m.key), movePlan)} />
                  <MoveClashes lang={lang} move={m} />
                </>
              )}
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

export interface AllocPlanEffectProps {
  lang: Lang;
  effect: AltEffect;
  currency: string;
  /** Display name for a resource id; falls back to "#id" at the call site. */
  nameOf: (resourceId: number) => string;
}

/** The cost segment: signed (+ for an increase), and "no cost change" when it rounds to nothing in whole currency units. */
function costSegment(lang: Lang, costDelta: number, currency: string): string {
  if (Math.round(costDelta) === 0) return t(lang, "allocPlanCostNone");
  const amount = formatCurrency(costDelta, currency, localeFor(lang));
  return t(lang, "allocPlanCostInternal", costDelta > 0 ? `+${amount}` : amount);
}

/** What ticking part of the alternative would do. Warnings are text with an icon, never colour alone. */
export function AllocPlanEffect({ lang, effect, currency, nameOf }: AllocPlanEffectProps) {
  const segments: string[] = [];
  if (effect.movedTasks > 0) {
    segments.push(tPlural(lang, "allocPlanEffectMoves", effect.movedTasks, effect.movedTasks, formatMovedHours(effect.movedHours, lang)));
  }
  if (effect.editedCells > 0) segments.push(tPlural(lang, "allocPlanEffectCells", effect.editedCells, effect.editedCells));
  segments.push(costSegment(lang, effect.costDelta, currency));
  return (
    <div className="mt-4 rounded-md border border-line px-3 py-2">
      <p className="text-sm text-foreground">
        {segments.join(" · ")}
      </p>
      {effect.coveredCells > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          {tPlural(lang, "allocPlanEffectCovered", effect.coveredCells, effect.coveredCells)}
        </p>
      )}
      {effect.externalHours > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t(lang, "allocPlanCostExternals", formatMovedHours(effect.externalHours, lang))}
        </p>
      )}
      {effect.noRateCount > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          {tPlural(lang, "allocPlanNoRate", effect.noRateCount, effect.noRateCount)}
        </p>
      )}
      {effect.overCapacity.length > 0 && (
        <ul className="mt-2 space-y-1">
          {effect.overCapacity.map((o) => (
            <li key={`${o.resourceId}:${o.periodKey}`} className="flex items-start gap-1.5 text-xs text-foreground">
              <ExclamationTriangleIcon aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {t(
                  lang,
                  "allocPlanOverCapacity",
                  nameOf(o.resourceId),
                  formatMovedHours(o.hours, lang),
                  formatMovedHours(o.capacityHours, lang),
                  defaultPeriodLabel(o.periodKey, lang),
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
