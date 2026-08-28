"use client";
/** Two presentational leaves of the Budget panel: the per-bucket "Manual %
 *  complete" input, and the CCI tile the project and bucket summaries repeat.
 *
 *  Split out of `budget-panel.tsx` to keep that orchestrator under the 800-line
 *  size ratchet (the gantt orchestrator + presentational-leaf convention). Both
 *  bodies moved with every comment attached; the ONLY change to either is the
 *  `export` keyword each `function` now carries. */
import { type Lang, t } from "./i18n";
import { formatCurrency } from "./resource-cost";
import type { CciValue } from "./budget-report";
import { bucketPercentComplete } from "./budget-earned-value";
import { describeClamp } from "./sanitize-report";
import type { BudgetBucket, Task } from "./types";
import { useCommitDraft } from "./use-commit-draft";
import { RagBadge } from "./rag-badge";
import type { Health } from "./health";
import { InfoTooltip } from "./info-tooltip";
import { rowLabel } from "./row-tokens";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";

/** The bucket's Manual % complete, editable without opening the bucket modal.
 *  The placeholder shows the task-derived percentage so the override
 *  relationship is visible in place. */
export function ManualPercentCell({
  lang, bucket, rowToken, tasks, onCommit,
}: {
  lang: Lang;
  bucket: BudgetBucket;
  /** The bucket's WCAG 2.4.6 disambiguation token, from a `buildRowTokens`
   *  (`row-tokens.ts`) map built over the RENDERED bucket list.
   *
   *  ★ REQUIRED, and it is a prop rather than something computed here because a
   *  per-item component has no sibling visibility — it cannot know whether some
   *  OTHER bucket carries the same name. Only the caller that maps the list can.
   *  Passing `bucket.name` defeats it: names are free text with no uniqueness
   *  constraint (`budget-bucket-modal.tsx` enforces only BUDGET_NAME_MAX). */
  rowToken: string;
  /** OPTIONAL on the panel — a caller that omits it gets no derived hint, never
   *  a misleading 0 %. */
  tasks: readonly Task[] | undefined;
  onCommit: (pct: number | undefined) => void;
}) {
  const derived = bucket.percentComplete === undefined && tasks
    ? bucketPercentComplete({ taskIds: bucket.taskIds, percentComplete: undefined }, tasks)
    : null;
  // Clearing the box must write `undefined`, NOT 0: `bucketPercentComplete`
  // treats a manual 0 as a real override that wins over the task derivation,
  // so a 0 would pin the bucket at 0 % forever.
  const draft = useCommitDraft(
    bucket.percentComplete === undefined ? "" : String(bucket.percentComplete),
    (raw) => onCommit(describeClamp(raw, { min: 0, max: 100, round: 2 }).value),
  );
  return (
    <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
      {t(lang, "budgetPercentComplete")}
      <InfoTooltip text={t(lang, "budgetPercentCompleteHint")} />
      <input
        // ★★ Bucket-UNIQUE via `rowToken`, NOT merely bucket-qualified. N
        // identical "Manual % complete" labels is a WCAG 2.4.6 failure the axe
        // gate cannot see (of axe-core 4.12.1's rules, not one carrying a tag
        // e2e/a11y.spec.ts requests flags two controls sharing a name), so the
        // only detector is the unit test in `budget-panel.test.tsx` — "keeps
        // every bucket control bucket-unique when two buckets share a name".
        // ★ `budget-bucket-modal.tsx` renders a SECOND percent input carrying
        // the BARE `budgetPercentComplete` label. That is not this collision and
        // must not be "fixed" to match: the modal is the only such control in
        // its own dialog, and `modal.tsx` sets `aria-modal="true"`, which hides
        // these background copies from AT. 2.4.6 is about one context.
        aria-label={rowLabel(t(lang, "budgetPercentComplete"), rowToken)}
        type="number"
        min={0}
        max={100}
        step="1"
        placeholder={derived === null ? "—" : String(Math.round(derived))}
        value={draft.value}
        onChange={(e) => draft.onChange(e.target.value)}
        onFocus={draft.onFocus}
        onBlur={draft.onBlur}
        onKeyDown={draft.onKeyDown}
        className={`w-16 rounded border border-line bg-surface px-1 py-0.5 text-right tabular-nums ${FOCUS_RING} ${TRANSITION}`}
      />
      <span aria-hidden="true">%</span>
    </span>
  );
}

export function Cci({ label, hint, value, currency, locale, lang, rag, primary = "amount", unknown = false }: { label: string; hint?: string; value: CciValue; currency: string; locale: string; lang: Lang; rag?: Health | null; primary?: "amount" | "percent"; unknown?: boolean }) {
  const pct = value.percent == null ? "—" : `${value.percent.toFixed(1)}%`;
  // `unknown` means the figure could not be computed (no internal rate), NOT
  // that it computed to zero. Both figures go to "—" and the tone stays neutral:
  // the green/red tone reads as a judgement, and there is nothing to judge.
  const tone = unknown
    ? "text-muted-foreground"
    : value.amount >= 0 ? "text-[var(--rag-green-text)]" : "text-[var(--rag-red-text)]";
  const bigFigure = unknown ? "—" : primary === "percent" ? pct : formatCurrency(value.amount, currency, locale);
  const smallFigure = unknown ? "—" : primary === "percent" ? formatCurrency(value.amount, currency, locale) : pct;
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          {label}
          {hint ? <InfoTooltip text={hint} /> : null}
        </span>
        {rag !== undefined && !unknown ? <RagBadge value={rag} lang={lang} title={label} /> : null}
      </div>
      <div className={`text-lg font-semibold ${tone}`}>{bigFigure}</div>
      <div className="text-xs text-muted-foreground">{smallFigure}</div>
    </div>
  );
}
