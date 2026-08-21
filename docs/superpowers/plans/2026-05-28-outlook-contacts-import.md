# Outlook Contacts Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in Microsoft 365 user import their Outlook personal contacts (Graph `/me/contacts`) into both lop-app people surfaces — the rich Resource Directory and the assignee address book — via a preview-and-pick dialog.

**Architecture:** A pure core module (`outlook-contacts.ts`) does all mapping/merge; a hook (`use-outlook-contacts.ts`) isolates the paged Graph fetch; a presentational modal (`outlook-import-modal.tsx`) drives selection; `task-manager.tsx` coordinates auth + state + handlers and a Directory toolbar button triggers it. Reuses M1's `useMsAuth().acquireToken` and mirrors M2's Graph error handling.

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Tailwind v4 / Vitest. `@azure/msal-browser` (already a dependency from M1). Microsoft Graph `GET /me/contacts` (`Contacts.Read`).

**Spec:** `docs/superpowers/specs/2026-05-28-outlook-contacts-import-design.md`

**Branch:** `feat/0.23.0-outlook-contacts` (already created and checked out).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/app/outlook-contacts.ts` | Pure core: Graph→app mapping, birthday parse, resource merge, address-book projection | Create |
| `src/app/outlook-contacts.test.ts` | Unit tests for the core | Create |
| `src/app/use-outlook-contacts.ts` | Hook: token + paged `/me/contacts` fetch + typed errors | Create |
| `src/app/use-outlook-contacts.test.tsx` | Unit tests for the hook | Create |
| `src/app/outlook-import-modal.tsx` | Preview-and-pick dialog (presentational) | Create |
| `src/app/outlook-import-modal.test.tsx` | Unit tests for the modal | Create |
| `src/app/use-resource-planner.ts` | Add `handleImportResources` (batch merge into resources) | Modify |
| `src/app/task-manager.tsx` | Wire auth + hook + state + handlers + render modal + pass button handler | Modify |
| `src/app/resources-panel.tsx` | Thread `onImportOutlook` to `<ResourceDirectory>` | Modify |
| `src/app/resource-directory.tsx` | "Import from Outlook" toolbar button | Modify |
| `src/app/resource-directory.test.tsx` | Assert button visibility | Modify |
| `src/app/settings-menu.tsx` | Flip Outlook contacts sub-toggle interactive | Modify |
| `src/app/settings-menu.test.tsx` | Update sub-toggle tests | Modify |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | New keys (EN + DE) | Modify |
| `src/app/version.ts` | Bump to 0.23.0 + highlight key | Modify |
| `CHANGELOG.md` | 0.23.0 entry | Modify |

**Reference facts (verified against the codebase — do not re-derive):**
- `Resource` (`types.ts:291`): `{ id:number; firstName:string; lastName:string; title?; businessPhone?; location?; department?; email?; company?; birthday?; notes?; roleId:number|null; utilizationMode:UtilizationMode; utilization:Record<string,number>; absenceOverride?; active?; localModifiedAt? }`. `birthday` is `"MM-DD"` or `"YYYY-MM-DD"`.
- `nextId(items: ReadonlyArray<{ id: number }>): number` — exported from `resource-foundation.ts`.
- `sanitizeEmail(s: unknown): string` — from `sanitize.ts` (trims + caps; does NOT lowercase or validate).
- `upsertContact(c: ContactsMap, rawName: string, rawEmail: string): ContactsMap` — from `contacts.ts` (immutable; empty name → no-op).
- `useMsAuth(enabled: boolean)` returns `{ account, ready, signIn, signOut, acquireToken }`; `acquireToken` is a stable `useCallback`. The MSAL PCA is a module-scoped singleton, so calling `useMsAuth` in multiple components is safe (already done in `settings-menu.tsx:194` and `storage-config.tsx:86`).
- `showToast(kind: "info" | "error", text: string): void` — from `useToast()`; available in `task-manager.tsx` as `showToast`.
- `<Modal>` (`modal.tsx`): props `open`, `onClose`, `ariaLabel` | `ariaLabelledby`, `align?: "start"|"center"`, `backdropClassName?`, `zIndex?`, `initialFocusRef?`, `children`. Owns Escape/focus-trap/backdrop-close.
- `t(lang, key, ...args)` supports positional `{0}` substitution (e.g. `tasksCountFiltered: "({0} of {1})"`).

---

## Task 1: Pure core — `outlook-contacts.ts`

**Files:**
- Create: `src/app/outlook-contacts.ts`
- Test: `src/app/outlook-contacts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/outlook-contacts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  mapGraphContact,
  parseGraphBirthday,
  mergeImportedResources,
  contactsFromImported,
  type GraphContact,
  type OutlookContact,
} from "./outlook-contacts";
import type { Resource } from "./types";

function res(partial: Partial<Resource> & { id: number }): Resource {
  return {
    firstName: "X",
    lastName: "",
    roleId: null,
    utilizationMode: "percent",
    utilization: {},
    ...partial,
  };
}

describe("parseGraphBirthday", () => {
  it("keeps a real year as YYYY-MM-DD", () => {
    expect(parseGraphBirthday("1974-07-04T00:00:00Z")).toBe("1974-07-04");
  });
  it("drops the 0001 placeholder year to MM-DD", () => {
    expect(parseGraphBirthday("0001-12-31T00:00:00Z")).toBe("12-31");
  });
  it("returns undefined for missing/invalid", () => {
    expect(parseGraphBirthday(null)).toBeUndefined();
    expect(parseGraphBirthday(undefined)).toBeUndefined();
    expect(parseGraphBirthday("not-a-date")).toBeUndefined();
    expect(parseGraphBirthday("1974-13-40T00:00:00Z")).toBeUndefined();
  });
});

describe("mapGraphContact", () => {
  it("maps a full record", () => {
    const raw: GraphContact = {
      id: "abc",
      displayName: "Alex Example",
      givenName: "Sample",
      surname: "Dummy",
      emailAddresses: [{ address: "Sample.Dummy@example.com" }],
      jobTitle: "Architect",
      department: "Engineering",
      companyName: "Contoso",
      businessPhones: ["+49 123"],
      mobilePhone: "+49 999",
      officeLocation: "Berlin",
      birthday: "1980-03-02T00:00:00Z",
    };
    expect(mapGraphContact(raw, 0)).toEqual<OutlookContact>({
      sourceId: "abc",
      firstName: "Sample",
      lastName: "Dummy",
      displayName: "Alex Example",
      email: "Sample.Dummy@example.com",
      title: "Architect",
      department: "Engineering",
      company: "Contoso",
      phone: "+49 123",
      location: "Berlin",
      birthday: "1980-03-02",
    });
  });

  it("splits displayName when given/surname absent", () => {
    const c = mapGraphContact({ displayName: "Zoe Adams" }, 1)!;
    expect(c.firstName).toBe("Zoe");
    expect(c.lastName).toBe("Adams");
    expect(c.sourceId).toBe("graph-1");
  });

  it("falls back to email local-part when no name", () => {
    const c = mapGraphContact({ emailAddresses: [{ address: "ops@example.com" }] }, 2)!;
    expect(c.firstName).toBe("ops");
    expect(c.displayName).toBe("ops");
    expect(c.email).toBe("ops@example.com");
  });

  it("returns null when neither name nor email", () => {
    expect(mapGraphContact({ jobTitle: "Nobody" }, 3)).toBeNull();
  });

  it("prefers businessPhones[0] then mobilePhone", () => {
    expect(mapGraphContact({ givenName: "A", mobilePhone: "+1 5" }, 4)!.phone).toBe("+1 5");
    expect(
      mapGraphContact({ givenName: "A", businessPhones: ["+1 1"], mobilePhone: "+1 5" }, 5)!.phone,
    ).toBe("+1 1");
  });
});

describe("mergeImportedResources", () => {
  const contact: OutlookContact = {
    sourceId: "x",
    firstName: "Sample",
    lastName: "Dummy",
    displayName: "Alex Example",
    email: "Sample@example.com",
    title: "Architect",
  };

  it("appends a new resource with nextId", () => {
    const out = mergeImportedResources([res({ id: 5 })], [contact]);
    expect(out).toHaveLength(2);
    expect(out[1].id).toBe(6);
    expect(out[1].email).toBe("Sample@example.com");
    expect(out[1].roleId).toBeNull();
    expect(out[1].utilizationMode).toBe("percent");
  });

  it("updates an existing resource matched by email (case-insensitive), preserving id/role/utilization", () => {
    const existing = res({
      id: 9,
      firstName: "S",
      lastName: "C",
      email: "Sample@Example.com",
      roleId: 3,
      utilization: { "2026-02": 100 },
      title: "Old",
    });
    const out = mergeImportedResources([existing], [contact]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(9);
    expect(out[0].roleId).toBe(3);
    expect(out[0].utilization).toEqual({ "2026-02": 100 });
    expect(out[0].title).toBe("Architect");
    expect(out[0].firstName).toBe("Sample");
  });

  it("assigns distinct ids across a multi-add batch", () => {
    const out = mergeImportedResources(
      [res({ id: 1 })],
      [
        { ...contact, email: "a@x.com" },
        { ...contact, email: "b@x.com" },
      ],
    );
    expect(out.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it("clears a field on update when the contact leaves it blank", () => {
    const existing = res({ id: 1, email: "Sample@example.com", title: "Old" });
    const out = mergeImportedResources([existing], [{ ...contact, title: undefined }]);
    expect(out[0].title).toBeUndefined();
  });
});

describe("contactsFromImported", () => {
  it("maps displayName + email and skips blank-name contacts", () => {
    const out = contactsFromImported([
      { sourceId: "1", firstName: "A", lastName: "B", displayName: "A B", email: "ab@x.com" },
      { sourceId: "2", firstName: "", lastName: "", displayName: "", email: "x@x.com" },
    ]);
    expect(out).toEqual([{ name: "A B", email: "ab@x.com" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/outlook-contacts.test.ts`
Expected: FAIL — "Cannot find module './outlook-contacts'".

- [ ] **Step 3: Write the implementation**

Create `src/app/outlook-contacts.ts`:

```ts
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
      const i = indexByEmail.get(e) as number;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/outlook-contacts.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Type-check & lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/outlook-contacts.ts src/app/outlook-contacts.test.ts
git commit -m "feat(m3): Outlook contact mapping + resource merge core"
```

---

## Task 2: Fetch hook — `use-outlook-contacts.ts`

**Files:**
- Create: `src/app/use-outlook-contacts.ts`
- Test: `src/app/use-outlook-contacts.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/use-outlook-contacts.test.tsx`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useOutlookContacts } from "./use-outlook-contacts";

const G = "https://graph.microsoft.com/v1.0/me/contacts";

describe("useOutlookContacts", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonRes(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }

  it("walks @odata.nextLink and accumulates mapped contacts", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    fetchSpy
      .mockResolvedValueOnce(
        jsonRes({
          value: [{ id: "1", displayName: "A B", emailAddresses: [{ address: "a@x.com" }] }],
          "@odata.nextLink": `${G}?$skip=100`,
        }),
      )
      .mockResolvedValueOnce(
        jsonRes({ value: [{ id: "2", displayName: "C D", emailAddresses: [{ address: "c@x.com" }] }] }),
      );

    const { result } = renderHook(() => useOutlookContacts(acquireToken));
    const contacts = await result.current.fetchContacts();

    expect(contacts).toHaveLength(2);
    expect(contacts[0].email).toBe("a@x.com");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toContain("$select=");
    expect(fetchSpy.mock.calls[0][0]).toContain("$top=100");
    expect((fetchSpy.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      Authorization: "Bearer tok",
    });
  });

  it("throws outlookSignInRequired when token is null", async () => {
    const acquireToken = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useOutlookContacts(acquireToken));
    await expect(result.current.fetchContacts()).rejects.toThrow("outlookSignInRequired");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps HTTP errors to keys", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    for (const [status, key] of [
      [401, "outlookSignInExpired"],
      [403, "outlookPermissionDenied"],
      [500, "outlookFetchFailed"],
    ] as const) {
      fetchSpy.mockResolvedValueOnce(jsonRes({}, status));
      const { result } = renderHook(() => useOutlookContacts(acquireToken));
      await expect(result.current.fetchContacts()).rejects.toThrow(key);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/use-outlook-contacts.test.tsx`
Expected: FAIL — "Cannot find module './use-outlook-contacts'".

- [ ] **Step 3: Write the implementation**

Create `src/app/use-outlook-contacts.ts`:

```ts
// src/app/use-outlook-contacts.ts
"use client";

import { useCallback } from "react";
import {
  mapGraphContact,
  type GraphContact,
  type OutlookContact,
} from "./outlook-contacts";

const GRAPH = "https://graph.microsoft.com/v1.0";
const SELECT =
  "id,displayName,givenName,surname,emailAddresses,jobTitle,department,companyName,businessPhones,mobilePhone,officeLocation,birthday";
const FIRST_URL = `${GRAPH}/me/contacts?$top=100&$select=${SELECT}`;

interface GraphPage {
  value?: GraphContact[];
  "@odata.nextLink"?: string;
}

export interface UseOutlookContactsResult {
  /** Fetch + normalize all /me/contacts pages. Throws an Error whose message
   *  is an i18n key (outlookSignInRequired / outlookSignInExpired /
   *  outlookPermissionDenied / outlookFetchFailed) for the caller to translate. */
  fetchContacts: () => Promise<OutlookContact[]>;
}

export function useOutlookContacts(
  acquireToken: (scopes: readonly string[]) => Promise<string | null>,
): UseOutlookContactsResult {
  const fetchContacts = useCallback(async (): Promise<OutlookContact[]> => {
    const token = await acquireToken(["Contacts.Read"]);
    if (!token) throw new Error("outlookSignInRequired");

    const out: OutlookContact[] = [];
    let url: string | undefined = FIRST_URL;
    let index = 0;
    while (url) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) throw new Error("outlookSignInExpired");
      if (res.status === 403) throw new Error("outlookPermissionDenied");
      if (!res.ok) throw new Error("outlookFetchFailed");
      const page = (await res.json()) as GraphPage;
      for (const raw of page.value ?? []) {
        const mapped = mapGraphContact(raw, index++);
        if (mapped) out.push(mapped);
      }
      url = page["@odata.nextLink"];
    }
    return out;
  }, [acquireToken]);

  return { fetchContacts };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/use-outlook-contacts.test.tsx`
Expected: PASS.

- [ ] **Step 5: Type-check & lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-outlook-contacts.ts src/app/use-outlook-contacts.test.tsx
git commit -m "feat(m3): paged Outlook /me/contacts fetch hook"
```

---

## Task 3: Preview modal — `outlook-import-modal.tsx`

**Files:**
- Create: `src/app/outlook-import-modal.tsx`
- Test: `src/app/outlook-import-modal.test.tsx`

This task adds i18n keys it references. Add them to BOTH dictionaries now (Task 6 verifies the full set). Insert these entries into the EN object in `src/app/i18n.ts` and translate in `src/app/i18n.de.ts` (place near other modal keys; exact location is not significant):

```ts
// EN (i18n.ts)
outlookImportTitle: "Import Outlook contacts",
outlookImportLoading: "Loading contacts…",
outlookImportEmpty: "No Outlook contacts found.",
outlookImportExisting: "already in directory · will update",
outlookImportSelectAll: "Select all",
outlookImportSelectedN: "{0} selected",
outlookImportConfirm: "Import ({0})",
outlookImportCancel: "Cancel",
```

```ts
// DE (i18n.de.ts)
outlookImportTitle: "Outlook-Kontakte importieren",
outlookImportLoading: "Kontakte werden geladen…",
outlookImportEmpty: "Keine Outlook-Kontakte gefunden.",
outlookImportExisting: "bereits im Verzeichnis · wird aktualisiert",
outlookImportSelectAll: "Alle auswählen",
outlookImportSelectedN: "{0} ausgewählt",
outlookImportConfirm: "Importieren ({0})",
outlookImportCancel: "Abbrechen",
```

- [ ] **Step 1: Write the failing test**

Create `src/app/outlook-import-modal.test.tsx`:

```ts
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OutlookImportModal } from "./outlook-import-modal";
import type { OutlookContact } from "./outlook-contacts";

const contacts: OutlookContact[] = [
  { sourceId: "1", firstName: "Ann", lastName: "New", displayName: "Ann New", email: "ann@x.com" },
  { sourceId: "2", firstName: "Bob", lastName: "Old", displayName: "Bob Old", email: "bob@x.com" },
];

function base(overrides = {}) {
  return {
    lang: "en-US" as const,
    open: true,
    loading: false,
    error: null as string | null,
    contacts,
    existingEmails: new Set(["bob@x.com"]),
    onConfirm: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe("OutlookImportModal", () => {
  it("pre-checks every contact; badges existing matches", () => {
    render(<OutlookImportModal {...base()} />);
    const boxes = screen.getAllByRole("checkbox");
    // 2 rows + 1 select-all = 3
    expect(boxes).toHaveLength(3);
    boxes.forEach((b) => expect(b).toBeChecked());
    expect(screen.getByText(/already in directory/i)).toBeInTheDocument();
  });

  it("confirm passes only the checked subset", () => {
    const onConfirm = vi.fn();
    render(<OutlookImportModal {...base({ onConfirm })} />);
    // Uncheck Ann (her row checkbox is labeled by her name).
    fireEvent.click(screen.getByLabelText(/Ann New/i));
    fireEvent.click(screen.getByRole("button", { name: /Import \(1\)/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toEqual([contacts[1]]);
  });

  it("select-all toggles every row", () => {
    render(<OutlookImportModal {...base()} />);
    const selectAll = screen.getByLabelText(/Select all/i);
    fireEvent.click(selectAll); // deselect all
    screen.getAllByRole("checkbox").forEach((b) => expect(b).not.toBeChecked());
  });

  it("renders loading, empty, and error states", () => {
    const { rerender } = render(<OutlookImportModal {...base({ loading: true })} />);
    expect(screen.getByText(/Loading contacts/i)).toBeInTheDocument();
    rerender(<OutlookImportModal {...base({ contacts: [] })} />);
    expect(screen.getByText(/No Outlook contacts found/i)).toBeInTheDocument();
    rerender(<OutlookImportModal {...base({ error: "Permission denied" })} />);
    expect(screen.getByText(/Permission denied/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/outlook-import-modal.test.tsx`
Expected: FAIL — "Cannot find module './outlook-import-modal'".

- [ ] **Step 3: Write the implementation**

Create `src/app/outlook-import-modal.tsx`:

```tsx
// src/app/outlook-import-modal.tsx
"use client";

import { useMemo, useState } from "react";
import { type Lang, t } from "./i18n";
import { Modal } from "./modal";
import type { OutlookContact } from "./outlook-contacts";

export interface OutlookImportModalProps {
  lang: Lang;
  open: boolean;
  loading: boolean;
  /** Pre-translated error message; null when none. */
  error: string | null;
  contacts: OutlookContact[];
  /** Normalized (lower-case) emails already present in the directory. */
  existingEmails: ReadonlySet<string>;
  onConfirm: (selected: OutlookContact[]) => void;
  onClose: () => void;
}

export function OutlookImportModal({
  lang,
  open,
  loading,
  error,
  contacts,
  existingEmails,
  onConfirm,
  onClose,
}: OutlookImportModalProps) {
  // Selection keyed by sourceId. Re-seed (all checked) whenever the contact
  // set changes, using the render-time previous-value sync pattern used
  // elsewhere in the app (avoids the set-state-in-effect lint rule).
  const allIds = useMemo(() => contacts.map((c) => c.sourceId).join("|"), [contacts]);
  const [prevIds, setPrevIds] = useState(allIds);
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(contacts.map((c) => c.sourceId)),
  );
  if (prevIds !== allIds) {
    setPrevIds(allIds);
    setChecked(new Set(contacts.map((c) => c.sourceId)));
  }

  const selectedCount = checked.size;
  const allChecked = contacts.length > 0 && selectedCount === contacts.length;

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setChecked((prev) =>
      prev.size === contacts.length ? new Set() : new Set(contacts.map((c) => c.sourceId)),
    );
  }

  function confirm() {
    onConfirm(contacts.filter((c) => checked.has(c.sourceId)));
  }

  return (
    <Modal open={open} onClose={onClose} ariaLabel={t(lang, "outlookImportTitle")} align="center" zIndex={50}>
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-line bg-surface">
        <header className="flex shrink-0 items-center justify-between border-b border-line px-6 py-4">
          <h2 className="text-lg font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
            {t(lang, "outlookImportTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t(lang, "outlookImportCancel")}
            className="rounded-md p-2 text-AIPM-dark-grey hover:bg-surface-muted hover:text-AIPM-dark-blue"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
              <path
                fillRule="evenodd"
                d="M4.28 4.28a.75.75 0 011.06 0L10 8.94l4.66-4.66a.75.75 0 111.06 1.06L11.06 10l4.66 4.66a.75.75 0 11-1.06 1.06L10 11.06l-4.66 4.66a.75.75 0 01-1.06-1.06L8.94 10 4.28 5.34a.75.75 0 010-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t(lang, "outlookImportLoading")}
            </p>
          ) : error ? (
            <p className="py-8 text-center text-sm text-AIPM-pink">{error}</p>
          ) : contacts.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t(lang, "outlookImportEmpty")}
            </p>
          ) : (
            <>
              <label className="mb-2 flex items-center gap-2 border-b border-line pb-2 text-sm font-medium text-foreground">
                <input type="checkbox" checked={allChecked} onChange={toggleAll} className="h-4 w-4" />
                <span>{t(lang, "outlookImportSelectAll")}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {t(lang, "outlookImportSelectedN", selectedCount)}
                </span>
              </label>
              <ul className="space-y-1">
                {contacts.map((c) => {
                  const exists = c.email !== "" && existingEmails.has(c.email);
                  const label = c.displayName || c.email || c.sourceId;
                  return (
                    <li key={c.sourceId}>
                      <label className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-muted">
                        <input
                          type="checkbox"
                          aria-label={label}
                          checked={checked.has(c.sourceId)}
                          onChange={() => toggle(c.sourceId)}
                          className="h-4 w-4"
                        />
                        <span className="font-medium text-foreground">{label}</span>
                        {c.email && <span className="text-xs text-muted-foreground">{c.email}</span>}
                        {exists && (
                          <span className="ml-auto text-xs italic text-AIPM-purple">
                            {t(lang, "outlookImportExisting")}
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted"
          >
            {t(lang, "outlookImportCancel")}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={selectedCount === 0 || loading || !!error}
            className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-3 py-1.5 text-sm font-medium text-white hover:bg-AIPM-dark-blue/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t(lang, "outlookImportConfirm", selectedCount)}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/outlook-import-modal.test.tsx`
Expected: PASS. (If `text-AIPM-purple` / `text-AIPM-pink` aren't valid tokens, grep `text-AIPM-pink` — it is used elsewhere; substitute the nearest existing semantic class if needed. This is a cosmetic class, not behavior.)

- [ ] **Step 5: Type-check & lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/outlook-import-modal.tsx src/app/outlook-import-modal.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(m3): Outlook contacts preview-and-pick modal"
```

---

## Task 4: Wire the import flow (resource-planner + task-manager + panels + directory)

**Files:**
- Modify: `src/app/use-resource-planner.ts` (add `handleImportResources`)
- Modify: `src/app/task-manager.tsx`
- Modify: `src/app/resources-panel.tsx`
- Modify: `src/app/resource-directory.tsx`
- Test: `src/app/resource-directory.test.tsx`

### 4a. `use-resource-planner.ts` — batch merge handler

- [ ] **Step 1: Add the handler.** Near the other resource handlers (after `handleSaveResource`), add:

```ts
const handleImportResources = useCallback(
  (selected: readonly OutlookContact[]): void => {
    if (selected.length === 0) return;
    setResources((prev) => mergeImportedResources(prev, selected));
  },
  [setResources],
);
```

Add the import at the top of the file:

```ts
import { mergeImportedResources, type OutlookContact } from "./outlook-contacts";
```

Add `handleImportResources` to the hook's returned object (the `return { ... }` block at the end of the hook, near `handleSaveResource`).

- [ ] **Step 2: Type-check.** Run: `npx tsc --noEmit` — Expected: 0 errors.

### 4b. `resource-directory.tsx` — toolbar button

- [ ] **Step 3: Write the failing test.** Add to `src/app/resource-directory.test.tsx` (ensure `fireEvent` is imported from `@testing-library/react` and `t` from `./i18n`):

```ts
it("renders Import from Outlook only when onImportOutlook is provided", () => {
  const onImport = vi.fn();
  const { rerender } = render(
    <ResourceDirectory lang="en-US" resources={rs} roles={[]} disciplines={[]} grades={[]}
      onAssignRole={vi.fn()} onEditResource={vi.fn()} onAddResource={vi.fn()} />,
  );
  expect(screen.queryByRole("button", { name: t("en-US", "outlookImportButton") })).toBeNull();

  rerender(
    <ResourceDirectory lang="en-US" resources={rs} roles={[]} disciplines={[]} grades={[]}
      onAssignRole={vi.fn()} onEditResource={vi.fn()} onAddResource={vi.fn()} onImportOutlook={onImport} />,
  );
  const btn = screen.getByRole("button", { name: t("en-US", "outlookImportButton") });
  fireEvent.click(btn);
  expect(onImport).toHaveBeenCalled();
});
```

- [ ] **Step 4: Run test to verify it fails.** Run: `npx vitest run src/app/resource-directory.test.tsx` — Expected: FAIL (button not found / prop unknown).

- [ ] **Step 5: Implement.** In `src/app/resource-directory.tsx`:
  - Add to `interface Props`: `onImportOutlook?: () => void;`
  - Destructure `onImportOutlook` in `ResourceDirectoryInner`.
  - In the toolbar `<div className="mb-2 flex shrink-0 items-center gap-2">`, after the `onOpenAddressBook` button block, add:

```tsx
{onImportOutlook && (
  <button
    type="button"
    onClick={onImportOutlook}
    className="shrink-0 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted"
  >
    {t(lang, "outlookImportButton")}
  </button>
)}
```

Add i18n key `outlookImportButton` to both dictionaries:
```ts
// i18n.ts:     outlookImportButton: "Import from Outlook",
// i18n.de.ts:  outlookImportButton: "Aus Outlook importieren",
```

- [ ] **Step 6: Run test to verify it passes.** Run: `npx vitest run src/app/resource-directory.test.tsx` — Expected: PASS.

### 4c. `resources-panel.tsx` — thread the prop

- [ ] **Step 7:** Add `onImportOutlook?: () => void;` to the panel's `Props`, destructure it, and pass `onImportOutlook={onImportOutlook}` to the **Directory-tab** `<ResourceDirectory>` (the instance at the existing line ~566, NOT the workload/calendar instances which don't render the directory toolbar).

### 4d. `task-manager.tsx` — coordinate

- [ ] **Step 8: Add imports** near the other hook imports:

```ts
import { useMsAuth } from "./use-ms-auth";
import { useOutlookContacts } from "./use-outlook-contacts";
import { OutlookImportModal } from "./outlook-import-modal";
import { contactsFromImported, type OutlookContact } from "./outlook-contacts";
import { upsertContact } from "./contacts";
```

- [ ] **Step 9: Add `handleImportResources` to the `useResourcePlanner(...)` destructuring**, then add auth + hook + state + handlers after that block:

```ts
const m365Enabled = settings.integrations?.m365?.enabled ?? false;
const outlookContactsEnabled =
  m365Enabled && (settings.integrations?.m365?.outlookContacts ?? false);
const msAuth = useMsAuth(m365Enabled);
const { fetchContacts: fetchOutlookContacts } = useOutlookContacts(msAuth.acquireToken);

const [importOpen, setImportOpen] = useState(false);
const [importLoading, setImportLoading] = useState(false);
const [importError, setImportError] = useState<string | null>(null);
const [importContacts, setImportContacts] = useState<OutlookContact[]>([]);

const handleOpenOutlookImport = useCallback(async () => {
  const knownKeys = [
    "outlookSignInRequired",
    "outlookSignInExpired",
    "outlookPermissionDenied",
    "outlookFetchFailed",
  ] as const;
  setImportOpen(true);
  setImportError(null);
  setImportContacts([]);
  setImportLoading(true);
  try {
    const fetched = await fetchOutlookContacts();
    setImportContacts(fetched);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    const key = (knownKeys as readonly string[]).includes(msg)
      ? (msg as (typeof knownKeys)[number])
      : "outlookFetchFailed";
    setImportError(t(lang, key));
  } finally {
    setImportLoading(false);
  }
}, [fetchOutlookContacts, lang]);

const existingResourceEmails = useMemo(
  () =>
    new Set(
      resources
        .map((r) => (r.email ?? "").trim().toLowerCase())
        .filter((e) => e !== ""),
    ),
  [resources],
);

const handleConfirmOutlookImport = useCallback(
  (selected: OutlookContact[]) => {
    handleImportResources(selected);
    setContacts((prev) =>
      contactsFromImported(selected).reduce(
        (acc, c) => upsertContact(acc, c.name, c.email),
        prev,
      ),
    );
    setImportOpen(false);
    showToast("info", t(lang, "outlookImportedN", selected.length));
  },
  [handleImportResources, setContacts, showToast, lang],
);
```

Notes:
- `resources` must be in scope in `task-manager` (it is read from the workspace context that `useResourcePlanner` also uses). Grep `resources` in `task-manager.tsx`; if absent, read it from the same `useWorkspace()` source.
- `useState`, `useCallback`, `useMemo`, and `t` are already imported in `task-manager.tsx`.

- [ ] **Step 10: Pass the button handler to ResourcesPanel.** On the `<ResourcesPanel>` render (the block containing `onAddResource={guardEdit(handleOpenAddResource)}`), add:

```tsx
onImportOutlook={
  outlookContactsEnabled && msAuth.account
    ? () => { void handleOpenOutlookImport(); }
    : undefined
}
```

(Passing `undefined` when disabled / not signed in hides the Directory button — the gating contract.)

- [ ] **Step 11: Render the modal.** Near where the other modals / `<AppModals>` render, add:

```tsx
<OutlookImportModal
  lang={lang}
  open={importOpen}
  loading={importLoading}
  error={importError}
  contacts={importContacts}
  existingEmails={existingResourceEmails}
  onConfirm={handleConfirmOutlookImport}
  onClose={() => setImportOpen(false)}
/>
```

Add i18n key `outlookImportedN` to both dictionaries:
```ts
// i18n.ts:    outlookImportedN: "Imported {0} contacts",
// i18n.de.ts: outlookImportedN: "{0} Kontakte importiert",
```

- [ ] **Step 12: Run the full suite + gates.**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: all green, 0 type errors, 0 lint errors.

- [ ] **Step 13: Commit**

```bash
git add src/app/use-resource-planner.ts src/app/task-manager.tsx src/app/resources-panel.tsx src/app/resource-directory.tsx src/app/resource-directory.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(m3): wire Outlook import (directory button + modal + merge)"
```

---

## Task 5: Make the Outlook contacts sub-toggle interactive

**Files:**
- Modify: `src/app/settings-menu.tsx:669`
- Test: `src/app/settings-menu.test.tsx`

- [ ] **Step 1: Update the failing tests.** In `src/app/settings-menu.test.tsx`, replace the test titled `"Outlook contacts and calendar sub-toggles are still disabled (M3/M4 not yet shipped)"` (around line 124) with these three:

```ts
it("Outlook contacts sub-toggle is interactive (M3 shipped)", () => {
  const settings = makeSettings({ integrations: m365EnabledIntegrations });
  render(<SettingsMenu {...makeProps({ settings })} />);
  fireEvent.click(screen.getByRole("button", { name: t("en-US", "settings") }));
  const outlookContactsCheckbox = screen.getByRole("checkbox", { name: t("en-US", "integrationsOutlookContacts") });
  expect(outlookContactsCheckbox).not.toBeDisabled();
});

it("Outlook calendar sub-toggle is still disabled (M4 not yet shipped)", () => {
  const settings = makeSettings({ integrations: m365EnabledIntegrations });
  render(<SettingsMenu {...makeProps({ settings })} />);
  fireEvent.click(screen.getByRole("button", { name: t("en-US", "settings") }));
  const outlookCalendarCheckbox = screen.getByRole("checkbox", { name: t("en-US", "integrationsOutlookCalendar") });
  expect(outlookCalendarCheckbox).toBeDisabled();
});

it("toggling Outlook contacts persists settings.integrations.m365.outlookContacts", () => {
  const onChange = vi.fn();
  const settings = makeSettings({ integrations: m365EnabledIntegrations });
  render(<SettingsMenu {...makeProps({ settings, onChange })} />);
  fireEvent.click(screen.getByRole("button", { name: t("en-US", "settings") }));
  fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "integrationsOutlookContacts") }));
  expect(onChange).toHaveBeenCalled();
  const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as Settings;
  expect(lastCall.integrations?.m365?.outlookContacts).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure.** Run: `npx vitest run src/app/settings-menu.test.tsx` — Expected: FAIL (contacts checkbox still disabled).

- [ ] **Step 3: Implement.** In `src/app/settings-menu.tsx` change line 669 from:

```ts
["integrationsOutlookContacts", "outlookContacts", true],
```
to:
```ts
["integrationsOutlookContacts", "outlookContacts", false],
```

Leave the calendar tuple (`"outlookCalendar", true`) unchanged.

- [ ] **Step 4: Run to verify pass.** Run: `npx vitest run src/app/settings-menu.test.tsx` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/settings-menu.tsx src/app/settings-menu.test.tsx
git commit -m "feat(m3): make Outlook contacts sub-toggle interactive"
```

---

## Task 6: i18n completeness (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

By now Tasks 3–5 have added most keys. This task adds the remaining error/highlight keys and verifies EN and DE are in parity.

- [ ] **Step 1: Ensure each key exists in BOTH files.** Required full M3 set:

```ts
// EN (i18n.ts)
outlookImportButton: "Import from Outlook",
outlookImportTitle: "Import Outlook contacts",
outlookImportLoading: "Loading contacts…",
outlookImportEmpty: "No Outlook contacts found.",
outlookImportExisting: "already in directory · will update",
outlookImportSelectAll: "Select all",
outlookImportSelectedN: "{0} selected",
outlookImportConfirm: "Import ({0})",
outlookImportCancel: "Cancel",
outlookImportedN: "Imported {0} contacts",
outlookSignInRequired: "Sign in to Microsoft first.",
outlookSignInExpired: "Sign-in expired. Sign in again.",
outlookPermissionDenied: "Permission denied. Grant contacts access.",
outlookFetchFailed: "Could not load Outlook contacts.",
versionHighlightOutlookContacts:
  "Import your Outlook contacts: sign in with Microsoft, then pull contacts into your resource directory and assignee suggestions from the Resources tab.",
```

```ts
// DE (i18n.de.ts)
outlookImportButton: "Aus Outlook importieren",
outlookImportTitle: "Outlook-Kontakte importieren",
outlookImportLoading: "Kontakte werden geladen…",
outlookImportEmpty: "Keine Outlook-Kontakte gefunden.",
outlookImportExisting: "bereits im Verzeichnis · wird aktualisiert",
outlookImportSelectAll: "Alle auswählen",
outlookImportSelectedN: "{0} ausgewählt",
outlookImportConfirm: "Importieren ({0})",
outlookImportCancel: "Abbrechen",
outlookImportedN: "{0} Kontakte importiert",
outlookSignInRequired: "Zuerst bei Microsoft anmelden.",
outlookSignInExpired: "Anmeldung abgelaufen. Bitte erneut anmelden.",
outlookPermissionDenied: "Zugriff verweigert. Kontaktzugriff gewähren.",
outlookFetchFailed: "Outlook-Kontakte konnten nicht geladen werden.",
versionHighlightOutlookContacts:
  "Outlook-Kontakte importieren: mit Microsoft anmelden und Kontakte aus dem Reiter „Ressourcen“ ins Ressourcenverzeichnis und in die Zuständigen-Vorschläge übernehmen.",
```

- [ ] **Step 2: Verify EN/DE parity.** Grep for an existing i18n parity test (a test comparing the EN and DE key sets); if present, run it — Expected: PASS. Otherwise confirm every EN key above has a DE counterpart.

Run: `npx vitest run src/app` — Expected: green, including any i18n parity test.

- [ ] **Step 3: Type-check & lint.** Run: `npx tsc --noEmit && npm run lint` — Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(m3): EN/DE strings for Outlook contacts import"
```

---

## Task 7: Release 0.23.0 "Jemisin"

**Files:**
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Bump version + add highlight key.** In `src/app/version.ts`:
  - Add this block comment at the very top (above the `0.22.0` comment):

```ts
// 0.23.0 adds Outlook contacts import (M3) — sign in with Microsoft, then
// pull your personal Outlook contacts (Graph /me/contacts) into both the
// resource directory and the assignee address book. Preview-and-pick dialog
// opened from the Resources › Directory toolbar; existing contacts (matched
// by email) are updated, new ones added. Reuses M1's MSAL foundation.
```
  - Change `export const APP_VERSION = "0.22.0";` → `export const APP_VERSION = "0.23.0";`
  - Keep `APP_BUILD_DATE = "2026-05-28"; // Jemisin milestone` unchanged.
  - Append as the LAST entry of `APP_HIGHLIGHT_KEYS` (after `"versionHighlightSharepointStorage"`):

```ts
  "versionHighlightOutlookContacts",
```

- [ ] **Step 2: CHANGELOG entry.** In `CHANGELOG.md`, add above the `[0.22.0]` entry:

```markdown
## [0.23.0] — 2026-05-28 "Jemisin"

### Added
- **Outlook contacts import (M3).** With Microsoft 365 enabled and signed in, an **Import from Outlook** button in Resources › Directory fetches your personal Outlook contacts (Microsoft Graph `/me/contacts`, `Contacts.Read`). A preview dialog lets you pick which to import; selected contacts populate the rich resource directory (name, email, title, department, phone, company, location, birthday) and seed the assignee address book.
- Contacts already in the directory are matched by email, pre-checked, and **updated** from the latest Outlook values (uncheck to leave them alone).

### Changed
- The **Outlook contacts** sub-toggle in Settings → Integrations is now interactive (was gated "Available in 0.22.0+"). Outlook calendar remains gated for a future release.
```

- [ ] **Step 3: Final gates.**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: full suite green, 0 type errors, 0 lint errors.

Optional coverage check: `npm run test:coverage` — Expected: ≥ current (~77%).

- [ ] **Step 4: Commit**

```bash
git add src/app/version.ts CHANGELOG.md
git commit -m "release: 0.23.0 Jemisin — Outlook contacts import"
```

---

## Final Review Checklist

After all tasks, dispatch a final code review over the whole branch diff (`git diff main...HEAD`). Confirm:

- [ ] All spec requirements implemented (mapping, paged fetch, preview-and-pick, update-by-email, both surfaces, interactive toggle, i18n, release).
- [ ] No token ever embedded in a URL — `Authorization: Bearer` header only.
- [ ] `useMsAuth(m365Enabled)` gates the MSAL load; nothing loads when M365 is OFF.
- [ ] Directory button hidden unless `outlookContactsEnabled && msAuth.account`.
- [ ] EN and DE key sets are in parity; no missing translations.
- [ ] `tsc --noEmit` 0, `npm run lint` 0, full suite green.
- [ ] `eslint.config.mjs` NOT modified (hook-blocked).

---

## Self-Review (plan vs spec)

**1. Spec coverage:**
- Goal (import to both surfaces) → Tasks 1 (merge + address-book projection) + 4 (wiring).
- `mapGraphContact` / `parseGraphBirthday` → Task 1.
- `mergeImportedResources` update-by-email, preserve id/role/utilization → Task 1.
- Paged `/me/contacts` fetch + typed errors → Task 2.
- Preview-and-pick modal (pre-check, badge, select-all, states) → Task 3.
- Coordinator wiring + Directory button + gating → Task 4.
- Interactive sub-toggle → Task 5. i18n EN/DE → Tasks 3/4/6. Release → Task 7.
- Edge cases (token null, name-only contact, dup emails, birthday 0001) → covered by Task 1 logic + Task 2 error mapping; tested in Tasks 1–2.

**2. Placeholder scan:** No "TBD"/"handle errors"/"similar to" — every code step shows full code.

**3. Type consistency:** `OutlookContact`/`GraphContact` defined in Task 1 and imported identically in Tasks 2–4. `handleImportResources(selected: readonly OutlookContact[]): void` defined in Task 4a, called in Task 4d. `fetchContacts` (aliased `fetchOutlookContacts` in task-manager) consistent. i18n keys referenced in modal/wiring match the keys added in Tasks 3/4/6. `showToast("info", ...)` matches the `(kind, text)` signature. `nextId`, `sanitizeEmail`, `upsertContact`, `Modal` signatures match the verified facts.
