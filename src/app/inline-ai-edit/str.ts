/** The ONE preview projection of an arbitrary tool-input value to the string the
 *  card renders.
 *
 *  ★★★ IT LIVES IN ITS OWN LEAF MODULE BECAUSE THE OBVIOUS HOMES BOTH FAIL.
 *  `plan.ts` imports `entity-descriptor.ts`, so putting it in `plan.ts` and
 *  importing it back would close a cycle; putting it in `entity-descriptor.ts`
 *  makes a descriptor concern out of a rendering one. It was two copies —
 *  `function str` in `plan.ts` and `const str` in `entity-descriptor.ts` — with
 *  a comment explaining why it was not an import (open-followups §400).
 *
 *  ★★ THE `[]` CASE IS LOAD-BEARING AND IS NOT INCIDENTAL. `rendersAsClear` in
 *  `sanitize-records.ts` treats `null`, `undefined`, `""` and `[]` alike
 *  BECAUSE this function renders all four as "", and the card therefore
 *  discloses all four as a clear. Changing this projection silently changes
 *  which model inputs the merge-site guards accept. */
export function str(v: unknown): string {
  return v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v);
}
