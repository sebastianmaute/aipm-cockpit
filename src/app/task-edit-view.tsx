"use client";

import { type Lang, t } from "./i18n";
import { TaskFormFields, type TaskFormFieldsProps } from "./task-form-fields";

/** Stable id shared by the edit-view <form> and the top-bar Save button so the
 *  button can submit the form via the HTML `form=` association. */
export const TASK_EDIT_FORM_ID = "task-edit-form";

export interface TaskEditViewProps extends TaskFormFieldsProps {
  lang: Lang;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
}

export function TaskEditView({ onSubmit, ...fieldProps }: TaskEditViewProps) {
  const { lang } = fieldProps;
  return (
    <div className="mx-auto w-full max-w-5xl">
      <section className="rounded-lg border border-line bg-surface">
        <h2 className="border-b border-line px-6 py-4 text-base font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
          1. {t(lang, "taskEditDetailsHeading")}
        </h2>
        <form
          id={TASK_EDIT_FORM_ID}
          onSubmit={onSubmit}
          className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2"
        >
          <TaskFormFields {...fieldProps} />
        </form>
      </section>
    </div>
  );
}
