// The single display rule for a `ContactPerson`: the name, plus the address in
// angle brackets ONLY when there is one.
//
// ★★ It exists because the exporter and the project form had drifted. The form
//    guarded on the address and `export-sections.ts` did not, so a contact with
//    no email rendered as "Bob Jones" on screen and exported as "Bob Jones <>".
//    `email` is REQUIRED on `ContactPerson` and holds "" when unset, and the Add
//    path does not ask for one, so the empty case is ORDINARY, not degenerate.
//    See docs/open-followups.md 283.
//
// ★ Deliberately NOT in `contacts.ts`: that module is a different concept (the
//   localStorage address book of assignee-to-email pairs) and it imports
//   `device-store`, which would drag localStorage into `export-sections.ts`'s
//   pure model layer.
import type { ContactPerson } from "./types";

export function contactDisplay(cp: Pick<ContactPerson, "name" | "email">): string {
  return `${cp.name}${cp.email ? ` <${cp.email}>` : ""}`;
}
