"use client";

import type React from "react";
import { type Lang } from "./i18n";
import { TaskFormFields, type TaskFormFieldsProps } from "./task-form-fields";

/** Stable id shared by the edit-view <form> and the top-bar Save button so the
 *  button can submit the form via the HTML `form=` association. */
export const TASK_EDIT_FORM_ID = "task-edit-form";

export interface TaskEditViewProps extends TaskFormFieldsProps {
  lang: Lang;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  footer?: React.ReactNode;
}

export function TaskEditView({ onSubmit, footer, ...fieldProps }: TaskEditViewProps) {
  return (
    <div className="mx-auto w-full max-w-5xl">
      <section className="rounded-lg border border-line bg-surface">
        <form id={TASK_EDIT_FORM_ID} onSubmit={onSubmit} className="space-y-6 p-6">
          <TaskFormFields {...fieldProps} />
          {footer && <div className="flex justify-end gap-2 border-t border-line pt-4">{footer}</div>}
        </form>
      </section>
    </div>
  );
}
