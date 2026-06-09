// Tests for the optional `config` parameter on workspaceToCsv / workspaceToMarkdown.
//
// These cover three guarantees:
//   1. No-config path (storage/round-trip) — identical to pre-change behaviour.
//   2. defaultExportConfig (tasks+raid only) — other sections absent even when populated.
//   3. Custom config — enabling a section includes it; disabling excludes it.
//   4. Markdown |‑escaping preserved when a config is supplied.
//
// The round-trip tests in the sibling files remain the primary guard for (1).

import { describe, expect, it } from "vitest";
import {
  workspaceToCsv,
  workspaceToMarkdown,
  csvToWorkspace,
  markdownToWorkspace,
  emptyWorkspace,
  neutralizeCsvFormula,
} from "./storage";
import { defaultExportConfig } from "./settings-types";
import type { ExportConfig } from "./settings-types";
import type { Milestone, ChangeItem, RaidItem, Task } from "./types";

// ---------------------------------------------------------------------------
// Shared test workspace — populated with tasks, RAID, milestones, and changes.
// ---------------------------------------------------------------------------

const raid: RaidItem = {
  id: 1, category: "R", title: "Budget risk", status: "Open",
  linkedTaskIds: [], raisedDate: "2026-01-01",
  causedByRaidIds: [], stakeholderIds: [],
};

const milestone: Milestone = {
  id: 1, name: "Kickoff", date: "2026-03-01", linkedTaskIds: [],
};

const change: ChangeItem = {
  id: 1, title: "Widen scope", description: "add module",
  type: "Scope", status: "Approved", impact: "High",
  raisedDate: "2026-06-01", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [],
};

function richWorkspace() {
  return {
    ...emptyWorkspace(),
    raid: [raid],
    milestones: [milestone],
    changes: [change],
  };
}

// ---------------------------------------------------------------------------
// 1. No-config path — everything still emitted (storage round-trip unchanged)
// ---------------------------------------------------------------------------

describe("no-config path preserves full round-trip (CSV)", () => {
  it("emits milestones section", () => {
    const ws = richWorkspace();
    const csv = workspaceToCsv(ws); // no config — storage path
    const back = csvToWorkspace(csv);
    expect(back.milestones).toHaveLength(1);
    expect(back.milestones![0].name).toBe("Kickoff");
  });

  it("emits changes section", () => {
    const ws = richWorkspace();
    const back = csvToWorkspace(workspaceToCsv(ws));
    expect(back.changes).toHaveLength(1);
    expect(back.changes![0].title).toBe("Widen scope");
  });

  it("emits plan line", () => {
    const ws = richWorkspace();
    const csv = workspaceToCsv(ws);
    expect(csv).toContain("startDate");
  });
});

describe("no-config path preserves full round-trip (Markdown)", () => {
  it("emits milestones section", () => {
    const ws = richWorkspace();
    const back = markdownToWorkspace(workspaceToMarkdown(ws));
    expect(back.milestones).toHaveLength(1);
    expect(back.milestones![0].name).toBe("Kickoff");
  });

  it("emits changes section", () => {
    const ws = richWorkspace();
    const back = markdownToWorkspace(workspaceToMarkdown(ws));
    expect(back.changes).toHaveLength(1);
    expect(back.changes![0].title).toBe("Widen scope");
  });

  it("emits Plan section", () => {
    const ws = richWorkspace();
    const md = workspaceToMarkdown(ws);
    expect(md).toContain("## Plan");
  });
});

// ---------------------------------------------------------------------------
// 2. defaultExportConfig — tasks + raid only; milestones/changes absent
// ---------------------------------------------------------------------------

describe("defaultExportConfig CSV — tasks+raid only", () => {
  it("milestones section absent even though workspace has milestones", () => {
    const ws = richWorkspace();
    const csv = workspaceToCsv(ws, defaultExportConfig);
    expect(defaultExportConfig.milestones).toBe(false); // guard: default is off
    // csvToWorkspace tolerates missing sections — milestones comes back empty
    const back = csvToWorkspace(csv);
    expect(back.milestones ?? []).toHaveLength(0);
  });

  it("changes section absent", () => {
    const ws = richWorkspace();
    const csv = workspaceToCsv(ws, defaultExportConfig);
    const back = csvToWorkspace(csv);
    expect(back.changes ?? []).toHaveLength(0);
  });

  it("raid section present (default raid=true)", () => {
    const ws = richWorkspace();
    const csv = workspaceToCsv(ws, defaultExportConfig);
    expect(defaultExportConfig.raid).toBe(true);
    const back = csvToWorkspace(csv);
    expect(back.raid).toHaveLength(1);
  });

  it("plan section marker absent (storage-only section)", () => {
    const ws = richWorkspace();
    const csv = workspaceToCsv(ws, defaultExportConfig);
    expect(csv).not.toContain("# PLAN");
  });
});

describe("defaultExportConfig Markdown — tasks+raid only", () => {
  it("milestones heading absent", () => {
    const ws = richWorkspace();
    const md = workspaceToMarkdown(ws, defaultExportConfig);
    expect(md).not.toContain("## Milestones");
  });

  it("changes heading absent", () => {
    const ws = richWorkspace();
    const md = workspaceToMarkdown(ws, defaultExportConfig);
    expect(md).not.toContain("## Changes");
  });

  it("RAID Log heading present", () => {
    const ws = richWorkspace();
    const md = workspaceToMarkdown(ws, defaultExportConfig);
    expect(md).toContain("# RAID Log");
  });

  it("Plan section absent (storage-only section)", () => {
    const ws = richWorkspace();
    const md = workspaceToMarkdown(ws, defaultExportConfig);
    expect(md).not.toContain("## Plan");
  });
});

// ---------------------------------------------------------------------------
// 3. Custom config — enabling milestones includes it; disabling raid excludes it
// ---------------------------------------------------------------------------

describe("custom ExportConfig CSV", () => {
  it("enabling milestones includes the section", () => {
    const cfg: ExportConfig = { ...defaultExportConfig, milestones: true };
    const ws = richWorkspace();
    const back = csvToWorkspace(workspaceToCsv(ws, cfg));
    expect(back.milestones).toHaveLength(1);
    expect(back.milestones![0].name).toBe("Kickoff");
  });

  it("disabling raid excludes the section", () => {
    const cfg: ExportConfig = { ...defaultExportConfig, raid: false };
    const ws = richWorkspace();
    const back = csvToWorkspace(workspaceToCsv(ws, cfg));
    expect(back.raid).toHaveLength(0);
  });

  it("enabling changes includes the section", () => {
    const cfg: ExportConfig = { ...defaultExportConfig, changes: true };
    const ws = richWorkspace();
    const back = csvToWorkspace(workspaceToCsv(ws, cfg));
    expect(back.changes).toHaveLength(1);
    expect(back.changes![0].title).toBe("Widen scope");
  });
});

describe("custom ExportConfig Markdown", () => {
  it("enabling milestones includes the heading", () => {
    const cfg: ExportConfig = { ...defaultExportConfig, milestones: true };
    const ws = richWorkspace();
    const md = workspaceToMarkdown(ws, cfg);
    expect(md).toContain("## Milestones");
  });

  it("disabling raid excludes RAID Log heading", () => {
    const cfg: ExportConfig = { ...defaultExportConfig, raid: false };
    const ws = richWorkspace();
    const md = workspaceToMarkdown(ws, cfg);
    expect(md).not.toContain("# RAID Log");
  });
});

// ---------------------------------------------------------------------------
// 5. tasks:false — tasks section absent; raid:true — RAID section present
// ---------------------------------------------------------------------------

describe("tasks:false CSV — tasks section absent, RAID present", () => {
  const cfg: ExportConfig = { ...defaultExportConfig, tasks: false, raid: true };

  it("does NOT contain # TASKS header", () => {
    const csv = workspaceToCsv(richWorkspace(), cfg);
    expect(csv).not.toContain("# TASKS");
  });

  it("does NOT round-trip tasks", () => {
    const back = csvToWorkspace(workspaceToCsv(richWorkspace(), cfg));
    expect(back.tasks).toHaveLength(0);
  });

  it("DOES contain # RAID header (raid:true)", () => {
    const csv = workspaceToCsv(richWorkspace(), cfg);
    expect(csv).toContain("# RAID");
  });

  it("DOES round-trip RAID items", () => {
    const back = csvToWorkspace(workspaceToCsv(richWorkspace(), cfg));
    expect(back.raid).toHaveLength(1);
    expect(back.raid[0].title).toBe("Budget risk");
  });
});

describe("tasks:false Markdown — tasks section absent, RAID present", () => {
  const cfg: ExportConfig = { ...defaultExportConfig, tasks: false, raid: true };

  it("does NOT contain # LOP Tasks heading", () => {
    const md = workspaceToMarkdown(richWorkspace(), cfg);
    expect(md).not.toContain("# LOP Tasks");
  });

  it("DOES contain # RAID Log heading (raid:true)", () => {
    const md = workspaceToMarkdown(richWorkspace(), cfg);
    expect(md).toContain("# RAID Log");
  });

  it("DOES round-trip RAID items", () => {
    const back = markdownToWorkspace(workspaceToMarkdown(richWorkspace(), cfg));
    expect(back.raid).toHaveLength(1);
    expect(back.raid[0].title).toBe("Budget risk");
  });
});

describe("no-config (undefined) — tasks ALWAYS emitted (round-trip unchanged)", () => {
  it("CSV contains # TASKS with no config", () => {
    const csv = workspaceToCsv(richWorkspace()); // no config
    expect(csv).toContain("# TASKS");
  });

  it("Markdown contains # LOP Tasks with no config", () => {
    const md = workspaceToMarkdown(richWorkspace()); // no config
    expect(md).toContain("# LOP Tasks");
  });
});

// ---------------------------------------------------------------------------
// 4. Markdown |‑escaping preserved when config is supplied
// ---------------------------------------------------------------------------

describe("Markdown pipe-escaping preserved with config", () => {
  it("pipe in RAID title is escaped in config-gated output", () => {
    const raidWithPipe: RaidItem = {
      ...raid,
      title: "Risk | Opportunity",
    };
    const ws = { ...emptyWorkspace(), raid: [raidWithPipe] };
    const cfg: ExportConfig = { ...defaultExportConfig, raid: true };
    const md = workspaceToMarkdown(ws, cfg);
    // The pipe inside the title must be escaped so it doesn't corrupt the table
    expect(md).toContain("Risk \\| Opportunity");
  });
});

// ---------------------------------------------------------------------------
// 6. neutralizeCsvFormula — unit tests for the helper
// ---------------------------------------------------------------------------

describe("neutralizeCsvFormula helper", () => {
  it("prefixes single-quote on = (formula)", () => {
    expect(neutralizeCsvFormula('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
  });

  it("prefixes single-quote on + prefix", () => {
    expect(neutralizeCsvFormula('+1')).toBe("'+1");
  });

  it("prefixes single-quote on - prefix", () => {
    expect(neutralizeCsvFormula('-1')).toBe("'-1");
  });

  it("prefixes single-quote on @ prefix", () => {
    expect(neutralizeCsvFormula('@user')).toBe("'@user");
  });

  it("prefixes single-quote on tab prefix", () => {
    expect(neutralizeCsvFormula('\tvalue')).toBe("'\tvalue");
  });

  it("leaves normal values unchanged", () => {
    expect(neutralizeCsvFormula('hello world')).toBe('hello world');
  });

  it("leaves empty string unchanged", () => {
    expect(neutralizeCsvFormula('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 7. CSV formula injection — export path neutralizes, storage path does NOT
// ---------------------------------------------------------------------------

describe("CSV formula injection — export path (config provided)", () => {
  function makeFormulaTask(taskName = '=HYPERLINK("http://x","y")'): Task {
    return {
      id: "T1", taskName, status: "Open",
      priority: "Medium", labels: [], dependencies: [],
    } as unknown as Task;
  }

  it("export path neutralizes =HYPERLINK taskName with single-quote prefix", () => {
    const ws = { ...emptyWorkspace(), tasks: [makeFormulaTask()] };
    const csv = workspaceToCsv(ws, defaultExportConfig);
    // The neutralized value gets CSV-quoted because it contains commas/quotes;
    // but the ' prefix must appear right after the opening quote (or directly).
    expect(csv).toContain("'=HYPERLINK");
  });

  it("storage path (no config) does NOT neutralize — = preserved verbatim", () => {
    const ws = { ...emptyWorkspace(), tasks: [makeFormulaTask()] };
    const csv = workspaceToCsv(ws); // no config — storage path
    // Must NOT have a single-quote prefix before =
    expect(csv).not.toContain("'=HYPERLINK");
    expect(csv).toContain("=HYPERLINK");
  });

  it("storage path (no config) preserves raw formula — no neutralization", () => {
    const ws = { ...emptyWorkspace(), tasks: [makeFormulaTask()] };
    const storageCsv = workspaceToCsv(ws);                       // no config = storage path
    const exportCsv  = workspaceToCsv(ws, defaultExportConfig);  // export path
    expect(storageCsv).toContain('=HYPERLINK');      // raw formula present
    expect(storageCsv).not.toContain("'=HYPERLINK"); // NOT neutralized
    expect(exportCsv).toContain("'=HYPERLINK");      // export IS neutralized
  });

  it("export path neutralizes + prefix", () => {
    const ws = { ...emptyWorkspace(), tasks: [makeFormulaTask("+inject")] };
    const csv = workspaceToCsv(ws, defaultExportConfig);
    expect(csv).toContain("'+inject");
  });

  it("export path neutralizes - prefix", () => {
    const ws = { ...emptyWorkspace(), tasks: [makeFormulaTask("-inject")] };
    const csv = workspaceToCsv(ws, defaultExportConfig);
    expect(csv).toContain("'-inject");
  });

  it("export path neutralizes @ prefix", () => {
    const ws = { ...emptyWorkspace(), tasks: [makeFormulaTask("@inject")] };
    const csv = workspaceToCsv(ws, defaultExportConfig);
    expect(csv).toContain("'@inject");
  });

  it("normal taskName is identical in both paths", () => {
    const ws = { ...emptyWorkspace(), tasks: [makeFormulaTask("Normal title")] };
    const csvStorage = workspaceToCsv(ws);
    const csvExport = workspaceToCsv(ws, defaultExportConfig);
    expect(csvStorage).toContain("Normal title");
    expect(csvExport).toContain("Normal title");
  });

  it("storage path leaves + prefix verbatim", () => {
    const ws = { ...emptyWorkspace(), tasks: [makeFormulaTask("+inject")] };
    const csv = workspaceToCsv(ws);
    expect(csv).not.toContain("'+inject");
    expect(csv).toContain("+inject");
  });

  it("export path neutralizes = in RAID title", () => {
    const raidItem: RaidItem = { ...raid, title: "=CMD" };
    const ws = { ...emptyWorkspace(), raid: [raidItem] };
    const cfg: ExportConfig = { ...defaultExportConfig, raid: true };
    const csv = workspaceToCsv(ws, cfg);
    expect(csv).toContain("'=CMD");
  });

  it("storage path leaves = in RAID title verbatim", () => {
    const raidItem: RaidItem = { ...raid, title: "=CMD" };
    const ws = { ...emptyWorkspace(), raid: [raidItem] };
    const csv = workspaceToCsv(ws);
    expect(csv).not.toContain("'=CMD");
    expect(csv).toContain("=CMD");
  });
});
