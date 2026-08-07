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
import { Button } from "./button";
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
  /** Panel width classes. Default `"w-[720px] min-w-[460px]"` (the wide
   *  change/raid/stakeholder modals); the narrower register modals
   *  (absence/milestone/resource) pass `"w-[560px] min-w-[320px]"`. */
  widthClassName?: string;
  /** Panel height classes. Default `"h-[720px] min-h-[420px] max-h-[95vh]"` —
   *  `useResizable` needs a class-based default height or a dragged height opens
   *  dead space. Overriding replaces all three; the override must carry its own
   *  `max-h-` cap (there is no tailwind-merge, so a stray leftover would be
   *  resolved by Tailwind's output ordering, not by the call site). */
  heightClassName?: string;
  /** `<form>` classes. Default is the two-column grid the wide modals use;
   *  narrower modals override the padding, and the milestone modal opts into a
   *  single-column flow. */
  formClassName?: string;
  children: ReactNode;
}

/**
 * The draggable modal shell shared by SEVEN edit modals — absence,
 * calendar-event, change, milestone, raid, resource and stakeholder (reproduce:
 * `grep -rln EditModalShell src/app --include="*.tsx" | grep -v "\.test\."`):
 * the centered `Modal`, the fixed-width draggable panel, the `ModalHeader`
 * (carrying the field-visibility control in its right-hand cluster), and the
 * two-column form grid. The caller's fields + `ModalEditFooter` slot in as
 * `children` (inside the `<form>`). Presentational — offset/handlers are props.
 * (It no longer "emits the exact prior DOM tree" as this comment used to claim:
 * that held while the extraction was DOM-for-DOM, and the field-visibility
 * control has since moved from a strip below the header into the header.)
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
  widthClassName = "w-[720px] min-w-[460px]",
  heightClassName = "h-[720px] min-h-[420px] max-h-[95vh]",
  formClassName = "grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-6 sm:grid-cols-2",
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
        className={`relative flex ${widthClassName} ${heightClassName} max-w-[95vw] resize flex-col overflow-hidden rounded-xl border border-line bg-surface${panelClassName ? ` ${panelClassName}` : ""}`}
      >
        <ModalHeader
          lang={lang}
          title={title}
          onClose={onClose}
          dragHandleProps={dragHandleProps}
          headerExtra={<ModalFieldControls modalId={modalId} lang={lang} />}
          onResetLayout={() => {
            onDragReset();
            sizeReset();
          }}
        />

        <form onSubmit={onSubmit} className={formClassName}>
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
          <Button
            variant="destructive"
            size="sm"
            onClick={async () => {
              if (deleteConfirmKey) {
                if (await confirm({ message: t(lang, deleteConfirmKey) })) onDelete();
              } else {
                onDelete();
              }
            }}
            disabled={deleteDisabled}
            aria-label={deleteAriaLabelKey ? t(lang, deleteAriaLabelKey) : undefined}
          >
            {t(lang, deleteLabelKey ?? "delete")}
          </Button>
        )}
        {middle}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel}>
          {t(lang, "cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={saveDisabled}>
          {t(lang, saveLabelKey)}
        </Button>
      </div>
    </footer>
  );
}
