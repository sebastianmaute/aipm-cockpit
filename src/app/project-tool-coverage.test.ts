// §715 — every input `update_project` declares is either a field the card describes or excluded with a reason,
// and every described field has a translated label on the card.
import { describe, expect, it } from "vitest";
import { PROJECT_TOOL_DEFS } from "./chat-tool-defs-project";
import { fieldLabel } from "./inline-ai-edit/field-labels";
import { loadI18n } from "./i18n";
import { PROJECT_AI_FIELDS } from "./project-ai-fields";

/** Declared inputs the card does not describe as a field row, each with its reason. */
const EXCLUDED_INPUTS: Readonly<Record<string, string>> = {
  expectedToken: "The concurrency token is checked by the write, never shown as a field change.",
};

describe("update_project coverage", () => {
  it("every update_project input is described or excluded with a reason", () => {
    const def = PROJECT_TOOL_DEFS.find((t) => t.name === "update_project");
    const declared = Object.keys(def?.input_schema.properties ?? {});
    expect(declared.length).toBeGreaterThan(Object.keys(EXCLUDED_INPUTS).length);
    const described = declared.filter((k) => !(k in EXCLUDED_INPUTS));
    expect(described.sort()).toEqual([...PROJECT_AI_FIELDS].sort());
    for (const reason of Object.values(EXCLUDED_INPUTS)) expect(reason.length).toBeGreaterThan(0);
  });

  it("every project field has a translated card label in EN and DE", async () => {
    await loadI18n("de");
    for (const field of PROJECT_AI_FIELDS) {
      for (const lang of ["en-US", "de"] as const) {
        const label = fieldLabel(lang, "project", field);
        expect({ field, lang, raw: label === field || label === "" }).toEqual({ field, lang, raw: false });
      }
    }
  });
});
