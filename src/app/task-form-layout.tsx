"use client";

// Layout primitives for the task form: the numbered section wrapper and the
// per-field caption wrapper. Extracted from `task-form-fields.tsx` when adding
// `Field`'s `group` mode pushed that file past the 800-line ratchet — these two
// are pure presentational scaffolding with no task-form state, so they are the
// natural seam. ★ Nothing outside `task-form-fields.tsx` ever imported either
// symbol (checked across src/e2e/scripts), so the move needed no re-export and
// there is none: importing `Field` from `./task-form-fields` is a type error.
import { FieldGroup, HintedLabel } from "./form-controls";
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
// ★★ A `hint` MUST NOT sit inside the binding `<label>` (open-followups §386).
// A label's text CONTENT is its control's accessible name, so a tooltip trigger
// inside it concatenates onto the caption — testing-library computed "Groupi"
// for "Group". With a hint, the `<label>` is therefore `display: contents` and
// the `InfoTooltip` is its SIBLING: the wrapper is the flex row, and `order`
// puts the trigger back beside the caption text visually (measured in Chromium:
// the textbox is named "Group*", the trigger shares the caption's line, the
// control wraps below). The trigger stays focusable and its own `aria-label` is
// the hint — that is how the hint reaches AT. It is NOT wired to the control via
// `aria-describedby`: `Field` does not own the child element, and cloning it or
// mutating it imperatively was judged more fragile than the sibling.
// ★ `group` mode needs none of this — `FieldGroup`'s `aria-label` outranks its
// content, so a hint inside its caption never reached the group's name.
// ★ No `preventDefault` wrapper: the trigger is outside the label, and
// `InfoTooltip`'s own click handler already calls it. See src/test/label-binding.ts.
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
  const requiredMark = required && <span className="ml-0.5 text-ui-pink-strong">*</span>;
  if (group || captionAction) {
    const caption = (
      <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
        {label}
        {requiredMark}
        {hint && <InfoTooltip text={hint} />}
        {captionAction && <span className="ml-auto inline-flex">{captionAction}</span>}
      </span>
    );
    return (
      <FieldGroup name={label} caption={caption} className={`block ${className ?? ""}`}>
        {children}
      </FieldGroup>
    );
  }
  if (hint) {
    return (
      <HintedLabel
        hint={<InfoTooltip text={hint} />}
        caption={
          <span className="flex items-center gap-1 text-sm font-medium text-foreground">
            {label}
            {requiredMark}
          </span>
        }
        className={className}
      >
        {children}
      </HintedLabel>
    );
  }
  const caption = (
    <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
      {label}
      {requiredMark}
    </span>
  );
  return (
    <label className={`block ${className ?? ""}`}>
      {caption}
      {children}
    </label>
  );
}
