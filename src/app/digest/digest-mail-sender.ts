// Builds the `sendDigestMail` dependency `useDigest` consumes. Extracted from
// the connected component so the contract below is actually testable — the
// component is coverage-excluded UI glue and had no test, which is how the
// false-success bug shipped.
import { buildGraphMessage, sendMail } from "../graph-mail";

/**
 * CONTRACT: resolve ONLY when a mail was actually accepted by Graph; throw on
 * every other outcome. `useDigest` treats a resolved promise as "sent" and
 * confirms it to the user, so reporting a failure here and resolving produces a
 * false "Digest email sent." with nothing in the mailbox.
 *
 * The thrown message must stay free of the recipient and the token — it is
 * logged to the diagnostics ring by the hook's `reportSilentFailure`.
 *
 * `send` is injectable for tests; production callers use the default.
 */
export function createDigestMailSender(
  getRecipient: () => string | undefined,
  send: typeof sendMail = sendMail,
) {
  return async (token: string, subject: string, html: string): Promise<void> => {
    // Trim before the emptiness check: `buildGraphMessage` trims and drops empty
    // addresses, so a whitespace-only username would slip past a bare falsy
    // check and POST with an empty `toRecipients`.
    const to = (getRecipient() ?? "").trim();
    if (!to) throw new Error("no-recipient");
    await send(token, buildGraphMessage(to, subject, html));
  };
}
