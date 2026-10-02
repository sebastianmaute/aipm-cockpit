import { type Lang, t } from "./i18n";
import { isWriterConflictReason } from "./document-ops";

/** The refusal banner's user-facing text (§186): every concurrent-writer
 *  reason collapses into ONE translated sentence — several ops refused for the
 *  same cause would otherwise repeat it — in the position of the first one;
 *  any other engine reason passes through untouched. */
export function displayRejected(lang: Lang, rejected: readonly string[]): string[] {
  const out: string[] = [];
  let conflictShown = false;
  for (const reason of rejected) {
    if (!isWriterConflictReason(reason)) {
      out.push(reason);
    } else if (!conflictShown) {
      conflictShown = true;
      out.push(t(lang, "documentsBlockConflictNotSaved"));
    }
  }
  return out;
}
