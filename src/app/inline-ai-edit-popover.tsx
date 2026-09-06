"use client";
import { useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { FieldError } from "./field-feedback";
import { type EditPlan } from "./inline-ai-edit/plan";
import { type InlineEntity } from "./inline-ai-edit/entity-descriptor";
import { fieldLabel } from "./inline-ai-edit/field-labels";
import { type InlinePhase } from "./use-inline-ai-edit";
import { usePopoverDismiss } from "./use-popover-dismiss";
import { useFocusTrap } from "./use-focus-trap";
import { MODAL_BACKDROP_CLASS } from "./modal";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";
import { XMarkIcon } from "./icons";
import { Button } from "./button";
import { AiTriggerButton } from "./ai-trigger-button";
import { IconButton } from "./icon-button";

export interface InlineAiEditPopoverProps {
  lang: Lang;
  itemTitle: string;
  entityLabel: string;
  /** Which entity the open row belongs to — NOT derivable from `entityLabel`,
   *  which is an already-translated display string. It names the descriptor the
   *  plan was diffed against, so `fieldLabel` can resolve `${entity}.${field}`:
   *  `title` is a job title on a resource and a person's role on a stakeholder,
   *  so an unqualified label would be wrong for one of them. Both call sites
   *  (`use-entity-inline-ai-edit`, `use-tasks-inline-ai-edit`) already hold it. */
  entity: InlineEntity;
  phase: InlinePhase;
  plan: EditPlan | null;
  clarifyText: string;
  errorText: string;
  onSubmit: (instruction: string) => void;
  onApply: () => void;
  onCancel: () => void;
}

export function InlineAiEditPopover(props: InlineAiEditPopoverProps) {
  const { lang, itemTitle, entityLabel, entity, phase, plan, clarifyText, errorText, onSubmit, onApply, onCancel } = props;
  const [value, setValue] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  usePopoverDismiss(true, ref, onCancel);
  // Focus the NL input on open, trap Tab within the aria-modal dialog, and
  // restore focus to the trigger (✨ button) on close — via the shared
  // focus-trap primitive (usePopoverDismiss already owns Escape + outside-click).
  useFocusTrap(ref, true, undefined, inputRef);
  const busy = phase === "thinking" || phase === "applying";

  return (
    <div className={`fixed inset-0 z-[70] flex items-center justify-center ${MODAL_BACKDROP_CLASS} p-4`}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={t(lang, "inlineAiEdit")}
        className="w-[420px] max-w-[95vw] rounded-xl border border-line bg-surface p-4"
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">{t(lang, "inlineAiEditTitle")}</h2>
          <IconButton onClick={onCancel} label={t(lang, "cancel")} title={t(lang, "cancel")}>
            <XMarkIcon aria-hidden="true" className="h-4 w-4" />
          </IconButton>
        </div>
        <p className="mb-3 truncate text-xs text-muted-foreground"><span className="font-medium">{entityLabel}</span> · {itemTitle}</p>

        {phase !== "preview" && (
          <form onSubmit={(e) => { e.preventDefault(); if (value.trim() && !busy) onSubmit(value.trim()); }}>
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label={t(lang, "inlineAiEditTitle")}
              placeholder={t(lang, "inlineAiEditPlaceholder")}
              disabled={busy}
              className={`w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground disabled:opacity-50 ${FOCUS_RING} ${TRANSITION}`}
            />
            <div className="mt-2 flex justify-end">
              {/* ★★★ ONE SUBMIT PATH PER INTERACTION — do NOT re-add
                  `type="submit"` here. AiTriggerButton always wires
                  `onClick={onRun}`, so a submit-typed button inside this
                  `<form onSubmit>` fires BOTH: onRun → onSubmit(value), then the
                  browser's default action → the form handler → onSubmit(value)
                  again. Worst case that is two billed Claude calls per click with
                  the first controller orphaned; only the two phase guards stood
                  between us and it, and they hold solely because React happens to
                  flush the discrete-event update before the default action runs.
                  ★ Enter still submits: with no submit button in the form and
                    exactly one field, the HTML implicit-submission rule fires the
                    form's onSubmit. That IS a property of this form's contents —
                    adding a second input silently breaks Enter, at which point the
                    fix is a real submit button and REMOVING onRun's call, never
                    both paths at once.
                  ★ `busy` is `"thinking"` alone; `"applying"` is a local commit,
                    not a stoppable Claude call, so it stays disabled as before. */}
              <AiTriggerButton
                lang={lang}
                busy={phase === "thinking"}
                onRun={() => { if (value.trim()) onSubmit(value.trim()); }}
                onCancel={onCancel}
                idleLabelKey="inlineAiEdit"
                size="sm"
                disabled={phase === "applying" || !value.trim()}
              />
            </div>
          </form>
        )}

        {phase === "thinking" && <p className="mt-3 text-xs text-muted-foreground">{t(lang, "inlineAiEditThinking")}</p>}

        {phase === "clarify" && (
          <p className="mt-3 text-xs text-foreground"><span className="font-medium">{t(lang, "inlineAiEditClarify")}</span> {clarifyText}</p>
        )}

        {phase === "error" && errorText && <FieldError>{errorText}</FieldError>}

        {/* ★★★ A REFUSAL, NOT "NO CHANGES" (§392). The model understood and the
            writer refused a named field — a different thing from "clarify",
            which means the model needs more from the user. There is deliberately
            NO Apply button: `apply()` guards on `isEmptyPlan`, which does not
            count `rejected`, so an Apply offered here would be live and would
            no-op on every click. The instruction form above still renders (this
            phase is not `preview`), so retrying with a different value is the
            recourse and this footer is only the way out.
            ★ `close`, not `cancel`: the header ✕ is already named "Cancel", and
            a second control with that name inside one `aria-modal` dialog is a
            WCAG 2.4.6 collision — the one the preview footer below already
            has. */}
        {phase === "rejected" && plan && (
          <div className="mt-3">
            <p className="mb-2 text-xs font-medium text-foreground">{t(lang, "inlineAiEditRejectedOnly")}</p>
            <ul className="mb-3 space-y-1 text-xs">
              {plan.rejected.map((r, i) => (<li key={`r${i}`} className="text-ui-pink-strong">{t(lang, "inlineAiEditRejected", r.detail)}</li>))}
            </ul>
            <div className="flex justify-end">
              <Button variant="secondary" size="sm" onClick={onCancel}>{t(lang, "close")}</Button>
            </div>
          </div>
        )}

        {phase === "preview" && plan && (
          <div className="mt-1">
            <p className="mb-2 text-xs font-medium text-foreground">{t(lang, "inlineAiEditPreview")}</p>
            <ul className="mb-3 space-y-1 text-xs text-foreground">
              {plan.updates.map((d) => (
                <li key={d.field}><span className="font-medium">{fieldLabel(lang, entity, d.field)}</span>: {d.before || "—"} → {d.after || "—"}</li>
              ))}
              {/* ★★ This popover's Apply REBUILDS its write patch from `links`,
                  and a relationship write REPLACES — so an unrendered link
                  change is a silent destructive write. `before`/`after` are the
                  resolved TITLES, never `rawIds`; the `|| "—"` is load-bearing
                  because `after` is legitimately "" when every link is removed. */}
              {plan.links.map((l, i) => (<li key={`l${i}-${l.field}`}><span className="font-medium">{fieldLabel(lang, entity, l.field)}</span>: {l.before || "—"} → {l.after || "—"}</li>))}
              {plan.creates.map((c, i) => (<li key={`c${i}`}>{t(lang, "inlineAiEditCreate", c.entity, c.title)}</li>))}
              {plan.deletes.map((del, i) => (<li key={`d${i}`}>{t(lang, "inlineAiEditDelete", del.entity, del.label)}</li>))}
              {/* ★★★ THE PARTS THAT WILL NOT LAND, and this surface is the one
                  that APPLIES what it renders. Rendered nowhere at all before —
                  the same gap the chat approval card had — so a field the
                  sanitizer refused simply vanished from a preview the user then
                  approved, and they read the remaining lines as the whole change.
                  Last, and in the same failure colour the card uses.
                  ★★ IN THE LIVE APP THIS BLOCK IS ONLY REACHABLE ON A PLAN THAT
                  ALSO WRITES SOMETHING, and that is now the whole story rather
                  than a defect: `use-inline-entity-edit.ts` routes an
                  `isEmptyPlan` result whose `rejected` is non-empty to the
                  "rejected" phase below (§392, closed by the commit that added
                  that phase). It used to route there to "clarify" — telling the
                  user "no changes" instead of which field was refused — because
                  `isEmptyPlan` does not count `rejected`. Do NOT "simplify" the
                  two renderings into one by routing a rejection-only plan here:
                  `apply()` guards on `isEmptyPlan` too, so the Apply button
                  below would be live and would no-op. */}
              {plan.rejected.map((r, i) => (<li key={`r${i}`} className="text-ui-pink-strong">{t(lang, "inlineAiEditRejected", r.detail)}</li>))}
            </ul>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={onCancel}>{t(lang, "cancel")}</Button>
              <Button size="sm" onClick={onApply}>{t(lang, "inlineAiEditApply")}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
