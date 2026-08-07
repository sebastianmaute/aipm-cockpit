"use client";

// Draggable, resizable, NON-MODAL floating window: the single CRUD surface for
// an entity's note log (shared by tasks AND raid). Controlled by external
// `open`/`onClose` — it never self-triggers, has no backdrop, and does not trap
// focus, so the app stays interactive underneath. Drag/resize mechanics clone
// `help-menu.tsx`; the composer + entry list live in the shared `NoteLogPanel`,
// so the same body can also be mounted inside the task editor.

import { XMarkIcon } from "@heroicons/react/24/outline";
import { IconButton } from "./icon-button";
// `Lang` no longer needs importing here: the props are derived from
// NoteLogPanelProps, which already types `lang`.
import { t } from "./i18n";
import { useResizable } from "./use-resizable";
import { useDraggableWindow, type ComputeInitialPos } from "./use-draggable-window";
import { ResetSizeButton } from "./task-manager-ui";
import { useClaimsWhenFocusWithin, useDismissable } from "./use-dismissable";
import { usePanelInitialFocus } from "./use-panel-focus";
import { NoteLogPanel, type NoteLogPanelProps } from "./note-log-panel";

const STORAGE_KEY_POS = "aipm-cockpit:notes-window-pos";
const STORAGE_KEY_SIZE = "aipm-cockpit:notes-window-size";

const DEFAULT_X = 96;
const DEFAULT_Y = 96;

// Place the window on first open: saved position, else a default corner gap.
const computeNotesInitialPos: ComputeInitialPos = ({ saved, clamp }) =>
  clamp(saved ?? { x: DEFAULT_X, y: DEFAULT_Y });

// The note-log props are shared verbatim with the panel — derived rather than
// restated so the two cannot drift (and so the split introduces no clone).
// `labelSuffix` is deliberately omitted: see the mount below.
export interface NotesWindowProps extends Omit<NoteLogPanelProps, "labelSuffix"> {
  open: boolean;
  onClose: () => void;
  entityLabel: string;
}

export function NotesWindow(props: NotesWindowProps) {
  const { open, onClose, entries, onAdd, onEdit, onDelete, self, resources, lang, entityLabel } = props;

  const { ref: panelRef, reset: resetSize } = useResizable(STORAGE_KEY_SIZE);
  // Drag/position (shared with help-menu); size stays on useResizable above.
  const { pos, onTitleBarMouseDown } = useDraggableWindow(STORAGE_KEY_POS, {
    open,
    panelRef,
    computeInitialPos: computeNotesInitialPos,
    fallbackWidth: 480,
    fallbackHeight: 560,
  });

  // Escape closes — but ONLY while focus is inside this window, or nowhere.
  //
  // ★★ This window is NON-MODAL and mounts at the top level: it stays open
  // while the user works anywhere else, including inside a modal it is not
  // part of. An unconditional claim swallowed every Escape in the app — open
  // notes from a row badge, open the task editor, press Escape to dismiss the
  // editor, and the notes window closed while the editor stayed.
  //
  // ★★ The gate lives in `claims` rather than in a handler, and that is
  // load-bearing: a declining entry that stayed topmost would block every
  // layer beneath it, because each of those asks "am I topmost?" and gets
  // `false`. Escape would become a no-op. The stack walks past a decliner
  // instead, so the editor underneath gets the key.
  // ★★ Move focus INTO the window on open. Without this the trigger that
  // opened it — the "Notes (N)" button INSIDE the task/RAID editor `Modal` —
  // keeps focus, `claimsFocusWithin` reads false, this window declines, and the
  // editor beneath takes the Escape and closes with the user's draft. Opening
  // this window must not arm a keypress that destroys work.
  usePanelInitialFocus(panelRef, open);

  const claimsFocusWithin = useClaimsWhenFocusWithin(panelRef);
  useDismissable({
    open,
    kind: "layer",
    onDismiss: onClose,
    claims: claimsFocusWithin,
  });

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      // Focus target for `usePanelInitialFocus` — carries no focus ring, and is
      // deliberately not in the tab order.
      tabIndex={-1}
      aria-label={`${t(lang, "noteLogTitle")} — ${entityLabel}`}
      style={{ left: pos?.x ?? DEFAULT_X, top: pos?.y ?? DEFAULT_Y, maxWidth: "100vw", maxHeight: "calc(100vh - 32px)" }}
      className="fixed z-40 flex h-[560px] min-h-72 w-[480px] min-w-[320px] resize flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-[var(--shadow-card)] focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-green"
    >
      <div
        onMouseDown={onTitleBarMouseDown}
        className="flex shrink-0 cursor-move select-none items-center justify-between border-b border-line px-4 py-2"
      >
        <h3 className="truncate text-sm font-semibold text-foreground">
          {t(lang, "noteLogTitle")} — {entityLabel}
        </h3>
        <div className="flex items-center gap-1">
          <ResetSizeButton onClick={resetSize} lang={lang} labelKey="modalResetSize" />
          <IconButton onClick={onClose} label={t(lang, "close")}>
            <XMarkIcon aria-hidden="true" className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      {/* ★ NO `labelSuffix`: this window's `role="dialog"` aria-label already
          announces the entity, so its row controls are unambiguous within it —
          and adding one would change every existing accessible name. The
          in-editor mount is the surface that needs to disambiguate. */}
      <NoteLogPanel
        entries={entries}
        onAdd={onAdd}
        onEdit={onEdit}
        onDelete={onDelete}
        self={self}
        resources={resources}
        lang={lang}
      />
    </div>
  );
}
