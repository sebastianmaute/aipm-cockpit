/**
 * Shared chrome for the entity edit modals (change / raid / stakeholder).
 *
 * Each modal repeated these three blocks verbatim; extracting them removes the
 * top cross-file jscpd clones (TD-6). Presentational only — every value +
 * handler is a prop; the callers keep their own visibility gates and divergent
 * pieces (raid's border-less footer with an InfoTooltip stays bespoke).
 */
import type { ReactNode } from "react";
import { type Lang, t, type TranslationKey } from "./i18n";
import { INTERACTIVE } from "./interaction-styles";
import { Checkbox } from "./form-controls";
import { Modal, MODAL_BACKDROP_CLASS } from "./modal";
import { ModalHeader } from "./modal-header";
import { ModalFieldControls } from "./modal-field-controls";
import { useConfirm } from "./confirm-dialog";
import type { ModalId } from "./modal-fields";
import type { Offset, DragHandleProps } from "./use-draggable";
import { useResizable } from "./use-resizable";
import { Banner } from "./banner";

interface EditModalShellProps {
  lang: Lang;
  title: string;
  modalId: ModalId;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  offset: Offset;
  dragHandleProps: DragHandleProps;
  /** Recenter the draggable panel (from the caller's `useDraggable`). Combined
   *  with the size reset behind the header's reset-layout button. */
  onDragReset: () => void;
  /** localStorage key for the persisted panel size (see `useResizable`). */
  sizeKey: string;
  /** Panel alignment. Default "center"; "start" (top-aligned) for tall modals
   *  (raid) that pair with `backdropScroll`. */
  align?: "start" | "center";
  /** Let the backdrop scroll when the panel exceeds the viewport (tall modals). */
  backdropScroll?: boolean;
  /** Extra panel classes appended after the shared panel chrome (e.g. a
   *  `max-h-[95vh]` cap on a tall start-aligned modal). */
  panelClassName?: string;
  children: ReactNode;
}

/**
 * The draggable modal shell shared by the change + stakeholder edit modals:
 * the centered `Modal`, the fixed-width draggable panel, the `ModalHeader`, the
 * field-visibility controls bar, and the two-column form grid. The caller's
 * fields + `ModalEditFooter` slot in as `children` (inside the `<form>`).
 * Presentational — offset/handlers are props. Emits the exact prior DOM tree.
 */
export function EditModalShell({
  lang,
  title,
  modalId,
  onClose,
  onSubmit,
  offset,
  dragHandleProps,
  onDragReset,
  sizeKey,
  align = "center",
  backdropScroll = false,
  panelClassName,
  children,
}: EditModalShellProps) {
  const { ref: sizeRef, reset: sizeReset } = useResizable(sizeKey);
  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel={title}
      align={align}
      backdropScroll={backdropScroll}
      backdropClassName={MODAL_BACKDROP_CLASS}
      zIndex={50}
    >
      <div
        ref={sizeRef}
        data-modal-panel
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        className={`relative flex w-[720px] min-w-[460px] max-w-[95vw] resize flex-col overflow-hidden rounded-xl border border-line bg-surface${panelClassName ? ` ${panelClassName}` : ""}`}
      >
        <ModalHeader
          lang={lang}
          title={title}
          onClose={onClose}
          dragHandleProps={dragHandleProps}
          onResetLayout={() => {
            onDragReset();
            sizeReset();
          }}
        />

        <ModalFieldControls modalId={modalId} lang={lang} />

        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 overflow-y-auto p-6 sm:grid-cols-2">
          {children}
        </form>
      </div>
    </Modal>
  );
}

interface ModalFieldErrorProps {
  error: string;
}

/**
 * The inline validation-error banner shown in a modal form grid. Caller guards
 * on `error` being non-empty (`{error && <ModalFieldError error={error} />}`).
 */
export function ModalFieldError({ error }: ModalFieldErrorProps) {
  return (
    <Banner severity="error" role="alert" className="sm:col-span-2">
      {error}
    </Banner>
  );
}

interface StakeholderChipOption {
  id: number;
  name: string;
}

interface StakeholderChipPickerProps {
  lang: Lang;
  stakeholders: readonly StakeholderChipOption[];
  selectedIds: readonly number[];
  onToggle: (id: number) => void;
}

/**
 * The "linked stakeholders" checkbox chip list. Caller supplies the visibility
 * gate (the field-visibility key differs per modal).
 */
export function StakeholderChipPicker({
  lang,
  stakeholders,
  selectedIds,
  onToggle,
}: StakeholderChipPickerProps) {
  return (
    <div className="sm:col-span-2">
      <span className="mb-2 block text-sm font-medium text-foreground">
        {t(lang, "fieldStakeholders")}
      </span>
      {stakeholders.length === 0 ? (
        <span className="text-xs italic text-muted-foreground">—</span>
      ) : (
        <div className="flex flex-wrap gap-2">
          {stakeholders.map((sh) => (
            <label
              key={sh.id}
              className="inline-flex items-center gap-1.5 rounded border border-line bg-surface px-2 py-1 text-xs text-foreground"
            >
              <Checkbox
                checked={selectedIds.includes(sh.id)}
                onChange={() => onToggle(sh.id)}
                aria-label={sh.name}
              />
              <span className="max-w-[200px] truncate">{sh.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

interface ModalEditFooterProps {
  lang: Lang;
  /** Delete button. If `deleteConfirmKey` is set it is gated behind a branded
   *  `useConfirm()`; otherwise it fires `onDelete` immediately (caller
   *  pre-confirms or none needed). */
  onDelete: () => void;
  /** When set, delete goes through `useConfirm({ message })`. */
  deleteConfirmKey?: TranslationKey;
  /** Visible delete label. Default `"delete"`. */
  deleteLabelKey?: TranslationKey;
  /** Row-unique accessible name where the visible label collides (a11y). */
  deleteAriaLabelKey?: TranslationKey;
  /** Hide the delete button entirely (e.g. a new item that can't be deleted).
   *  Takes precedence over `deleteDisabled`. */
  hideDelete?: boolean;
  /** Render delete but disabled (new item, when the modal shows it greyed). */
  deleteDisabled?: boolean;
  onCancel: () => void;
  saveDisabled?: boolean;
  /** Save label. Default `"raidSave"` (the generic "Save"). */
  saveLabelKey?: TranslationKey;
  /** Extra actions rendered in the left group, after delete (raid: an
   *  InfoTooltip + a conditional "Send inquiry" button). */
  middle?: ReactNode;
}

/**
 * The bordered footer with a destructive delete on the left and cancel + submit
 * on the right (all entity edit modals). The submit is a native `type="submit"`
 * — the caller's `<form onSubmit>` handles it. `middle` slots extra left-group
 * actions in for the raid modal (which formerly hand-rolled its own footer).
 */
export function ModalEditFooter({
  lang,
  onDelete,
  deleteConfirmKey,
  deleteLabelKey,
  deleteAriaLabelKey,
  hideDelete = false,
  deleteDisabled = false,
  onCancel,
  saveDisabled = false,
  saveLabelKey = "raidSave",
  middle,
}: ModalEditFooterProps) {
  const confirm = useConfirm();
  return (
    <footer className="flex items-center justify-between gap-2 border-t border-line pt-3 sm:col-span-2">
      <div className="flex items-center gap-2">
        {!hideDelete && (
          <button
            type="button"
            onClick={async () => {
              if (deleteConfirmKey) {
                if (await confirm({ message: t(lang, deleteConfirmKey) })) onDelete();
              } else {
                onDelete();
              }
            }}
            disabled={deleteDisabled}
            aria-label={deleteAriaLabelKey ? t(lang, deleteAriaLabelKey) : undefined}
            className={`rounded-md border border-AIPM-pink/40 bg-surface px-3 py-1.5 text-sm font-medium text-AIPM-pink-strong hover:bg-AIPM-pink/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-AIPM-pink/50 ${INTERACTIVE}`}
          >
            {t(lang, deleteLabelKey ?? "delete")}
          </button>
        )}
        {middle}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          className={`rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`}
        >
          {t(lang, "cancel")}
        </button>
        <button
          type="submit"
          disabled={saveDisabled}
          className={`rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-3 py-1.5 text-sm font-medium text-white hover:bg-AIPM-dark-blue/90 disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}
        >
          {t(lang, saveLabelKey)}
        </button>
      </div>
    </footer>
  );
}
