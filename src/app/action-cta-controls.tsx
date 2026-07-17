// src/app/action-cta-controls.tsx
"use client";
import { useState, useRef, useCallback } from "react";
import { type Lang, t } from "./i18n";
import type { SuggestedAction } from "./next-actions/types";
import type { Resource } from "./types";
import { SNOOZE_1H, SNOOZE_1D } from "./reminder-snooze";
import { ResourcePicker } from "./resource-picker";
import { EscalatePopover, type EscalateBundle } from "./escalate-popover";
import { RebaselinePopover, type RebaselineBundle } from "./rebaseline-popover";
import { ReschedulePopover, type RescheduleBundle } from "./reschedule-popover";
import { PopoverPanel } from "./popover-panel";
import { FOCUS_RING, INTERACTIVE } from "./interaction-styles";
import { pickPrimaryCta, overflowCtas, type ActionCaps } from "./next-actions/action-cta";

export interface AssignOwnerBundle {
  resources: readonly Resource[];
  onCreateResource: (name: string, email: string) => number;
  onAssign: (action: SuggestedAction, value: { name: string; email: string; resourceId: number | null }) => void;
}

/** Every optional handler/bundle the surface may thread down. Shared by row + hero. */
export interface ActionHandlers {
  onOpen: (action: SuggestedAction) => void;
  onSnooze?: (action: SuggestedAction, durationMs: number) => void;
  onCreateTask?: (action: SuggestedAction) => void;
  assignOwner?: AssignOwnerBundle;
  onDraftMessage?: (action: SuggestedAction) => void;
  escalate?: EscalateBundle;
  rebaseline?: RebaselineBundle;
  reschedule?: RescheduleBundle;
  onMarkDone?: (action: SuggestedAction) => void;
  onClearBlocker?: (action: SuggestedAction) => void;
}

/** Derive the capability flags from which handlers/bundles are present. */
export function useActionCaps(h: ActionHandlers): ActionCaps {
  return {
    assign: h.assignOwner != null,
    draft: h.onDraftMessage != null,
    escalate: h.escalate != null,
    rebaseline: h.rebaseline != null,
    snapshotActive: h.rebaseline?.snapshotActive === true,
    reschedule: h.reschedule != null,
    markDone: h.onMarkDone != null,
    clearBlocker: h.onClearBlocker != null,
    snooze: h.onSnooze != null,
    createTask: h.onCreateTask != null,
  };
}

const GHOST =
  `cursor-pointer rounded-md border border-line px-2 py-1 text-xs font-medium text-AIPM-dark-blue hover:border-AIPM-dark-blue/40 hover:bg-AIPM-dark-blue/10 dark:text-AIPM-light-grey ${INTERACTIVE}`;
// Size is applied per-context (prominent hero vs compact row) so the hero's primary
// verb reads bolder than the same verb in a row.
const FILLED_BASE =
  `cursor-pointer rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue font-medium text-white hover:opacity-90 ${INTERACTIVE}`;

interface CtaProps {
  lang: Lang;
  action: SuggestedAction;
  caps: ActionCaps;
  handlers: ActionHandlers;
  /** Hero = larger filled treatment for direct verbs (bigger padding + text). */
  prominent?: boolean;
}

/** Renders the single primary control (popover verbs reuse their existing popover;
 *  direct verbs render a button) PLUS a ghost Open when the primary isn't Open. */
export function ActionPrimaryCta({ lang, action, caps, handlers, prominent }: CtaProps) {
  const [assignOpen, setAssignOpen] = useState(false);
  const assignBtnRef = useRef<HTMLButtonElement>(null);
  const closeAssign = useCallback(() => setAssignOpen(false), []);

  const kind = pickPrimaryCta(action, caps);
  const directBtn = `${FILLED_BASE} ${prominent ? "px-4 py-1.5 text-sm" : "px-3 py-1 text-xs"}`;
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const open = (
    <button type="button" onClick={(e) => { stop(e); handlers.onOpen(action); }}
      className={kind === "open" ? directBtn : `${GHOST} px-3`}>
      {t(lang, "actionOpen")}
    </button>
  );

  let primary: React.ReactNode = open;
  if (kind === "assign" && handlers.assignOwner) {
    primary = (
      <span className="relative">
        <button ref={assignBtnRef} type="button" aria-haspopup="dialog" aria-expanded={assignOpen}
          onClick={(e) => { stop(e); setAssignOpen((o) => !o); }} className={prominent ? directBtn : GHOST}>
          {t(lang, "actionAssignOwner")}
        </button>
        <PopoverPanel open={assignOpen} anchorRef={assignBtnRef} onClose={closeAssign}
          role="dialog" ariaLabel={t(lang, "actionAssignOwner")} className="w-64 p-2">
          <ResourcePicker lang={lang} value={{ name: "", email: "", resourceId: null }}
            resources={handlers.assignOwner.resources} contacts={[]}
            onCreateResource={handlers.assignOwner.onCreateResource}
            onChange={(next) => { handlers.assignOwner!.onAssign(action, next); setAssignOpen(false); }} />
        </PopoverPanel>
      </span>
    );
  } else if (kind === "escalate" && handlers.escalate) {
    primary = <EscalatePopover lang={lang} action={action} bundle={handlers.escalate} prominent={prominent} />;
  } else if (kind === "rebaseline" && handlers.rebaseline) {
    primary = <RebaselinePopover lang={lang} action={action} bundle={handlers.rebaseline} prominent={prominent} />;
  } else if (kind === "reschedule" && handlers.reschedule) {
    primary = <ReschedulePopover lang={lang} action={action} bundle={handlers.reschedule} prominent={prominent} />;
  } else if (kind === "clearBlocker" && handlers.onClearBlocker) {
    primary = <button type="button" onClick={(e) => { stop(e); handlers.onClearBlocker!(action); }} className={directBtn}>{t(lang, "actionClearBlocker")}</button>;
  } else if (kind === "markDone" && handlers.onMarkDone) {
    primary = <button type="button" onClick={(e) => { stop(e); handlers.onMarkDone!(action); }} className={directBtn}>{t(lang, "actionMarkDone")}</button>;
  } else if (kind === "draft" && handlers.onDraftMessage) {
    primary = <button type="button" onClick={(e) => { stop(e); handlers.onDraftMessage!(action); }} className={directBtn}>{t(lang, "actionDraftMessage")}</button>;
  }

  return (
    <>
      {primary}
      {kind !== "open" && open /* ghost Open alongside a non-open primary */}
    </>
  );
}

/** The ⋮ overflow holding the menu-able secondaries minus the primary. */
export function ActionOverflowMenu({ lang, action, caps, handlers }: CtaProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setMenuOpen(false), []);
  const items = overflowCtas(action, caps);
  if (items.length === 0) return null;
  const title = t(lang, action.title.key, ...(action.title.params ?? []));
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const item = (label: string, onClick: () => void) => (
    <button key={label} type="button"
      onClick={(e) => { stop(e); setMenuOpen(false); onClick(); }}
      className={`px-3 py-1 text-left text-xs text-foreground hover:bg-surface-muted ${FOCUS_RING}`}>{label}</button>
  );
  return (
    <span className="relative">
      <button ref={btnRef} type="button" aria-expanded={menuOpen}
        aria-label={`${t(lang, "actionMoreActions")} – ${title}`}
        onClick={(e) => { stop(e); setMenuOpen((o) => !o); }}
        className={`cursor-pointer rounded-md border border-line px-2 py-1 text-xs font-medium text-muted-foreground hover:border-AIPM-dark-blue/40 hover:bg-AIPM-dark-blue/10 ${FOCUS_RING}`}>
        ⋮
      </button>
      <PopoverPanel open={menuOpen} anchorRef={btnRef} onClose={close} className="flex w-max flex-col py-1">
          {items.map((k) => {
            if (k === "markDone" && handlers.onMarkDone) return item(t(lang, "actionMarkDone"), () => handlers.onMarkDone!(action));
            if (k === "draft" && handlers.onDraftMessage) return item(t(lang, "actionDraftMessage"), () => handlers.onDraftMessage!(action));
            if (k === "createTask" && handlers.onCreateTask) return item(t(lang, "actionCreateTask"), () => handlers.onCreateTask!(action));
            if (k === "snooze" && handlers.onSnooze) return (
              <span key="snooze" className="contents">
                {item(t(lang, "actionSnooze1h"), () => handlers.onSnooze!(action, SNOOZE_1H))}
                {item(t(lang, "actionSnooze1d"), () => handlers.onSnooze!(action, SNOOZE_1D))}
              </span>
            );
            return null;
          })}
      </PopoverPanel>
    </span>
  );
}
