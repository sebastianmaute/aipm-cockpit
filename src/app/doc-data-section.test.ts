// src/app/doc-data-section.test.ts
//
// Unit tests for the shared dataSection resolver. These moved out of
// doc-render-docx.test.ts when the resolver was extracted: they are about the
// registry lookup, not about WordprocessingML, and all three renderers depend
// on this contract. The DOCX tests that assert on document.xml stayed behind.

import { describe, it, expect, beforeAll } from "vitest";
import { resolveDataSection } from "./doc-data-section";
import { loadI18n, t } from "./i18n";
import type { Workspace } from "./workspace";

const empty = { tasks: [], raid: [] } as unknown as Workspace;

const populated = {
  // ★ The Task text field is `taskName`, NOT `title` (that is RaidItem). A
  // fixture using `title` yields a task whose name is "", so any assertion
  // that "A task" is absent passes without the code being right.
  tasks: [{ id: 9, taskName: "A task", status: "To Do" }],
  raid: [
    { id: 1, title: "Vendor delay", category: "Risk", status: "Open" },
    { id: 2, title: "Budget & scope <risk>", category: "Risk", status: "Open" },
  ],
} as unknown as Workspace;

describe("resolveDataSection", () => {
  beforeAll(async () => {
    // The DE dictionary is lazy; asserting German output without this reads
    // back the English string and the assertion passes for the wrong reason.
    await loadI18n("de");
  });

  it("resolves a populated register through the real registry", () => {
    const section = resolveDataSection("raid", populated, "en-US");
    expect(section).not.toBeNull();
    expect(section!.key).toBe("raid");
    expect(section!.columns.length).toBeGreaterThan(0);
    // One row per entity — the registry's projection, not a reshaped copy.
    expect(section!.rows).toHaveLength(2);
    expect(section!.rows.flat()).toContain("Vendor delay");
  });

  it("returns null for an empty register", () => {
    // The common case in a fresh project. Callers render nothing for null; if
    // this returned an empty section instead, every generated document would
    // grow a stray heading and an empty table.
    expect(resolveDataSection("raid", empty, "en-US")).toBeNull();
    expect(resolveDataSection("tasks", empty, "en-US")).toBeNull();
  });

  it("selects ONLY the requested section", () => {
    const section = resolveDataSection("raid", populated, "en-US");
    expect(section!.key).toBe("raid");
    // The workspace also has a task; enabling more than the requested key
    // would silently pull it in.
    expect(JSON.stringify(section!.rows)).not.toContain("A task");
  });

  it("is not hardcoded to one key", () => {
    const tasks = resolveDataSection("tasks", populated, "en-US");
    expect(tasks!.key).toBe("tasks");
    expect(tasks!.rows.flat()).toContain("A task");
  });

  it("threads lang through to the section title", () => {
    // ★ MUST use the TASKS section. The RAID title is the acronym "RAID" in
    // both i18n.ts and i18n.de.ts, so the same assertion on raid passes even
    // if `lang` is dropped on the floor — a test that cannot fail.
    const en = resolveDataSection("tasks", populated, "en-US");
    const de = resolveDataSection("tasks", populated, "de");
    expect(en!.title).toBe(t("en-US", "tasks"));
    expect(de!.title).toBe(t("de", "tasks"));
    expect(de!.title).not.toBe(en!.title);
  });

  it("returns cells as plain strings for the renderer to escape", () => {
    // Values arrive UNESCAPED; each renderer escapes at its own sink. If this
    // ever pre-escaped, every renderer would double-escape.
    const section = resolveDataSection("raid", populated, "en-US");
    const flat = section!.rows.flat();
    for (const cell of flat) expect(typeof cell).toBe("string");
    expect(flat).toContain("Budget & scope <risk>");
    expect(flat.join(" ")).not.toContain("&amp;");
  });
});
