// src/app/reassign-hours-notice.ts — the user-facing sentence for a reassign that
// moves planned hours (§774). Pure: names and period labels are passed in.
import { type Lang, t, tPlural } from "./i18n";
import { type HoursMovePlan, type NoMoveReason, type TaskHoursMove } from "./reassign-hours";

export interface HoursMoveNoticeCtx {
  lang: Lang;
  resourceName: (id: number) => string;
  periodLabel: (key: string) => string;
  taskName: (id: number) => string;
}

const MONTH_KEY = /^(\d{4})-(\d{2})$/;
const WEEK_KEY = /^\d{4}-(W\d+)$/;

/** Ruling R1: "2026-09" → short month name, "2026-W38" → "W38". Anything else is returned as is. */
export function defaultPeriodLabel(key: string, lang: Lang): string {
  const month = MONTH_KEY.exec(key);
  if (month) {
    const date = new Date(Date.UTC(Number(month[1]), Number(month[2]) - 1, 1));
    return new Intl.DateTimeFormat(lang, { month: "short", timeZone: "UTC" }).format(date);
  }
  const week = WEEK_KEY.exec(key);
  if (!week) return key;
  return lang === "de" ? `KW ${week[1].slice(1)}` : week[1];
}

/** Whole hours, or one decimal under 1 (Rounding rule). */
export function formatHours(hours: number, lang: Lang): string {
  const fractionDigits = hours < 1 ? 1 : 0;
  return new Intl.NumberFormat(lang, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(hours);
}

const REASON_KEY = {
  noEstimate: "hoursMovedNoEstimate",
  closed: "hoursMovedClosed",
  unlinked: "hoursMovedUnlinked",
  outsideWindow: "hoursMovedOutsideWindow",
} as const satisfies Record<NoMoveReason, string>;

interface PairGroup {
  from: number;
  to: number;
  moves: TaskHoursMove[];
}

function groupByPair(moved: readonly TaskHoursMove[]): PairGroup[] {
  const groups = new Map<string, PairGroup>();
  for (const move of moved) {
    if (move.fromResourceId === undefined || move.toResourceId === undefined) continue;
    const key = `${move.fromResourceId}>${move.toResourceId}`;
    const group = groups.get(key);
    if (group) group.moves.push(move);
    else groups.set(key, { from: move.fromResourceId, to: move.toResourceId, moves: [move] });
  }
  return [...groups.values()];
}

function pairSentence(group: PairGroup, ctx: HoursMoveNoticeCtx): string {
  const { lang } = ctx;
  const byPeriod = new Map<string, number>();
  let total = 0;
  let shortfall = 0;
  let capped = 0;
  let outside = 0;
  for (const move of group.moves) {
    total += move.movedHours;
    shortfall += move.shortfallHours;
    capped += move.receiverCapHours;
    outside += move.outsideWindowHours;
    for (const p of move.perPeriod) byPeriod.set(p.periodKey, (byPeriod.get(p.periodKey) ?? 0) + p.hours);
  }
  const periods = [...byPeriod.keys()]
    .sort()
    .map((key) => `${ctx.periodLabel(key)} ${formatHours(byPeriod.get(key) ?? 0, lang)} ${t(lang, "hoursMovedUnit")}`)
    .join(", ");
  const from = ctx.resourceName(group.from);
  const to = ctx.resourceName(group.to);
  const hours = formatHours(total, lang);
  const base =
    group.moves.length === 1
      ? t(lang, "hoursMoved", hours, from, to, periods)
      : tPlural(lang, "hoursMovedBatch", group.moves.length, hours, group.moves.length, from, to, periods);
  const notes: string[] = [];
  if (shortfall > 0) notes.push(t(lang, "hoursMovedShortfall", formatHours(shortfall, lang), from));
  if (capped > 0) notes.push(t(lang, "hoursMovedReceiverCap", formatHours(capped, lang), to));
  if (outside > 0) notes.push(t(lang, "hoursMovedOutsideWindowNote", formatHours(outside, lang)));
  return notes.length > 0 ? `${base} ${notes.join(" ")}` : base;
}

/** Why one task moved no hours: its reason, or (no reason set) a giver with nothing planned or a receiver with no room. */
function nothingMovedSentences(move: TaskHoursMove, ctx: HoursMoveNoticeCtx): string[] {
  const task = ctx.taskName(move.taskId);
  if (move.reason) return [t(ctx.lang, REASON_KEY[move.reason], task)];
  const out: string[] = [];
  if (move.shortfallHours > 0 && move.fromResourceId !== undefined) {
    out.push(t(ctx.lang, "hoursMovedNoneShortfall", task, ctx.resourceName(move.fromResourceId)));
  }
  if (move.receiverCapHours > 0 && move.toResourceId !== undefined) {
    out.push(t(ctx.lang, "hoursMovedNoneReceiverCap", task, ctx.resourceName(move.toResourceId)));
  }
  return out;
}

type SkipKind = NoMoveReason | "shortfall" | "receiverCap";

const SKIP_LABEL_KEY = {
  noEstimate: "hoursSkipNoEstimate",
  closed: "hoursSkipClosed",
  unlinked: "hoursSkipUnlinked",
  outsideWindow: "hoursSkipOutsideWindow",
  shortfall: "hoursSkipShortfall",
  receiverCap: "hoursSkipReceiverCap",
} as const satisfies Record<SkipKind, string>;
const SKIP_ORDER: readonly SkipKind[] = ["noEstimate", "closed", "unlinked", "outsideWindow", "shortfall", "receiverCap"];

/** Why a skipped task moved nothing, as one kind: its reason, else a giver with nothing planned, else a full receiver. */
function skipKind(move: TaskHoursMove): SkipKind {
  return move.reason ?? (move.shortfallHours > 0 ? "shortfall" : "receiverCap");
}

/** "No planned hours moved for 8 tasks: no remaining estimate (5), closed (3)." */
function skippedSummary(skipped: readonly TaskHoursMove[], lang: Lang): string {
  const counts = new Map<SkipKind, number>();
  for (const move of skipped) counts.set(skipKind(move), (counts.get(skipKind(move)) ?? 0) + 1);
  const parts = SKIP_ORDER.filter((k) => counts.has(k)).map((k) => `${t(lang, SKIP_LABEL_KEY[k])} (${counts.get(k)})`);
  return t(lang, "hoursMovedSkippedSummary", skipped.length, parts.join(", "));
}

/** The notice for a plan, or null when nothing moved and nothing needs saying. */
export function hoursMoveNotice(plan: HoursMovePlan, ctx: HoursMoveNoticeCtx): string | null {
  const moved = plan.moves.filter((m) => m.movedHours > 0);
  const skipped = plan.moves.filter(
    (m) => m.movedHours <= 0 && (m.reason !== undefined || m.shortfallHours > 0 || m.receiverCapHours > 0),
  );
  if (moved.length === 0 && skipped.length === 0) return null;
  const sentences: string[] = groupByPair(moved).map((g) => `${pairSentence(g, ctx)}.`);
  // One skipped task keeps its own sentence; several are summarised by reason, so a bulk edit over many
  // unestimated or closed tasks still gives one short notice (final review).
  if (skipped.length === 1) sentences.push(...nothingMovedSentences(skipped[0], ctx));
  else if (skipped.length > 1) sentences.push(skippedSummary(skipped, ctx.lang));
  for (const over of plan.overCapacity) {
    sentences.push(
      t(ctx.lang, "hoursMovedOverCapacity", ctx.resourceName(over.resourceId), over.percent, ctx.periodLabel(over.periodKey)),
    );
  }
  return sentences.length > 0 ? sentences.join(" ") : null;
}
