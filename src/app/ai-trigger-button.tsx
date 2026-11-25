"use client";
import { createContext, type ReactNode, useContext, useId } from "react";
import { StopIcon } from "./icons";
import { Button, type ButtonSize, type ButtonVariant } from "./button";
import { t, type Lang, type TranslationKey } from "./i18n";

/** Reason text → the id of the ONE visible copy a toolbar renders for it (`SharedAiReasonTexts`). */
const SharedAiReasonIds = createContext<ReadonlyMap<string, string> | null>(null);

/**
 * The reasons more than one trigger in the same toolbar is unavailable for, each with one id. The toolbar
 * passes the `unavailableReason` of each trigger it renders (undefined for one that is ready or absent), wraps
 * its row in `SharedAiReasonsProvider` and renders `SharedAiReasonTexts` once: a trigger whose reason is in
 * the map points `aria-describedby` at that copy and renders none of its own. A reason only one trigger has
 * is not in the map, so that trigger keeps its own text. Computed in render from the props — no state.
 */
export function useSharedAiReasons(reasons: readonly (string | undefined)[]): ReadonlyMap<string, string> {
  const base = useId();
  const counts = new Map<string, number>();
  for (const r of reasons) if (r) counts.set(r, (counts.get(r) ?? 0) + 1);
  const shared = [...counts].filter(([, n]) => n > 1).map(([r]) => r);
  return new Map(shared.map((r, i) => [r, `${base}-reason-${i}`]));
}

export function SharedAiReasonsProvider({ ids, children }: { ids: ReadonlyMap<string, string>; children: ReactNode }) {
  return <SharedAiReasonIds.Provider value={ids}>{children}</SharedAiReasonIds.Provider>;
}

/** The one visible copy of each shared reason, styled like a trigger's own reason text. */
export function SharedAiReasonTexts({ ids }: { ids: ReadonlyMap<string, string> }) {
  return (
    <>
      {[...ids].map(([reason, id]) => (
        <span key={id} id={id} className={REASON_TEXT_CLASS}>
          {reason}
        </span>
      ))}
    </>
  );
}

// `max-w-56` lets a long reason wrap within itself rather than stretch the toolbar row.
const REASON_TEXT_CLASS = "max-w-56 text-xs text-muted-foreground";

/**
 * The shared trigger for every AI feature that can be stopped mid-flight.
 *
 * ★ While busy, the VISIBLE label and the ACCESSIBLE NAME both become "Stop"
 *   and the click aborts. A control whose visible text names something other
 *   than what a click does is WCAG 2.5.3 (F96) — which is why this never shows
 *   a progress label like "Asking Claude…" on the button itself. Put progress
 *   text beside the button if a surface needs it.
 *
 * Purely presentational: the caller's own busy flag and cancel function drive
 * it, so the five features that already own an AbortController keep it.
 */
export function AiTriggerButton({
  lang,
  busy,
  onRun,
  onCancel,
  idleLabelKey,
  idleIcon,
  nameQualifier,
  description,
  variant = "secondary",
  size = "xs",
  type = "button",
  disabled,
  unavailableReason,
  className,
}: {
  lang: Lang;
  busy: boolean;
  onRun: () => void;
  onCancel: () => void;
  idleLabelKey: TranslationKey;
  idleIcon?: ReactNode;
  /**
   * Row/mount-unique suffix for the ACCESSIBLE NAME only — the visible label is
   * never qualified. Required wherever this trigger renders more than once in
   * one DOM: N identical "Generate recommendation" buttons is WCAG 2.4.6, and
   * this project's axe gate can only flag a MISSING accessible name — it is
   * BLIND to a duplicate one (see clear-label-uniqueness.test.tsx and
   * dedup-trigger-qualifier.test.tsx, which exist because that shipped twice).
   *
   * ★ It qualifies BOTH states. Leaving the Stop state unqualified would put
   *   the collision back the moment a call is in flight, which is precisely
   *   when the surface has N buttons reading "Stop".
   *
   * ★ 2.5.3 still holds: the visible string ("Stop" / the idle label) is
   *   CONTAINED in the name, so a speech user saying what they see matches.
   */
  nameQualifier?: string;
  /**
   * A longer sentence for `title` — the accessible DESCRIPTION — while
   * `aria-label` keeps the short visible label as the NAME. Same split
   * `ResourcePicker` uses. Without it, a site whose trigger carried a fuller
   * explanation (allocPlanTitle, "Plan resource allocations with AI") silently
   * loses that disclosure for screen-reader users on the way to this component.
   *
   * ★ IDLE ONLY. While busy the description would still describe RUNNING the
   *   feature, on a control that now stops it — so `title` falls back to the
   *   name ("Stop"), which is what the click actually does.
   */
  description?: string;
  /** Defaults to the secondary/xs treatment every trigger had before this
   *  component existed. ★ A pane's PRIMARY action must pass its own
   *  `variant="primary"`/`size` — silently restyling a primary CTA down to a
   *  secondary xs button is a UI regression, and AGENTS.md's toolbar
   *  convention has the primary action leading the control row. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * ★★★ NO CALLER PASSES `"submit"` TODAY, AND ADDING ONE IS A TWO-PATH BUG
   *     UNLESS `onRun` STOPS SUBMITTING. This component ALWAYS wires
   *     `onClick={onRun}`, so a submit-typed trigger inside a `<form onSubmit>`
   *     runs the feature TWICE from one click: `onRun` first, then the browser's
   *     default action → the form handler. For an AI trigger that is two billed
   *     Claude calls with the first controller orphaned. `inline-ai-edit-popover`
   *     shipped exactly that and was reverted to the default; a phase guard is
   *     not a fix, it only makes the second call conditional on React having
   *     flushed a discrete update before the default action ran.
   * ★ So if a form genuinely needs a submit button (more than one field, where
   *   implicit Enter submission stops working), pass `"submit"` AND make `onRun`
   *   a no-op so the form handler is the single path — never both.
   */
  type?: "button" | "submit";
  disabled?: boolean;
  /**
   * Why the feature cannot run (e.g. AI not ready). While idle it DISABLES the
   * trigger and is shown as visible muted text beside it, which is also the
   * trigger's description (`aria-describedby`) and `title`.
   * ★ Visible text, not a title alone: a disabled button takes no keyboard
   *   focus and `title` never shows on touch, so a title-only reason reached
   *   mouse users alone. The trigger keeps a REAL `disabled` (see below).
   * ★ It is a `<span>`, never a second button: a sibling control would put a
   *   second match beside every name lookup of the trigger.
   */
  unavailableReason?: string;
  className?: string;
}) {
  const reasonId = useId();
  const label = busy ? t(lang, "aiStop") : t(lang, idleLabelKey);
  const name = nameQualifier ? `${label} – ${nameQualifier}` : label;
  const reason = !busy && unavailableReason ? unavailableReason : undefined;
  // A toolbar that holds several triggers unavailable for the same reason renders that reason once.
  const sharedIds = useContext(SharedAiReasonIds);
  const sharedReasonId = reason ? sharedIds?.get(reason) : undefined;
  const trigger = (
    <Button
      variant={variant}
      size={size}
      type={type}
      onClick={busy ? onCancel : onRun}
      aria-label={name}
      aria-describedby={reason ? (sharedReasonId ?? reasonId) : undefined}
      title={reason ?? (!busy && description ? description : name)}
      // ★ A real `disabled` attribute, never an `aria-disabled` lookalike —
      //   the lookalike still fires onClick, which here would start a billed
      //   AI call from a control the surface had switched off.
      disabled={disabled || reason !== undefined}
      // `Button` carries no layout of its own, so the icon+label pair needs the
      // repo's standard inline-flex row; the caller's className still wins by
      // being appended after it.
      // ★ `gap-1.5`, not `gap-1`: all FOUR migrated sites that carried an
      //   icon+label row before this component existed used `gap-1.5`
      //   (actions-panel, use-alloc-plan, use-raci-suggest, use-tasks-dedup —
      //   `git show 7151ebfd^` for each). The other two rendered text only, so
      //   they had no gap to preserve. `gap-1` shipped as a silent 2px
      //   restyle of every one of them; this restores what they had.
      className={`inline-flex items-center gap-1.5${className ? ` ${className}` : ""}`}
    >
      {busy ? <StopIcon aria-hidden="true" className="h-4 w-4" /> : idleIcon}
      <span>{label}</span>
    </Button>
  );
  if (!reason || sharedReasonId !== undefined) return trigger;
  return (
    <>
      {trigger}
      <span id={reasonId} className={REASON_TEXT_CLASS}>
        {reason}
      </span>
    </>
  );
}
