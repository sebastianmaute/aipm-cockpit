// A work-breakdown apply records the tasks it created in its ONE `ai.wbsPlan` entry: `[applied, id, title, …]`.
// One entry per apply (no per-task flood against ACTIVITY_MAX_ENTRIES), the ids survive the log's load sanitiser,
// and the activity panel names them.
import { beforeAll, describe, expect, it } from "vitest";
import {
  WBS_ACTIVITY_TITLE_MAX, sanitizeActivityEntry, wbsPlanActivityArgs, wbsPlanCreatedTasks, type ActivityEntry,
} from "./activity-log";
import { activityMessage } from "./activity-message";
import { loadI18n } from "./i18n";

beforeAll(() => loadI18n("de"));

const CREATED = [{ id: 12, taskName: "Design B" }, { id: 13, taskName: "Rollout, phase 2" }];

describe("wbsPlanActivityArgs / wbsPlanCreatedTasks", () => {
  it("stores the applied count, then each created task's id and title", () => {
    expect(wbsPlanActivityArgs(3, CREATED)).toEqual([3, 12, "Design B", 13, "Rollout, phase 2"]);
  });

  it("reads the created tasks back, and none from a count-only entry written before", () => {
    expect(wbsPlanCreatedTasks(wbsPlanActivityArgs(3, CREATED))).toEqual([
      { id: 12, title: "Design B" }, { id: 13, title: "Rollout, phase 2" },
    ]);
    expect(wbsPlanCreatedTasks([5])).toEqual([]);
    expect(wbsPlanCreatedTasks([])).toEqual([]);
  });

  it("caps a long title and puts the whole title on one line", () => {
    const [, , title] = wbsPlanActivityArgs(1, [{ id: 1, taskName: `a\nb${"x".repeat(500)}` }]);
    expect(String(title).length).toBe(WBS_ACTIVITY_TITLE_MAX);
    expect(String(title)).not.toContain("\n");
  });

  it("ignores a trailing half pair, so a damaged entry is never read as an extra task", () => {
    expect(wbsPlanCreatedTasks([2, 12, "Design B", 13])).toEqual([{ id: 12, title: "Design B" }]);
  });
});

describe("the entry round-trips through the log's sanitiser", () => {
  const entry: ActivityEntry = {
    id: "dev-s-1", timestamp: "2026-10-12T09:00:00.000Z", kind: "ai.wbsPlan", actor: "ai",
    args: wbsPlanActivityArgs(3, CREATED),
  };

  it("unchanged, through JSON", () => {
    expect(sanitizeActivityEntry(JSON.parse(JSON.stringify(entry)))).toEqual(entry);
  });

  it("a hostile element is coerced in place, keeping every other id in its slot", () => {
    const hostile = { ...entry, args: [3, 12, { toString: 1 }, 13, "Rollout, phase 2"] };
    const clean = sanitizeActivityEntry(hostile)!;
    expect(wbsPlanCreatedTasks(clean.args)).toEqual([{ id: 12, title: "" }, { id: 13, title: "Rollout, phase 2" }]);
  });
});

describe("the activity panel names the created tasks", () => {
  it("in English", () => {
    const text = activityMessage("en-US", "ai.wbsPlan", wbsPlanActivityArgs(3, CREATED), { display: true });
    expect(text).toBe("AI applied 3 work-breakdown changes — created: #12 Design B; #13 Rollout, phase 2");
  });

  it("in German, with the singular", () => {
    const text = activityMessage("de", "ai.wbsPlan", wbsPlanActivityArgs(1, CREATED.slice(0, 1)), { display: true });
    expect(text).toBe("KI hat 1 Änderung an den Arbeitspaketen übernommen — angelegt: #12 Design B");
  });

  // The rendered line also reaches the model (`search_history` renders entries through `renderActivityEntry`), so
  // it names at most the first 20 tasks; the stored entry keeps every id.
  it("names at most 20 created tasks, then how many more, in both languages", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ id: 100 + i, taskName: `Piece ${i}` }));
    const args = wbsPlanActivityArgs(25, many);
    expect(wbsPlanCreatedTasks(args)).toHaveLength(25); // stored complete
    const en = activityMessage("en-US", "ai.wbsPlan", args);
    expect(en).toContain("#100 Piece 0; ");
    expect(en).toContain("#119 Piece 19");
    expect(en).not.toContain("#120");
    expect(en.endsWith("#119 Piece 19; and 5 more")).toBe(true);
    expect(activityMessage("de", "ai.wbsPlan", args).endsWith("#119 Piece 19; und 5 weitere")).toBe(true);
  });

  it("exactly 20 created tasks name them all, with no remainder", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => ({ id: 100 + i, taskName: `Piece ${i}` }));
    const en = activityMessage("en-US", "ai.wbsPlan", wbsPlanActivityArgs(20, twenty));
    expect(en.endsWith("#119 Piece 19")).toBe(true);
    expect(en).not.toContain("more");
  });

  it("a count-only entry reads as before", () => {
    expect(activityMessage("en-US", "ai.wbsPlan", [2], { display: true })).toBe("AI applied 2 work-breakdown changes");
  });
});
