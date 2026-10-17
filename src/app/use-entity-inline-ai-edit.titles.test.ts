// §715 D4 — the inline Ask Claude popover names what it edits: a milestone's popover says "milestone",
// not "task". One title per entity, because German needs the article that goes with each noun.
import { beforeAll, describe, expect, it } from "vitest";
import { loadI18n, t } from "./i18n";
import { INLINE_EDIT_TITLE_KEY } from "./use-entity-inline-ai-edit";

// The entities the app opens the popover on today (workspace-section.tsx), each with its own label.
const SURFACED = { raid: "RAID item", change: "change request", milestone: "milestone", stakeholder: "stakeholder" } as const;

describe("the inline Ask Claude popover title (§715 D4)", () => {
  beforeAll(async () => { await loadI18n("de"); });

  it("names the entity in English", () => {
    for (const [entity, noun] of Object.entries(SURFACED)) {
      expect(t("en-US", INLINE_EDIT_TITLE_KEY[entity as keyof typeof SURFACED]), entity).toBe(`Ask Claude to edit this ${noun}`);
    }
  });

  it("gives every entity its own German title, none of them the task's", () => {
    const task = t("de", "inlineAiEditTitle");
    const titles = Object.values(INLINE_EDIT_TITLE_KEY).map((k) => t("de", k));
    expect(titles.filter((s) => s !== task && /bearbeiten/.test(s))).toHaveLength(titles.length - 1);
    expect(new Set(titles).size, "no two entities share a German title").toBe(titles.length);
    expect(t("de", INLINE_EDIT_TITLE_KEY.milestone)).toBe("Claude bitten, diesen Meilenstein zu bearbeiten");
  });

  it("keeps the task's title for a task", () => {
    expect(INLINE_EDIT_TITLE_KEY.task).toBe("inlineAiEditTitle");
  });
});
