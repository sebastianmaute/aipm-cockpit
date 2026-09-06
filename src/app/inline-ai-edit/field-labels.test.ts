import { describe, it, expect } from "vitest";
import { fieldLabel, linkLabel, FIELD_LABEL_KEY } from "./field-labels";
import { INLINE_DESCRIPTORS } from "./entity-descriptor";
import { loadI18n, t } from "../i18n";

describe("fieldLabel", () => {
  // ★★★ THE COUNT IS RE-DERIVED, NOT INHERITED. The slice plan asserted 68 from
  // "58 diffFields + 8 links + emails + lastUpdateDate", and that arithmetic no
  // longer describes the code — `emails` and `lastUpdateDate` are now IN
  // `diffFields`, so today it is 60 diffFields + 8 linkFields. The total happens
  // to still be 68, which is exactly how a stale count survives a rename.
  // Re-derive (prints a per-entity split and the total):
  //   node -e "const s=require('fs').readFileSync('src/app/inline-ai-edit/entity-descriptor.ts','utf8')" # …or, authoritatively:
  //   npx vitest run src/app/inline-ai-edit/field-labels.test.ts   ← the loop below IS the derivation
  // This constant is only the VACUITY GUARD: without it an empty
  // FIELD_LABEL_KEY next to an empty descriptor map registers zero assertions
  // and reports green.
  const PREVIEWABLE_FIELD_COUNT = 68;

  it("covers every previewable field of every entity", () => {
    // A missing entry is not a crash — it falls back to the raw property name —
    // so only an enumeration catches it.
    let checked = 0;
    for (const d of Object.values(INLINE_DESCRIPTORS)) {
      for (const f of [...d.diffFields, ...Object.keys(d.linkFields)]) {
        expect(FIELD_LABEL_KEY[`${d.entity}.${f}`], `${d.entity}.${f}`).toBeDefined();
        checked += 1;
      }
    }
    expect(checked).toBe(PREVIEWABLE_FIELD_COUNT);
  });

  it("names a real translation key for every entry", () => {
    // The map is typed `Record<string, TranslationKey>`, so tsc rejects a key
    // that does not exist. This asserts the half the TYPE cannot: that the key
    // resolves to a usable non-empty EN string. `t` returns `undefined` for a
    // key absent from both dictionaries, so this also catches a cast.
    for (const [qualified, key] of Object.entries(FIELD_LABEL_KEY)) {
      const label: string | undefined = t("en-US", key);
      expect(typeof label, qualified).toBe("string");
      expect((label ?? "").trim(), qualified).not.toBe("");
    }
  });

  it("falls back to the raw field name, never to blank", () => {
    // A blank label on an approval card is strictly worse than a property name.
    expect(fieldLabel("en-US", "task", "somethingNew")).toBe("somethingNew");
  });

  it("falls back to the raw field name for an entity it does not know", () => {
    // The chat card resolves its entity from the tool name, and a tool with no
    // `INLINE_DESCRIPTORS` entity (every `*_document` tool) yields `undefined`.
    expect(fieldLabel("en-US", undefined, "linkedTaskIds")).toBe("linkedTaskIds");
  });

  it("translates a known field", () => {
    expect(fieldLabel("en-US", "task", "taskName")).toBe("Task name");
  });

  it("keys the label on the ENTITY, not the field name alone", () => {
    // ★★ The qualifier earns its keep: `title` is a job title on a resource and
    // a person's role on a stakeholder, reached through different form keys. A
    // bare field-name map would collapse them onto one string.
    expect(fieldLabel("en-US", "resource", "title")).toBe("Title");
    expect(fieldLabel("en-US", "stakeholder", "title")).toBe("Title / role");
  });

  it("translates into German", async () => {
    // The DE dictionary is lazy — a DE assertion without this loads nothing and
    // silently reads the EN fallback, which passes for the wrong reason.
    await loadI18n("de");
    // Asserted as DIFFERENT FROM EN, not as equal to `t(de, key)` — the latter
    // is the same lookup this function performs and would pass with the DE
    // dictionary never loaded.
    expect(fieldLabel("de", "task", "taskName")).not.toBe(fieldLabel("en-US", "task", "taskName"));
    // One of the three MINTED keys, so a DE gap in the new strings is caught
    // here rather than only by the EN/DE parity typecheck.
    expect(fieldLabel("de", "raid", "closedDate")).not.toBe(
      fieldLabel("en-US", "raid", "closedDate"),
    );
    expect(fieldLabel("de", "raid", "closedDate")).toBe(t("de", "fieldClosedDate"));
    // …and the fallback is the raw name in DE too, never a blank.
    expect(fieldLabel("de", "task", "somethingNew")).toBe("somethingNew");
  });

  // §406 — `set_task_dependencies` has no create/update/delete triple, so it is
  // absent from `TOOL_ENTITY` and the card renders its rows with `entity`
  // undefined. That branch used to return the raw name unconditionally, so the
  // one field that reaches a preview ONLY on such a row could never translate.
  it("translates an entity-less field that no descriptor can qualify", async () => {
    await loadI18n("de");
    // Both directions: the EN value is not the raw property name either, so a
    // fix that only reached DE (or only EN) fails here.
    expect(fieldLabel("en-US", undefined, "dependencies")).toBe(t("en-US", "dependencies"));
    expect(fieldLabel("de", undefined, "dependencies")).toBe(t("de", "dependencies"));
    expect(fieldLabel("de", undefined, "dependencies")).not.toBe("dependencies");
    // The narrowness IS the design: an unlisted entity-less field still falls
    // back to its raw name, and the entity-qualified path is untouched.
    expect(fieldLabel("de", undefined, "someDocField")).toBe("someDocField");
  });
});

describe("linkLabel", () => {
  // Composed here rather than at the three preview surfaces so the subject and
  // the translated field name cannot drift apart, and so a subject cannot be
  // silently dropped by whichever surface forgot to render it.
  it("prefixes the subject with an en dash and translates the field", async () => {
    await loadI18n("de");
    expect(linkLabel("de", undefined, { field: "dependencies", subject: "Kickoff" })).toBe(
      `Kickoff – ${t("de", "dependencies")}`,
    );
  });

  // Every diff the descriptor engine produces is this shape — `describeEntityCalls`
  // and the two producers that delegate to it never set a subject; only the
  // hand-written dependency describer does — so the no-subject render must stay
  // byte-identical to `fieldLabel`, not merely similar.
  it("renders exactly the field label when there is no subject", () => {
    expect(linkLabel("en-US", "raid", { field: "linkedTaskIds" })).toBe(
      fieldLabel("en-US", "raid", "linkedTaskIds"),
    );
    expect(linkLabel("en-US", "raid", { field: "linkedTaskIds" })).toBe("Linked tasks");
  });
});
