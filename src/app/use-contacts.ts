// src/app/use-contacts.ts
"use client";

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type Contact,
  type ContactsMap,
  listContacts,
  loadContacts,
  removeContact,
  saveContacts,
  seedContactsFromTasks,
} from "./contacts";
import type { Task } from "./types";

export interface UseContactsArgs {
  hydrated: boolean;
  tasks: Task[];
}

export function useContacts({ hydrated, tasks }: UseContactsArgs): {
  contacts: ContactsMap;
  setContacts: Dispatch<SetStateAction<ContactsMap>>;
  contactsList: Contact[];
  handleRemoveContact: (name: string) => void;
} {
  const [contacts, setContacts] = useState<ContactsMap>({});
  const contactsHydratedRef = useRef(false);

  // Load contacts once after settings hydration completes so tasks are
  // available for seeding on first-ever load when the address book is empty.
  useEffect(() => {
    if (contactsHydratedRef.current) return;
    if (!hydrated) return;
    contactsHydratedRef.current = true;
    const loaded = loadContacts();
    const seeded =
      Object.keys(loaded).length === 0
        ? seedContactsFromTasks(loaded, tasks)
        : loaded;
    void Promise.resolve().then(() => {
      setContacts(seeded);
      if (Object.keys(seeded).length > 0 && Object.keys(loaded).length === 0) {
        saveContacts(seeded);
      }
    });
  }, [hydrated, tasks]);

  // Persist on every change after hydration.
  useEffect(() => {
    if (!contactsHydratedRef.current) return;
    saveContacts(contacts);
  }, [contacts]);

  const contactsList = useMemo(() => listContacts(contacts), [contacts]);

  const handleRemoveContact = useCallback((name: string) => {
    setContacts((prev) => removeContact(prev, name));
  }, []);

  return { contacts, setContacts, contactsList, handleRemoveContact };
}
