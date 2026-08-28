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
import { FOCUS_RING, TRANSITION } from "./interaction-styles";

/** The bucket's Manual % complete, editable without opening the bucket modal.
 *  The placeholder shows the task-derived percentage so the override
 *  relationship is visible in place. */
export function ManualPercentCell({
  lang, bucket, tasks, onCommit,
}: {
  lang: Lang;
  bucket: BudgetBucket;
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
        // ★★ Bucket-QUALIFIED, which is NOT bucket-UNIQUE — an earlier revision
        // of this comment read as if the qualifier closed 2.4.6, and it does
        // not. N identical "Manual % complete" labels is a WCAG 2.4.6 failure
        // the axe gate cannot see (of axe-core 4.12.1's rules, not one carrying
        // a tag e2e/a11y.spec.ts requests flags two controls sharing a name),
        // and appending the bucket name fixes only the ordinary case. The
        // RESIDUAL case is live: `budget-bucket-modal.tsx` edits the name as
        // free text with no uniqueness constraint (only `BUDGET_NAME_MAX`), so
        // two buckets can carry one name and these inputs then collide
        // byte-for-byte again. Closing it needs a `buildRowTokens`
        // (`row-tokens.ts`) map built where the buckets are MAPPED and threaded
        // down as a prop — a per-item component has no sibling visibility — so
        // it is a deferred follow-up, deliberately not attempted here.
        aria-label={`${t(lang, "budgetPercentComplete")} – ${bucket.name}`}
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
