// §779 — the review card's row for a staged `update_settings { enabledModules }`: a readable title and the
// functions it switches on and off, in the module labels the navigation uses (EN/DE). A row without
// `functions` renders as before.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatProposalBlock, functionsRowTitle, type ProposalCardRow } from "./chat-proposal-block";
import type { FunctionsChange } from "./chat-proposal-describe-functions";
import type { EditPlan } from "./inline-ai-edit/plan";
import { loadI18n, type Lang } from "./i18n";

const emptyPlan = (): EditPlan => ({ updates: [], creates: [], deletes: [], rejected: [], links: [] });

function renderCard(rows: readonly ProposalCardRow[], lang: Lang = "en-US") {
  return render(
    <ChatProposalBlock
      lang={lang}
      rows={rows}
      selected={new Set(rows.map((r) => r.index))}
      onToggleRow={vi.fn()}
      onApply={vi.fn()}
      onDiscard={vi.fn()}
    />,
  );
}

const functionsRow = (change: Partial<FunctionsChange> | undefined): ProposalCardRow => ({
  index: 0,
  title: "Project functions",
  call: { name: "update_settings", input: { enabledModules: ["raid"] } },
  plan: emptyPlan(),
  functions:
    change === undefined ? undefined : { on: [], off: [], dropped: [], before: [], after: [], others: [], ...change },
});

describe("ChatProposalBlock — a functions change (§779)", () => {
  // Mutation: not rendering `row.functions` turns this red. The names are joined as the Functions
  // picker joins them (`moduleNames`).
  it("lists the functions switched on and off by their navigation labels", () => {
    renderCard([functionsRow({ on: ["raid"], off: ["milestones", "budget"], dropped: [] })]);
    expect(screen.getByText("Turns on: RAID")).toBeInTheDocument();
    expect(screen.getByText("Turns off: Milestones and Budget")).toBeInTheDocument();
  });

  it("names the ids the write will ignore", () => {
    renderCard([functionsRow({ on: ["raid"], off: [], dropped: ["raidd"] })]);
    expect(screen.getByText("Not a known function, ignored: raidd")).toBeInTheDocument();
    expect(screen.queryByText(/^Turns off:/)).toBeNull();
  });

  it("says so when the list matches the saved functions", () => {
    renderCard([functionsRow({ on: [], off: [], dropped: [] })]);
    expect(screen.getByText("The functions stay as they are")).toBeInTheDocument();
  });

  it("speaks German, module labels included", async () => {
    await loadI18n("de");
    renderCard([functionsRow({ on: ["raid"], off: ["milestones"], dropped: [] })], "de");
    expect(screen.getByText("Schaltet ein: RAID")).toBeInTheDocument();
    expect(screen.getByText("Schaltet aus: Meilensteine")).toBeInTheDocument();
  });

  it("a row without functions renders no functions line", () => {
    renderCard([{ ...functionsRow(undefined), call: { name: "update_settings", input: { showViewHints: false } } }]);
    expect(screen.queryByText(/^Turns (on|off):/)).toBeNull();
    expect(screen.queryByText("The functions stay as they are")).toBeNull();
  });
});

describe("ChatProposalBlock — what else the functions block says (§779)", () => {
  // Mutation: dropping the no-undo line from `FunctionsDetail` turns this red. No shortcut is named:
  // Ctrl+Z is Cmd+Z on a Mac, and the undo button cannot reverse the change either.
  it("says the change cannot be undone", () => {
    renderCard([functionsRow({ on: ["raid"] })]);
    expect(screen.getByText("Cannot be undone.")).toBeInTheDocument();
  });

  it("says so in German too", async () => {
    await loadI18n("de");
    renderCard([functionsRow({ on: ["raid"] })], "de");
    expect(screen.getByText("Lässt sich nicht rückgängig machen.")).toBeInTheDocument();
  });

  // Mutation: not rendering `change.others` turns this red: a call that also changes another setting
  // showed only its functions, under the title "Project functions".
  it("shows every other setting the same call changes, beside the functions", () => {
    renderCard([functionsRow({ on: ["raid"], others: [{ key: "showViewHints", value: "false" }] })]);
    expect(screen.getByText("Turns on: RAID")).toBeInTheDocument();
    expect(screen.getByText("Also sets showViewHints = false")).toBeInTheDocument();
  });

  it("names the other settings in German too", async () => {
    await loadI18n("de");
    renderCard(
      [functionsRow({ others: [{ key: "showViewHints", value: "false" }, { key: "tasksViewMode", value: "board" }] })],
      "de",
    );
    expect(screen.getByText("Setzt außerdem showViewHints = false, tasksViewMode = board")).toBeInTheDocument();
  });

  it("a row with no other settings shows no such line", () => {
    renderCard([functionsRow({ on: ["raid"] })]);
    expect(screen.queryByText(/^Also sets/)).toBeNull();
  });
});

describe("functionsRowTitle (§779)", () => {
  it("titles an update_settings call that carries enabledModules", async () => {
    expect(functionsRowTitle("en-US", { name: "update_settings", input: { enabledModules: [] } })).toBe("Project functions");
    await loadI18n("de");
    expect(functionsRowTitle("de", { name: "update_settings", input: { enabledModules: [] } })).toBe("Funktionen des Projekts");
  });

  it("is null for any other call", () => {
    expect(functionsRowTitle("en-US", { name: "update_settings", input: { showViewHints: false } })).toBeNull();
    expect(functionsRowTitle("en-US", { name: "update_task", input: { enabledModules: [] } })).toBeNull();
  });
});
