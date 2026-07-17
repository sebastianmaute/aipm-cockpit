"use client";

// Boot-time unlock gate for a passphrase-wrapped at-rest secret. Rendered as the
// ONLY surface (a non-dismissable modal) when a required secret is sealed under a
// passphrase and not yet held in memory — e.g. the Turso auth token, without
// which the portfolio can't load. The caller resolves `onUnlock(passphrase)`:
// true means it decrypted the secret and filled it into in-memory settings
// (which makes this gate disappear and lets the storage backend load); false
// means the passphrase was wrong.

import { useState } from "react";
import { type Lang, t, type TranslationKey } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { Button } from "./button";

export interface SecretUnlockGateProps {
  lang: Lang;
  messageKey: TranslationKey;
  /** Resolve true on success (caller fills the secret in memory); false → wrong passphrase. */
  onUnlock: (passphrase: string) => Promise<boolean>;
}

const TITLE_ID = "secret-unlock-gate-title";

/** No-op passed to Modal.onClose so Escape/backdrop do nothing (non-dismissable). */
const noop = () => undefined;

export function SecretUnlockGate({ lang, messageKey, onUnlock }: SecretUnlockGateProps) {
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!passphrase || busy) return;
    setBusy(true);
    const ok = await onUnlock(passphrase);
    setBusy(false);
    if (ok) {
      setPassphrase("");
      setError(false);
    } else {
      setError(true);
    }
  }

  return (
    <Modal open onClose={noop} ariaLabelledby={TITLE_ID} align="center" zIndex={50}>
      <div
        data-modal-panel
        className="w-[440px] max-w-[92vw] rounded-xl border border-line bg-surface"
      >
        <ModalHeader
          lang={lang}
          title={t(lang, "secretUnlockTitle")}
          titleId={TITLE_ID}
          onClose={noop}
          hideClose
        />
        <div className="flex flex-col gap-3 p-6">
          <p className="text-sm text-muted-foreground">{t(lang, messageKey)}</p>
          <input
            type="password"
            aria-label={t(lang, "secretPassphrasePlaceholder")}
            placeholder={t(lang, "secretPassphrasePlaceholder")}
            value={passphrase}
            onChange={(e) => {
              setPassphrase(e.target.value);
              setError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-AIPM-green"
          />
          {error && (
            <p role="alert" className="text-sm text-AIPM-pink-strong">
              {t(lang, "secretUnlockFailed")}
            </p>
          )}
          <div className="flex justify-end">
            <Button
              variant="primary"
              onClick={() => void submit()}
              disabled={!passphrase || busy}
            >
              {t(lang, "secretUnlock")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
