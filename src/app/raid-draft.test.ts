// Characterization for the RAID draft builders moved out of raid-panel.tsx.
// The expected shapes are the ones `openNew` / `applyStatus` / `applyMatrix`
// produced inside the panel before the move, written out field by field.
import { beforeEach, describe, expect, it } from "vitest";
import { __resetMintStateForTests } from "./id-mint-session";
import { defaultStatusForCategory, isTerminalStatus, riskSeverityFromMatrix } from "./raid";
import { applyMatrix, applyStatus, buildNewRaidDraft, buildRaidSeedFromSignal } from "./raid-draft";
import { RISK_STATUSES, type RaidItem } from "./types";

const TODAY = "2026-06-20";

describe("buildNewRaidDraft", () => {
  beforeEach(() => {
    __resetMintStateForTests();
  });

  it("builds the Risk default the panel's openNew built", () => {
    const d = buildNewRaidDraft([], "R", TODAY);
    expect(d).toEqual({
      id: 1,
      category: "R",
      title: "",
      severity: riskSeverityFromMatrix(3, 3),
      probability: 3,
      impact: 3,
      status: defaultStatusForCategory("R"),
      linkedTaskIds: [],
      causedByRaidIds: [],
      stakeholderIds: [],
      knowledgeLinks: [],
      raisedDate: TODAY,
    });
  });

  it("builds a non-Risk default with Medium severity and no matrix axes", () => {
    const d = buildNewRaidDraft([], "I", TODAY);
    expect(d.severity).toBe("Medium");
    expect(d.probability).toBeUndefined();
    expect(d.impact).toBeUndefined();
    expect(d.status).toBe(defaultStatusForCategory("I"));
  });

  it("mints an id above the existing register", () => {
    const existing: RaidItem = {
      id: 5, category: "R", title: "x", status: "Open", linkedTaskIds: [],
      causedByRaidIds: [], stakeholderIds: [], raisedDate: TODAY,
    };
    expect(buildNewRaidDraft([existing], "R", TODAY).id).toBeGreaterThan(5);
  });
});

describe("applyStatus", () => {
  const terminal = RISK_STATUSES.find((s) => isTerminalStatus(s, "R"))!;
  const base = (over: Partial<RaidItem> = {}): RaidItem => ({
    id: 1, category: "R", title: "x", status: "Open", linkedTaskIds: [],
    causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-01-01", ...over,
  });

  it("stamps closedDate with today when entering a terminal status", () => {
    expect(terminal).toBeDefined();
    expect(applyStatus(base(), terminal, TODAY)).toMatchObject({ status: terminal, closedDate: TODAY });
  });
  it("keeps an existing closedDate", () => {
    expect(applyStatus(base({ closedDate: "2026-02-02" }), terminal, TODAY).closedDate).toBe("2026-02-02");
  });
  it("clears closedDate for a non-terminal status", () => {
    const out = applyStatus(base({ closedDate: "2026-02-02" }), "Open", TODAY);
    expect(out.status).toBe("Open");
    expect(out.closedDate).toBeUndefined();
  });
});

describe("applyMatrix", () => {
  it("sets both axes and derives severity from the matrix", () => {
    const d: RaidItem = {
      id: 1, category: "R", title: "x", status: "Open", linkedTaskIds: [],
      causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-01-01",
    };
    expect(applyMatrix(d, 5, 4)).toMatchObject({ probability: 5, impact: 4, severity: riskSeverityFromMatrix(5, 4) });
  });
});

describe("buildRaidSeedFromSignal", () => {
  it("trims the title and wraps the provenance note as sanitized rich HTML", () => {
    const seed = buildRaidSeedFromSignal({ title: "  Milestone slipping  ", note: "From: Insights — <b>5 days</b> overdue" });
    expect(seed.title).toBe("Milestone slipping");
    expect(seed.description.startsWith("<p>")).toBe(true);
    expect(seed.description).toContain("From: Insights");
    expect(seed.description).not.toContain("<b>");
  });
});
