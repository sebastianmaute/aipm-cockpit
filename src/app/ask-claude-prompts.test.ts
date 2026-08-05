import { describe, it, expect, beforeAll } from "vitest";
import {
  promptsForView,
  FOUNDATIONAL_PROMPTS,
  CHAT_ONLY_PROMPTS,
  ASK_CLAUDE_PROMPTS,
  type PromptDef,
} from "./ask-claude-prompts";
import { t, loadI18n } from "./i18n";
import { VIEW_AI_SCOPE } from "./view-ai-scope";
import { VIEW_AI_DIGEST } from "./view-ai-digest";
import type { AppView } from "./nav-config";

describe("ask-claude-prompts", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  it("returns view-specific on-page prompts plus the foundational general set", () => {
    const { onPage, general } = promptsForView("raid");
    expect(general).toEqual(FOUNDATIONAL_PROMPTS);
    expect(onPage.length).toBeGreaterThan(0);
    expect(onPage).toEqual(ASK_CLAUDE_PROMPTS.raid);
  });

  it("falls back to foundational-only for a view with no curated set", () => {
    const { onPage, general } = promptsForView("settings");
    expect(onPage).toEqual([]);
    expect(general).toEqual(FOUNDATIONAL_PROMPTS);
  });

  // The header menu has no attach affordance, so a prompt that asks Claude to
  // read an attachment is dead there. Chat can attach, so the prompt lives on
  // as a chat-only chip rather than being deleted outright.
  it("omits the attachment prompt from the menu's general set", () => {
    const { general } = promptsForView("settings");
    expect(general.some((p) => p.labelKey === "aiPromptProcessAttachmentLabel")).toBe(false);
  });

  it("keeps the attachment prompt for the chat surface", () => {
    expect(CHAT_ONLY_PROMPTS.some((p) => p.labelKey === "aiPromptProcessAttachmentLabel")).toBe(true);
  });

  it("offers on-page prompts for every view that has the tools to answer them", () => {
    const expected = [
      "actions", "budget", "budget-report", "calendar", "change-report", "changes",
      "dashboard", "directory", "gantt", "insights", "knowledge", "manage-roles",
      "milestones", "open-points", "planning", "portfolio-health", "raci", "raid",
      "raid-report", "reports", "resources", "stakeholder-map", "stakeholders",
      "steering-committee", "trends", "workload",
    ];
    expect(Object.keys(ASK_CLAUDE_PROMPTS).sort()).toEqual(expected);
  });

  // Dead prompts are the failure this feature exists to remove: a chip that
  // asks a question no tool can answer.
  it("has no chips for the views whose read tools are deferred", () => {
    expect(ASK_CLAUDE_PROMPTS.timelog).toBeUndefined();
    expect(ASK_CLAUDE_PROMPTS.activity).toBeUndefined();
  });

  it("every chipped view has tool hints or a digest behind it", () => {
    for (const view of Object.keys(ASK_CLAUDE_PROMPTS) as AppView[]) {
      const hasHints = (VIEW_AI_SCOPE[view].toolHints ?? []).length > 0;
      const hasDigest = VIEW_AI_DIGEST[view] !== undefined;
      expect(hasHints || hasDigest, `${view} has chips but no capability`).toBe(true);
    }
  });

  it("every label/body key resolves in EN and DE (no missing keys)", () => {
    const all: PromptDef[] = [
      ...FOUNDATIONAL_PROMPTS,
      ...CHAT_ONLY_PROMPTS,
      ...Object.values(ASK_CLAUDE_PROMPTS).flat().filter(Boolean) as PromptDef[],
    ];
    for (const def of all) {
      for (const lang of ["en-US", "de"] as const) {
        const label = t(lang, def.labelKey);
        const body = t(lang, def.bodyKey);
        expect(label).toBeTruthy();
        expect(label).not.toBe(def.labelKey);
        expect(body).toBeTruthy();
        expect(body).not.toBe(def.bodyKey);
      }
    }
  });
});
