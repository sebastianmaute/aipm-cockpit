"use client";

// Layout primitive for the task form: the numbered section wrapper. Extracted from
// `task-form-fields.tsx` when that file passed the 800-line ratchet. The per-field
// caption wrapper `Field` that lived here too is now `form-field.tsx`, shared with
// the project form (open-followups §7, A1).

// One titled, numbered section of the task form. Owns its own two-column grid so
// fields with `sm:col-span-2` keep spanning. Heading uses the dark-blue token.
export function TaskFormSection({
  index,
  title,
  children,
}: {
  index: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-3 border-b border-line pb-2 text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">
        {index}. {title}
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}
