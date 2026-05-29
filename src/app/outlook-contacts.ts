// src/app/outlook-contacts.ts
//
// Pure core for the Outlook contacts import (M3). No React, no window —
// the Graph token + I/O live in use-outlook-contacts.ts. This module maps
// raw Graph /me/contacts items into the app's people model and merges them
// into the resource directory + assignee address book.

import type { Resource } from "./types";
import { nextId } from "./resource-foundation";
import { sanitizeEmail } from "./sanitize";

/** Raw Graph /me/contacts item — the subset we $select. */
export interface GraphContact {
  id?: string;
  displayName?: string | null;
  givenName?: string | null;
  surname?: string | null;
  emailAddresses?: { address?: string | null }[] | null;
  jobTitle?: string | null;
  department?: string | null;
  companyName?: string | null;
  businessPhones?: (string | null)[] | null;
  mobilePhone?: string | null;
  officeLocation?: string | null;
  birthday?: string | null; // ISO; year 0001 == "no year"
}

/** Normalized, app-facing contact. `email` is lower-cased; "" when absent. */
export interface OutlookContact {
  sourceId: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  title?: string;
  department?: string;
  company?: string;
  phone?: string;
  location?: string;
  birthday?: string; // "YYYY-MM-DD" or "MM-DD"
}

function clean(s?: string | null): string | undefined {
  if (typeof s !== "string") return undefined;
  const trimmed = s.trim();
  return trimmed || undefined;
}

function normEmail(e?: string | null): string {
  return (e ?? "").trim().toLowerCase();
}

/** Graph birthday ISO → "YYYY-MM-DD" (real year) or "MM-DD" (year 0001). */
export function parseGraphBirthday(iso?: string | null): string | undefined {
  if (typeof iso !== "string") return undefined;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return undefined;
  const [, yyyy, mm, dd] = m;
  const mi = Number(mm);
  const di = Number(dd);
  if (mi < 1 || mi > 12 || di < 1 || di > 31) return undefined;
  return yyyy === "0001" ? `${mm}-${dd}` : `${yyyy}-${mm}-${dd}`;
}

export function mapGraphContact(
  raw: GraphContact,
  index: number,
): OutlookContact | null {
  const email = normEmail(sanitizeEmail(raw.emailAddresses?.[0]?.address ?? ""));
  let firstName = clean(raw.givenName) ?? "";
  let lastName = clean(raw.surname) ?? "";
  const displayRaw = clean(raw.displayName);

  if (!firstName && !lastName) {
    if (displayRaw) {
      const parts = displayRaw.split(/\s+/);
      firstName = parts[0];
      lastName = parts.slice(1).join(" ");
    } else if (email) {
      firstName = email.split("@")[0];
    }
  }

  if (!firstName && !lastName && !email) return null;

  const displayName =
    displayRaw ??
    ([firstName, lastName].filter(Boolean).join(" ").trim() ||
      (email ? email.split("@")[0] : ""));

  const phone = clean(raw.businessPhones?.[0]) ?? clean(raw.mobilePhone);

  const out: OutlookContact = {
    sourceId: clean(raw.id) ?? `graph-${index}`,
    firstName,
    lastName,
    displayName,
    email,
  };
  const title = clean(raw.jobTitle);
  if (title) out.title = title;
  const department = clean(raw.department);
  if (department) out.department = department;
  const company = clean(raw.companyName);
  if (company) out.company = company;
  if (phone) out.phone = phone;
  const location = clean(raw.officeLocation);
  if (location) out.location = location;
  const birthday = parseGraphBirthday(raw.birthday);
  if (birthday) out.birthday = birthday;
  return out;
}

/**
 * Merge selected contacts into the resource list. Matches existing resources
 * by normalized email: a match UPDATES the mutable contact fields (the
 * "offer to update" rule — latest Outlook value wins, including clearing a
 * field the contact leaves blank) while preserving id/roleId/utilization and
 * the other planner-owned fields. No match appends a new resource with the
 * next free id. Immutable — returns a brand-new array.
 */
export function mergeImportedResources(
  existing: readonly Resource[],
  selected: readonly OutlookContact[],
): Resource[] {
  const result: Resource[] = existing.map((r) => ({ ...r }));
  const indexByEmail = new Map<string, number>();
  result.forEach((r, i) => {
    const e = normEmail(r.email);
    if (e) indexByEmail.set(e, i);
  });

  for (const c of selected) {
    const e = normEmail(c.email);
    if (e && indexByEmail.has(e)) {
      const i = indexByEmail.get(e)!;
      const prev = result[i];
      result[i] = {
        ...prev,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email || undefined,
        title: c.title,
        department: c.department,
        businessPhone: c.phone,
        company: c.company,
        location: c.location,
        birthday: c.birthday,
      };
    } else {
      const created: Resource = {
        id: nextId(result),
        firstName: c.firstName,
        lastName: c.lastName,
        roleId: null,
        utilizationMode: "percent",
        utilization: {},
      };
      if (c.email) created.email = c.email;
      if (c.title) created.title = c.title;
      if (c.department) created.department = c.department;
      if (c.phone) created.businessPhone = c.phone;
      if (c.company) created.company = c.company;
      if (c.location) created.location = c.location;
      if (c.birthday) created.birthday = c.birthday;
      result.push(created);
      if (e) indexByEmail.set(e, result.length - 1);
    }
  }
  return result;
}

/** Project selected contacts into address-book seed pairs (skip blank names). */
export function contactsFromImported(
  selected: readonly OutlookContact[],
): { name: string; email: string }[] {
  return selected
    .filter((c) => c.displayName.trim() !== "")
    .map((c) => ({ name: c.displayName, email: c.email }));
}
