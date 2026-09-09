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
  // ★★ 68 → 84 when `absence` (6 diffFields + 1 linkField) and `calendarEvent`
  // (8 + 1) joined the union. Re-derived by running this test, not by adding 16
  // to the old number — which is how the "58 + 8 + 2" arithmetic above went
  // stale while still summing to the right total.
  // ★★ 84 → 83 when `change.decisionDate` was WITHDRAWN from that entity's
  // `diffFields`, and this guard is what noticed: the field is DERIVED
  // (`applyChangeStatus` owns the `status`/`decisionDate` pair for every
  // TRANSITION in the app — the Outlook two-way pull writes the date alone, so
  // the field itself is not exclusively owned; the modal
  // renders it read-only), so the model supplies its VALUE on no surface and
  // the preview must not offer a diff row for it. ★★ Three guards make that
  // true, not this removal: `CHANGE_FIELD_GUARDS.decisionDate` (`() => false`)
  // on both `dropUnacceptedChangeFields` call sites, its absence from
  // `changeFields`, and `SEED_OFFERED_KEYS` on the `propose_project` seed. The
  // model can still CAUSE a write by choosing `status` — `applyChangeStatus`
  // then stamps the clock's date — which is derivation, not authoring.
  // A DELIBERATE removal, not drift
  // — the direction that matters is that the number went DOWN, which is the
  // one event worth a human look. Re-derived by running this file, not by
  // subtracting one.
  // ★ `FIELD_LABEL_KEY["change.decisionDate"]` is deliberately LEFT in place:
  // the FIRST loop below is one-directional (every previewable field needs a
  // label, never the reverse), the label names a real translated field the
  // change modal still renders, and `fieldLabel` is a lookup with a raw-name
  // fallback — so removing it would only make a future re-offer render
  // `decisionDate` as a property name.
  // ★★ IT IS NOT AN UNUSED ENTRY, which is what this said until 2026-09-09.
  // "names a real translation key for every entry" below iterates
  // `Object.entries(FIELD_LABEL_KEY)` and asserts THIS entry resolves to a
  // non-empty EN string, so it is exercised on every run and deleting
  // `changeFieldDecisionDate` from the dictionary turns that test red. Only the
  // COUNT loop stopped seeing it.
  const PREVIEWABLE_FIELD_COUNT = 83;

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

  // Task 3 (absence + calendarEvent field labels) landed BEFORE `calendarEvent`
  // was an `InlineEntity`, so `fieldLabel`'s typed `entity` parameter could not
  // take that literal and this asserted directly against the map + `t()`. An
  // EN-only check cannot prove the entry is wired: if the English string
  // happened to equal the raw field name it would pass whether or not
  // `FIELD_LABEL_KEY` carried it, via the raw-name fallback.
  it("labels a calendarEvent field key in German", async () => {
    await loadI18n("de");
    const key = FIELD_LABEL_KEY["calendarEvent.durationMinutes"];
    expect(key).toBeDefined();
    const de = t("de", key);
    const en = t("en-US", key);
    expect(de).not.toBe(en);
    expect(de).not.toBe("durationMinutes");
  });

  // ★★★ THE SAME CLAIM THROUGH THE PRODUCTION FUNCTION, and it is NOT redundant
  //  with the test above. That one reads `FIELD_LABEL_KEY` itself, so it proves
  //  the MAP has the entry and says nothing about `keyedFieldLabel`'s
  //  composition — the `${entity}.${field}` join, the lookup, and the raw-name
  //  fallback. Now that `calendarEvent` and `absence` are real `InlineEntity`
  //  members the typed call site compiles, so the composition can be exercised.
  //  ★ Asserted as NOT the raw field name in BOTH languages: a broken join
  //  falls through to the fallback, which returns exactly that.
  it("routes a new entity's field through fieldLabel, not just the map", async () => {
    await loadI18n("de");
    expect(fieldLabel("en-US", "calendarEvent", "durationMinutes")).toBe(
      t("en-US", FIELD_LABEL_KEY["calendarEvent.durationMinutes"]),
    );
    expect(fieldLabel("en-US", "calendarEvent", "durationMinutes")).not.toBe("durationMinutes");
    expect(fieldLabel("de", "absence", "note")).toBe(t("de", FIELD_LABEL_KEY["absence.note"]));
    expect(fieldLabel("de", "absence", "note")).not.toBe("note");
    // The fallback still holds for a field neither entity declares.
    expect(fieldLabel("en-US", "calendarEvent", "somethingNew")).toBe("somethingNew");
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

  // Every `target: "row"` diff is this shape, so the no-subject render must stay
  // byte-identical to `fieldLabel`, not merely similar.
  // ★★ TWO PRODUCERS SET A SUBJECT, not one, and this comment said "only the
  //  hand-written dependency describer does" until §420 landed a second: the
  //  `target: "create"` branch of `pushLinkDiffs` (`plan.ts`) sets it from the
  //  created item's own title, because that row does not exist yet. So
  //  "`describeEntityCalls` never sets a subject" is now FALSE — it is false
  //  only on the create branch, and true for every `"row"` diff, which is the
  //  half this test needs. Stating it the old way made a reader who found the
  //  create branch distrust the test rather than the comment.
  it("renders exactly the field label when there is no subject", () => {
    expect(linkLabel("en-US", "raid", { field: "linkedTaskIds" })).toBe(
      fieldLabel("en-US", "raid", "linkedTaskIds"),
    );
    expect(linkLabel("en-US", "raid", { field: "linkedTaskIds" })).toBe("Linked tasks");
  });
});
