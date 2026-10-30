// §769 spec, "Grounding" caps — the size test the spec asked for: a large project's digest stays within a stated
// input budget, and the largest answer the parser accepts fits the call's output budget.
//
// ESTIMATE RULE: tokens ≈ characters / 3.5. It is the rule `ALLOC_CONTEXT_MAX_PERIODS`'s comment uses
// (alloc-plan.ts), and it matches the figure `alloc-plan-call.ts` quotes for the answer (200 cells ≈ 2,900–3,300
// tokens of tool-use JSON). Digits and punctuation tokenise worse than prose, so 3.5 is the cautious side of the
// usual 4.
//
// INPUT BUDGET: 50,000 tokens for the user message plus the system prompt and the tool schema (the user's guide text
// is extra and unbounded here). The call states no input limit, so this test names one: a quarter of a 200k context,
// billed on every propose click. Measured on the sample below (every cap hit, every task spanning all 26 listed
// weeks): ≈41.5k. Before the hours lists were cut to the listed periods it was ≈55k — this test found that (a task
// in a 51-week plan listed all 51 weeks, though the model may use only 26 of the keys).
// OUTPUT BUDGET: the call's `maxTokens: 8192` (alloc-plan-call.ts).
import { describe, expect, it } from "vitest";
import { MAX_ALLOC_ALTERNATIVES, MAX_ALLOC_MOVES } from "./alloc-alternatives";
import { ALLOC_CONTEXT_MAX_RESOURCES, MAX_ALLOC_CELLS, PROPOSE_ALLOCATIONS_TOOL, buildAllocContext, buildAllocSystemPrompt } from "./alloc-plan";
import { ALLOC_CONTEXT_MAX_MILESTONES, ALLOC_CONTEXT_MAX_TASKS } from "./alloc-project-digest";
import { type Discipline, type Grade, type Milestone, type Resource, type ResourcePlan, type Role, type Stakeholder, type Task } from "../types";

const CHARS_PER_TOKEN = 3.5;
const INPUT_BUDGET_TOKENS = 50_000;
const OUTPUT_BUDGET_TOKENS = 8192;
const tokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

// A weekly plan of well over 26 weeks: the RESOURCES part is cut at the period cap, while a task's hours list is not.
const plan: ResourcePlan = { startDate: "2026-09-07", endDate: "2027-08-29", granularity: "week", currency: "EUR" };
const today = "2026-09-07";
const roles: Role[] = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 87.5, externalRate: 120 }];
const disciplines: Discipline[] = [{ id: 1, name: "Solution Architecture" }];
const grades: Grade[] = [{ id: 1, name: "Senior Consultant" }];

function largeProject() {
  const resources: Resource[] = Array.from({ length: ALLOC_CONTEXT_MAX_RESOURCES + 10 }, (_, i) => ({
    id: 100_000 + i, firstName: `Firstname${i}`, lastName: `Longer-Lastname${i}`, roleId: 1, utilizationMode: "hours",
    utilization: {},
  }));
  // Every open task spans the whole plan, so its hours list is as long as the plan allows.
  const tasks: Task[] = Array.from({ length: ALLOC_CONTEXT_MAX_TASKS + 20 }, (_, i) => ({
    id: 200_000 + i, taskName: `A fairly descriptive task name number ${i} for the migration`, assignee: "",
    assigneeEmail: "", resourceId: 100_000 + (i % resources.length), startDate: plan.startDate, dueDate: plan.endDate,
    lastUpdateDate: today, priority: "Medium", status: "In Progress", blockers: "", description: "",
    remainingEstimateMinutes: 400 * 60, dependencies: [{ taskId: 200_000 + ((i + 1) % 150), type: "FS" }],
  }) as Task);
  const milestones: Milestone[] = Array.from({ length: ALLOC_CONTEXT_MAX_MILESTONES + 5 }, (_, i) => ({
    id: 300_000 + i, name: `Milestone ${i}: cut-over rehearsal`, date: "2027-03-01",
    linkedTaskIds: [200_000 + i, 200_000 + i + 1],
  }));
  // RACI on every milestone: two R and one A.
  const stakeholders: Stakeholder[] = Array.from({ length: 30 }, (_, i) => ({
    id: 400_000 + i, name: `S${i}`, category: "Internal", influence: "High", interest: "High", resourceId: 100_000 + i,
    raci: Object.fromEntries(milestones.map((m, j) => [String(m.id), (i + j) % 10 === 0 ? "A" : (i + j) % 10 < 3 ? "R" : "C"])),
  }) as Stakeholder);
  return { resources, tasks, milestones, stakeholders };
}

describe("Plan with AI call size (§769)", () => {
  it("a large project's request stays within the input budget", () => {
    const { resources, tasks, milestones, stakeholders } = largeProject();
    const context = buildAllocContext({
      resources, roles, disciplines, grades, plan, absences: [], workdayHours: 8, holidaySet: new Set<string>(),
      tasks, milestones, stakeholders, instruction: "bring the architects under 100 % in October", today,
    });
    // The sample really is at every cap.
    expect(context).toContain("more resources truncated)");
    expect(context).toContain("more tasks truncated)");
    expect(context).toContain("more milestones truncated)");
    expect(context.split("\n").filter((l) => l.startsWith("milestone #"))).toHaveLength(ALLOC_CONTEXT_MAX_MILESTONES);
    const input = `${buildAllocSystemPrompt()}\n${JSON.stringify(PROPOSE_ALLOCATIONS_TOOL)}\n${context}`;
    expect(tokens(input)).toBeLessThan(INPUT_BUDGET_TOKENS);
  });

  it("the largest answer the parser accepts fits the output budget", () => {
    const line = "x".repeat(200); // summary and rationale at the parser's 200-character cap
    const cellsPer = Math.ceil(MAX_ALLOC_CELLS / MAX_ALLOC_ALTERNATIVES);
    const movesPer = Math.ceil(MAX_ALLOC_MOVES / MAX_ALLOC_ALTERNATIVES);
    const alternatives = Array.from({ length: MAX_ALLOC_ALTERNATIVES }, (_, a) => ({
      summary: line,
      rationale: line,
      taskMoves: Array.from({ length: movesPer }, (_, i) => ({ taskId: 200_000 + a * 100 + i, toResourceId: 100_000 + i })),
      cells: Array.from({ length: cellsPer }, (_, i) => ({ resourceId: 100_000 + i, periodKey: "2026-W38", hours: 123.5 })),
    }));
    expect(alternatives.reduce((n, x) => n + x.cells.length, 0)).toBeGreaterThanOrEqual(MAX_ALLOC_CELLS);
    expect(alternatives.reduce((n, x) => n + x.taskMoves.length, 0)).toBeGreaterThanOrEqual(MAX_ALLOC_MOVES);
    expect(tokens(JSON.stringify({ alternatives }))).toBeLessThan(OUTPUT_BUDGET_TOKENS);
  });
});
