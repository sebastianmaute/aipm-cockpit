"use client";

import type React from "react";
import { type Lang, t } from "./i18n";
import { INTERACTIVE } from "./interaction-styles";
import { ModalFieldControls } from "./modal-field-controls";
import { TaskFormFields, type TaskFormFieldsProps } from "./task-form-fields";

/** Stable id shared by the edit-view <form> and the top-bar Save button so the
 *  button can submit the form via the HTML `form=` association. */
export const TASK_EDIT_FORM_ID = "task-edit-form";

export interface TaskEditViewProps extends TaskFormFieldsProps {
  lang: Lang;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  footer?: React.ReactNode;
  /** Destructive action (Delete button) rendered on the left of the footer. */
  footerLeading?: React.ReactNode;
  /** Heading shown top-left of the control bar (e.g. "Edit task" / "New task").
   *  Optional so existing render tests need not supply it. */
  heading?: string;
  /** Dismiss handler for the ✕ close button rendered beside the field cog. When
   *  omitted, no close button is shown. */
  onClose?: () => void;
}

export function TaskEditView({ onSubmit, footer, footerLeading, heading, onClose, ...fieldProps }: TaskEditViewProps) {
  const { lang } = fieldProps;
  return (
    <div className="mx-auto w-full max-w-5xl">
      <section className="rounded-lg border border-line bg-surface">
        <form id={TASK_EDIT_FORM_ID} onSubmit={onSubmit} className="space-y-6 p-6">
          <div className="flex items-center justify-between gap-4 border-b border-line pb-3">
            {heading ? (
              <h2 className="truncate text-lg font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{heading}</h2>
            ) : (
              <span aria-hidden />
            )}
            <div className="flex items-center gap-2">
              <ModalFieldControls modalId="task" lang={lang} />
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={t(lang, "alertModalClose")}
                  title={t(lang, "alertModalClose")}
                  className={`cursor-pointer rounded-md p-2 text-muted-foreground hover:bg-surface-muted hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey ${INTERACTIVE}`}
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
                    <path
                      fillRule="evenodd"
                      d="M4.28 4.28a.75.75 0 011.06 0L10 8.94l4.66-4.66a.75.75 0 111.06 1.06L11.06 10l4.66 4.66a.75.75 0 11-1.06 1.06L10 11.06l-4.66 4.66a.75.75 0 01-1.06-1.06L8.94 10 4.28 5.34a.75.75 0 010-1.06z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              )}
            </div>
          </div>
          <TaskFormFields {...fieldProps} />
          {(footer || footerLeading) && (
            <div className="flex items-center justify-between gap-2 border-t border-line pt-4">
              <div>{footerLeading}</div>
              <div className="flex items-center gap-2">{footer}</div>
            </div>
          )}
        </form>
      </section>
    </div>
  );
}
