"use client";

// Review modal for an AI insight recommendation (#6B SP2 — Task 9). Presentational
// only: shows the recommendation's one-line summary + a preview of its proposed
// tool calls (reusing the EditPlan shape the inline "Ask Claude" editor already
// renders), and lets the user Confirm (task-manager replays the proposed calls
// through the existing tool dispatcher) or Cancel. No apply logic lives here.
import { type Lang, t } from "../i18n";
import { Modal } from "../modal";
import { Button } from "../button";
import { isEmptyPlan, type EditPlan } from "../inline-ai-edit/plan";
import { fieldLabel, linkLabel } from "../inline-ai-edit/field-labels";

export interface RecommendationReviewModalProps {
  lang: Lang;
  summary: string;
  /** ★★★ EVERY ROW CARRIES ITS OWN ENTITY, so this modal takes no plan-level
   *   one. `describeRecommendationPlan` MERGES every proposed call's diffs into
   *   one `EditPlan`, so a recommendation touching a task AND a raid item has no
   *   single entity — this used to arrive as an optional prop that
   *   `recommendationPlanEntity` could only fill when exactly one register was
   *   updated, and a mixed plan then rendered raw property names throughout
   *   (§393). `FieldDiff.entity`/`LinkDiff.entity` answer per ROW instead, so a
   *   mixed plan labels both halves correctly and neither can be mislabelled
   *   (`impact` is a rating on a change and a 1-5 scale on a RAID item). */
  plan: EditPlan;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RecommendationReviewModal({ lang, summary, plan, onConfirm, onCancel }: RecommendationReviewModalProps) {
  const empty = isEmptyPlan(plan);

  return (
    <Modal open onClose={onCancel} ariaLabel={t(lang, "insightRecommendationReviewTitle")} align="center">
      <div className="w-[460px] max-w-[95vw] rounded-xl border border-line bg-surface p-4">
        {/* ★★ NO help icon, deliberately — and this one was a WIRE candidate
            downgraded on re-review, so the evidence is recorded rather than the
            verdict alone. The candidate was automated-insights, which is about
            DETECTION AND TRIAGE: the five watched patterns, the status
            lifecycle, and where insights are listed. It never says
            "recommendation", "AI", "propose" or "apply" — which is the only
            question this dialog poses, namely what Apply will write. Its status
            sentence does describe a real consequence (applying sets
            status: "acted", in use-insight-recommendations.ts), but a
            consequence is not the subject.
            ★★★ THE ALTERNATION IS PART OF THE NUMBER — quoting either count
            against the other pattern is the unlabelled-convention defect §453
            records. Measured over all 69 help bodies at 69/69 resolved:
            "recommend" matches 1 (feature-template-suggest, a project
            template); "apply|applied" matches 4 (feature-templates,
            feature-per-project-functions, feature-documents, feature-timelog);
            the wider "apply|applied|applies" matches 6, adding
            feature-timezones and feature-ai in the scope sense. None is the
            sense of applying an AI-proposed write.
            ★ The near-miss, named so the next reader need not re-derive it, is
            feature-inline-ai-edit: it describes this mechanic almost verbatim
            ("you see each field it proposes to touch with its current and its
            new value, and nothing is written until you confirm"), and this file
            already notes it reuses that editor's EditPlan shape — but its
            scoping clause is "without leaving the row", so wiring it would tell
            a reader they are in the inline row editor, which they are not.
            ★ And no existing entry can be pointed at a surface whose purpose is
            applying AI-proposed writes: feature-ai-advanced says of Analyze with
            AI that "it never edits your data".
            See docs/open-followups.md §456. */}
        <h2 className="mb-2 text-sm font-semibold text-foreground">
          {t(lang, "insightRecommendationReviewTitle")}
        </h2>
        <p className="mb-3 text-sm text-foreground">{summary}</p>

        {empty ? (
          <p className="mb-3 text-xs text-muted-foreground">{t(lang, "insightRecommendationEmptyPlan")}</p>
        ) : (
          <>
            <p className="mb-2 text-xs font-medium text-foreground">{t(lang, "inlineAiEditPreview")}</p>
            <ul className="mb-3 space-y-1 text-xs text-foreground">
              {plan.updates.map((d, i) => (
                <li key={`u${i}-${d.field}`}>
                  <span className="font-medium">{fieldLabel(lang, d.entity, d.field)}</span>: {d.before || "—"} → {d.after || "—"}
                </li>
              ))}
              {/* ★★ This consumer REPLAYS the original tool calls through the
                  dispatcher, so it really does write these links — and a
                  relationship write REPLACES. `before`/`after` are the resolved
                  titles, never `rawIds`; the `|| "—"` is load-bearing because
                  `after` is legitimately "" when every link is removed. */}
              {plan.links.map((l, i) => (
                <li key={`l${i}-${l.field}`}>
                  <span className="font-medium">{linkLabel(lang, l.entity, l)}</span>: {l.before || "—"} →{" "}
                  {l.after || "—"}
                </li>
              ))}
              {plan.creates.map((c, i) => (
                <li key={`c${i}`}>{t(lang, "inlineAiEditCreate", c.entity, c.title)}</li>
              ))}
              {plan.deletes.map((del, i) => (
                <li key={`d${i}`}>{t(lang, "inlineAiEditDelete", del.entity, del.label)}</li>
              ))}
            </ul>
          </>
        )}

        {/* ★★ The FIELDS, not a tally. A bare count told the user how many
            proposed changes would not land but never WHICH, which is the half
            they need in order to decide whether to confirm the rest. */}
        {plan.rejected.length > 0 && (
          <p className="mb-3 text-xs text-muted-foreground">
            {t(
              lang,
              "insightRecommendationSkippedFields",
              plan.rejected.map((r) => r.detail).join(", "),
            )}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            {t(lang, "cancel")}
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={empty}>
            {t(lang, "insightApplyRecommendation")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
