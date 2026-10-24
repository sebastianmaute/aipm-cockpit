// §779 — a staged `update_settings { enabledModules }` row says which functions it switches on and which
// off, against the project's saved functions (`Workspace.features`). Without it the review card showed only
// the tool name and an empty diff, which is no review at all.
import { describe, expect, test } from "vitest";
import type { ProposedCall } from "./chat-proposal";
import { computeSettingsPatch } from "./chat-settings-patch";
import { defaultSettings, resolveNextActionsConfig, type Settings } from "./settings-types";
import { describeProposal } from "./chat-proposal-describe";
import { ALL_MODULE_IDS, type FeatureModuleId } from "./feature-modules";
import { emptyWorkspace, type Workspace } from "./workspace";

const settings = (input: Record<string, unknown>): ProposedCall => ({ name: "update_settings", input });
const wsWith = (features: FeatureModuleId[] | undefined): Workspace => ({ ...emptyWorkspace(), features });
const only = (call: ProposedCall, ws: Workspace) => {
  const [row] = describeProposal([call], ws);
  return row;
};

describe("describeProposal — update_settings { enabledModules } (§779)", () => {
  // Mutation: dropping the update_settings branch from `describeProposal` turns this red (no `functions`).
  test("names the functions switched on and off, compared with the saved functions", () => {
    const row = only(settings({ enabledModules: ["dashboard", "raid"] }), wsWith(["dashboard", "milestones"]));
    expect(row.functions).toMatchObject({ on: ["raid"], off: ["milestones"], dropped: [] });
    expect(row.plan.rejected).toEqual([]);
  });

  // Mutation: comparing with `[]` instead of the legacy all-on default turns this red.
  test("a project with no saved list starts from every function on", () => {
    const row = only(settings({ enabledModules: ["raid"] }), wsWith(undefined));
    expect(row.functions?.on).toEqual([]);
    expect(row.functions?.off).toEqual(ALL_MODULE_IDS.filter((id) => id !== "raid"));
  });

  test("[] switches every saved function off", () => {
    const row = only(settings({ enabledModules: [] }), wsWith(["budget", "raid"]));
    expect(row.functions).toMatchObject({ on: [], off: ["budget", "raid"], dropped: [] });
  });

  test("an unknown id in a mixed list is listed as dropped, as the write reports it", () => {
    const row = only(settings({ enabledModules: ["raid", "raidd"] }), wsWith([]));
    expect(row.functions).toMatchObject({ on: ["raid"], off: [], dropped: ["raidd"] });
  });

  // Mutation: describing a refused value as a change turns this red. The refusal is the write's own
  // judge (`judgeEnabledModules`), so the card cannot promise a change the write refuses.
  test("a value the write refuses shows as rejected on the enabledModules field, with no change", () => {
    const row = only(settings({ enabledModules: "raid" }), wsWith(["raid"]));
    expect(row.functions).toBeUndefined();
    expect(row.plan.rejected).toEqual([
      expect.objectContaining({ field: "enabledModules", detail: "enabledModules must be a list of module ids" }),
    ]);
  });

  test("an update_settings without enabledModules keeps today's empty row", () => {
    const row = only(settings({ showViewHints: false }), wsWith(["raid"]));
    expect(row.functions).toBeUndefined();
    expect(row.plan).toEqual({ updates: [], creates: [], deletes: [], rejected: [], links: [] });
  });
  // The card names the full lists too, so Apply can re-judge against the baseline it was described with.
  test("carries the baseline and the resulting list", () => {
    const row = only(settings({ enabledModules: ["raid", "dashboard"] }), wsWith(["budget"]));
    expect(row.functions?.before).toEqual(["budget"]);
    expect(row.functions?.after).toEqual(["dashboard", "raid"]);
  });

  // Mutation: describing every row against the pre-turn `ws.features` turns this red (row 2 would be
  // described against a list row 1 already changed).
  test("a second functions row is described against the list the first leaves", () => {
    const [first, second] = describeProposal(
      [settings({ enabledModules: ["dashboard", "raid"] }), settings({ enabledModules: ["raid", "budget"] })],
      wsWith(["dashboard"]),
    );
    expect(first.functions).toMatchObject({ on: ["raid"], off: [] });
    expect(second.functions).toMatchObject({ before: ["dashboard", "raid"], on: ["budget"], off: ["dashboard"] });
  });

  test("a refused functions row does not move the next row's baseline", () => {
    const [, second] = describeProposal(
      [settings({ enabledModules: "raid" }), settings({ enabledModules: ["raid"] })],
      wsWith(["dashboard"]),
    );
    expect(second.functions).toMatchObject({ before: ["dashboard"], on: ["raid"], off: ["dashboard"] });
  });

  // Mutation: dropping `others` from the describer turns this red. Only what the write would accept is
  // listed: `computeSettingsPatch` ignores an invalid density, so the card does too.
  test("lists the other settings the same call changes, as the write accepts them", () => {
    const row = only(
      settings({ enabledModules: ["raid"], showViewHints: false, tasksViewMode: "board", dashboardDensity: "cosy" }),
      wsWith(["raid"]),
    );
    expect(row.functions?.others).toEqual([
      { key: "showViewHints", value: "false" },
      { key: "tasksViewMode", value: "board" },
    ]);
  });

  // Mutation: computing "Also sets" against `defaultSettings` instead of `previewSettings` turns this red
  // (it shows the default 5). A weight the coercer refuses keeps the user's CURRENT value in the write, so
  // the card must show that value, not the default.
  test("a refused weight shows the user's current value, as the write keeps it", () => {
    const live: Settings = {
      ...defaultSettings,
      nextActions: { ...resolveNextActionsConfig(undefined), scopePendingRed: 9 },
    };
    const preview = (patch: Parameters<typeof computeSettingsPatch>[0]) => computeSettingsPatch(patch, live).applied;
    const [row] = describeProposal(
      [settings({ enabledModules: ["raid"], nextActionsWeights: { scopePendingRed: "junk" } })],
      wsWith(["raid"]),
      undefined,
      preview,
    );
    expect(row.functions?.others).toEqual([{ key: "nextActionsWeights", value: "scopePendingRed 9" }]);
  });
});
