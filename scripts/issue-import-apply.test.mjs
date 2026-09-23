import { describe, expect, it } from "vitest";
import { applyPlan, closeOnGitLab, RateLimited, Refused } from "./issue-import-apply.mjs";
import { PLACEHOLDER_TITLE } from "./issue-import-lib.mjs";

/** In-memory GitHub: numbers are assigned in sequence and shared with PRs; deleted
 *  numbers stay used. */
function fakeGitHub({ pulls = 0, preIssues = 0, rateLimitOnce = new Set(), foreignCreateAt = null } = {}) {
  let next = 1 + pulls;
  const issues = new Map();
  const labels = new Set();
  const calls = [];
  const add = (title, state = "open") => {
    const number = next++;
    issues.set(number, { number, title, state, nodeId: `N${number}`, deleted: false });
    return number;
  };
  for (let i = 0; i < preIssues; i++) add(`pre ${i}`);
  return {
    calls,
    issues,
    labels,
    async counts() {
      return { issues: [...issues.values()].filter((i) => !i.deleted).length, pulls };
    },
    async listIssues() {
      return [...issues.values()].filter((i) => !i.deleted).map(({ number, title, state, nodeId }) => ({ number, title, state, nodeId }));
    },
    async ensureLabels(names) {
      calls.push(["labels", names.length]);
      names.forEach((n) => labels.add(n));
    },
    async createIssue({ title }) {
      if (rateLimitOnce.has(title)) {
        rateLimitOnce.delete(title);
        throw new RateLimited("slow down", 5);
      }
      if (foreignCreateAt !== null && next === foreignCreateAt) add("someone else");
      const number = add(title);
      calls.push(["create", number]);
      return { number, nodeId: `N${number}` };
    },
    async closeIssue(number) {
      issues.get(number).state = "closed";
      calls.push(["close", number]);
    },
    async deleteIssue(nodeId) {
      const n = Number(nodeId.slice(1));
      issues.get(n).deleted = true;
      calls.push(["delete", n]);
    },
  };
}

const plan = [
  { n: 1, kind: "placeholder", title: PLACEHOLDER_TITLE, body: "", labels: [] },
  { n: 2, kind: "open", title: "§2: two", body: "b", labels: ["type::defect"] },
  { n: 3, kind: "stub", title: "GitLab #3, closed before the migration", body: "s", labels: [] },
  { n: 4, kind: "open", title: "§4: four", body: "b", labels: ["theme::ux", "type::defect"] },
];
const noSleep = async () => {};
const quiet = () => {};

describe("applyPlan", () => {
  it("preserves every number, closes stubs, and deletes placeholders last", async () => {
    const gh = fakeGitHub();
    const r = await applyPlan(plan, gh, { sleep: noSleep, log: quiet });
    expect(r).toEqual({ created: 4, closed: 1, deleted: 1 });
    expect(gh.issues.get(2).title).toBe("§2: two");
    expect(gh.issues.get(3).state).toBe("closed");
    expect(gh.issues.get(1).deleted).toBe(true);
    expect(gh.calls.at(-1)).toEqual(["delete", 1]);
    expect(gh.calls[0]).toEqual(["labels", 2]);
  });
  it("refuses a target that has a pull request, before any write", async () => {
    const gh = fakeGitHub({ pulls: 1 });
    await expect(applyPlan(plan, gh, { sleep: noSleep, log: quiet })).rejects.toThrow(Refused);
    expect(gh.calls).toEqual([]);
  });
  it("refuses a target that already has issues unless resuming", async () => {
    const gh = fakeGitHub({ preIssues: 1 });
    await expect(applyPlan(plan, gh, { sleep: noSleep, log: quiet })).rejects.toThrow(/1 issue/);
    expect(gh.calls).toEqual([]);
  });
  it("stops at once when GitHub assigns an unexpected number", async () => {
    const gh = fakeGitHub({ foreignCreateAt: 3 });
    await expect(applyPlan(plan, gh, { sleep: noSleep, log: quiet })).rejects.toThrow(/expected #3.*got #4/);
    expect(gh.calls.filter((c) => c[0] === "create").map((c) => c[1])).toEqual([1, 2, 4]);
  });
  it("waits and retries the same number on a rate limit", async () => {
    const gh = fakeGitHub({ rateLimitOnce: new Set(["§2: two"]) });
    const slept = [];
    await applyPlan(plan, gh, { sleep: async (ms) => slept.push(ms), log: quiet });
    expect(slept).toContain(5);
    expect(gh.issues.get(2).title).toBe("§2: two");
  });
  it("resumes from the highest existing number after checking every existing one", async () => {
    const gh = fakeGitHub();
    await applyPlan(plan.slice(0, 2), gh, { sleep: noSleep, log: quiet }).catch(() => {});
    // the first run created #1-#2 and deleted #1; simulate the crash before the delete:
    gh.issues.get(1).deleted = false;
    const r = await applyPlan(plan, gh, { resume: true, sleep: noSleep, log: quiet });
    expect(r.created).toBe(2);
    expect([...gh.issues.values()].filter((i) => !i.deleted).map((i) => i.number)).toEqual([2, 3, 4]);
  });
  it("refuses to resume when an existing number disagrees with the plan", async () => {
    const gh = fakeGitHub({ preIssues: 1 });
    await expect(applyPlan(plan, gh, { resume: true, sleep: noSleep, log: quiet })).rejects.toThrow(/#1/);
  });
  it("refuses a plan that holds no actions", async () => {
    await expect(applyPlan([], fakeGitHub(), { sleep: noSleep, log: quiet })).rejects.toThrow(Refused);
  });
});

describe("closeOnGitLab", () => {
  it("comments and closes each imported issue once, and skips one already moved", async () => {
    const state = new Map([
      [2, { state: "opened", notes: [] }],
      [4, { state: "closed", notes: ["Moved to GitHub #4: https://github.com/o/r/issues/4"] }],
    ]);
    const log = [];
    const gitlab = {
      get: async (iid) => state.get(iid),
      comment: async (iid, body) => log.push(["comment", iid, body]),
      close: async (iid) => log.push(["close", iid]),
    };
    const r = await closeOnGitLab(plan, gitlab, { githubUrl: "https://github.com/o/r", log: quiet });
    expect(r).toEqual({ closed: 1, skipped: 1 });
    expect(log).toEqual([
      ["comment", 2, "Moved to GitHub #2: https://github.com/o/r/issues/2"],
      ["close", 2],
    ]);
  });
});
