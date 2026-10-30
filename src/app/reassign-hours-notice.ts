// src/app/reassign-hours-notice.ts — the user-facing sentence for a reassign that
// moves planned hours (§774). Pure: names and period labels are passed in.
import { type Lang, t, tPlural } from "./i18n";
import { type HoursMovePlan, type NoMoveReason, type TaskHoursMove } from "./reassign-hours";
import { HOURS_MAP_MAX } from "./sanitize-entities";

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

/** Whole hours when the value is whole, else one decimal: the planner moves tenths, so a period list
 *  written this way adds up to its total ("10 h (Sep: 3.3 h, Oct: 3.3 h, Nov: 3.4 h)"). */
export function formatMovedHours(hours: number, lang: Lang): string {
  const tenths = Math.round(hours * 10);
  const fractionDigits = tenths % 10 === 0 ? 0 : 1;
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

/** "Sep, Oct": period labels in plan order. */
function periodList(keys: Iterable<string>, ctx: HoursMoveNoticeCtx): string {
  return [...new Set(keys)].sort().map((key) => ctx.periodLabel(key)).join(", ");
}

/** "Liam Foster is at 100 % in Sep" / "… at the 1,000 h limit in Sep" — the receiver-cap sentence's key and args. */
function capSentence(limit: TaskHoursMove["receiverCapLimit"], lead: string[], receiver: string, periods: string, lang: Lang, none: boolean): string {
  if (limit === "hours") {
    const key = none ? "hoursMovedNoneReceiverLimit" : "hoursMovedReceiverLimit";
    return t(lang, key, ...lead, receiver, formatMovedHours(HOURS_MAP_MAX, lang), periods);
  }
  return t(lang, none ? "hoursMovedNoneReceiverCap" : "hoursMovedReceiverCap", ...lead, receiver, periods);
}

function pairSentence(group: PairGroup, ctx: HoursMoveNoticeCtx): string {
  const { lang } = ctx;
  const byPeriod = new Map<string, number>();
  let total = 0;
  let shortfall = 0;
  let capped = 0;
  let outside = 0;
  const shortKeys: string[] = [];
  const capKeys: string[] = [];
  let limit: TaskHoursMove["receiverCapLimit"];
  for (const move of group.moves) {
    total += move.movedHours;
    shortfall += move.shortfallHours;
    capped += move.receiverCapHours;
    outside += move.outsideWindowHours;
    shortKeys.push(...move.shortfallPeriods);
    capKeys.push(...move.receiverCapPeriods);
    limit = limit ?? move.receiverCapLimit;
    for (const p of move.perPeriod) byPeriod.set(p.periodKey, (byPeriod.get(p.periodKey) ?? 0) + p.hours);
  }
  // "Sep: 8 h" — a colon between label and amount, so a week ("KW 38: 16 Std.") never reads as two numbers.
  const periods = [...byPeriod.keys()]
    .sort()
    .map((key) => `${ctx.periodLabel(key)}: ${formatMovedHours(byPeriod.get(key) ?? 0, lang)} ${t(lang, "hoursMovedUnit")}`)
    .join(", ");
  const from = ctx.resourceName(group.from);
  const to = ctx.resourceName(group.to);
  const hours = formatMovedHours(total, lang);
  const base =
    group.moves.length === 1
      ? t(lang, "hoursMoved", hours, from, to, periods)
      : tPlural(lang, "hoursMovedBatch", group.moves.length, hours, group.moves.length, from, to, periods);
  // Each note is a sentence of its own that names its periods, never a run of parentheses.
  const sentences = [`${base}.`];
  if (shortfall > 0) sentences.push(t(lang, "hoursMovedShortfall", formatMovedHours(shortfall, lang), from, periodList(shortKeys, ctx)));
  if (capped > 0) sentences.push(capSentence(limit, [formatMovedHours(capped, lang), from], to, periodList(capKeys, ctx), lang, false));
  if (outside > 0) sentences.push(t(lang, "hoursMovedOutsideWindowNote", formatMovedHours(outside, lang)));
  return sentences.join(" ");
}

/** Why one task moved no hours: its reason, or (no reason set) a giver with nothing planned or a receiver with no room. */
function nothingMovedSentences(move: TaskHoursMove, ctx: HoursMoveNoticeCtx): string[] {
  const task = ctx.taskName(move.taskId);
  if (move.reason) return [t(ctx.lang, REASON_KEY[move.reason], task)];
  const out: string[] = [];
  if (move.shortfallHours > 0 && move.fromResourceId !== undefined) {
    out.push(t(ctx.lang, "hoursMovedNoneShortfall", task, ctx.resourceName(move.fromResourceId), periodList(move.shortfallPeriods, ctx)));
  }
  if (move.receiverCapHours > 0 && move.toResourceId !== undefined) {
    out.push(capSentence(move.receiverCapLimit, [task], ctx.resourceName(move.toResourceId), periodList(move.receiverCapPeriods, ctx), ctx.lang, true));
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
  const sentences: string[] = groupByPair(moved).map((g) => pairSentence(g, ctx));
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
