// Client-side wrappers around /api/jira/* server proxy routes.
// Credentials live in localStorage (via Settings) and are sent in each request
// body to localhost; the server-side handlers attach Basic auth and call
// Atlassian on the user's behalf.

import { adfToText, textToAdf } from "./adf";
import { jiraCategoryToStatus, statusToJiraCategory } from "./jira-status-map";
import { jiraProjectKeys } from "./jira-projects";
import {
  isWriteSafeEmail,
  sanitizeAssignee,
  sanitizeLoadedEmail,
  sanitizeIsoDate,
  sanitizeLabels,
  sanitizeTaskName,
} from "./sanitize";
import { logDiag } from "./diagnostics";
import {
  jiraCreatedIssueSchema, jiraIssueSchema, jiraIssueTypeSchema, jiraIssueTypesEnvelope, jiraProjectSchema,
  jiraProjectsEnvelope, jiraSearchEnvelope, jiraUserSchema, jiraUsersEnvelope, parseJiraList,
} from "./jira-schemas";
import type { z } from "zod";
import { plainToHtml } from "./sanitize-html";
import { descriptionText } from "./rich-text-projection";
import type { JiraConfig } from "./settings-types";
import type { Priority, Task, TaskStatus } from "./types";

export type JiraCreds = Pick<JiraConfig, "siteUrl" | "email" | "apiToken">;

export type JiraUser = {
  accountId: string;
  displayName: string;
  emailAddress?: string;
};

export type JiraProject = {
  id: string;
  key: string;
  name: string;
};

export type JiraIssueType = {
  id: string;
  name: string;
  description?: string;
  subtask?: boolean;
};

export class JiraApiError extends Error {
  constructor(
    public status: number,
    public payload: unknown,
  ) {
    super(`Jira ${status}`);
    this.name = "JiraApiError";
  }
}

/** The `error` a malformed (but HTTP-successful) response is reported with; `formatJiraError` shows it. */
export const JIRA_MALFORMED_RESPONSE = "Malformed Jira response";

async function post(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    throw new JiraApiError(res.status, data);
  }
  return data;
}

// §7 B4 — every response is untrusted external data, checked against `jira-schemas.ts` here. A
// response whose envelope does not match throws a `JiraApiError` that classifies as "other", never
// "network", so sync does not treat it as transient. The path is logged; the payload never is.
function parseResponse<T>(schema: z.ZodType<T>, data: unknown, path: string): T {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  logDiag("warn", "jira.malformedResponse", { path });
  // 200: the request succeeded; only the body is unusable.
  throw new JiraApiError(200, { error: JIRA_MALFORMED_RESPONSE });
}

/** Keeps the valid items of a list response and logs how many were dropped. */
function keepValid<T>(schema: z.ZodType<T>, items: readonly unknown[], path: string): T[] {
  const { items: ok, dropped } = parseJiraList(schema, items);
  if (dropped > 0) logDiag("warn", "jira.malformedItems", { path, dropped });
  return ok;
}

export async function testConnection(creds: JiraCreds): Promise<JiraUser> {
  const path = "/api/jira/test";
  return parseResponse(jiraUserSchema, await post(path, creds), path);
}

export async function listProjects(creds: JiraCreds): Promise<JiraProject[]> {
  const path = "/api/jira/projects";
  const r = parseResponse(jiraProjectsEnvelope, await post(path, creds), path);
  return keepValid(jiraProjectSchema, r.values, path);
}

export async function listIssueTypes(
  creds: JiraCreds,
  projectKey: string,
): Promise<JiraIssueType[]> {
  const path = "/api/jira/issue-types";
  const r = parseResponse(jiraIssueTypesEnvelope, await post(path, { ...creds, projectKey }), path);
  return keepValid(jiraIssueTypeSchema, r.issueTypes ?? [], path);
}

export async function searchUsers(
  creds: JiraCreds,
  projectKey: string,
  query: string,
): Promise<JiraUser[]> {
  const path = "/api/jira/users";
  const r = parseResponse(jiraUsersEnvelope, await post(path, { ...creds, projectKey, query }), path);
  return keepValid(jiraUserSchema, r, path);
}

// --- JQL search + issue mapping --------------------------------------------

export type JiraIssue = {
  key: string;
  fields?: {
    summary?: string;
    duedate?: string | null;
    updated?: string | null;
    resolutiondate?: string | null;
    labels?: string[];
    assignee?: {
      displayName?: string;
      emailAddress?: string;
      accountId?: string;
    } | null;
    priority?: { name?: string } | null;
    status?: { statusCategory?: { key?: string }; name?: string } | null;
    issuetype?: { name?: string } | null;
    /** Atlassian Document Format JSON tree (or null for no description). */
    description?: unknown;
  };
};

/**
 * Page through every issue matching the JQL. Caps at 2000 to avoid runaway loops;
 * raise if your project regularly exceeds that.
 */
export async function searchAllIssues(
  creds: JiraCreds,
  jql: string,
  hardCap = 2000,
): Promise<JiraIssue[]> {
  const all: JiraIssue[] = [];
  let nextPageToken: string | undefined;
  while (all.length < hardCap) {
    const path = "/api/jira/search";
    const r = parseResponse(jiraSearchEnvelope, await post(path, { ...creds, jql, nextPageToken }), path);
    all.push(...keepValid<JiraIssue>(jiraIssueSchema, r.issues ?? [], path));
    if (r.isLast || !r.nextPageToken) break;
    nextPageToken = r.nextPageToken;
  }
  return all;
}

function escapeJqlString(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Build a JQL query from the configured Jira scope. Returns `null` when the
 * scope is too incomplete to be useful (e.g. no project).
 */
export function buildJql(config: JiraConfig): string | null {
  const keys = jiraProjectKeys(config);
  if (keys.length === 0) return null;
  const projectClause =
    keys.length === 1
      ? `project = "${escapeJqlString(keys[0])}"`
      : `project in (${keys.map((k) => `"${escapeJqlString(k)}"`).join(", ")})`;
  const parts: string[] = [projectClause];

  if (config.assigneeMode === "currentUser") {
    parts.push("assignee = currentUser()");
  } else if (config.assigneeMode === "specific" && config.assigneeAccountId) {
    parts.push(`assignee = "${escapeJqlString(config.assigneeAccountId)}"`);
  }
  // "any" → no assignee filter.

  if (config.issueTypes.length > 0) {
    const list = config.issueTypes
      .map((t) => `"${escapeJqlString(t)}"`)
      .join(", ");
    parts.push(`issuetype in (${list})`);
  }

  return parts.join(" AND ") + " ORDER BY updated DESC";
}

function mapPriority(name: string | undefined): Priority {
  switch (name) {
    case "Highest":
      return "Urgent";
    case "High":
      return "High";
    case "Medium":
      return "Medium";
    case "Low":
    case "Lowest":
      return "Low";
    default:
      return "Medium";
  }
}

/**
 * Translate a Jira issue into the subset of Task fields the sync owns.
 * Local-only fields (id, blockers, inquiriesSent, group) are not set here —
 * the caller decides how to merge with existing tasks. Notes are now Jira-owned
 * for linked tasks (mirrors the description field via ADF↔plain-text).
 */
export function issueToTaskFields(
  issue: JiraIssue,
  todayIso: string,
): Partial<Task> & { status: TaskStatus } {
  const f = issue.fields ?? {};
  const updated = (f.updated ?? "").slice(0, 10);
  const resolved = (f.resolutiondate ?? "").slice(0, 10);
  const statusKey = f.status?.statusCategory?.key ?? "";
  const isDone = statusKey === "done";
  // Spec Part 2: a synced record keeps everything but an address that is not
  // write-safe after normalising; the diagnostic names the issue, never the address.
  const syncedEmail = sanitizeLoadedEmail(f.assignee?.emailAddress ?? "");
  const assigneeEmail = syncedEmail === "" || isWriteSafeEmail(syncedEmail) ? syncedEmail : "";
  if (assigneeEmail !== syncedEmail) logDiag("warn", "jira.assigneeEmailDropped", { issueKey: issue.key, field: "assigneeEmail" });

  return {
    taskName: sanitizeTaskName(f.summary ?? issue.key),
    assignee: sanitizeAssignee(f.assignee?.displayName ?? ""),
    assigneeEmail,
    dueDate: sanitizeIsoDate(f.duedate ?? "") || "",
    lastUpdateDate: sanitizeIsoDate(updated) || todayIso,
    priority: mapPriority(f.priority?.name),
    labels: sanitizeLabels(f.labels ?? []),
    description: plainToHtml(adfToText(f.description)),
    completedDate: isDone
      ? sanitizeIsoDate(resolved) || sanitizeIsoDate(updated) || todayIso
      : undefined,
    status: jiraCategoryToStatus(statusKey),
    jiraKey: issue.key,
    jiraIssueType: f.issuetype?.name ?? undefined,
  };
}

// --- write back ------------------------------------------------------------

function priorityToJira(p: Priority): string {
  switch (p) {
    case "Urgent":
      return "Highest";
    case "High":
      return "High";
    case "Medium":
      return "Medium";
    case "Low":
      return "Low";
  }
}

/**
 * Build the Jira `fields` object for a PUT update. Pushes the subset of fields
 * Jira owns: summary, priority, labels, duedate, description. Notes are
 * serialized as ADF (lossy: rich formatting in the original Jira description
 * is flattened on round-trip — paragraphs and line breaks survive). Local-only
 * fields (blockers, group, inquiriesSent) are not pushed.
 */
export function taskFieldsToJiraFields(task: Task): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    summary: task.taskName,
    priority: { name: priorityToJira(task.priority) },
    labels: Array.isArray(task.labels) ? task.labels : [],
    description: textToAdf(descriptionText(task.description ?? "")),
  };
  // Jira treats empty-string duedate as a clear; null also works. Use null
  // to keep the API expectation explicit.
  fields.duedate = task.dueDate ? task.dueDate : null;
  return fields;
}

export async function updateIssue(
  creds: JiraCreds,
  key: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await post("/api/jira/update-issue", {
    ...creds,
    key,
    fields,
  });
}

export type CreatedIssue = { id?: string; key: string; self?: string };

/**
 * Create a brand-new Jira issue from local task fields. Returns the new key
 * (e.g. "LOP-42") on success. `fields` should be the output of
 * `taskFieldsToJiraFields` — assignee is deliberately not pushed (we don't
 * carry accountIds locally; user sets the assignee in Jira after creation).
 */
export async function createIssue(
  creds: JiraCreds,
  projectKey: string,
  issueType: string,
  fields: Record<string, unknown>,
): Promise<CreatedIssue> {
  const path = "/api/jira/create-issue";
  return parseResponse(jiraCreatedIssueSchema, await post(path, { ...creds, projectKey, issueType, fields }), path);
}

/** Pick the default issue type for newly-pushed local tasks. */
export function defaultIssueTypeForCreate(configured: string[]): string {
  return configured[0] ?? "Task";
}

export type TransitionCategory = "done" | "indeterminate" | "new";

export async function transitionIssueTo(
  creds: JiraCreds,
  key: string,
  targetCategory: TransitionCategory,
): Promise<void> {
  await post("/api/jira/transition-issue", {
    ...creds,
    key,
    targetCategory,
  });
}

/** Whether a Jira issue (as returned by search) is currently in the "done" category. */
export function isIssueDone(issue: JiraIssue): boolean {
  return issue.fields?.status?.statusCategory?.key === "done";
}

// --- conflict resolution ---------------------------------------------------

export type ConflictFieldKey =
  | "taskName"
  | "assignee"
  | "assigneeEmail"
  | "dueDate"
  | "priority"
  | "labels"
  | "description"
  | "completedDate";

export type ConflictField = {
  key: ConflictFieldKey;
  localValue: string | string[] | undefined;
  remoteValue: string | string[] | undefined;
};

export type ConflictItem = {
  taskId: number;
  jiraKey: string;
  jiraIssueType?: string;
  /** Whether the remote issue is currently Done (statusCategory.key === "done"). */
  remoteDone: boolean;
  /** The remote issue's mapped workflow status.
   *  ★★ Carried so the conflict merge can write `status` and `completedDate`
   *  from the SAME side. `status` is deliberately NOT a `ConflictFieldKey` — a
   *  user cannot arbitrate it independently of the date without being able to
   *  construct the very split pair this exists to prevent. */
  remoteStatus: TaskStatus;
  /** The LOCAL row's workflow status at queue time.
   *  ★ Carried purely so the modal can render the completion row as the PAIR it
   *  actually is. The merge does not read it — the local arm takes `status`
   *  from `original`. Without it a status-only conflict renders two identical
   *  dates and the user cannot see what they are choosing between. */
  localStatus: TaskStatus;
  fields: ConflictField[];
};

function normalizeForCompare(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) {
    return [...v.map((x) => String(x))].sort().join("\u0001");
  }
  return String(v);
}

function fieldsDiffer(local: unknown, remote: unknown): boolean {
  return normalizeForCompare(local) !== normalizeForCompare(remote);
}

/**
 * Compare a local task to a Jira issue's mapped fields and return the list of
 * fields that differ. Empty array means no real conflict (the task and the
 * issue agree even though both sides were "touched").
 */
export function diffTaskAgainstIssue(
  local: Task,
  remoteFields: Partial<Task>,
): ConflictField[] {
  const out: ConflictField[] = [];
  const check = (key: ConflictFieldKey) => {
    const l = (local as Partial<Task>)[key];
    const r = remoteFields[key];
    if (fieldsDiffer(l, r)) {
      out.push({
        key,
        localValue: l as string | string[] | undefined,
        remoteValue: r as string | string[] | undefined,
      });
    }
  };
  check("taskName");
  check("assignee");
  check("assigneeEmail");
  check("dueDate");
  check("priority");
  check("labels");
  check("description");
  // ★★★ The completion row represents the PAIR (`status` + `completedDate`),
  //   not the date alone: the merge writes BOTH halves from the side the user
  //   picks, and `status` is deliberately not a ConflictFieldKey. So it must be
  //   queued when EITHER half differs. Testing the date alone dropped a remote
  //   status move whose date had not changed — and when no other field
  //   differed this function returned empty, so no conflict was queued at all
  //   and the move was discarded silently (open-followups §226).
  // ★ `remoteFields.status === undefined` means the patch says nothing about
  //   the remote status; treating that as a difference would queue a phantom
  //   conflict on every sync. ★★ UNREACHABLE FROM THE SYNC HOOK, and kept
  //   anyway: the only non-test caller is `use-jira-sync.ts`, which always
  //   passes an `issueToTaskFields(...)` patch — typed `Partial<Task> & {
  //   status: TaskStatus }`, so its `status` is non-optional by construction.
  //   The guard is for the OTHER callers the exported `Partial<Task>` signature
  //   admits, and is pinned by its own test; do not delete it as dead code
  //   after grepping only the hook.
  // ★★ Compare through the CATEGORY, not the two status strings. Jira carries
  //   three categories against our six statuses, so `On Hold`, `In Review` and
  //   `Cancelled` compare as different forever under a literal test — a
  //   conflict on every dual-changed sync that the user cannot resolve, since
  //   picking remote overwrites the status they chose. Round-tripping the
  //   local status through the lossy map compares the two at the granularity
  //   the wire can actually express, which still catches a genuine move
  //   (`In Progress` is `indeterminate`, `To Do` is `new`).
  const statusDiffers =
    remoteFields.status !== undefined &&
    jiraCategoryToStatus(statusToJiraCategory(local.status)) !== remoteFields.status;
  if (fieldsDiffer(local.completedDate, remoteFields.completedDate) || statusDiffers) {
    out.push({
      key: "completedDate",
      localValue: local.completedDate,
      remoteValue: remoteFields.completedDate,
    });
  }
  return out;
}

// --- error helpers ---------------------------------------------------------

export type JiraErrorKind = "auth" | "network" | "other";

/**
 * Classify a Jira error for use in sync logic. Distinguishes between
 * authentication failures (401/403), network failures (5xx), and other errors.
 */
export function classifyJiraError(err: unknown): JiraErrorKind {
  if (err instanceof JiraApiError) {
    if (err.status === 401 || err.status === 403) return "auth";
    if (err.status >= 500) return "network";
    return "other";
  }
  return "network";
}

/** Best-effort, user-facing message from a JiraApiError payload. */
export function formatJiraError(err: unknown): string {
  if (err instanceof JiraApiError) {
    if (err.status === 401 || err.status === 403) return "Authentication failed";
    if (err.status === 404) return "Not found";
    const p = err.payload as { error?: string; errorMessages?: string[] } | null;
    if (p?.errorMessages?.[0]) return p.errorMessages[0];
    if (p?.error) return p.error;
    return `Jira returned ${err.status}`;
  }
  return err instanceof Error ? err.message : String(err);
}
