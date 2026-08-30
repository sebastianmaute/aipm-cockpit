// The single display rule for a `ContactPerson`: the name, plus the address in
// angle brackets ONLY when there is one.
//
// ★★ It exists because the exporter and the project form had drifted. The form
//    guarded on the address and `export-sections.ts` did not, so a contact with
//    no email rendered as "Bob Jones" on screen and exported as "Bob Jones <>".
//    `email` is REQUIRED on `ContactPerson` and holds "" when unset, and the Add
//    path ACCEPTS a blank one — `addDraft` in `project-form-fields.tsx` returns
//    early on a missing or duplicate NAME and never looks at the address — so
//    the empty case is ORDINARY, not degenerate.
//    See docs/open-followups.md 283.
//
// ★★★ THE REASON ABOVE USED TO READ "and the Add path does not ask for one",
//    which is FALSE: `ContactPersonsControl` renders a dedicated email input in
//    the add row. The CONCLUSION survived the wrong premise, which is the worst
//    shape a justification can have — it reads as verified, and the next reader
//    who deletes that input finds this comment agreeing with them. Measured
//    2026-08-30, and cheap to re-check:
//      grep -n "draft.email" src/app/project-form-fields.tsx
//    prints three lines, one of them a `value={draft.email}` on an
//    `<input type="email">`; and
//      grep -n "if (!name || hasName(name)) return;" src/app/project-form-fields.tsx
//    is the whole of that path's validation — name only.
//
// ★ Deliberately NOT in `contacts.ts`: that module is a different concept (the
//   localStorage address book of assignee-to-email pairs) and it imports
//   `device-store`, which would drag localStorage into `export-sections.ts`'s
//   pure model layer.
import type { ContactPerson } from "./types";

export function contactDisplay(cp: Pick<ContactPerson, "name" | "email">): string {
  return `${cp.name}${cp.email ? ` <${cp.email}>` : ""}`;
}
