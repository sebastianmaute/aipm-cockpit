"use client";

// Layout primitives for the task form: the numbered section wrapper and the
// per-field caption wrapper. Extracted from `task-form-fields.tsx` when adding
// `Field`'s `group` mode pushed that file past the 800-line ratchet — these two
// are pure presentational scaffolding with no task-form state, so they are the
// natural seam. ★ Nothing outside `task-form-fields.tsx` ever imported either
// symbol (checked across src/e2e/scripts), so the move needed no re-export and
// there is none: importing `Field` from `./task-form-fields` is a type error.
import { FieldGroup } from "./form-controls";
import { InfoTooltip } from "./info-tooltip";

// One titled, numbered section of the task form. Owns its own two-column grid so
// fields with `sm:col-span-2` keep spanning. Heading uses the AIPM dark-blue token.
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

// Field helper — moved verbatim from task-form-modal.tsx.
//
// ★★★ `group` IS NOT COSMETIC — pick it whenever the children's first labelable
// element is a BUTTON. A `<label>` with no `for` binds to its first LABELABLE
// descendant (button · input · meter · output · progress · select · textarea).
// A radiogroup `<div>`, a chip row and a contenteditable are all NOT labelable,
// so wrapping one in the default `<label>` silently binds the caption to a
// BUTTON inside it: hovering the caption paints that button's hover state, and
// clicking the caption ACTIVATES it. In this form that meant clicking "Priority"
// set Low, clicking "Labels" DELETED the first chip, and clicking "Health" set
// Auto. `group` renders a `<div role="group" aria-label>` instead, which names
// the block for assistive tech without making the caption a click target.
// ★ The `hint` tooltip below is wrapped in an `onClick` preventDefault. That is
// a DIFFERENT problem from mis-binding — it suppresses forwarding even when the
// binding is CORRECT — and it is REDUNDANT: `InfoTooltip`'s own trigger already
// calls `preventDefault` (`info-tooltip.tsx:52`), and the sibling `Field` in
// `project-form-fields.tsx` renders one inside its `<label>` branch with no
// wrapper and is not broken. Kept only because the span also carries layout
// (`inline-flex`); do not cite it as load-bearing. See src/test/label-binding.ts.
export function Field({
  label,
  required,
  hint,
  className,
  group,
  captionAction,
  children,
}: {
  label: string;
  required?: boolean;
  /** Optional explanatory tooltip shown via an InfoTooltip beside the label. */
  hint?: string;
  className?: string;
  /** Children's first labelable element is a button (or there is none) — render
   *  a named `role="group"` wrapper rather than a mis-binding `<label>`. */
  group?: boolean;
  /** A control rendered at the caption's trailing edge (the task-name dictation
   *  mic). PASSING THIS FORCES `group` MODE, and that is the whole point.
   *  The default branch wraps caption AND children in a `<label>`; a `<label>`
   *  with no `for` binds to its FIRST LABELABLE descendant; a button IS
   *  labelable — so a control in the caption would steal the click from the
   *  input and clicking "Task name" would start dictation. Forcing `group`
   *  makes that unreachable for every future caller rather than fixing it once
   *  at one call site.
   *  CONSEQUENCE: a named `role="group"` does NOT give its input an
   *  accessible name, so a consumer passing this MUST give its own control an
   *  explicit `aria-label`. An unlabeled form control is an axe-CRITICAL fail. */
  captionAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  const caption = (
    <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
      {label}
      {required && <span className="ml-0.5 text-ui-pink-strong">*</span>}
      {hint && (
        // preventDefault stops the wrapping <label> from also focusing/toggling
        // its control when the tooltip trigger is clicked.
        <span onClick={(e) => e.preventDefault()} className="inline-flex">
          <InfoTooltip text={hint} />
        </span>
      )}
      {captionAction && <span className="ml-auto inline-flex">{captionAction}</span>}
    </span>
  );
  if (group || captionAction) {
    return (
      <FieldGroup name={label} caption={caption} className={`block ${className ?? ""}`}>
        {children}
      </FieldGroup>
    );
  }
  return (
    <label className={`block ${className ?? ""}`}>
      {caption}
      {children}
    </label>
  );
}
