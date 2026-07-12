// src/app/use-contacts.test.ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Task } from "./types";
import { useContacts } from "./use-contacts";

const CONTACTS_KEY = "aipm-cockpit:contacts";
const NO_TASKS: Task[] = [];

describe("useContacts", () => {
  describe("initial state", () => {
    it("contacts is empty and contactsList is empty initially", () => {
      const { result } = renderHook(() =>
        useContacts({ hydrated: false, tasks: NO_TASKS }),
      );
      expect(result.current.contacts).toEqual({});
      expect(result.current.contactsList).toHaveLength(0);
    });
  });

  describe("hydration", () => {
    it("does not hydrate when hydrated=false", async () => {
      localStorage.setItem(
        CONTACTS_KEY,
        JSON.stringify({ Alice: { name: "Alice", email: "alice@example.com" } }),
      );
      const { result } = renderHook(() =>
        useContacts({ hydrated: false, tasks: NO_TASKS }),
      );
      await act(async () => {});
      expect(result.current.contacts).toEqual({});
    });

    it("hydrates from localStorage when hydrated=true", async () => {
      localStorage.setItem(
        CONTACTS_KEY,
        JSON.stringify({ Alice: { name: "Alice", email: "alice@example.com" } }),
      );
      const { result } = renderHook(() =>
        useContacts({ hydrated: true, tasks: NO_TASKS }),
      );
      await act(async () => {});
      expect(Object.keys(result.current.contacts)).toContain("alice");
      expect(result.current.contactsList).toHaveLength(1);
    });
  });

  describe("handleRemoveContact", () => {
    it("removes the named contact from the map", async () => {
      localStorage.setItem(
        CONTACTS_KEY,
        JSON.stringify({ Alice: { name: "Alice", email: "alice@example.com" } }),
      );
      const { result } = renderHook(() =>
        useContacts({ hydrated: true, tasks: NO_TASKS }),
      );
      await act(async () => {});
      act(() => {
        result.current.handleRemoveContact("Alice");
      });
      expect(Object.keys(result.current.contacts)).not.toContain("alice");
    });
  });
});
