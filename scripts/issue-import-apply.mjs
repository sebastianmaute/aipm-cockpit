/** Applies an import plan (issue-import-lib.mjs) through an injected client, so every
 *  guard is testable without a network. The CLI supplies the real clients. */
import { PLACEHOLDER_TITLE } from "./issue-import-lib.mjs";

export class Refused extends Error {}
export class RateLimited extends Error {
  constructor(message, retryAfterMs) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}

const MAX_RETRIES = 8;

async function withRetry(fn, sleep, log) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof RateLimited) || attempt >= MAX_RETRIES) throw err;
      log(`rate limited; waiting ${err.retryAfterMs} ms`);
      await sleep(err.retryAfterMs);
    }
  }
}

function checkExisting(actions, existing) {
  const byN = new Map(actions.map((a) => [a.n, a]));
  for (const issue of existing) {
    const a = byN.get(issue.number);
    if (!a || a.title !== issue.title) {
      throw new Refused(`existing #${issue.number} ("${issue.title}") does not match the plan — cannot resume`);
    }
  }
}

// Every non-placeholder action at or below the highest existing number must actually be
// listed. A missing one (a real API dropping a page, say) would otherwise be silently
// skipped by the "already created" check below, breaking the one-to-one number mapping.
function checkResumeComplete(actions, existing, highest) {
  const listed = new Set(existing.map((i) => i.number));
  for (const a of actions) {
    if (a.n > highest || a.kind === "placeholder") continue;
    if (!listed.has(a.n)) {
      throw new Refused(`existing #${a.n} is missing from the listing — cannot resume`);
    }
  }
}

export async function applyPlan(actions, client, { resume = false, sleep, log }) {
  if (actions.length === 0) throw new Refused("the plan holds no actions");
  const { issues, pulls } = await client.counts();
  if (pulls > 0) throw new Refused(`the target has ${pulls} pull request(s); numbers can no longer be preserved`);
  if (issues > 0 && !resume) throw new Refused(`the target already has ${issues} issue(s); use --resume or a fresh repository`);

  const existing = resume ? await client.listIssues() : [];
  checkExisting(actions, existing);
  const highest = Math.max(0, ...existing.map((i) => i.number));
  checkResumeComplete(actions, existing, highest);

  await client.ensureLabels([...new Set(actions.flatMap((a) => a.labels))]);

  let created = 0;
  let closed = 0;
  for (const a of actions) {
    if (a.n <= highest) continue;
    const { number } = await withRetry(() => client.createIssue(a), sleep, log);
    if (number !== a.n) {
      throw new Refused(
        `expected #${a.n}, got #${number}; stopped — numbers can no longer be preserved on this target; ` +
          "start over with a fresh repository (--resume cannot recover this)",
      );
    }
    created += 1;
    if (a.kind === "stub") {
      await withRetry(() => client.closeIssue(number), sleep, log);
      closed += 1;
    }
    log(`#${number} ${a.kind}`);
  }
  // Stubs created before a crash may still be open; close them now.
  for (const i of existing) {
    const a = actions.find((x) => x.n === i.number);
    if (a.kind === "stub" && i.state !== "closed") {
      await withRetry(() => client.closeIssue(i.number), sleep, log);
      closed += 1;
    }
  }

  let deleted = 0;
  const live = await client.listIssues();
  for (const i of live) {
    if (i.title !== PLACEHOLDER_TITLE) continue;
    await withRetry(() => client.deleteIssue(i.nodeId), sleep, log);
    deleted += 1;
  }
  return { created, closed, deleted };
}

export async function closeOnGitLab(actions, gitlab, { githubUrl, log }) {
  let closedCount = 0;
  let skipped = 0;
  for (const a of actions) {
    if (a.kind !== "open") continue;
    const body = `Moved to GitHub #${a.n}: ${githubUrl}/issues/${a.n}`;
    const current = await gitlab.get(a.n);
    if (current.state === "closed" && current.notes.includes(body)) {
      skipped += 1;
      continue;
    }
    if (!current.notes.includes(body)) await gitlab.comment(a.n, body);
    if (current.state !== "closed") await gitlab.close(a.n);
    closedCount += 1;
    log(`GitLab #${a.n} closed`);
  }
  return { closed: closedCount, skipped };
}
