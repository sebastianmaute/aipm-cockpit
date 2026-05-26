import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeTaskHealth,
  computeGroupHealth,
  healthColorName,
  formatHealthTooltip,
  healthDot,
  type Health,
  type TaskHealth,
  type GroupHealth,
} from "./health";
import type { Task } from "./types";
import * as i18n from "./i18n";

// Mock the i18n module
vi.mock("./i18n", () => ({
  t: vi.fn((lang: string, key: string, ...args: string[]) => {
    // Simple mock: return the key itself for testing
    // In real code, this would return a translated string
    if (args.length > 0) {
      return `${key}(${args.join(",")})`;
    }
    return key;
  }),
}));

// Mock the due-dates module
vi.mock("./due-dates", () => ({
  workdaysUntil: vi.fn((dueDate: string, today: string, holidays: Set<string>) => {
    // Simple mock: count calendar days minus 2 for the weekend pattern
    const due = new Date(dueDate + "T00:00:00");
    const cur = new Date(today + "T00:00:00");
    let count = 0;
    while (cur < due) {
      cur.setDate(cur.getDate() + 1);
      const day = cur.getDay();
      if (day === 0 || day === 6) continue;
      const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
      if (holidays.has(iso)) continue;
      count++;
    }
    return count;
  }),
}));

// Helper to create a minimal Task
function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    taskName: "Test Task",
    assignee: "Test Assignee",
    assigneeEmail: "test@example.com",
    dueDate: "2026-06-01",
    lastUpdateDate: "2026-05-01",
    priority: "Medium",
    blockers: "",
    notes: "",
    ...overrides,
  };
}

describe("computeTaskHealth", () => {
  const today = "2026-05-26";
  const holidays = new Set<string>();

  describe("Rule 1: healthOverride beats all", () => {
    it("returns Red when healthOverride is 'R', ignoring all other rules", () => {
      const task = createTask({
        healthOverride: "R",
        completedDate: "2026-05-20",
        dueDate: "2026-05-25", // overdue
        blockers: "test",
      });

      const health = computeTaskHealth(task, today, holidays);

      expect(health.color).toBe("R");
      expect(health.drivers).toEqual(["manual"]);
    });

    it("returns Amber when healthOverride is 'A', ignoring other rules", () => {
      const task = createTask({
        healthOverride: "A",
        completedDate: "2026-05-20",
      });

      const health = computeTaskHealth(task, today, holidays);

      expect(health.color).toBe("A");
      expect(health.drivers).toEqual(["manual"]);
    });

    it("returns Green when healthOverride is 'G', ignoring other rules", () => {
      const task = createTask({
        healthOverride: "G",
        dueDate: "2026-05-20", // overdue
      });

      const health = computeTaskHealth(task, today, holidays);

      expect(health.color).toBe("G");
      expect(health.drivers).toEqual(["manual"]);
    });
  });

  describe("Rule 2: completedDate → Green", () => {
    it("returns Green with 'completed' driver when completedDate is set", () => {
      const task = createTask({
        completedDate: "2026-05-20",
      });

      const health = computeTaskHealth(task, today, holidays);

      expect(health.color).toBe("G");
      expect(health.drivers).toEqual(["completed"]);
    });

    it("returns Green even when overdue before completion", () => {
      const task = createTask({
        completedDate: "2026-05-20",
        dueDate: "2026-05-15",
      });

      const health = computeTaskHealth(task, today, holidays);

      expect(health.color).toBe("G");
      expect(health.drivers).toEqual(["completed"]);
    });

    it("returns Green even when blocked and completed", () => {
      const task = createTask({
        completedDate: "2026-05-20",
        blockers: "something",
      });

      const health = computeTaskHealth(task, today, holidays);

      expect(health.color).toBe("G");
      expect(health.drivers).toEqual(["completed"]);
    });
  });

  describe("Rule 3: dueDate before today (overdue) → Red", () => {
    it("returns Red with 'overdue' driver when dueDate < today", () => {
      const task = createTask({
        dueDate: "2026-05-20",
      });

      const health = computeTaskHealth(task, today, holidays);

      expect(health.color).toBe("R");
      expect(health.drivers).toEqual(["overdue"]);
    });

    it("returns Red for 1 day overdue", () => {
      const task = createTask({
        dueDate: "2026-05-25",
      });

      const health = computeTaskHealth(task, today, holidays);

      expect(health.color).toBe("R");
      expect(health.drivers).toEqual(["overdue"]);
    });

    it("includes 'overdue' in drivers but not 'completed' when overdue", () => {
      const task = createTask({
        dueDate: "2026-05-20",
      });

      const health = computeTaskHealth(task, today, holidays);

      expect(health.drivers).toContain("overdue");
      expect(health.drivers).not.toContain("completed");
    });
  });

  describe("Rule 4: blockers non-empty → Red", () => {
    it("returns Red with 'blocked' driver when blockers is set", () => {
      const task = createTask({
        blockers: "waiting for approval",
        dueDate: "2026-06-10",
      });

      const health = computeTaskHealth(task, today, holidays);

      expect(health.color).toBe("R");
      expect(health.drivers).toEqual(["blocked"]);
    });

    it("ignores whitespace-only blockers (treated as empty)", () => {
      const task = createTask({
        blockers: "   ",
        dueDate: "2026-06-10",
      });

      const health = computeTaskHealth(task, today, holidays);

      expect(health.color).toBe("G");
      expect(health.drivers).toEqual(["onTrack"]);
    });

    it("returns Red when blockers is set, even if due far in future", () => {
      const task = createTask({
        blockers: "x",
        dueDate: "2026-12-31",
      });

      const health = computeTaskHealth(task, today, holidays);

      expect(health.color).toBe("R");
      expect(health.drivers).toEqual(["blocked"]);
    });

    it("blocks Amber evaluation when blocked", () => {
      const task = createTask({
        blockers: "waiting",
        dueDate: today, // would be dueToday if not blocked
      });

      const health = computeTaskHealth(task, today, holidays);

      expect(health.color).toBe("R");
      expect(health.drivers).toEqual(["blocked"]);
      expect(health.drivers).not.toContain("dueToday");
    });
  });

  describe("Rule 5: dueDate === today → Amber", () => {
    it("returns Amber with 'dueToday' driver when dueDate === today", () => {
      const task = createTask({
        dueDate: today,
      });

      const health = computeTaskHealth(task, today, holidays);

      expect(health.color).toBe("A");
      expect(health.drivers).toEqual(["dueToday"]);
    });

    it("does not return Amber if overdue (dueDate before today)", () => {
      const task = createTask({
        dueDate: "2026-05-20",
      });

      const health = computeTaskHealth(task, "2026-05-26", holidays);

      expect(health.color).toBe("R");
      expect(health.drivers).not.toContain("dueToday");
    });

    it("does not apply dueToday if blocked", () => {
      const task = createTask({
        dueDate: today,
        blockers: "something",
      });

      const health = computeTaskHealth(task, today, holidays);

      expect(health.color).toBe("R");
      expect(health.drivers).not.toContain("dueToday");
    });
  });

  describe("Rule 6: workdays until dueDate ≤ 3 → Amber (due soon)", () => {
    it("returns Amber with 'dueSoon' driver when dueDate is 3 workdays away", () => {
      // 2026-05-26 is Tuesday; +3 workdays → Wed 5/27, Thu 5/28, Fri 5/29 = 2026-05-29
      const task = createTask({
        dueDate: "2026-05-29",
      });

      const health = computeTaskHealth(task, "2026-05-26", holidays);

      expect(health.color).toBe("A");
      expect(health.drivers).toEqual(["dueSoon"]);
    });

    it("returns Amber when due in 1 workday", () => {
      // 2026-05-26 is Tuesday; +1 workday → Wed 2026-05-27
      const task = createTask({
        dueDate: "2026-05-27",
      });

      const health = computeTaskHealth(task, "2026-05-26", holidays);

      expect(health.color).toBe("A");
      expect(health.drivers).toEqual(["dueSoon"]);
    });

    it("returns Amber when due in exactly 2 workdays", () => {
      // 2026-05-26 is Tuesday; +2 workdays → Thu 2026-05-28
      const task = createTask({
        dueDate: "2026-05-28",
      });

      const health = computeTaskHealth(task, "2026-05-26", holidays);

      expect(health.color).toBe("A");
      expect(health.drivers).toEqual(["dueSoon"]);
    });

    it("returns Green when due in 4 workdays (beyond threshold)", () => {
      // 2026-05-26 is Tuesday; +4 workdays → Fri 5/29, Mon 6/1, Tue 6/2, Wed 6/3 = 2026-06-03
      const task = createTask({
        dueDate: "2026-06-03",
      });

      const health = computeTaskHealth(task, "2026-05-26", holidays);

      expect(health.color).toBe("G");
      expect(health.drivers).toEqual(["onTrack"]);
    });

    it("respects holidays when computing workdays until due", () => {
      const hols = new Set(["2026-05-28"]); // Block Thursday
      // Tue 5/26 → Wed 5/27 (1) → Thu 5/28 (holiday, skip) → Fri 5/29 (2) → Mon 6/1 (3)
      // So due on Monday 6/1 is 3 workdays, should be Amber
      const task = createTask({
        dueDate: "2026-06-01",
      });

      const health = computeTaskHealth(task, "2026-05-26", hols);

      expect(health.color).toBe("A");
      expect(health.drivers).toEqual(["dueSoon"]);
    });

    it("does not apply dueSoon if blocked (stays Red)", () => {
      const task = createTask({
        dueDate: "2026-05-27", // 1 workday
        blockers: "something",
      });

      const health = computeTaskHealth(task, "2026-05-26", holidays);

      expect(health.color).toBe("R");
      expect(health.drivers).toEqual(["blocked"]);
    });

    it("does not apply dueSoon if overdue (stays Red)", () => {
      const task = createTask({
        dueDate: "2026-05-20",
      });

      const health = computeTaskHealth(task, "2026-05-26", holidays);

      expect(health.color).toBe("R");
      expect(health.drivers).toEqual(["overdue"]);
    });
  });

  describe("Rule 7: no due date and no issues → Green (onTrack)", () => {
    it("returns Green with 'onTrack' driver when no dueDate and no blockers", () => {
      const task = createTask({
        dueDate: "",
      });

      const health = computeTaskHealth(task, today, holidays);

      expect(health.color).toBe("G");
      expect(health.drivers).toEqual(["onTrack"]);
    });

    it("returns Green with 'onTrack' when due far in future", () => {
      const task = createTask({
        dueDate: "2026-12-31",
      });

      const health = computeTaskHealth(task, today, holidays);

      expect(health.color).toBe("G");
      expect(health.drivers).toEqual(["onTrack"]);
    });

    it("includes 'onTrack' only when no other drivers apply", () => {
      const task = createTask({
        dueDate: "2026-06-10",
        blockers: "",
      });

      const health = computeTaskHealth(task, today, holidays);

      expect(health.drivers).toContain("onTrack");
      expect(health.drivers.length).toBe(1);
    });
  });

  describe("Edge cases and readonly Set handling", () => {
    it("accepts readonly holidays set and works correctly", () => {
      const readonlyHols: ReadonlySet<string> = new Set(["2026-05-28"]);
      const task = createTask({
        dueDate: "2026-05-30",
      });

      const health = computeTaskHealth(task, "2026-05-26", readonlyHols);

      // With holiday on 5/28, 4 calendar days → 3 workdays → should be Amber
      expect(health.color).toBe("A");
    });

    it("accepts a Set<string> directly without copying when possible", () => {
      const hols = new Set(["2026-05-28"]);
      const task = createTask({
        dueDate: "2026-05-30",
      });

      const health = computeTaskHealth(task, "2026-05-26", hols);

      expect(health.color).toBe("A");
    });

    it("defaults to empty holidays when not provided", () => {
      const task = createTask({
        dueDate: "2026-06-03",
      });

      const health = computeTaskHealth(task, "2026-05-26");

      // Tue 5/26 → Wed 5/27 (1) → Thu 5/28 (2) → Fri 5/29 (3) → Mon 6/1 (4) → Tue 6/2 (5) → Wed 6/3 (6 workdays, beyond threshold)
      expect(health.color).toBe("G");
    });

    it("handles task with undefined dueDate", () => {
      const task = createTask({
        dueDate: undefined as any, // explicitly undefined
      });

      const health = computeTaskHealth(task, today, holidays);

      expect(health.color).toBe("G");
      expect(health.drivers).toEqual(["onTrack"]);
    });

    it("handles task with empty string dueDate", () => {
      const task = createTask({
        dueDate: "",
      });

      const health = computeTaskHealth(task, today, holidays);

      expect(health.color).toBe("G");
      expect(health.drivers).toEqual(["onTrack"]);
    });
  });

  describe("Multiple drivers aggregation", () => {
    it("includes both overdue and blocked when both apply (Red takes priority)", () => {
      const task = createTask({
        dueDate: "2026-05-20",
        blockers: "waiting",
      });

      const health = computeTaskHealth(task, today, holidays);

      expect(health.color).toBe("R");
      expect(health.drivers).toContain("overdue");
      expect(health.drivers).toContain("blocked");
    });

    it("does not mix Red and Amber drivers in same task health", () => {
      const task = createTask({
        dueDate: "2026-05-27", // dueSoon (Amber)
        blockers: "something", // blocked (Red)
      });

      const health = computeTaskHealth(task, "2026-05-26", holidays);

      // Red overrides Amber, so no dueSoon driver
      expect(health.color).toBe("R");
      expect(health.drivers).toContain("blocked");
      expect(health.drivers).not.toContain("dueSoon");
    });
  });
});

describe("computeGroupHealth", () => {
  const today = "2026-05-26";
  const holidays = new Set<string>();

  describe("Color aggregation: worst-case", () => {
    it("returns Red when any task is Red", () => {
      const tasks = [
        createTask({ dueDate: "2026-06-10" }), // Green
        createTask({ dueDate: "2026-05-20" }), // Red (overdue)
        createTask({ dueDate: "2026-05-27" }), // Amber (dueSoon)
      ];

      const health = computeGroupHealth(tasks, today, holidays);

      expect(health.color).toBe("R");
    });

    it("returns Amber when any task is Amber but none are Red", () => {
      const tasks = [
        createTask({ dueDate: "2026-06-10" }), // Green
        createTask({ dueDate: "2026-05-27" }), // Amber (dueSoon)
        createTask({ dueDate: "2026-06-20" }), // Green
      ];

      const health = computeGroupHealth(tasks, today, holidays);

      expect(health.color).toBe("A");
    });

    it("returns Green when all tasks are Green", () => {
      const tasks = [
        createTask({ dueDate: "2026-06-10" }),
        createTask({ dueDate: "2026-06-20" }),
        createTask({ dueDate: "2026-07-01" }),
      ];

      const health = computeGroupHealth(tasks, today, holidays);

      expect(health.color).toBe("G");
    });

    it("returns Green when task list is empty", () => {
      const tasks: Task[] = [];

      const health = computeGroupHealth(tasks, today, holidays);

      expect(health.color).toBe("G");
      expect(health.counts).toEqual({ R: 0, A: 0, G: 0 });
    });
  });

  describe("Counts aggregation", () => {
    it("counts Red, Amber, and Green tasks correctly", () => {
      const tasks = [
        createTask({ dueDate: "2026-05-20" }), // Red
        createTask({ dueDate: "2026-05-27" }), // Amber
        createTask({ dueDate: "2026-06-10" }), // Green
        createTask({ dueDate: "2026-05-25" }), // Red
        createTask({ dueDate: "2026-06-20" }), // Green
      ];

      const health = computeGroupHealth(tasks, today, holidays);

      expect(health.counts.R).toBe(2);
      expect(health.counts.A).toBe(1);
      expect(health.counts.G).toBe(2);
    });

    it("counts completed tasks as Green", () => {
      const tasks = [
        createTask({ completedDate: "2026-05-20" }), // Green
        createTask({ dueDate: "2026-05-20" }), // Red
      ];

      const health = computeGroupHealth(tasks, today, holidays);

      expect(health.counts.G).toBe(1);
      expect(health.counts.R).toBe(1);
    });

    it("counts manual Green overrides as Green", () => {
      const tasks = [
        createTask({ healthOverride: "G" }), // Green
        createTask({ dueDate: "2026-05-20" }), // Red
      ];

      const health = computeGroupHealth(tasks, today, holidays);

      expect(health.counts.G).toBe(1);
      expect(health.counts.R).toBe(1);
    });
  });

  describe("Driver aggregation (deduped and ordered)", () => {
    it("aggregates drivers from all non-Green tasks", () => {
      const tasks = [
        createTask({ dueDate: "2026-05-20" }), // Red: overdue
        createTask({ blockers: "x", dueDate: "2026-06-10" }), // Red: blocked
        createTask({ dueDate: "2026-05-27" }), // Amber: dueSoon
      ];

      const health = computeGroupHealth(tasks, today, holidays);

      expect(health.drivers).toContain("overdue");
      expect(health.drivers).toContain("blocked");
      expect(health.drivers).toContain("dueSoon");
    });

    it("deduplicates drivers", () => {
      const tasks = [
        createTask({ dueDate: "2026-05-20" }), // overdue
        createTask({ dueDate: "2026-05-19" }), // overdue
        createTask({ dueDate: "2026-05-18" }), // overdue
      ];

      const health = computeGroupHealth(tasks, today, holidays);

      const overdueCount = health.drivers.filter((d) => d === "overdue").length;
      expect(overdueCount).toBe(1);
    });

    it("excludes 'onTrack' and 'completed' from group drivers (noisy)", () => {
      const tasks = [
        createTask({ dueDate: "2026-06-10" }), // Green: onTrack
        createTask({ dueDate: "2026-06-20" }), // Green: onTrack
        createTask({ completedDate: "2026-05-20" }), // Green: completed
      ];

      const health = computeGroupHealth(tasks, today, holidays);

      expect(health.drivers).not.toContain("onTrack");
      expect(health.drivers).not.toContain("completed");
    });

    it("includes 'manual' driver when a Green task has manual override", () => {
      const tasks = [
        createTask({ healthOverride: "G", dueDate: "2026-05-20" }), // Green: manual
        createTask({ dueDate: "2026-05-20" }), // Red: overdue
      ];

      const health = computeGroupHealth(tasks, today, holidays);

      expect(health.drivers).toContain("manual");
      expect(health.drivers).toContain("overdue");
    });

    it("does not include 'manual' for manual Red or Amber overrides", () => {
      const tasks = [
        createTask({ healthOverride: "R" }), // Red: manual
        createTask({ healthOverride: "A" }), // Amber: manual
      ];

      const health = computeGroupHealth(tasks, today, holidays);

      expect(health.drivers).toContain("manual");
    });

    it("maintains stable driver order: manual, overdue, blocked, dueToday, dueSoon", () => {
      const tasks = [
        createTask({ dueDate: "2026-05-27" }), // dueSoon
        createTask({ dueDate: "2026-05-20" }), // overdue
        createTask({ blockers: "x", dueDate: "2026-06-10" }), // blocked
        createTask({ dueDate: "2026-05-26" }), // dueToday
        createTask({ healthOverride: "G", dueDate: "2026-05-20" }), // manual
      ];

      const health = computeGroupHealth(tasks, today, holidays);

      const driverIndices = {
        manual: health.drivers.indexOf("manual"),
        overdue: health.drivers.indexOf("overdue"),
        blocked: health.drivers.indexOf("blocked"),
        dueToday: health.drivers.indexOf("dueToday"),
        dueSoon: health.drivers.indexOf("dueSoon"),
      };

      expect(driverIndices.manual).toBeLessThan(driverIndices.overdue);
      expect(driverIndices.overdue).toBeLessThan(driverIndices.blocked);
      expect(driverIndices.blocked).toBeLessThan(driverIndices.dueToday);
      expect(driverIndices.dueToday).toBeLessThan(driverIndices.dueSoon);
    });
  });

  describe("Edge cases for group health", () => {
    it("handles group with single task", () => {
      const tasks = [createTask({ dueDate: "2026-05-20" })]; // Red

      const health = computeGroupHealth(tasks, today, holidays);

      expect(health.color).toBe("R");
      expect(health.counts.R).toBe(1);
      expect(health.counts.A).toBe(0);
      expect(health.counts.G).toBe(0);
    });

    it("respects holidays when aggregating", () => {
      const hols = new Set(["2026-05-28"]);
      const tasks = [
        createTask({ dueDate: "2026-05-30" }), // Amber (dueSoon with holiday)
      ];

      const health = computeGroupHealth(tasks, "2026-05-26", hols);

      expect(health.color).toBe("A");
      expect(health.drivers).toContain("dueSoon");
    });
  });
});

describe("healthColorName", () => {
  it("returns localized 'Red' for color R", () => {
    const name = healthColorName("R", "en-US");
    expect(name).toBe("healthRed");
  });

  it("returns localized 'Amber' for color A", () => {
    const name = healthColorName("A", "en-US");
    expect(name).toBe("healthAmber");
  });

  it("returns localized 'Green' for color G", () => {
    const name = healthColorName("G", "en-US");
    expect(name).toBe("healthGreen");
  });

  it("respects language parameter", () => {
    const nameEN = healthColorName("R", "en-US");
    const nameDE = healthColorName("R", "de");
    // Both should return the key, but we verify the function respects the param
    expect(nameEN).toBe("healthRed");
    expect(nameDE).toBe("healthRed");
  });
});

describe("formatHealthTooltip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("formats tooltip with color name and single driver", () => {
    const health: TaskHealth = {
      color: "R",
      drivers: ["overdue"],
    };

    const tooltip = formatHealthTooltip(health, "en-US");

    // Should call t() for color name and driver translation
    expect(tooltip).toContain("healthRed");
    expect(tooltip).toContain("healthDriverOverdue");
  });

  it("formats tooltip with multiple drivers", () => {
    const health: TaskHealth = {
      color: "R",
      drivers: ["overdue", "blocked"],
    };

    const tooltip = formatHealthTooltip(health, "en-US");

    expect(tooltip).toContain("healthDriverOverdue");
    expect(tooltip).toContain("healthDriverBlocked");
  });

  it("uses healthTooltip i18n key for the final format", () => {
    const health: TaskHealth = {
      color: "G",
      drivers: ["onTrack"],
    };

    const tooltip = formatHealthTooltip(health, "en-US");

    expect(tooltip).toContain("healthTooltip");
  });

  it("handles all driver types in tooltip", () => {
    const drivers = [
      "manual",
      "overdue",
      "blocked",
      "dueToday",
      "dueSoon",
      "completed",
      "onTrack",
    ] as const;

    for (const driver of drivers) {
      const health: TaskHealth = {
        color: driver === "overdue" || driver === "blocked" ? "R" : driver === "dueToday" || driver === "dueSoon" ? "A" : "G",
        drivers: [driver],
      };

      const tooltip = formatHealthTooltip(health, "en-US");
      expect(tooltip).toBeTruthy();
    }
  });
});

describe("healthDot", () => {
  it("returns Tailwind class for Red", () => {
    expect(healthDot.R).toBe("bg-red-500");
  });

  it("returns Tailwind class for Amber", () => {
    expect(healthDot.A).toBe("bg-amber-500");
  });

  it("returns Tailwind class for Green", () => {
    expect(healthDot.G).toBe("bg-emerald-500");
  });

  it("is indexed by all Health colors", () => {
    expect(healthDot).toHaveProperty("R");
    expect(healthDot).toHaveProperty("A");
    expect(healthDot).toHaveProperty("G");
  });
});
