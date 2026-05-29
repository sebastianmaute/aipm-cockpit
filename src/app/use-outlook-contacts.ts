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

// Safety cap against a runaway @odata.nextLink chain. 100 pages × 100 = 10k
// contacts — far above any realistic personal address book.
const MAX_PAGES = 100;

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
    let pages = 0;
    while (url) {
      if (++pages > MAX_PAGES) throw new Error("outlookFetchFailed");
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        throw new Error("outlookFetchFailed");
      }
      if (res.status === 401) throw new Error("outlookSignInExpired");
      if (res.status === 403) throw new Error("outlookPermissionDenied");
      if (!res.ok) throw new Error("outlookFetchFailed");
      let page: GraphPage;
      try {
        page = (await res.json()) as GraphPage;
      } catch {
        throw new Error("outlookFetchFailed");
      }
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
