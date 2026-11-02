// src/app/settings-sections/chat-passphrase-section.test.tsx — the Settings → AI "Chat passphrase"
// area: set (with the one-time unlock code), remove, and open chats from another browser.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../chat-passphrase", async (orig) => ({
  ...(await orig<typeof import("../chat-passphrase")>()),
  setChatPassphrase: vi.fn(),
  removeChatPassphrase: vi.fn(),
  unlockWithPassphrase: vi.fn(),
}));
vi.mock("../chat-key-vault", () => ({
  ensureChatIdentity: vi.fn(),
  getChatIdentity: vi.fn(),
}));

import { ChatPassphraseSection } from "./chat-passphrase-section";
import { ChatAdoptionMoveError, removeChatPassphrase, setChatPassphrase, unlockWithPassphrase } from "../chat-passphrase";
import { ensureChatIdentity, getChatIdentity } from "../chat-key-vault";
import { loadI18n, t } from "../i18n";

const cfg = { httpUrl: "https://db.example", authToken: "tok" } as never;
const me = { ownerId: "me", chatKey: new Uint8Array(32) };
const LONG = "a long passphrase";

const setMock = vi.mocked(setChatPassphrase);
const removeMock = vi.mocked(removeChatPassphrase);
const unlockMock = vi.mocked(unlockWithPassphrase);

beforeAll(async () => {
  await loadI18n("de");
});
beforeEach(() => {
  vi.mocked(ensureChatIdentity).mockResolvedValue(me);
  vi.mocked(getChatIdentity).mockResolvedValue(me);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const en = (key: Parameters<typeof t>[1], ...args: (string | number)[]) => t("en-US", key, ...args);
const type = (name: string, value: string) => fireEvent.change(screen.getByLabelText(name), { target: { value } });

describe("ChatPassphraseSection", () => {
  it("every control has an accessible name", () => {
    render(<ChatPassphraseSection lang="en-US" tursoConfig={cfg} onAdopted={vi.fn()} />);
    for (const name of ["chatPassphraseNew", "chatPassphraseConfirm", "chatUnlockCode", "chatUnlockPassphrase"] as const) {
      expect(screen.getByLabelText(en(name))).toBeInTheDocument();
    }
    for (const name of ["chatPassphraseSet", "chatPassphraseRemove", "chatUnlockButton"] as const) {
      expect(screen.getByRole("button", { name: en(name) })).toBeInTheDocument();
    }
    expect(screen.getByText(en("chatPassphraseForgotten"))).toBeInTheDocument();
  });

  it("refuses a short passphrase and a mismatch without saving", async () => {
    render(<ChatPassphraseSection lang="en-US" tursoConfig={cfg} onAdopted={vi.fn()} />);
    type(en("chatPassphraseNew"), "short");
    type(en("chatPassphraseConfirm"), "short");
    fireEvent.click(screen.getByRole("button", { name: en("chatPassphraseSet") }));
    expect(await screen.findByText(en("chatPassphraseTooShort", 12))).toBeInTheDocument();
    type(en("chatPassphraseNew"), LONG);
    type(en("chatPassphraseConfirm"), `${LONG}!`);
    fireEvent.click(screen.getByRole("button", { name: en("chatPassphraseSet") }));
    expect(await screen.findByText(en("chatPassphraseMismatch"))).toBeInTheDocument();
    expect(setMock).not.toHaveBeenCalled();
  });

  it("sets the passphrase for this browser's identity and shows the unlock code once, split for reading", async () => {
    setMock.mockResolvedValue({ unlockCode: "ABCDEFGH" });
    render(<ChatPassphraseSection lang="en-US" tursoConfig={cfg} onAdopted={vi.fn()} />);
    type(en("chatPassphraseNew"), LONG);
    type(en("chatPassphraseConfirm"), LONG);
    fireEvent.click(screen.getByRole("button", { name: en("chatPassphraseSet") }));
    expect(await screen.findByText("ABCD-EFGH")).toBeInTheDocument();
    expect(ensureChatIdentity).toHaveBeenCalledWith("https://db.example");
    expect(setMock).toHaveBeenCalledWith(cfg, me, LONG);
    expect(screen.getByLabelText(en("chatPassphraseNew"))).toHaveValue("");
  });

  it("removes only this browser's own row", async () => {
    render(<ChatPassphraseSection lang="en-US" tursoConfig={cfg} onAdopted={vi.fn()} confirm={async () => true} />);
    fireEvent.click(screen.getByRole("button", { name: en("chatPassphraseRemove") }));
    expect(await screen.findByText(en("chatPassphraseRemoved"))).toBeInTheDocument();
    expect(removeMock).toHaveBeenCalledWith(cfg, "me");
  });

  it("does not remove when the confirmation is declined", async () => {
    render(<ChatPassphraseSection lang="en-US" tursoConfig={cfg} onAdopted={vi.fn()} confirm={async () => false} />);
    fireEvent.click(screen.getByRole("button", { name: en("chatPassphraseRemove") }));
    await waitFor(() => expect(getChatIdentity).not.toHaveBeenCalled());
    expect(removeMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ outcome: "wrong" as const }, "chatUnlockWrong" as const],
    [{ outcome: "unknown-code" as const }, "chatUnlockUnknown" as const],
  ])("an unlock answering %o shows its message and adopts nothing", async (result, key) => {
    unlockMock.mockResolvedValue(result);
    const onAdopted = vi.fn();
    render(<ChatPassphraseSection lang="en-US" tursoConfig={cfg} onAdopted={onAdopted} />);
    type(en("chatUnlockCode"), "abcd-efgh");
    type(en("chatUnlockPassphrase"), LONG);
    fireEvent.click(screen.getByRole("button", { name: en("chatUnlockButton") }));
    expect(await screen.findByText(en(key))).toBeInTheDocument();
    expect(unlockMock).toHaveBeenCalledWith(cfg, "https://db.example", "abcd-efgh", LONG);
    expect(onAdopted).not.toHaveBeenCalled();
  });

  it("a successful unlock tells the person, then hands over to reload", async () => {
    unlockMock.mockResolvedValue({ outcome: "adopted", moved: 2, skipped: 1 });
    const onAdopted = vi.fn();
    const notice = vi.fn(async () => {});
    render(<ChatPassphraseSection lang="en-US" tursoConfig={cfg} onAdopted={onAdopted} notice={notice} />);
    type(en("chatUnlockCode"), "ABCDEFGH");
    type(en("chatUnlockPassphrase"), LONG);
    fireEvent.click(screen.getByRole("button", { name: en("chatUnlockButton") }));
    await waitFor(() => expect(onAdopted).toHaveBeenCalledTimes(1));
    expect(notice).toHaveBeenCalledWith(expect.objectContaining({
      message: `${en("chatUnlockDone")}\n${en("chatUnlockSkipped", 1)}`,
    }));
  });

  it("an unlock whose identity was stored but whose move failed says so first, then reloads like a success", async () => {
    unlockMock.mockRejectedValue(new ChatAdoptionMoveError());
    const order: string[] = [];
    const onAdopted = vi.fn(() => { order.push("reload"); });
    const notice = vi.fn(async () => { order.push("notice"); });
    render(<ChatPassphraseSection lang="en-US" tursoConfig={cfg} onAdopted={onAdopted} notice={notice} />);
    type(en("chatUnlockCode"), "ABCDEFGH");
    type(en("chatUnlockPassphrase"), LONG);
    fireEvent.click(screen.getByRole("button", { name: en("chatUnlockButton") }));
    await waitFor(() => expect(onAdopted).toHaveBeenCalledTimes(1));
    expect(notice).toHaveBeenCalledWith(expect.objectContaining({ message: en("chatUnlockMoveFailed") }));
    expect(order).toEqual(["notice", "reload"]);
  });

  it("an unlock that failed before storing anything shows the failure and does not reload", async () => {
    unlockMock.mockRejectedValue(new Error("network"));
    const onAdopted = vi.fn();
    render(<ChatPassphraseSection lang="en-US" tursoConfig={cfg} onAdopted={onAdopted} notice={vi.fn(async () => {})} />);
    type(en("chatUnlockCode"), "ABCDEFGH");
    type(en("chatUnlockPassphrase"), LONG);
    fireEvent.click(screen.getByRole("button", { name: en("chatUnlockButton") }));
    expect(await screen.findByText(en("chatUnlockFailed"))).toBeInTheDocument();
    expect(onAdopted).not.toHaveBeenCalled();
  });

  it("renders in German", () => {
    render(<ChatPassphraseSection lang="de" tursoConfig={cfg} onAdopted={vi.fn()} />);
    expect(screen.getByText("Chat-Passphrase")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Meine Chats öffnen" })).toBeInTheDocument();
  });
});
