// src/app/chat-not-saved-notice.test.tsx — the one line under the chat that says why chats are not
// saved, and the way out of a chat identity this browser can no longer open.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChatNotSavedNotice, ChatThreadClosedNotice } from "./chat-not-saved-notice";
import { loadI18n } from "./i18n";

beforeAll(async () => {
  await loadI18n("de");
});

describe("ChatThreadClosedNotice", () => {
  it("says neutrally that a chat which could not be saved was closed, in English and German", () => {
    const { rerender } = render(<ChatThreadClosedNotice lang="en-US" closed reason="unconfirmed" />);
    expect(screen.getByRole("status")).toHaveTextContent("This chat could not be saved and has been closed.");
    expect(screen.getByRole("status")).not.toHaveTextContent("deleted");
    rerender(<ChatThreadClosedNotice lang="de" closed reason="unconfirmed" />);
    expect(screen.getByRole("status")).toHaveTextContent("Dieser Chat konnte nicht gespeichert werden und wurde daher geschlossen.");
    rerender(<ChatThreadClosedNotice lang="en-US" closed reason="otherDatabase" />);
    expect(screen.getByRole("status")).toHaveTextContent("This chat belongs to the previous database and has been closed.");
    rerender(<ChatThreadClosedNotice lang="de" closed reason="otherDatabase" />);
    expect(screen.getByRole("status")).toHaveTextContent("Dieser Chat gehört zur vorherigen Datenbank und wurde daher geschlossen.");
    rerender(<ChatThreadClosedNotice lang="en-US" closed reason="gone" />);
    expect(screen.getByRole("status")).toHaveTextContent("This chat was deleted elsewhere and has been closed.");
  });

  it("says the chat was deleted elsewhere and closed, in English and German, and nothing when not closed", () => {
    const { rerender, container } = render(<ChatThreadClosedNotice lang="en-US" closed={false} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ChatThreadClosedNotice lang="en-US" closed />);
    expect(screen.getByRole("status")).toHaveTextContent("This chat was deleted elsewhere and has been closed.");
    rerender(<ChatThreadClosedNotice lang="de" closed />);
    expect(screen.getByRole("status")).toHaveTextContent("Dieser Chat wurde an anderer Stelle gelöscht und daher geschlossen.");
  });
});

describe("ChatNotSavedNotice", () => {
  it("says nothing while chats are saved", () => {
    const { container } = render(<ChatNotSavedNotice lang="en-US" persistence="on" onStartNewIdentity={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("a locked identity gets its own message and a button that starts a new identity", () => {
    const onStart = vi.fn(async () => undefined);
    render(<ChatNotSavedNotice lang="en-US" persistence="identity-locked" onStartNewIdentity={onStart} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your saved chats on this browser cannot be opened any more. Start a new chat identity to save chats again; your earlier chats stay with the operator until they expire. If you set a chat passphrase earlier, start a new identity, then use “Open my chats from another browser” in Settings → AI with your unlock code to get your earlier chats back.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Start a new chat identity" }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("a vault that cannot be read right now gets a neutral line and no new-identity button, in English and German", () => {
    const { rerender } = render(<ChatNotSavedNotice lang="en-US" persistence="identity-retry" onStartNewIdentity={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Saved chats are not available right now; the app will try again.");
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<ChatNotSavedNotice lang="de" persistence="identity-retry" onStartNewIdentity={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Gespeicherte Chats sind gerade nicht verfügbar; die App versucht es erneut.");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a locked identity can delete its old chats after typing the delete-all confirm value", async () => {
    const onDelete = vi.fn(async () => "done" as const);
    render(<ChatNotSavedNotice lang="en-US" persistence="identity-locked" onStartNewIdentity={vi.fn()} onDeleteOldChats={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete my old chats" }));
    const dialog = screen.getByRole("dialog");
    const input = dialog.querySelector("input")!;
    fireEvent.change(input, { target: { value: "delete my chats" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete my chats" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("says when deleting the old chats failed, and offers no delete button outside the locked state", async () => {
    const onDelete = vi.fn(async () => { throw new Error("network"); });
    const { rerender } = render(
      <ChatNotSavedNotice lang="de" persistence="identity-locked" onStartNewIdentity={vi.fn()} onDeleteOldChats={onDelete} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Meine alten Chats löschen" }));
    fireEvent.change(screen.getByRole("dialog").querySelector("input")!, { target: { value: "meine Chats löschen" } });
    fireEvent.click(screen.getByRole("button", { name: "Meine Chats löschen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ihre Chats konnten nicht gelöscht werden.");
    rerender(<ChatNotSavedNotice lang="en-US" persistence="no-crypto" onStartNewIdentity={vi.fn()} onDeleteOldChats={onDelete} />);
    expect(screen.queryByRole("button", { name: "Delete my old chats" })).toBeNull();
  });

  it("the no-crypto line has no button", () => {
    render(<ChatNotSavedNotice lang="en-US" persistence="no-crypto" onStartNewIdentity={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Chats are not saved: this browser cannot encrypt them.");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("speaks German", () => {
    render(<ChatNotSavedNotice lang="de" persistence="identity-locked" onStartNewIdentity={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Neue Chat-Identität beginnen" })).toBeInTheDocument();
    expect(screen.getByRole("status").textContent).toContain("Ihre gespeicherten Chats");
    expect(screen.getByRole("status").textContent).toContain("„Meine Chats aus einem anderen Browser öffnen“");
    expect(screen.getByRole("status").textContent).toContain("Entsperrcode");
  });
});
