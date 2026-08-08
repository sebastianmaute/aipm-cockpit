"use client";
import { type ReactNode } from "react";
import { StopIcon } from "@heroicons/react/24/outline";
import { Button } from "./button";
import { t, type Lang, type TranslationKey } from "./i18n";

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
  disabled,
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
  disabled?: boolean;
  className?: string;
}) {
  const label = busy ? t(lang, "aiStop") : t(lang, idleLabelKey);
  const name = nameQualifier ? `${label} – ${nameQualifier}` : label;
  return (
    <Button
      variant="secondary"
      size="xs"
      onClick={busy ? onCancel : onRun}
      aria-label={name}
      title={name}
      // ★ A real `disabled` attribute, never an `aria-disabled` lookalike —
      //   the lookalike still fires onClick, which here would start a billed
      //   AI call from a control the surface had switched off.
      disabled={disabled}
      // `Button` carries no layout of its own, so the icon+label pair needs the
      // repo's standard inline-flex row; the caller's className still wins by
      // being appended after it.
      className={`inline-flex items-center gap-1${className ? ` ${className}` : ""}`}
    >
      {busy ? <StopIcon aria-hidden="true" className="h-4 w-4" /> : idleIcon}
      <span>{label}</span>
    </Button>
  );
}
