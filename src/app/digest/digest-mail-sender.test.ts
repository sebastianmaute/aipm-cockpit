import { describe, it, expect, vi } from "vitest";
import { createDigestMailSender } from "./digest-mail-sender";

// This is the contract behind the digest card's "Email digest" button. The hook
// treats a RESOLVED promise as "the mail was sent" and confirms it to the user,
// so the sender must resolve only on an actual send and throw otherwise.
// Reporting a failure and resolving produced two contradictory toasts ending in
// "Digest email sent." with nothing in the mailbox — and nothing tested it.
describe("createDigestMailSender", () => {
  const SUBJECT = "Weekly status digest";
  const HTML = "<p>hi</p>";

  it("sends to the signed-in account", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await createDigestMailSender(() => "alice@example.com", send)("tok", SUBJECT, HTML);
    expect(send).toHaveBeenCalledTimes(1);
    const [token, msg] = send.mock.calls[0];
    expect(token).toBe("tok");
    expect(msg.toRecipients).toEqual([{ emailAddress: { address: "alice@example.com" } }]);
    expect(msg.subject).toBe(SUBJECT);
  });

  it("THROWS when there is no signed-in account, rather than resolving", async () => {
    const send = vi.fn();
    await expect(createDigestMailSender(() => undefined, send)("tok", SUBJECT, HTML)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("throws on an empty username", async () => {
    const send = vi.fn();
    await expect(createDigestMailSender(() => "", send)("tok", SUBJECT, HTML)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  // buildGraphMessage trims and drops empty addresses, so a whitespace-only
  // username slips past a bare falsy check and POSTs with toRecipients: [].
  it("throws on a whitespace-only username instead of sending to nobody", async () => {
    const send = vi.fn();
    await expect(createDigestMailSender(() => "   ", send)("tok", SUBJECT, HTML)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  // NOT a guard on this module: buildGraphMessage trims independently, so this
  // still passes with this module's own .trim() removed. Kept only to document
  // the end-to-end result; the real guard on that trim is the whitespace-only
  // case above, which is the one that changes behaviour when it is dropped.
  it("delivers a trimmed recipient (buildGraphMessage's contract, not this module's)", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await createDigestMailSender(() => "  bob@example.com  ", send)("tok", SUBJECT, HTML);
    expect(send.mock.calls[0][1].toRecipients).toEqual([
      { emailAddress: { address: "bob@example.com" } },
    ]);
  });

  it("propagates a Graph failure so the hook reports it", async () => {
    const send = vi.fn().mockRejectedValue(new Error("Graph /me/sendMail failed (500)"));
    await expect(
      createDigestMailSender(() => "alice@example.com", send)("tok", SUBJECT, HTML),
    ).rejects.toThrow(/500/);
  });

  // The thrown message reaches the diagnostics ring via reportSilentFailure.
  it("throws a message carrying no address or token", async () => {
    const err = await createDigestMailSender(() => "   ", vi.fn())("tok", SUBJECT, HTML).catch(
      (e: unknown) => e,
    );
    // REQUIRED first: without it both negative assertions below pass on the
    // ABSENCE of an error — remove the throw and `err` is undefined, whose
    // String() contains neither "tok" nor "@", so the test could never fail.
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).not.toContain("tok");
    expect(message).not.toMatch(/@/);
  });
});
