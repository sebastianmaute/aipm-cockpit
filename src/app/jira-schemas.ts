// Runtime shapes for the Jira responses the client reads (open-followups §7, B4).
//
// The `/api/jira/*` routes relay Atlassian's JSON unchanged, so every response is untrusted
// external data. Before this module the client cast it (`data as T`), and a field of the wrong
// type reached the task mapping as whatever it happened to be.
//
// Two levels of strictness, on purpose:
// - The ENVELOPE of a response (an issue's `key`, a project's `id`/`key`/`name`, the user the
//   connection test returns) must match, or the item is unusable.
// - An issue's FIELDS are lenient: one of the wrong type becomes `undefined` instead of rejecting
//   the issue. `issueToTaskFields` already sanitizes every field it keeps, and dropping a whole
//   issue over, say, a malformed `priority` would lose the rest of its data on the next sync.
//
// A list keeps its valid items and reports how many it dropped (`parseJiraList`), so one malformed
// issue cannot stop a sync.

import { z } from "zod";

/** Optional, and `undefined` when present with the wrong type. */
const lenient = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);
/** As `lenient`, but `null` is kept: Jira sends `null` for an unset field. */
const lenientNullable = <T extends z.ZodType>(schema: T) => schema.nullable().optional().catch(undefined);

export const jiraUserSchema = z.object({
  accountId: z.string(),
  displayName: z.string(),
  emailAddress: lenient(z.string()),
});

export const jiraProjectSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
});

export const jiraIssueTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: lenient(z.string()),
  subtask: lenient(z.boolean()),
});

const nameOnly = z.object({ name: lenient(z.string()) });

export const jiraIssueSchema = z.object({
  key: z.string().min(1),
  fields: lenient(
    z.object({
      summary: lenient(z.string()),
      duedate: lenientNullable(z.string()),
      updated: lenientNullable(z.string()),
      resolutiondate: lenientNullable(z.string()),
      // Keep the strings and drop the rest, rather than losing every label to one bad entry.
      labels: lenient(z.array(z.unknown()).transform((a) => a.filter((x): x is string => typeof x === "string"))),
      assignee: lenientNullable(
        z.object({
          displayName: lenient(z.string()),
          emailAddress: lenient(z.string()),
          accountId: lenient(z.string()),
        }),
      ),
      priority: lenientNullable(nameOnly),
      status: lenientNullable(
        z.object({
          statusCategory: lenient(z.object({ key: lenient(z.string()) })),
          name: lenient(z.string()),
        }),
      ),
      issuetype: lenientNullable(nameOnly),
      /** Atlassian Document Format; `adfToText` walks it defensively. ★ `.optional()` is
       *  load-bearing: in zod 4 a bare `z.unknown()` key is REQUIRED, so an issue without a
       *  description failed this object and lost every field to the outer `catch`. */
      description: z.unknown().optional(),
    }),
  ),
});

/** The list envelopes. Items stay `unknown` here and are checked one by one. */
export const jiraProjectsEnvelope = z.object({ values: z.array(z.unknown()) });
export const jiraIssueTypesEnvelope = z.object({ issueTypes: z.array(z.unknown()).optional() });
export const jiraUsersEnvelope = z.array(z.unknown());
export const jiraSearchEnvelope = z.object({
  issues: z.array(z.unknown()).optional(),
  nextPageToken: lenient(z.string()),
  isLast: lenient(z.boolean()),
});
export const jiraCreatedIssueSchema = z.object({
  id: lenient(z.string()),
  key: z.string().min(1),
  self: lenient(z.string()),
});

/** Keeps the items that match `schema` and counts the rest. */
export function parseJiraList<T>(schema: z.ZodType<T>, items: readonly unknown[]): { items: T[]; dropped: number } {
  const out: T[] = [];
  let dropped = 0;
  for (const item of items) {
    const r = schema.safeParse(item);
    if (r.success) out.push(r.data);
    else dropped += 1;
  }
  return { items: out, dropped };
}
