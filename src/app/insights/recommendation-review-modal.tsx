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

export interface RecommendationReviewModalProps {
  lang: Lang;
  summary: string;
  plan: EditPlan;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RecommendationReviewModal({ lang, summary, plan, onConfirm, onCancel }: RecommendationReviewModalProps) {
  const empty = isEmptyPlan(plan);

  return (
    <Modal open onClose={onCancel} ariaLabel={t(lang, "insightRecommendationReviewTitle")} align="center">
      <div className="w-[460px] max-w-[95vw] rounded-xl border border-line bg-surface p-4">
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
                  <span className="font-medium">{d.field}</span>: {d.before || "—"} → {d.after || "—"}
                </li>
              ))}
              {/* ★★ This consumer REPLAYS the original tool calls through the
                  dispatcher, so it really does write these links — and a
                  relationship write REPLACES. `before`/`after` are the resolved
                  titles, never `rawIds`; the `|| "—"` is load-bearing because
                  `after` is legitimately "" when every link is removed. */}
              {plan.links.map((l, i) => (
                <li key={`l${i}-${l.field}`}>
                  <span className="font-medium">{l.field}</span>: {l.before || "—"} →{" "}
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
