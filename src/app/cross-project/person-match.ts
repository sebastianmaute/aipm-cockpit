/**
 * Decides which resource in another project is the same person as one in the
 * open project. Pure and i18n-free.
 *
 * Order per pair: a live `different` row means no; a live `same` row matches
 * ("confirmed"); an overlapping usable email matches ("email"); equal first +
 * last name with a usable email missing on at least one side is only a
 * suggestion; anything else is no match.
 *
 * Every resource counts (external and inactive included). Two resources of one
 * other project matching the same person BOTH match, so their hours are summed
 * by the caller.
 *
 * A `same` row is live only while both projects are in the list, both resource
 * ids still exist and both resources still carry the stored first name AND last
 * name, each compared on its own (case-insensitive, trimmed), so re-splitting
 * "Mary Ann"/"Lee" into "Mary"/"Ann Lee" makes it stale. A stale `same` row is
 * ignored and the email/name rules decide. A `different` row is a rejection the
 * user made and applies whatever the names are now: renaming a resource must
 * never let an email match add hours to a pair the user said is not the same.
 * (A row whose project or resource no longer exists matches nothing.)
 */
import type { Resource } from "../types";
import { resourceDisplayName } from "../resource-foundation";

export type LinkVerdict = "same" | "different";

export interface PersonLinkRow {
  projectA: string;
  resourceA: number;
  projectB: string;
  resourceB: number;
  verdict: LinkVerdict;
  firstA: string;
  lastA: string;
  firstB: string;
  lastB: string;
  emailsA: string;
  emailsB: string;
  decidedAt: string;
  decidedBy: string;
}

export interface OtherProjectPeople {
  projectId: string;
  projectName: string;
  resources: readonly Resource[];
}

export interface PersonRelation {
  projectId: string;
  projectName: string;
  resourceId: number;
  via: "email" | "confirmed";
}

export interface PersonMatch {
  matched: PersonRelation[];
  suggestions: Omit<PersonRelation, "via">[];
  rejected: Omit<PersonRelation, "via">[];
}

/** Trimmed, lower-cased addresses over `email` + `emails` that contain "@". */
export function usableEmails(r: Resource): string[] {
  const out: string[] = [];
  for (const raw of [r.email, ...(r.emails ?? [])]) {
    const e = (raw ?? "").trim().toLowerCase();
    if (e !== "" && e.includes("@") && !out.includes(e)) out.push(e);
  }
  return out;
}

export function canonicalPair(
  projectA: string,
  resourceA: number,
  projectB: string,
  resourceB: number,
): { projectA: string; resourceA: number; projectB: string; resourceB: number } {
  return projectA <= projectB
    ? { projectA, resourceA, projectB, resourceB }
    : { projectA: projectB, resourceA: resourceB, projectB: projectA, resourceB: resourceA };
}

const normName = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();

const pairKey = (pa: string, ra: number, pb: string, rb: number): string => {
  const c = canonicalPair(pa, ra, pb, rb);
  return JSON.stringify([c.projectA, c.resourceA, c.projectB, c.resourceB]);
};

/** True while the resource still carries the first and last name stored for its side of the row. */
function namesUnchanged(row: PersonLinkRow, projectId: string, r: Resource): boolean {
  // pairKey guarantees the row concerns this pair, so a non-A side is B.
  const isA = row.projectA === projectId && row.resourceA === r.id;
  const first = isA ? row.firstA : row.firstB;
  const last = isA ? row.lastA : row.lastB;
  return normName(first) === normName(r.firstName) && normName(last) === normName(r.lastName);
}

export function matchPeople(
  hereProjectId: string,
  here: readonly Resource[],
  others: readonly OtherProjectPeople[],
  links: readonly PersonLinkRow[],
): Map<number, PersonMatch> {
  const rowByKey = new Map<string, PersonLinkRow>();
  for (const l of links) rowByKey.set(pairKey(l.projectA, l.resourceA, l.projectB, l.resourceB), l);

  const result = new Map<number, PersonMatch>();
  for (const h of here) {
    const match: PersonMatch = { matched: [], suggestions: [], rejected: [] };
    result.set(h.id, match);
    const hName = normName(resourceDisplayName(h));
    const hEmails = usableEmails(h);

    for (const o of others) {
      for (const r of o.resources) {
        const ref = { projectId: o.projectId, projectName: o.projectName, resourceId: r.id };
        const rName = normName(resourceDisplayName(r));

        const stored = rowByKey.get(pairKey(hereProjectId, h.id, o.projectId, r.id));
        const live =
          stored !== undefined &&
          (stored.verdict === "different" ||
            (namesUnchanged(stored, hereProjectId, h) && namesUnchanged(stored, o.projectId, r)));
        const verdict = live ? stored.verdict : undefined;

        if (verdict === "different") {
          match.rejected.push(ref);
          continue;
        }
        if (verdict === "same") {
          match.matched.push({ ...ref, via: "confirmed" });
          continue;
        }
        const rEmails = usableEmails(r);
        if (hEmails.some((e) => rEmails.includes(e))) {
          match.matched.push({ ...ref, via: "email" });
          continue;
        }
        const missingEmail = hEmails.length === 0 || rEmails.length === 0;
        if (hName !== "" && hName === rName && missingEmail) match.suggestions.push(ref);
      }
    }
  }
  return result;
}
