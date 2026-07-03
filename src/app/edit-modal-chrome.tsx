/**
 * Shared chrome for the entity edit modals (change / raid / stakeholder).
 *
 * Each modal repeated these three blocks verbatim; extracting them removes the
 * top cross-file jscpd clones (TD-6). Presentational only — every value +
 * handler is a prop; the callers keep their own visibility gates and divergent
 * pieces (raid's border-less footer with an InfoTooltip stays bespoke).
 */
import { type Lang, t, type TranslationKey } from "./i18n";
import { INTERACTIVE, FOCUS_RING, TRANSITION } from "./interaction-styles";

interface ModalFieldErrorProps {
  error: string;
}

/**
 * The inline validation-error banner shown in a modal form grid. Caller guards
 * on `error` being non-empty (`{error && <ModalFieldError error={error} />}`).
 */
export function ModalFieldError({ error }: ModalFieldErrorProps) {
  return (
    <p
      role="alert"
      className="rounded-md bg-AIPM-pink/10 px-3 py-2 text-sm text-AIPM-pink-strong dark:bg-AIPM-pink/15 sm:col-span-2"
    >
      {error}
    </p>
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
              <input
                type="checkbox"
                checked={selectedIds.includes(sh.id)}
                onChange={() => onToggle(sh.id)}
                aria-label={sh.name}
                className={`accent-AIPM-green ${FOCUS_RING} ${TRANSITION}`}
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
  /** Delete button: native `window.confirm` gate, then `onDelete`. */
  onDelete: () => void;
  deleteConfirmKey: TranslationKey;
  deleteLabelKey: TranslationKey;
  /** Row-unique accessible name where the visible label collides (a11y). */
  deleteAriaLabelKey?: TranslationKey;
  /** New item can't be deleted. */
  deleteDisabled: boolean;
  onCancel: () => void;
  saveDisabled: boolean;
  saveLabelKey: TranslationKey;
}

/**
 * The bordered footer with a destructive delete on the left and cancel + submit
 * on the right (change + stakeholder edit modals). The submit is a native
 * `type="submit"` — the caller's `<form onSubmit>` handles it.
 */
export function ModalEditFooter({
  lang,
  onDelete,
  deleteConfirmKey,
  deleteLabelKey,
  deleteAriaLabelKey,
  deleteDisabled,
  onCancel,
  saveDisabled,
  saveLabelKey,
}: ModalEditFooterProps) {
  return (
    <footer className="flex items-center justify-between gap-2 border-t border-line pt-3 sm:col-span-2">
      <div>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(t(lang, deleteConfirmKey))) onDelete();
          }}
          disabled={deleteDisabled}
          aria-label={deleteAriaLabelKey ? t(lang, deleteAriaLabelKey) : undefined}
          className={`rounded-md border border-AIPM-pink/40 bg-surface px-3 py-1.5 text-sm font-medium text-AIPM-pink-strong hover:bg-AIPM-pink/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-AIPM-pink/50 ${INTERACTIVE}`}
        >
          {t(lang, deleteLabelKey)}
        </button>
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
