"use client";

// The blocker log's floating window. The draggable/resizable non-modal chrome
// lives in the shared `FloatingLogWindow` (also used by the note log); the body
// is `BlockerLogPanel`. This file only supplies the title, storage keys and
// help entry.

import { t } from "./i18n";
import { FloatingLogWindow } from "./floating-log-window";
import { BlockerLogPanel, type BlockerLogPanelProps } from "./blocker-log-panel";
import { MODAL_HELP } from "./help-content";

// Saved geometry keys are `${prefix}-pos` / `${prefix}-size`.
const STORAGE_KEY_PREFIX = "aipm-cockpit:blockers-window";

export interface BlockersWindowProps extends BlockerLogPanelProps {
  open: boolean;
  onClose: () => void;
  entityLabel: string;
  /** The task the window is open for. Keys the body, so a draft typed for one
   *  task never carries over when the window switches to another. */
  taskId: number | null;
}

export function BlockersWindow(props: BlockersWindowProps) {
  const { open, onClose, entityLabel, taskId, ...panel } = props;
  // ★★ ONE SPELLING, THREE SINKS: accessible name, visible heading and the help
  // trigger's dialog title all come from this one string (see notes-window.tsx).
  const windowTitle = `${t(panel.lang, "blockerLogTitle")} — ${entityLabel}`;

  return (
    <FloatingLogWindow
      open={open}
      onClose={onClose}
      title={windowTitle}
      storageKeyPrefix={STORAGE_KEY_PREFIX}
      helpConceptId={MODAL_HELP.blockersWindow}
      lang={panel.lang}
    >
      <BlockerLogPanel key={taskId ?? "none"} {...panel} />
    </FloatingLogWindow>
  );
}
