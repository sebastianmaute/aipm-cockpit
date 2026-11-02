"use client";

// src/app/settings-sections/chat-passphrase-section.tsx — Settings → AI "Chat passphrase": set or
// change the passphrase that keeps this browser's chat key in the database (the unlock code is shown
// once), remove it, and open the chats of another browser with its unlock code and passphrase.
// Rendered by ai-section.tsx only while chats are saved. The passphrase, the code and any key
// material never reach a log: failures are logged by code alone.
import { useId, useState } from "react";
import { type Lang, t } from "../i18n";
import type { TursoConfig } from "../turso-config";
import { Button } from "../button";
import { Input } from "../form-controls";
import { Banner } from "../banner";
import { FieldError, FieldNotice } from "../field-feedback";
import { FieldHint } from "../field-hint";
import { useConfirm, useNotice, type ConfirmFn, type NoticeFn } from "../confirm-dialog";
import { logDiag } from "../diagnostics";
import { reloadRefusalText, secretLostToReload } from "../portfolio-mode-switch";
import type { Settings } from "../settings-types";
import { ensureChatIdentity, getChatIdentity } from "../chat-key-vault";
import {
  ChatAdoptionMoveError, MIN_CHAT_PASSPHRASE_LENGTH, formatUnlockCode, removeChatPassphrase, setChatPassphrase, unlockWithPassphrase,
} from "../chat-passphrase";

type I18nKey = Parameters<typeof t>[1];
type Message = { tone: "error" | "ok"; text: string } | null;

interface ChatPassphraseSectionProps {
  lang: Lang;
  tursoConfig: TursoConfig;
  /** The live settings, for the reload gate an unlock runs first (a reload loses a secret typed under its
   *  passphrase lock and not sealed yet). */
  readSettings: () => Settings;
  /** After a successful unlock: reload so every surface reads the adopted identity (default). */
  onAdopted?: () => void;
  /** Test seams; the app's dialogs by default. */
  confirm?: ConfirmFn;
  notice?: NoticeFn;
}

function reloadPage(): void {
  window.location.reload();
}

function Feedback({ message }: { message: Message }) {
  if (!message) return null;
  return message.tone === "error" ? <FieldError>{message.text}</FieldError> : <FieldNotice>{message.text}</FieldNotice>;
}

function LabelledPassword({ label, value, onChange, autoComplete = "new-password" }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <Input className="w-full" type="password" autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function SetPassphrase({ lang, tursoConfig }: { lang: Lang; tursoConfig: TursoConfig }) {
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [code, setCode] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setCode(null);
    if (Array.from(first).length < MIN_CHAT_PASSPHRASE_LENGTH) {
      setMessage({ tone: "error", text: t(lang, "chatPassphraseTooShort", MIN_CHAT_PASSPHRASE_LENGTH) });
      return;
    }
    if (first !== second) {
      setMessage({ tone: "error", text: t(lang, "chatPassphraseMismatch") });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const identity = await ensureChatIdentity(tursoConfig.httpUrl);
      if (!identity) throw new Error("no chat identity");
      const { unlockCode } = await setChatPassphrase(tursoConfig, identity, first);
      setFirst("");
      setSecond("");
      setCode(unlockCode);
    } catch {
      logDiag("warn", "chat.passphraseSetFailed");
      setMessage({ tone: "error", text: t(lang, "chatPassphraseSetFailed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <LabelledPassword label={t(lang, "chatPassphraseNew")} value={first} onChange={setFirst} />
      <LabelledPassword label={t(lang, "chatPassphraseConfirm")} value={second} onChange={setSecond} />
      <FieldHint>{t(lang, "chatPassphraseForgotten")}</FieldHint>
      <div>
        <Button size="sm" disabled={busy} onClick={() => void submit()}>{t(lang, "chatPassphraseSet")}</Button>
      </div>
      <Feedback message={message} />
      {code !== null && (
        <Banner severity="info">
          <span className="block">{t(lang, "chatPassphraseCodeLabel")}</span>
          <code className="mt-1 block select-all font-mono text-base tracking-widest">{formatUnlockCode(code)}</code>
          <span className="mt-1 block">{t(lang, "chatPassphraseForgotten")}</span>
        </Banner>
      )}
    </div>
  );
}

function RemovePassphrase({ lang, tursoConfig, confirm }: { lang: Lang; tursoConfig: TursoConfig; confirm: ConfirmFn }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  async function remove(): Promise<void> {
    const ok = await confirm({ message: t(lang, "chatPassphraseRemoveConfirm"), confirmLabel: t(lang, "chatPassphraseRemove") });
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    try {
      const identity = await getChatIdentity(tursoConfig.httpUrl);
      if (!identity) {
        setMessage({ tone: "ok", text: t(lang, "chatPassphraseNoChats") });
        return;
      }
      await removeChatPassphrase(tursoConfig, identity.ownerId);
      setMessage({ tone: "ok", text: t(lang, "chatPassphraseRemoved") });
    } catch {
      logDiag("warn", "chat.passphraseRemoveFailed");
      setMessage({ tone: "error", text: t(lang, "chatPassphraseRemoveFailed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void remove()}>{t(lang, "chatPassphraseRemove")}</Button>
      <Feedback message={message} />
    </div>
  );
}

const UNLOCK_MESSAGES: Record<"wrong" | "unknown-code", I18nKey> = {
  wrong: "chatUnlockWrong",
  "unknown-code": "chatUnlockUnknown",
};

function UnlockFromOtherBrowser({ lang, tursoConfig, readSettings, notice, onAdopted }: {
  lang: Lang;
  tursoConfig: TursoConfig;
  readSettings: () => Settings;
  notice: NoticeFn;
  onAdopted: () => void;
}) {
  const headingId = useId();
  const [code, setCode] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  async function unlock(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      // §749 — an unlock ends in a reload, which would lose a secret typed under its passphrase lock and not
      // sealed yet. Refuse BEFORE anything is written, and say how to save it.
      const risk = await secretLostToReload(readSettings);
      if (risk) {
        setMessage({ tone: "error", text: reloadRefusalText(lang, risk) });
        return;
      }
      const result = await unlockWithPassphrase(tursoConfig, tursoConfig.httpUrl, code, passphrase);
      if (result.outcome !== "adopted") {
        setMessage({ tone: "error", text: t(lang, UNLOCK_MESSAGES[result.outcome]) });
        return;
      }
      setPassphrase("");
      const lines = [t(lang, "chatUnlockDone")];
      if (result.skipped > 0) lines.push(t(lang, "chatUnlockSkipped", result.skipped));
      await notice({ message: lines.join("\n"), title: t(lang, "chatUnlockHeading") });
      onAdopted();
    } catch (err) {
      logDiag("warn", "chat.unlockFailed");
      if (err instanceof ChatAdoptionMoveError) {
        // The adopted identity is stored: this tab must not keep using the old one. Say why first, then
        // reload as on success; unlocking again finishes the move.
        setPassphrase("");
        await notice({ message: t(lang, "chatUnlockMoveFailed"), title: t(lang, "chatUnlockHeading") });
        onAdopted();
        return;
      }
      setMessage({ tone: "error", text: t(lang, "chatUnlockFailed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="group" aria-labelledby={headingId} className="mt-3 flex flex-col gap-2">
      <span id={headingId} className="text-xs font-medium text-foreground">{t(lang, "chatUnlockHeading")}</span>
      <FieldHint>{t(lang, "chatUnlockHint")}</FieldHint>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t(lang, "chatUnlockCode")}
        <Input className="w-full font-mono" autoComplete="off" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} />
      </label>
      <LabelledPassword label={t(lang, "chatUnlockPassphrase")} value={passphrase} onChange={setPassphrase} autoComplete="current-password" />
      <div>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void unlock()}>{t(lang, "chatUnlockButton")}</Button>
      </div>
      <Feedback message={message} />
    </div>
  );
}

export function ChatPassphraseSection({
  lang, tursoConfig, readSettings, onAdopted = reloadPage, confirm, notice,
}: ChatPassphraseSectionProps) {
  const headingId = useId();
  const appConfirm = useConfirm();
  const appNotice = useNotice();
  return (
    <div role="group" aria-labelledby={headingId} className="mt-3 rounded-md border border-line bg-surface p-3">
      <span id={headingId} className="text-sm font-medium text-foreground">{t(lang, "chatPassphraseHeading")}</span>
      <FieldHint className="mt-1">{t(lang, "chatPassphraseIntro")}</FieldHint>
      <SetPassphrase lang={lang} tursoConfig={tursoConfig} />
      <RemovePassphrase lang={lang} tursoConfig={tursoConfig} confirm={confirm ?? appConfirm} />
      <UnlockFromOtherBrowser
        lang={lang} tursoConfig={tursoConfig} readSettings={readSettings} notice={notice ?? appNotice} onAdopted={onAdopted}
      />
    </div>
  );
}
