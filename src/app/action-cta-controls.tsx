// src/app/action-cta-controls.tsx
"use client";
import { useState, useRef, useCallback } from "react";
import { EllipsisVerticalIcon } from "./icons";
import { type Lang, t } from "./i18n";
import type { SuggestedAction } from "./next-actions/types";
import type { Resource } from "./types";
import { SNOOZE_1H, SNOOZE_1D } from "./reminder-snooze";
import { ResourcePicker } from "./resource-picker";
import { EscalatePopover, type EscalateBundle } from "./escalate-popover";
import { RebaselinePopover, type RebaselineBundle } from "./rebaseline-popover";
import { ReschedulePopover, type RescheduleBundle } from "./reschedule-popover";
import { PopoverPanel } from "./popover-panel";
import { Button, PRIMARY_MATCHING_BORDER, type ButtonSize } from "./button";
import { pickPrimaryCta, overflowCtas, type ActionCaps } from "./next-actions/action-cta";
import { rowLabel } from "./row-tokens";
import { menuItemClass } from "./control-classes";

export interface AssignOwnerBundle {
  resources: readonly Resource[];
  onCreateResource: (name: string, email: string) => number;
  onAssign: (action: SuggestedAction, value: { name: string; email: string; resourceId: number | null }) => void;
}

/** Every optional handler/bundle the surface may thread down. Shared by row + hero. */
export interface ActionHandlers {
  /** §582 — optional so a caller (a popout, a read-only surface) can legitimately
   *  omit it; `ActionPrimaryCta` hides the Open CTA entirely rather than render
   *  one that does nothing when clicked. `ActionsPanel` always wires a real
   *  handler here; `DashboardTopActions` forwards the Dashboard's optional
   *  `onOpenAction` through as-is, so its rows hide Open when it is absent. */
  onOpen?: (action: SuggestedAction) => void;
  /** `extraIds`, when given, are the OTHER ids in the row's `ActionGroup` (F1 —
   *  snoozing a grouped row must snooze every signal in the group, not just the
   *  promoted primary, or the row reappears immediately with the next one
   *  promoted). The caller snoozes each of them too, without re-recording
   *  learned bias for them — only the primary's kind is learned. */
  onSnooze?: (action: SuggestedAction, durationMs: number, extraIds?: readonly string[]) => void;
  onCreateTask?: (action: SuggestedAction) => void;
  /** "Log as RAID" (§515) — overflow item; absent in popouts. */
  onLogAsRaid?: (action: SuggestedAction) => void;
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
    logAsRaid: h.onLogAsRaid != null,
  };
}

// Every CTA here is the shared Button (§102, owner decision 2026-10-09): a filled
// verb is `primary`, at `md` in the hero and `xs` on a row, so the hero's primary
// verb reads bolder than the same verb in a row; every bordered chip is `secondary`
// at `xs`.
const ROW_SIZE: ButtonSize = "xs";

interface CtaProps {
  lang: Lang;
  action: SuggestedAction;
  caps: ActionCaps;
  handlers: ActionHandlers;
  /** Occurrence-qualified row name from whoever renders the LIST. REQUIRED, not
   *  optional, so a future call site cannot silently omit it and reintroduce the
   *  bare name: every verb below ("Open", "Mark done", …) is a fixed string, so
   *  without a token two rows render two identically-named buttons (WCAG 2.4.6).
   *  ★★ A raw action TITLE is not a substitute — a title is free text and can
   *  repeat, which is the entire premise of this defect class; the discriminator
   *  is "can this value repeat in one rendered list", never the call form (§324).
   *  A per-item component cannot disambiguate itself (no sibling visibility), so
   *  the token is built by the list owner and threaded down. */
  rowToken: string;
  /** Hero = larger filled treatment for direct verbs (bigger padding + text). */
  prominent?: boolean;
  /** The other ids in this row's `ActionGroup` (F1), so `ActionOverflowMenu`'s
   *  Snooze items can snooze the whole group. Unused by `ActionPrimaryCta`. */
  extraIds?: readonly string[];
}

/** Renders the single primary control (popover verbs reuse their existing popover;
 *  direct verbs render a button) PLUS a bordered (secondary) Open when the primary isn't Open. */
export function ActionPrimaryCta({ lang, action, caps, handlers, rowToken, prominent }: CtaProps) {
  const [assignOpen, setAssignOpen] = useState(false);
  const assignBtnRef = useRef<HTMLButtonElement>(null);
  const closeAssign = useCallback(() => setAssignOpen(false), []);

  const kind = pickPrimaryCta(action, caps);
  const directSize: ButtonSize = prominent ? "md" : ROW_SIZE;
  // A row's filled verb sits beside secondary chips, so it takes PRIMARY_MATCHING_BORDER.
  const directBorder = prominent ? undefined : PRIMARY_MATCHING_BORDER;
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  // ★ Rendered for EVERY action — as the primary when `kind === "open"`, and as
  //   the secondary Open alongside every other primary — so this one element is two
  //   identically-named buttons the moment a list holds two rows.
  // §582 — `onOpen` is optional (a popout/read-only caller legitimately omits
  // it); a button that calls nothing on click is worse than no button, so hide
  // it entirely rather than fall back to a no-op handler.
  const onOpenHandler = handlers.onOpen;
  const open = onOpenHandler ? (
    <Button variant={kind === "open" ? "primary" : "secondary"} size={kind === "open" ? directSize : ROW_SIZE}
      className={kind === "open" ? directBorder : undefined}
      onClick={(e) => { stop(e); onOpenHandler(action); }}
      aria-label={rowLabel(t(lang, "actionOpen"), rowToken)}>
      {t(lang, "actionOpen")}
    </Button>
  ) : null;

  let primary: React.ReactNode = open;
  if (kind === "assign" && handlers.assignOwner) {
    primary = (
      <span className="relative">
        <Button ref={assignBtnRef} variant={prominent ? "primary" : "secondary"} size={directSize}
          aria-haspopup="dialog" aria-expanded={assignOpen}
          aria-label={rowLabel(t(lang, "actionAssignOwner"), rowToken)}
          onClick={(e) => { stop(e); setAssignOpen((o) => !o); }}>
          {t(lang, "actionAssignOwner")}
        </Button>
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
    primary = <EscalatePopover lang={lang} action={action} bundle={handlers.escalate} rowToken={rowToken} prominent={prominent} />;
  } else if (kind === "rebaseline" && handlers.rebaseline) {
    primary = <RebaselinePopover lang={lang} action={action} bundle={handlers.rebaseline} rowToken={rowToken} prominent={prominent} />;
  } else if (kind === "reschedule" && handlers.reschedule) {
    primary = <ReschedulePopover lang={lang} action={action} bundle={handlers.reschedule} rowToken={rowToken} prominent={prominent} />;
  } else if (kind === "clearBlocker" && handlers.onClearBlocker) {
    // ★ `aria-label` on its own line in all three, matching the Open and assign
    //   buttons above: it is the accessibility-relevant attribute and is hardest
    //   to spot wedged mid-line between `type` and `onClick`.
    primary = (
      <Button variant="primary" size={directSize} className={directBorder}
        aria-label={rowLabel(t(lang, "actionClearBlocker"), rowToken)}
        onClick={(e) => { stop(e); handlers.onClearBlocker!(action); }}>
        {t(lang, "actionClearBlocker")}
      </Button>
    );
  } else if (kind === "markDone" && handlers.onMarkDone) {
    primary = (
      <Button variant="primary" size={directSize} className={directBorder}
        aria-label={rowLabel(t(lang, "actionMarkDone"), rowToken)}
        onClick={(e) => { stop(e); handlers.onMarkDone!(action); }}>
        {t(lang, "actionMarkDone")}
      </Button>
    );
  } else if (kind === "draft" && handlers.onDraftMessage) {
    primary = (
      <Button variant="primary" size={directSize} className={directBorder}
        aria-label={rowLabel(t(lang, "actionDraftMessage"), rowToken)}
        onClick={(e) => { stop(e); handlers.onDraftMessage!(action); }}>
        {t(lang, "actionDraftMessage")}
      </Button>
    );
  }

  return (
    <>
      {primary}
      {kind !== "open" && open /* secondary Open alongside a non-open primary */}
    </>
  );
}

/** The ⋮ overflow holding the menu-able secondaries minus the primary. */
export function ActionOverflowMenu({ lang, action, caps, handlers, rowToken, extraIds }: CtaProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setMenuOpen(false), []);
  const items = overflowCtas(action, caps);
  if (items.length === 0) return null;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  // F1: pass extraIds only when the row is actually grouped (non-empty) — an
  // ungrouped row's snooze call stays a plain 2-arg call, byte-identical to
  // before this fix.
  const fireSnooze = (ms: number) => {
    if (extraIds && extraIds.length > 0) handlers.onSnooze!(action, ms, extraIds);
    else handlers.onSnooze!(action, ms);
  };
  // ★★ The menu ITEMS below are deliberately NOT qualified, on the premise that
  //    they render only inside this row's `PopoverPanel`, which dismisses on
  //    outside click — so two menus are never in the tree at once and an item's
  //    name cannot repeat in one rendered list, the discriminator this whole
  //    slice turns on.
  // ★★ MEASURED (§328, `action-cta-controls.test.tsx`): opening row B's menu by
  //    pointer closes row A's (PopoverPanel's outside-mousedown dismissal), and
  //    an open menu traps Tab, so row B's trigger is unreachable by keyboard.
  //    Both tests fail when the mechanism they rest on is disabled. If either
  //    mechanism is ever removed from PopoverPanel, these items need `rowToken`.
  const item = (label: string, onClick: () => void) => (
    <button key={label} type="button"
      onClick={(e) => { stop(e); setMenuOpen(false); onClick(); }}
      className={menuItemClass()}>{label}</button>
  );
  return (
    <span className="relative">
      <Button ref={btnRef} variant="secondary" size={ROW_SIZE} aria-expanded={menuOpen}
        aria-label={rowLabel(t(lang, "actionMoreActions"), rowToken)}
        title={t(lang, "actionMoreActionsHint")}
        onClick={(e) => { stop(e); setMenuOpen((o) => !o); }}>
        <EllipsisVerticalIcon aria-hidden="true" className="h-4 w-4" />
      </Button>
      <PopoverPanel open={menuOpen} anchorRef={btnRef} onClose={close} className="flex w-max flex-col py-1">
          {items.map((k) => {
            if (k === "markDone" && handlers.onMarkDone) return item(t(lang, "actionMarkDone"), () => handlers.onMarkDone!(action));
            if (k === "draft" && handlers.onDraftMessage) return item(t(lang, "actionDraftMessage"), () => handlers.onDraftMessage!(action));
            if (k === "createTask" && handlers.onCreateTask) return item(t(lang, "actionCreateTask"), () => handlers.onCreateTask!(action));
            if (k === "logAsRaid" && handlers.onLogAsRaid) return item(t(lang, "actionLogAsRaid"), () => handlers.onLogAsRaid!(action));
            if (k === "snooze" && handlers.onSnooze) return (
              <span key="snooze" className="contents">
                {item(t(lang, "actionSnooze1h"), () => fireSnooze(SNOOZE_1H))}
                {item(t(lang, "actionSnooze1d"), () => fireSnooze(SNOOZE_1D))}
              </span>
            );
            return null;
          })}
      </PopoverPanel>
    </span>
  );
}
