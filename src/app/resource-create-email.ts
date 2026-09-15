// src/app/resource-create-email.ts
//
// The email a ResourcePicker "+ Add" stores on the person it creates. The
// picker carries over whatever the host field holds, and a resource's stored
// email is then an exempt COPY SOURCE in every linked editor (RAID owner,
// shift, task, stakeholder) — so an unsafe carried-over value must not be
// stored here, or it would be laundered into those records as a "copy".
import { emailWriteRefusal, sanitizeLoadedEmail } from "./sanitize-core";

/** The typed email judged as the value that would be STORED
 *  (`sanitizeLoadedEmail`: unwrap `Name <addr>`, then trim + EMAIL_MAX cap — what
 *  `sanitizeResource` stores for every AI write and load, M-C4) with the write
 *  rule and no stored value. A blank or refused value yields undefined: the
 *  resource is created WITHOUT an email, and the host editor's own field still
 *  refuses the typed value on save. */
export function creatableResourceEmail(typed: string): string | undefined {
  const value = sanitizeLoadedEmail(typed);
  return value !== "" && emailWriteRefusal(value, undefined) === null ? value : undefined;
}
