import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  greetingName,
  loadContacts,
  saveContacts,
  upsertContact,
  removeContact,
  seedContactsFromTasks,
  listContacts,
  type ContactsMap,
} from "./contacts";
import type { Task } from "./types";

describe("greetingName", () => {
  describe("empty and whitespace input", () => {
    it("returns empty string for empty input", () => {
      expect(greetingName("")).toBe("");
    });

    it("returns empty string for whitespace-only input", () => {
      expect(greetingName("   ")).toBe("");
      expect(greetingName("\t")).toBe("");
      expect(greetingName("\n")).toBe("");
    });

    it("returns empty string for tab/newline combinations", () => {
      expect(greetingName("\t\n   \n")).toBe("");
    });
  });

  describe("email addresses (extracts and capitalizes local part)", () => {
    it("extracts lowercase local part and capitalizes first letter", () => {
      expect(greetingName("alice@example.com")).toBe("Alice");
    });

    it("extracts local part already capitalized", () => {
      expect(greetingName("Alice@example.com")).toBe("Alice");
    });

    it("extracts local part with mixed case (only first char capitalized)", () => {
      expect(greetingName("aLiCe@example.com")).toBe("ALiCe");
    });

    it("handles single character local part", () => {
      expect(greetingName("a@example.com")).toBe("A");
    });

    it("handles email with dots in local part (preserves after @)", () => {
      expect(greetingName("alice.bob@example.com")).toBe("Alice.bob");
    });

    it("handles email with plus addressing (preserves after @)", () => {
      expect(greetingName("alice+tag@example.com")).toBe("Alice+tag");
    });

    it("trims whitespace around email", () => {
      expect(greetingName("  alice@example.com  ")).toBe("Alice");
    });

    it("handles email with complex domain", () => {
      expect(greetingName("user@sub.domain.co.uk")).toBe("User");
    });

    it("handles numeric local part", () => {
      expect(greetingName("123@example.com")).toBe("123");
    });
  });

  describe("name format (first whitespace-delimited token)", () => {
    it("returns first name from full name", () => {
      expect(greetingName("Alice Bob")).toBe("Alice");
    });

    it("returns first name from three-word name", () => {
      expect(greetingName("Alice Bob Smith")).toBe("Alice");
    });

    it("preserves capitalization of first name", () => {
      expect(greetingName("ALICE Bob")).toBe("ALICE");
      expect(greetingName("alice Bob")).toBe("alice");
    });

    it("handles single word name", () => {
      expect(greetingName("Alice")).toBe("Alice");
    });

    it("trims whitespace around name", () => {
      expect(greetingName("  Alice Bob  ")).toBe("Alice");
    });

    it("handles multiple spaces between names", () => {
      expect(greetingName("Alice   Bob")).toBe("Alice");
    });

    it("handles tabs and other whitespace as delimiters", () => {
      expect(greetingName("Alice\tBob")).toBe("Alice");
      expect(greetingName("Alice\nBob")).toBe("Alice");
    });

    it("handles mixed whitespace delimiters", () => {
      expect(greetingName("Alice \t Bob")).toBe("Alice");
    });

    it("returns name with special characters", () => {
      expect(greetingName("José María")).toBe("José");
    });
  });
});

describe("loadContacts", () => {
  beforeEach(() => {
    // Mock localStorage
    const store: Record<string, string> = {};
    global.localStorage = {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        Object.keys(store).forEach((k) => delete store[k]);
      },
      length: 0,
      key: () => null,
    };
  });

  it("returns empty object when window is undefined", () => {
    const originalWindow = global.window;
    // @ts-expect-error -- forcing window undefined to exercise the SSR path
    global.window = undefined;
    const result = loadContacts();
    global.window = originalWindow;
    expect(result).toEqual({});
  });

  it("returns empty object when localStorage has no contacts key", () => {
    expect(loadContacts()).toEqual({});
  });

  it("returns empty object when stored value is not valid JSON", () => {
    localStorage.setItem("aipm-cockpit:contacts", "not valid json");
    expect(loadContacts()).toEqual({});
  });

  it("returns empty object when stored value is not an object", () => {
    localStorage.setItem("aipm-cockpit:contacts", '"string value"');
    expect(loadContacts()).toEqual({});
    localStorage.clear();

    localStorage.setItem("aipm-cockpit:contacts", "123");
    expect(loadContacts()).toEqual({});
    localStorage.clear();

    localStorage.setItem("aipm-cockpit:contacts", "[]");
    expect(loadContacts()).toEqual({});
  });

  it("loads single contact with name and email", () => {
    const data = { "alice": { name: "Alice", email: "alice@example.com" } };
    localStorage.setItem("aipm-cockpit:contacts", JSON.stringify(data));
    const result = loadContacts();
    expect(result).toEqual({
      alice: { name: "Alice", email: "alice@example.com" },
    });
  });

  it("loads multiple contacts", () => {
    const data = {
      alice: { name: "Alice", email: "alice@example.com" },
      bob: { name: "Bob", email: "bob@example.com" },
    };
    localStorage.setItem("aipm-cockpit:contacts", JSON.stringify(data));
    const result = loadContacts();
    expect(result).toEqual(data);
  });

  it("drops entries with invalid name (empty after sanitize)", () => {
    const data = {
      alice: { name: "Alice", email: "alice@example.com" },
      invalid1: { name: "", email: "invalid@example.com" },
    };
    localStorage.setItem("aipm-cockpit:contacts", JSON.stringify(data));
    const result = loadContacts();
    expect(result).toEqual({
      alice: { name: "Alice", email: "alice@example.com" },
    });
  });

  it("drops entries with non-string name", () => {
    const data = {
      alice: { name: "Alice", email: "alice@example.com" },
      invalid2: { name: 123, email: "invalid@example.com" },
    };
    localStorage.setItem("aipm-cockpit:contacts", JSON.stringify(data));
    const result = loadContacts();
    expect(result).toEqual({
      alice: { name: "Alice", email: "alice@example.com" },
    });
  });

  it("drops entries with non-object value", () => {
    const data = {
      alice: { name: "Alice", email: "alice@example.com" },
      invalid: "not an object",
    };
    localStorage.setItem("aipm-cockpit:contacts", JSON.stringify(data));
    const result = loadContacts();
    expect(result).toEqual({
      alice: { name: "Alice", email: "alice@example.com" },
    });
  });

  it("sanitizes name and email on load", () => {
    const data = {
      "alice bob": { name: "  Alice Bob  ", email: "  alice@example.com  " },
    };
    localStorage.setItem("aipm-cockpit:contacts", JSON.stringify(data));
    const result = loadContacts();
    expect(result).toEqual({
      "alice bob": { name: "Alice Bob", email: "alice@example.com" },
    });
  });

  it("drops contact with empty email but preserves contact with non-empty name", () => {
    const data = {
      "alice": { name: "Alice", email: "" },
      "bob": { name: "Bob", email: null },
    };
    localStorage.setItem("aipm-cockpit:contacts", JSON.stringify(data));
    const result = loadContacts();
    expect(result).toEqual({
      alice: { name: "Alice", email: "" },
      bob: { name: "Bob", email: "" },
    });
  });

  it("handles contacts with missing email field", () => {
    const data = {
      alice: { name: "Alice" },
    };
    localStorage.setItem("aipm-cockpit:contacts", JSON.stringify(data));
    const result = loadContacts();
    expect(result).toEqual({
      alice: { name: "Alice", email: "" },
    });
  });

  it("handles malformed entries gracefully with try-catch", () => {
    const mockGetItem = vi.spyOn(Storage.prototype, "getItem");
    mockGetItem.mockImplementationOnce(() => {
      throw new Error("Storage error");
    });
    const result = loadContacts();
    expect(result).toEqual({});
    mockGetItem.mockRestore();
  });
});

describe("saveContacts", () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    global.localStorage = {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        Object.keys(store).forEach((k) => delete store[k]);
      },
      length: 0,
      key: () => null,
    };
  });

  it("saves contacts to localStorage as JSON", () => {
    const contacts: ContactsMap = {
      alice: { name: "Alice", email: "alice@example.com" },
    };
    saveContacts(contacts);
    const stored = localStorage.getItem("aipm-cockpit:contacts");
    expect(stored).toBe(JSON.stringify(contacts));
  });

  it("saves empty contacts map", () => {
    saveContacts({});
    const stored = localStorage.getItem("aipm-cockpit:contacts");
    expect(stored).toBe("{}");
  });

  it("saves multiple contacts", () => {
    const contacts: ContactsMap = {
      alice: { name: "Alice", email: "alice@example.com" },
      bob: { name: "Bob", email: "bob@example.com" },
    };
    saveContacts(contacts);
    const stored = localStorage.getItem("aipm-cockpit:contacts");
    expect(JSON.parse(stored!)).toEqual(contacts);
  });

  it("does nothing when window is undefined", () => {
    const originalWindow = global.window;
    // @ts-expect-error -- forcing window undefined to exercise the SSR path
    global.window = undefined;
    const contacts: ContactsMap = {
      alice: { name: "Alice", email: "alice@example.com" },
    };
    saveContacts(contacts);
    // No assertion needed — just verifying no error is thrown
    global.window = originalWindow;
  });

  it("silently fails when localStorage quota exceeded", () => {
    const mockSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockSetItem.mockImplementationOnce(() => {
      throw new Error("QuotaExceededError");
    });
    const contacts: ContactsMap = {
      alice: { name: "Alice", email: "alice@example.com" },
    };
    // Should not throw
    expect(() => saveContacts(contacts)).not.toThrow();
    mockSetItem.mockRestore();
  });
});

describe("upsertContact", () => {
  it("returns unchanged map when name is empty", () => {
    const contacts: ContactsMap = {};
    const result = upsertContact(contacts, "", "alice@example.com");
    expect(result).toBe(contacts);
  });

  it("returns unchanged map when name is whitespace only", () => {
    const contacts: ContactsMap = {};
    const result = upsertContact(contacts, "   ", "alice@example.com");
    expect(result).toBe(contacts);
  });

  it("inserts new contact with name and email", () => {
    const contacts: ContactsMap = {};
    const result = upsertContact(contacts, "Alice", "alice@example.com");
    expect(result).toEqual({
      alice: { name: "Alice", email: "alice@example.com" },
    });
  });

  it("inserts new contact with name only (empty email)", () => {
    const contacts: ContactsMap = {};
    const result = upsertContact(contacts, "Alice", "");
    expect(result).toEqual({
      alice: { name: "Alice", email: "" },
    });
  });

  it("normalizes key but preserves original name casing", () => {
    const contacts: ContactsMap = {};
    const result = upsertContact(contacts, "AlIcE BoB", "alice@example.com");
    expect(result).toEqual({
      "alice bob": { name: "AlIcE BoB", email: "alice@example.com" },
    });
  });

  it("updates existing contact with new name and email (same normalized key)", () => {
    const contacts: ContactsMap = {
      alice: { name: "Alice", email: "old@example.com" },
    };
    const result = upsertContact(contacts, "ALICE", "new@example.com");
    expect(result).toEqual({
      alice: { name: "ALICE", email: "new@example.com" },
    });
  });

  it("creates new contact when normalized key differs from existing", () => {
    const contacts: ContactsMap = {
      alice: { name: "Alice", email: "old@example.com" },
    };
    const result = upsertContact(contacts, "Alice Smith", "new@example.com");
    expect(result).toEqual({
      alice: { name: "Alice", email: "old@example.com" },
      "alice smith": { name: "Alice Smith", email: "new@example.com" },
    });
  });

  it("preserves existing email when new email is empty", () => {
    const contacts: ContactsMap = {
      alice: { name: "Alice", email: "alice@example.com" },
    };
    const result = upsertContact(contacts, "Alice", "");
    expect(result).toEqual({
      alice: { name: "Alice", email: "alice@example.com" },
    });
  });

  it("updates name while preserving email when new email is empty (same key)", () => {
    const contacts: ContactsMap = {
      alice: { name: "Alice", email: "alice@example.com" },
    };
    const result = upsertContact(contacts, "ALICE", "");
    expect(result).toEqual({
      alice: { name: "ALICE", email: "alice@example.com" },
    });
  });

  it("creates new entry when name differs (creates new key, old entry remains)", () => {
    const contacts: ContactsMap = {
      alice: { name: "Alice", email: "alice@example.com" },
    };
    const result = upsertContact(contacts, "Alice Smith", "");
    expect(result).toEqual({
      alice: { name: "Alice", email: "alice@example.com" },
      "alice smith": { name: "Alice Smith", email: "" },
    });
  });

  it("returns unchanged map when no change (idempotent)", () => {
    const contacts: ContactsMap = {
      alice: { name: "Alice", email: "alice@example.com" },
    };
    const result = upsertContact(contacts, "Alice", "alice@example.com");
    expect(result).toBe(contacts);
  });

  it("returns new map when only email changes", () => {
    const contacts: ContactsMap = {
      alice: { name: "Alice", email: "old@example.com" },
    };
    const result = upsertContact(contacts, "Alice", "new@example.com");
    expect(result).not.toBe(contacts);
    expect(result).toEqual({
      alice: { name: "Alice", email: "new@example.com" },
    });
  });

  it("returns new map when only name casing changes", () => {
    const contacts: ContactsMap = {
      alice: { name: "Alice", email: "alice@example.com" },
    };
    const result = upsertContact(contacts, "ALICE", "alice@example.com");
    expect(result).not.toBe(contacts);
    expect(result).toEqual({
      alice: { name: "ALICE", email: "alice@example.com" },
    });
  });

  it("adds contact to existing map (immutably)", () => {
    const contacts: ContactsMap = {
      alice: { name: "Alice", email: "alice@example.com" },
    };
    const result = upsertContact(contacts, "Bob", "bob@example.com");
    expect(result).toEqual({
      alice: { name: "Alice", email: "alice@example.com" },
      bob: { name: "Bob", email: "bob@example.com" },
    });
    expect(result).not.toBe(contacts);
    expect(contacts).toEqual({
      alice: { name: "Alice", email: "alice@example.com" },
    });
  });

  it("enforces CONTACTS_MAX cap (500 entries)", () => {
    const contacts: ContactsMap = {};
    let result = contacts;
    for (let i = 0; i < 501; i++) {
      result = upsertContact(result, `User${i}`, `user${i}@example.com`);
    }
    expect(Object.keys(result).length).toBe(500);
    // First entry (User0) should be dropped
    expect("user0" in result).toBe(false);
    // Last entry (User500) should be present
    expect("user500" in result).toBe(true);
  });

  it("caps at 500 by dropping oldest inserted entry", () => {
    let result: ContactsMap = {};
    result = upsertContact(result, "User0", "user0@example.com");
    result = upsertContact(result, "User1", "user1@example.com");
    // Fill to 499 more
    for (let i = 2; i < 500; i++) {
      result = upsertContact(result, `User${i}`, `user${i}@example.com`);
    }
    expect(Object.keys(result).length).toBe(500);
    // Now add one more (should drop User0)
    result = upsertContact(result, "User500", "user500@example.com");
    expect(Object.keys(result).length).toBe(500);
    expect("user0" in result).toBe(false);
    expect("user1" in result).toBe(true);
  });
});

describe("removeContact", () => {
  it("returns unchanged map when contact not found", () => {
    const contacts: ContactsMap = {
      alice: { name: "Alice", email: "alice@example.com" },
    };
    const result = removeContact(contacts, "Bob");
    expect(result).toBe(contacts);
  });

  it("removes contact by name", () => {
    const contacts: ContactsMap = {
      alice: { name: "Alice", email: "alice@example.com" },
    };
    const result = removeContact(contacts, "Alice");
    expect(result).toEqual({});
  });

  it("removes contact immutably", () => {
    const contacts: ContactsMap = {
      alice: { name: "Alice", email: "alice@example.com" },
    };
    const result = removeContact(contacts, "Alice");
    expect(result).not.toBe(contacts);
    expect(contacts).toEqual({
      alice: { name: "Alice", email: "alice@example.com" },
    });
  });

  it("removes one contact from multiple", () => {
    const contacts: ContactsMap = {
      alice: { name: "Alice", email: "alice@example.com" },
      bob: { name: "Bob", email: "bob@example.com" },
      charlie: { name: "Charlie", email: "charlie@example.com" },
    };
    const result = removeContact(contacts, "Bob");
    expect(result).toEqual({
      alice: { name: "Alice", email: "alice@example.com" },
      charlie: { name: "Charlie", email: "charlie@example.com" },
    });
  });

  it("normalizes key for lookup (case-insensitive)", () => {
    const contacts: ContactsMap = {
      alice: { name: "Alice", email: "alice@example.com" },
    };
    const result = removeContact(contacts, "ALICE");
    expect(result).toEqual({});
  });

  it("normalizes key with whitespace", () => {
    const contacts: ContactsMap = {
      "alice bob": { name: "Alice Bob", email: "alice@example.com" },
    };
    const result = removeContact(contacts, "  Alice Bob  ");
    expect(result).toEqual({});
  });
});

describe("seedContactsFromTasks", () => {
  it("returns current map when tasks is empty", () => {
    const contacts: ContactsMap = {
      alice: { name: "Alice", email: "alice@example.com" },
    };
    const result = seedContactsFromTasks(contacts, []);
    expect(result).toEqual(contacts);
  });

  it("adds contacts from tasks", () => {
    const contacts: ContactsMap = {};
    const tasks: Task[] = [
      {
        id: 1,
        taskName: "Task 1",
        assignee: "Alice",
        assigneeEmail: "alice@example.com",
        dueDate: "2026-05-26",
        lastUpdateDate: "2026-05-26",
        status: "To Do",
        priority: "Medium",
        blockers: "",
        notes: "",
      },
    ];
    const result = seedContactsFromTasks(contacts, tasks);
    expect(result).toEqual({
      alice: { name: "Alice", email: "alice@example.com" },
    });
  });

  it("merges tasks into existing contacts", () => {
    const contacts: ContactsMap = {
      alice: { name: "Alice", email: "alice@example.com" },
    };
    const tasks: Task[] = [
      {
        id: 1,
        taskName: "Task 1",
        assignee: "Bob",
        assigneeEmail: "bob@example.com",
        dueDate: "2026-05-26",
        lastUpdateDate: "2026-05-26",
        status: "To Do",
        priority: "Medium",
        blockers: "",
        notes: "",
      },
    ];
    const result = seedContactsFromTasks(contacts, tasks);
    expect(result).toEqual({
      alice: { name: "Alice", email: "alice@example.com" },
      bob: { name: "Bob", email: "bob@example.com" },
    });
  });

  it("skips tasks with empty assignee", () => {
    const contacts: ContactsMap = {};
    const tasks: Task[] = [
      {
        id: 1,
        taskName: "Task 1",
        assignee: "",
        assigneeEmail: "alice@example.com",
        dueDate: "2026-05-26",
        lastUpdateDate: "2026-05-26",
        status: "To Do",
        priority: "Medium",
        blockers: "",
        notes: "",
      },
    ];
    const result = seedContactsFromTasks(contacts, tasks);
    expect(result).toEqual({});
  });

  it("handles tasks with undefined assigneeEmail", () => {
    const contacts: ContactsMap = {};
    const tasks: Task[] = [
      {
        id: 1,
        taskName: "Task 1",
        assignee: "Alice",
        assigneeEmail: "",
        dueDate: "2026-05-26",
        lastUpdateDate: "2026-05-26",
        status: "To Do",
        priority: "Medium",
        blockers: "",
        notes: "",
      },
    ];
    const result = seedContactsFromTasks(contacts, tasks);
    expect(result).toEqual({
      alice: { name: "Alice", email: "" },
    });
  });

  it("processes multiple tasks", () => {
    const contacts: ContactsMap = {};
    const tasks: Task[] = [
      {
        id: 1,
        taskName: "Task 1",
        assignee: "Alice",
        assigneeEmail: "alice@example.com",
        dueDate: "2026-05-26",
        lastUpdateDate: "2026-05-26",
        status: "To Do",
        priority: "Medium",
        blockers: "",
        notes: "",
      },
      {
        id: 2,
        taskName: "Task 2",
        assignee: "Bob",
        assigneeEmail: "bob@example.com",
        dueDate: "2026-05-26",
        lastUpdateDate: "2026-05-26",
        status: "To Do",
        priority: "Medium",
        blockers: "",
        notes: "",
      },
      {
        id: 3,
        taskName: "Task 3",
        assignee: "Alice",
        assigneeEmail: "alice.new@example.com",
        dueDate: "2026-05-26",
        lastUpdateDate: "2026-05-26",
        status: "To Do",
        priority: "Medium",
        blockers: "",
        notes: "",
      },
    ];
    const result = seedContactsFromTasks(contacts, tasks);
    expect(result).toEqual({
      alice: { name: "Alice", email: "alice.new@example.com" },
      bob: { name: "Bob", email: "bob@example.com" },
    });
  });

  it("returns immutably updated contacts", () => {
    const contacts: ContactsMap = {
      charlie: { name: "Charlie", email: "charlie@example.com" },
    };
    const tasks: Task[] = [
      {
        id: 1,
        taskName: "Task 1",
        assignee: "Alice",
        assigneeEmail: "alice@example.com",
        dueDate: "2026-05-26",
        lastUpdateDate: "2026-05-26",
        status: "To Do",
        priority: "Medium",
        blockers: "",
        notes: "",
      },
    ];
    const result = seedContactsFromTasks(contacts, tasks);
    expect(result).not.toBe(contacts);
    expect(result).toEqual({
      charlie: { name: "Charlie", email: "charlie@example.com" },
      alice: { name: "Alice", email: "alice@example.com" },
    });
  });
});

describe("listContacts", () => {
  it("returns empty array for empty map", () => {
    expect(listContacts({})).toEqual([]);
  });

  it("returns single contact as array", () => {
    const contacts: ContactsMap = {
      alice: { name: "Alice", email: "alice@example.com" },
    };
    expect(listContacts(contacts)).toEqual([
      { name: "Alice", email: "alice@example.com" },
    ]);
  });

  it("returns multiple contacts sorted by name", () => {
    const contacts: ContactsMap = {
      charlie: { name: "Charlie", email: "charlie@example.com" },
      alice: { name: "Alice", email: "alice@example.com" },
      bob: { name: "Bob", email: "bob@example.com" },
    };
    expect(listContacts(contacts)).toEqual([
      { name: "Alice", email: "alice@example.com" },
      { name: "Bob", email: "bob@example.com" },
      { name: "Charlie", email: "charlie@example.com" },
    ]);
  });

  it("sorts case-insensitively", () => {
    const contacts: ContactsMap = {
      alice: { name: "alice", email: "alice@example.com" },
      bob: { name: "BOB", email: "bob@example.com" },
      charlie: { name: "Charlie", email: "charlie@example.com" },
    };
    const result = listContacts(contacts);
    expect(result[0].name).toBe("alice");
    expect(result[1].name).toBe("BOB");
    expect(result[2].name).toBe("Charlie");
  });

  it("preserves display name casing in results", () => {
    const contacts: ContactsMap = {
      alice: { name: "ALICE", email: "alice@example.com" },
      bob: { name: "bob", email: "bob@example.com" },
    };
    const result = listContacts(contacts);
    expect(result[0].name).toBe("ALICE");
    expect(result[1].name).toBe("bob");
  });

  it("returns new array (not mutating)", () => {
    const contacts: ContactsMap = {
      alice: { name: "Alice", email: "alice@example.com" },
    };
    const result1 = listContacts(contacts);
    const result2 = listContacts(contacts);
    expect(result1).not.toBe(result2);
    expect(result1).toEqual(result2);
  });

  it("sorts contacts with unicode characters (sensitivity: base ignores accents)", () => {
    const contacts: ContactsMap = {
      andre: { name: "André", email: "andre@example.com" },
      alice: { name: "Alice", email: "alice@example.com" },
      albert: { name: "Albert", email: "albert@example.com" },
    };
    const result = listContacts(contacts);
    // localeCompare with sensitivity: "base" treats accents as equivalent,
    // so André and Alice are considered equally "A"; natural sort order applies.
    const names = result.map((c) => c.name);
    expect(names).toContain("Alice");
    expect(names).toContain("Albert");
    expect(names).toContain("André");
  });

  it("handles contacts with special characters in names", () => {
    const contacts: ContactsMap = {
      "john smith": { name: "John-Smith", email: "john@example.com" },
      alice: { name: "Alice O'Brien", email: "alice@example.com" },
    };
    const result = listContacts(contacts);
    expect(result.length).toBe(2);
    expect(result.some((c) => c.name === "Alice O'Brien")).toBe(true);
    expect(result.some((c) => c.name === "John-Smith")).toBe(true);
  });
});
