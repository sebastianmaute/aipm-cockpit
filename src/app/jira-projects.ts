// src/app/jira-projects.ts
//
// Pure, dependency-light helpers for the multi-project Jira sync. Kept OUT of
// jira-api.ts (which is lazy-loaded to stay off the boot bundle) so use-settings,
// the task badge, and the settings UI can import them cheaply at boot.
import type { JiraConfig, JiraExtraProject } from "./settings-types";

/** Jira issue keys are "<PROJECTKEY>-<number>"; project keys never contain "-". */
export function jiraProjectKeyOf(issueKey: string): string {
  const i = issueKey.indexOf("-");
  return i < 0 ? issueKey : issueKey.slice(0, i);
}

/** Deduped union of the primary project key + every extra project key, with
 *  empty strings removed. Primary comes first. */
export function jiraProjectKeys(
  config: Pick<JiraConfig, "projectKey" | "extraProjects">,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (k: string) => {
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  };
  push(config.projectKey);
  for (const p of config.extraProjects ?? []) push(p.key);
  return out;
}

/** primary -> false; extra project -> its readOnly flag; unrecognized -> true
 *  (never write to a project we don't recognize). */
export function isReadOnlyIssue(
  issueKey: string,
  config: { projectKey: string; extraProjects?: readonly JiraExtraProject[] },
): boolean {
  const project = jiraProjectKeyOf(issueKey);
  if (project === config.projectKey) return false;
  const extra = (config.extraProjects ?? []).find((p) => p.key === project);
  return extra ? extra.readOnly : true;
}

const KEY_RE = /^[A-Za-z0-9_]+$/;
const MAX_EXTRA_PROJECTS = 20;
const NAME_MAX = 120;

/** Validate the persisted extraProjects array from untrusted storage. Drops
 *  malformed/blank/invalid keys, the primary key, and duplicates; defaults a
 *  missing readOnly to true; caps the count. Keys are charset-restricted because
 *  they flow into JQL. */
export function sanitizeJiraExtraProjects(
  raw: unknown,
  primaryKey: string,
): JiraExtraProject[] {
  if (!Array.isArray(raw)) return [];
  const out: JiraExtraProject[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const key = typeof rec.key === "string" ? rec.key.trim() : "";
    if (!key || key.length > 64 || !KEY_RE.test(key)) continue;
    if (key === primaryKey || seen.has(key)) continue;
    seen.add(key);
    const name =
      typeof rec.name === "string" ? rec.name.trim().slice(0, NAME_MAX) : "";
    const readOnly = rec.readOnly === undefined ? true : rec.readOnly === true;
    out.push({ key, name, readOnly });
    if (out.length >= MAX_EXTRA_PROJECTS) break;
  }
  return out;
}
