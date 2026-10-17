// §715 — the demo week's names and dates, shared by the recorder (scripts/demo-video) and E's tests
// (src/test/demo-week.ts re-exports them), so the video and the pinned data cannot drift apart.
// Spec: docs/superpowers/specs/2026-10-16-demo-week-story-design.md, "The week".

/** Monday 21 to Friday 25 September 2026: the days of the big video. */
export const DEMO_WEEK_DATES = Object.freeze({
  mon: "2026-09-21", tue: "2026-09-22", wed: "2026-09-23", thu: "2026-09-24", fri: "2026-09-25",
});

/** The near-duplicate follow-ups the master plants on Friday 18th; Tuesday leaves one of each pair. */
export const DEMO_DUPLICATE_PAIRS = Object.freeze([
  Object.freeze(["Fix CRM sync for new registrations", "CRM provisioning fails for sign-ups"]),
  Object.freeze(["Erasure requests not reaching the CRM", "GDPR delete does not propagate to the CRM"]),
  Object.freeze(["Re-run the MVP demo checklist", "Prepare the MVP demo re-run"]),
]);

export const DEMO_CRM_TASK = "Integrate CRM provisioning";
export const DEMO_GDPR_ISSUE = "GDPR erasure requests do not reach the CRM";
export const DEMO_NEW_MEMBER = Object.freeze({ firstName: "Lukas", lastName: "Brandt" });
export const DEMO_DPO = "Northwind DPO";
export const DEMO_LICENCE_RISK = "connector licence lead time";
export const DEMO_MAYA_RELIEVED_HOURS = 160;

const MEMBER = `${DEMO_NEW_MEMBER.firstName} ${DEMO_NEW_MEMBER.lastName}`;

/**
 * What the project must hold after each day's steps, in workspace terms (collection, then the row whose
 * `key` equals `value`, then `field`). The recorder's rehearsal checks them against the live database
 * after each replayed or recorded day; `week-story.test.ts` checks them against E's `applyDemoWeek`.
 */
export const DAY_FACTS = Object.freeze({
  mon: [
    { collection: "tasks", key: "taskName", value: DEMO_CRM_TASK, field: "blockers", expected: "CRM API rejects erasure calls" },
    { collection: "tasks", key: "taskName", value: DEMO_CRM_TASK, field: "dueDate", expected: "2026-09-24" },
  ],
  tue: [
    { collection: "tasks", key: "taskName", value: DEMO_CRM_TASK, field: "status", expected: "In Progress" },
    { collection: "milestones", key: "name", value: "MVP re-demo", field: "date", expected: "2026-10-02" },
    { collection: "tasks", key: "taskName", value: "MVP demo to the customer", field: "dueDate", expected: "2026-10-02" },
  ],
  wed: [
    { collection: "resources", key: "lastName", value: DEMO_NEW_MEMBER.lastName, field: "firstName", expected: DEMO_NEW_MEMBER.firstName },
    { collection: "tasks", key: "taskName", value: DEMO_DUPLICATE_PAIRS[0][1], field: "assignee", expected: MEMBER },
  ],
  thu: [
    { collection: "raid", key: "title", value: DEMO_GDPR_ISSUE, field: "owner", expected: "Noah Bennett" },
    { collection: "changes", key: "title", value: "Add a CRM provisioning connector", field: "status", expected: "Approved" },
    { collection: "changes", key: "title", value: "Add MFA to SSO scope", field: "status", expected: "Approved" },
    { collection: "milestones", key: "name", value: "MVP target", field: "date", expected: "2026-10-01" },
    { collection: "raid", key: "title", value: DEMO_LICENCE_RISK, field: "severity", expected: "Medium" },
  ],
  fri: [
    { collection: "tasks", key: "taskName", value: DEMO_CRM_TASK, field: "status", expected: "Done" },
    { collection: "raid", key: "title", value: DEMO_GDPR_ISSUE, field: "status", expected: "Resolved" },
  ],
});
