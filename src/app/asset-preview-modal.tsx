"use client";
// The asset preview lightbox: a draggable, resizable modal that shows ONE
// uploaded image at a time and steps through the list the caller handed it.
//
// ★★★ DISMISSAL IS THE SHARED `Modal`'S JOB, NOT OURS. It joins
// `dismissal-stack.ts`, so Escape routing and the Tab trap are already correct
// and already stack-aware for a nested layer. Do NOT add a `useDismissable`,
// a `useFocusTrap`, or a document-level Escape listener here — a second
// claimer for one layer is exactly the double-fire the stack exists to stop.
// `notes-window.tsx` DOES hand-roll a conditional Escape claim; that is
// correct THERE because it is non-modal and stays open while the user works
// elsewhere. Do NOT copy its drag wiring either: it is `useDraggableWindow`'s
// mouse API, and `ModalHeader` takes only `useDraggable`'s pointer handlers.
// `task-form-modal.tsx` is the precedent for the window mechanics below.
//
// ★★ LIST-AGNOSTIC ON PURPOSE. "Next" means next in the list you opened this
// from — the library's current sort, or a document's visual order. A single
// global ordering would make "next" jump to an image that is not visible
// where the user clicked.
import { useState } from "react";
import { type Lang, t } from "./i18n";
import type { DocumentAsset } from "./document-asset";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { useResizable } from "./use-resizable";
import { useDraggable } from "./use-draggable";

// ★ Neither key collides. Enumerate today's set rather than trusting a list
// written here — a quoted enumeration rots on the next modal:
//   grep -rhn "modal-size:\|modal-pos:" src/app --include=*.tsx --include=*.ts | grep -v test
const STORAGE_KEY_POS = "aipm-cockpit:modal-pos:asset-preview";
const STORAGE_KEY_SIZE = "aipm-cockpit:modal-size:asset-preview";

const TITLE_ID = "asset-preview-modal-title";

export interface AssetPreviewModalProps {
  lang: Lang;
  open: boolean;
  onClose: () => void;
  /** The caller's own order. Prev/next walk THIS list, and do not wrap. */
  assets: readonly DocumentAsset[];
  startIndex: number;
  /** Injected byte loader — never a TursoConfig. Keeps this component
   *  storage-agnostic, and Turso gating stays inherited from the call site. */
  loadImage: (id: string) => Promise<string | null>;
}

export function AssetPreviewModal({
  lang, open, onClose, assets, startIndex,
}: AssetPreviewModalProps) {
  const [index, setIndex] = useState(startIndex);
  const { offset, reset: dragReset, handleProps } = useDraggable(open, STORAGE_KEY_POS);
  const { ref: sizeRef, reset: sizeReset } = useResizable(STORAGE_KEY_SIZE);

  // Re-seed when a fresh open targets a different asset. Render-time reconcile,
  // NOT a useEffect — `react-hooks/set-state-in-effect` is banned and fatal.
  const [seenStart, setSeenStart] = useState(startIndex);
  if (startIndex !== seenStart) {
    setSeenStart(startIndex);
    setIndex(startIndex);
  }

  const current = assets[index];

  return (
    // `ariaLabelledby` over `ariaLabel` so the dialog's accessible name IS the
    // heading a sighted user reads and the two cannot drift — the convention
    // `asset-library-modal.tsx` states at its own Modal.
    <Modal open={open} onClose={onClose} ariaLabelledby={TITLE_ID} align="center">
      <div
        ref={sizeRef}
        data-modal-panel
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        className="relative flex h-[720px] max-h-[95vh] min-h-[360px] w-[900px] min-w-[380px] max-w-[95vw] resize flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <ModalHeader
          lang={lang}
          title={t(lang, "assetPreviewTitle", current?.name ?? "")}
          titleId={TITLE_ID}
          onClose={onClose}
          dragHandleProps={handleProps}
          onResetLayout={() => { dragReset(); sizeReset(); }}
        />
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          {/* body arrives in Task 4 */}
        </div>
      </div>
    </Modal>
  );
}
