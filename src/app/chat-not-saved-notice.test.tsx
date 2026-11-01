// src/app/chat-not-saved-notice.test.tsx — the one line under the chat that says why chats are not
// saved, and the way out of a chat identity this browser can no longer open.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatNotSavedNotice } from "./chat-not-saved-notice";
import { loadI18n } from "./i18n";

beforeAll(async () => {
  await loadI18n("de");
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
      "Your saved chats on this browser cannot be opened any more. Start a new chat identity to save chats again; your earlier chats stay with the operator until they expire.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Start a new chat identity" }));
    expect(onStart).toHaveBeenCalledTimes(1);
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
  });
});
