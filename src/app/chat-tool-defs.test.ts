import { describe, it, expect } from "vitest";
import { TOOL_DEFS } from "./chat-tool-defs";

/** The `roleId` property as the model actually receives it.
 *
 *  ★ `resourceFields` is NOT exported — it is a private helper spread into both
 *    `create_resource` and `update_resource`. Reading it through the SHIPPED
 *    `TOOL_DEFS` is deliberate: it is the object the API is handed, so a future
 *    refactor that stops routing a tool through the helper cannot leave this
 *    test passing against a description no model ever sees.
 */
const roleIdDescription = (toolName: string): string =>
  (
    TOOL_DEFS.find((def) => def.name === toolName)!.input_schema as unknown as {
      properties: { roleId: { description: string } };
    }
  ).properties.roleId.description;

// ★★★ WHY THIS IS PINNED. `Resource` has no discipline, grade or rate field —
//  `roleId` is a plain `FK -> Role.id` (`types.ts`), and discipline, grade and
//  both rates are properties of `Role` resolved when a resource is READ. The
//  description used to read "Rate-card role id (assigns the resource's
//  discipline + grade + rates)", which told the model that setting this field
//  writes rate data onto the person. The risk is not a broken writer: it is a
//  model choosing `roleId` to achieve something it cannot achieve, and then
//  reporting the rates as changed (open-followups 402).
describe("the resource roleId schema description", () => {
  // Both resource tools spread the same private `resourceFields` helper today.
  // Checking both means a split that fixes one and not the other is caught.
  for (const toolName of ["create_resource", "update_resource"]) {
    it(`describes roleId on ${toolName} as a link, not as a write of rate data`, () => {
      const desc = roleIdDescription(toolName);

      // RETIRED CLAIM — the exact promise the old text made.
      expect(desc).not.toMatch(/assigns the resource/i);

      // ★★ The POSITIVE halves are what make the absence check above
      //    non-vacuous: on its own it passes against a description that says
      //    nothing at all, or against no description whatsoever.
      //
      // ★ NOTE the assertions deliberately do NOT forbid the WORD "rates".
      //   A correct description has to name discipline, grade and rates in
      //   order to DENY writing them; a bare `not.toMatch(/rates/i)` would
      //   force a vaguer, worse wording than the one it is guarding.
      expect(desc).toMatch(/links the resource/i);
      expect(desc).toMatch(/resolved when read/i);
      expect(desc).toMatch(/writes none of them/i);
    });
  }
});
