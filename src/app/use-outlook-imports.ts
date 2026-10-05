// src/app/use-outlook-imports.ts
//
// Deps-object hook factory extracted from task-manager.tsx (Phase 3 convention,
// §491). Holds the two Outlook import flows that task-manager drives from the
// Resources pane: contacts → resources (plus the address book) and calendar
// events → absences. It owns each flow's modal state, the fetch with its
// i18n error-key mapping, and the confirm handler; task-manager keeps the
// enablement gates (`canImportOutlookContacts`, `outlookCalendarEnabled`) and
// renders the two modals from what this returns. Called unconditionally with
// the live closure values via a typed `deps` object; the inline
// `useCallback`/`useMemo` keep the exact memoization the code had inline.
// Move-only: no behaviour change.
//
// ★ Coverage-GATED on purpose (not in `coverage.exclude`): the error-key
// mapping, the calendar target resolution and the fetch window are real logic,
// not glue. `use-outlook-imports.test.ts` pins them.
import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { t, tPlural, type Lang } from "./i18n";
import type { Absence, AbsenceType, Resource } from "./types";
import type { ToastKind } from "./use-toast";
import type { UseMsAuthResult } from "./use-ms-auth";
import { useOutlookContacts } from "./use-outlook-contacts";
import { contactsFromImported, type OutlookContact } from "./outlook-contacts";
import { upsertContact, type ContactsMap } from "./contacts";
import { useOutlookCalendar } from "./use-outlook-calendar";
import { dedupeKey, type OutlookEvent, type AbsenceImportTarget } from "./outlook-calendar";
import { isoAddDays } from "./due-dates";
import { resourceDisplayName } from "./resource-foundation";

export interface OutlookImportsDeps {
  lang: Lang;
  today: string;
  msAuth: Pick<UseMsAuthResult, "account" | "acquireToken">;
  resources: readonly Resource[];
  absences: readonly Absence[];
  setContacts: Dispatch<SetStateAction<ContactsMap>>;
  handleImportResources: (selected: readonly OutlookContact[]) => void;
  handleImportAbsences: (
    rows: readonly { event: OutlookEvent; type: AbsenceType }[],
    target: AbsenceImportTarget,
  ) => void;
  showToast: (kind: ToastKind, text: string) => void;
}

export function useOutlookImports(deps: OutlookImportsDeps) {
  const {
    lang,
    today,
    msAuth,
    resources,
    absences,
    setContacts,
    handleImportResources,
    handleImportAbsences,
    showToast,
  } = deps;

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
  }, [fetchOutlookContacts, lang, setImportOpen, setImportError, setImportContacts, setImportLoading]);

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
    [handleImportResources, setContacts, showToast, lang, setImportOpen],
  );

  const { fetchEvents: fetchOutlookEvents } = useOutlookCalendar(msAuth.acquireToken);

  const [calImportOpen, setCalImportOpen] = useState(false);
  const [calImportLoading, setCalImportLoading] = useState(false);
  const [calImportError, setCalImportError] = useState<string | null>(null);
  const [calImportEvents, setCalImportEvents] = useState<OutlookEvent[]>([]);

  const calendarTarget = useMemo<AbsenceImportTarget>(() => {
    const email = (msAuth.account?.username ?? "").trim();
    const lower = email.toLowerCase();
    const match = email
      ? resources.find((r) => (r.email ?? "").trim().toLowerCase() === lower)
      : undefined;
    return {
      assignee: match ? resourceDisplayName(match) : (msAuth.account?.name ?? email),
      assigneeEmail: email || undefined,
      resourceId: match?.id,
    };
  }, [msAuth.account, resources]);

  const calendarExistingKeys = useMemo(() => {
    const key = calendarTarget.assignee.trim().toLowerCase();
    return new Set(
      absences
        .filter((a) => a.assignee.trim().toLowerCase() === key)
        .map((a) => dedupeKey(a.assignee, a.startDate, a.endDate)),
    );
  }, [absences, calendarTarget.assignee]);

  const handleOpenCalendarImport = useCallback(async () => {
    const knownKeys = [
      "outlookSignInRequired",
      "outlookSignInExpired",
      "outlookCalendarPermissionDenied",
      "outlookCalendarFetchFailed",
    ] as const;
    setCalImportOpen(true);
    setCalImportError(null);
    setCalImportEvents([]);
    setCalImportLoading(true);
    try {
      const events = await fetchOutlookEvents({
        startDateTime: `${isoAddDays(today, -30)}T00:00:00Z`,
        endDateTime: `${isoAddDays(today, 180)}T00:00:00Z`,
      });
      setCalImportEvents(events);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      const key = (knownKeys as readonly string[]).includes(msg)
        ? (msg as (typeof knownKeys)[number])
        : "outlookCalendarFetchFailed";
      setCalImportError(t(lang, key));
    } finally {
      setCalImportLoading(false);
    }
  }, [fetchOutlookEvents, today, lang, setCalImportOpen, setCalImportError, setCalImportEvents, setCalImportLoading]);

  const handleConfirmCalendarImport = useCallback(
    (rows: { event: OutlookEvent; type: AbsenceType }[]) => {
      handleImportAbsences(rows, calendarTarget);
      setCalImportOpen(false);
      showToast("info", tPlural(lang, "outlookCalImportedN", rows.length, rows.length));
    },
    [handleImportAbsences, calendarTarget, showToast, lang, setCalImportOpen],
  );

  return {
    importOpen,
    setImportOpen,
    importLoading,
    importError,
    importContacts,
    handleOpenOutlookImport,
    existingResourceEmails,
    handleConfirmOutlookImport,
    calImportOpen,
    setCalImportOpen,
    calImportLoading,
    calImportError,
    calImportEvents,
    calendarTarget,
    calendarExistingKeys,
    handleOpenCalendarImport,
    handleConfirmCalendarImport,
  };
}
