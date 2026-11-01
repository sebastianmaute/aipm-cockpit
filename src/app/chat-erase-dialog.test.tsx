// src/app/chat-erase-dialog.test.tsx — "Delete all my chats" and "Find chats mentioning a person".
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ChatEraseControls } from "./chat-erase-dialog";
import type { ChatEraseActions } from "./use-chat-threads";
import type { ChatThread } from "./chat-threads";
import { loadI18n } from "./i18n";

function thread(id: string, over: Partial<ChatThread> = {}): ChatThread {
  return {
    id, projectId: "p", ownerId: "me", name: `Thread ${id}`,
    createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z", history: [], display: [], ...over,
  };
}

function actions(over: Partial<ChatEraseActions> = {}): ChatEraseActions {
  return {
    enabled: true,
    ownerId: "me",
    deleteAll: vi.fn(async () => "done" as const),
    deleteSelected: vi.fn(async () => undefined),
    ...over,
  };
}

function renderControls(threads: ChatThread[], erase = actions(), lang: "en-US" | "de" = "en-US") {
  render(<ChatEraseControls lang={lang} threads={threads} erase={erase} />);
  return erase;
}

function search(query: string) {
  fireEvent.click(screen.getByRole("button", { name: "Find chats mentioning a person" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Name or e-mail address" }), { target: { value: query } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Search" }));
  return dialog;
}

describe("ChatEraseControls — find chats mentioning a person", () => {
  it("says that older shared chats are searched and can be deleted too", () => {
    renderControls([thread("a")]);
    fireEvent.click(screen.getByRole("button", { name: "Find chats mentioning a person" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("older shared chats saved before chats became private, which you can delete too");
    expect(dialog).not.toHaveTextContent("Colleagues' chats are not searched.");
  });
});

describe("ChatEraseControls — delete all my chats", () => {
  it("asks for the typed phrase before deleting, then deletes", async () => {
    const erase = renderControls([thread("a")]);
    fireEvent.click(screen.getByRole("button", { name: "Delete all my chats" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("in every project of this database");
    expect(dialog).toHaveTextContent("cannot be undone");
    expect(dialog).toHaveTextContent("colleagues' chats are not affected");
    expect(dialog).toHaveTextContent("Your own chats from before the upgrade belong to no one and stay until they expire");
    const confirm = within(dialog).getByRole("button", { name: "Delete my chats" });
    expect(confirm).toBeDisabled();
    const input = within(dialog).getByRole("textbox");
    fireEvent.change(input, { target: { value: "delete chats" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(input, { target: { value: "delete my chats" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(erase.deleteAll).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("closes the dialog and says so when the delete fails", async () => {
    renderControls([thread("a")], actions({ deleteAll: vi.fn(async () => { throw new Error("x"); }) }));
    fireEvent.click(screen.getByRole("button", { name: "Delete all my chats" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "delete my chats" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete my chats" }));
    expect(await screen.findByText("Your chats could not be deleted. Please try again.")).toBeInTheDocument();
  });

  it("says the chats were deleted, not that the delete failed, when only the refresh afterwards failed", async () => {
    renderControls([thread("a")], actions({ deleteAll: vi.fn(async () => "not-refreshed" as const) }));
    fireEvent.click(screen.getByRole("button", { name: "Delete all my chats" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "delete my chats" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete my chats" }));
    expect(await screen.findByText("Your chats were deleted; the list could not be refreshed.")).toBeInTheDocument();
    expect(screen.queryByText("Your chats could not be deleted. Please try again.")).not.toBeInTheDocument();
  });

  it("says so in German too when only the refresh failed", async () => {
    await loadI18n("de");
    renderControls([thread("a")], actions({ deleteAll: vi.fn(async () => "not-refreshed" as const) }), "de");
    fireEvent.click(screen.getByRole("button", { name: "Alle meine Chats löschen" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "meine Chats löschen" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Meine Chats löschen" }));
    expect(await screen.findByText("Ihre Chats wurden gelöscht; die Liste konnte nicht aktualisiert werden.")).toBeInTheDocument();
  });

  it("is disabled, with the reason as its description, when this browser has no chats of yours", () => {
    renderControls([thread("a", { ownerId: null })], actions({ ownerId: null }));
    const button = screen.getByRole("button", { name: "Delete all my chats" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription("This browser has no saved chats of yours to delete.");
  });

  it("renders nothing while chats are not saved", () => {
    renderControls([thread("a")], actions({ enabled: false }));
    expect(screen.queryByRole("button", { name: "Delete all my chats" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Find chats mentioning a person" })).not.toBeInTheDocument();
  });

  it("uses the German phrase in German", async () => {
    await loadI18n("de");
    renderControls([thread("a")], actions(), "de");
    fireEvent.click(screen.getByRole("button", { name: "Alle meine Chats löschen" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("meine Chats löschen");
  });
});

describe("ChatEraseControls — find chats mentioning a person", () => {
  const jane = thread("j", { name: "Budget", history: [{ role: "assistant", content: [{ type: "text", text: "Ask JANE" }] }] });
  const janeToo = thread("k", { name: "Budget", display: [{ kind: "user", text: "jane said" }] });
  const other = thread("o", { name: "Other" });

  it("searching is disabled until a query is typed", () => {
    renderControls([jane]);
    fireEvent.click(screen.getByRole("button", { name: "Find chats mentioning a person" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Search" })).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Name or e-mail address" }), { target: { value: "   " } });
    expect(within(dialog).getByRole("button", { name: "Search" })).toBeDisabled();
  });

  it("lists matches with row-unique tick boxes and deletes exactly the ticked ones", async () => {
    const erase = renderControls([jane, janeToo, other]);
    const dialog = search("Jane");
    const boxes = within(dialog).getAllByRole("checkbox");
    expect(boxes.map((b) => b.getAttribute("aria-label"))).toEqual(['Select "Budget (1)"', 'Select "Budget (2)"']);
    const deleteButton = within(dialog).getByRole("button", { name: "Delete selected" });
    expect(deleteButton).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: 'Select "Budget (2)"' }));
    fireEvent.click(deleteButton);
    await waitFor(() => expect(erase.deleteSelected).toHaveBeenCalledWith(["k"]));
  });

  it("says when no chat matches", () => {
    renderControls([other]);
    const dialog = search("jane");
    expect(dialog).toHaveTextContent('No chat mentions "jane".');
    expect(within(dialog).queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("does not list a colleague's chat", () => {
    renderControls([thread("c", { ownerId: "colleague", name: "Jane" })]);
    const dialog = search("jane");
    expect(within(dialog).queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("says so when deleting fails", async () => {
    renderControls([jane], actions({ deleteSelected: vi.fn(async () => { throw new Error("x"); }) }));
    const dialog = search("jane");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: 'Select "Budget"' }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete selected" }));
    expect(await within(dialog).findByText("Some chats could not be deleted. Please try again.")).toBeInTheDocument();
  });
});
