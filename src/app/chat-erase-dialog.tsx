"use client";

// src/app/chat-erase-dialog.tsx — the chat sidebar's two erase controls: "Delete all my chats" (a
// type-to-confirm dialog; deletes this browser's owner's threads in every project of the database)
// and "Find chats mentioning a person" (search this owner's chats of every project and this project's
// older shared ones, tick, delete — each in its own project; every match names its project). Rendered
// once the chat status is known — also while chats are not saved, since deletes need no encryption;
// the hook (`use-chat-threads.ts`) does the deleting.

import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import { type Lang, t } from "./i18n";
import { Banner } from "./banner";
import { Button } from "./button";
import { Checkbox, Input } from "./form-controls";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { TypeToConfirmDialog } from "./type-to-confirm-dialog";
import { buildRowTokens } from "./row-tokens";
import { formatFetchedAt } from "./date-format";
import type { ChatThread } from "./chat-threads";
import type { ChatEraseActions } from "./use-chat-threads";

export interface ChatEraseControlsProps {
  lang: Lang;
  erase: ChatEraseActions;
  /** Project names by id, for the project each found chat belongs to; an unknown id is shown as is. */
  projectNames?: ReadonlyMap<string, string>;
}

function displayName(lang: Lang, name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : t(lang, "chatThreadUntitled");
}

export function ChatEraseControls({ lang, erase, projectNames }: ChatEraseControlsProps) {
  const noOwnerId = useId();
  const [open, setOpen] = useState<"none" | "delete-all" | "find">("none");
  const [busy, setBusy] = useState(false);
  // What the last delete-all left to say: it failed, or it deleted but the list could not be refreshed.
  const [deleteAllNotice, setDeleteAllNotice] = useState<"failed" | "not-refreshed" | null>(null);
  if (!erase.enabled) return null;
  const hasOwner = erase.ownerId !== null;

  function confirmDeleteAll(): void {
    if (busy) return;
    setBusy(true);
    setDeleteAllNotice(null);
    erase.deleteAll().then(
      (outcome) => {
        setBusy(false);
        setOpen("none");
        if (outcome === "not-refreshed") setDeleteAllNotice("not-refreshed");
      },
      () => {
        setBusy(false);
        setOpen("none");
        setDeleteAllNotice("failed");
      },
    );
  }

  return (
    <div className="flex shrink-0 flex-col items-start gap-1.5">
      {deleteAllNotice === "failed" && (
        <Banner severity="error" role="alert">
          {t(lang, "chatDeleteAllFailed")}
        </Banner>
      )}
      {deleteAllNotice === "not-refreshed" && (
        <Banner severity="warn" role="alert">
          {t(lang, "chatDeleteAllNotRefreshed")}
        </Banner>
      )}
      <Button variant="secondary" size="xs" onClick={() => setOpen("find")}>
        {t(lang, "chatFindButton")}
      </Button>
      <Button
        variant="secondary"
        size="xs"
        disabled={!hasOwner}
        aria-describedby={hasOwner ? undefined : noOwnerId}
        onClick={() => setOpen("delete-all")}
      >
        {t(lang, "chatDeleteAllButton")}
      </Button>
      {!hasOwner && (
        <p id={noOwnerId} className="text-xs text-muted-foreground">
          {t(lang, "chatDeleteAllNoOwner")}
        </p>
      )}
      {open === "delete-all" && (
        <TypeToConfirmDialog
          lang={lang}
          title={t(lang, "chatDeleteAllTitle")}
          message={t(lang, "chatDeleteAllMessage")}
          confirmValue={t(lang, "chatDeleteAllConfirmValue")}
          confirmLabel={t(lang, "chatDeleteAllConfirm")}
          onConfirm={confirmDeleteAll}
          onCancel={() => setOpen("none")}
        />
      )}
      {open === "find" && (
        <ChatFindDialog lang={lang} erase={erase} projectNames={projectNames} onClose={() => setOpen("none")} />
      )}
    </div>
  );
}

interface ChatFindDialogProps extends ChatEraseControlsProps {
  onClose: () => void;
}

/** Search this owner's chats (every project) and this project's older shared ones for a name or e-mail
 *  address, tick matches, delete the ticked ones. Deleted matches leave the results. */
export function ChatFindDialog({ lang, erase, projectNames, onClose }: ChatFindDialogProps) {
  const titleId = useId();
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [matches, setMatches] = useState<readonly ChatThread[]>([]);
  const [searchFailed, setSearchFailed] = useState(false);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Only the latest search may set the results: an earlier one that answers late is dropped.
  const searchSeq = useRef(0);
  const tokens = useMemo(
    () => buildRowTokens(matches.map((th) => ({ id: th.id, name: displayName(lang, th.name) }))),
    [matches, lang],
  );
  const selected = matches.filter((th) => ticked.has(th.id)).map((th) => th.id);
  const canSearch = query.trim() !== "";

  function search(e: FormEvent): void {
    e.preventDefault();
    if (!canSearch) return;
    const q = query.trim();
    const seq = ++searchSeq.current;
    setSubmitted(q);
    setMatches([]);
    setTicked(new Set());
    setFailed(false);
    setSearchFailed(false);
    erase.findMentioning(q).then(
      (found) => { if (seq === searchSeq.current) setMatches(found); },
      () => { if (seq === searchSeq.current) setSearchFailed(true); },
    );
  }

  function toggle(id: string, on: boolean): void {
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function deleteTicked(): void {
    if (busy || selected.length === 0) return;
    setBusy(true);
    setFailed(false);
    const gone = new Set(selected);
    erase.deleteSelected(selected).then(
      () => {
        setBusy(false);
        setMatches((prev) => prev.filter((th) => !gone.has(th.id)));
      },
      () => {
        setBusy(false);
        setFailed(true);
      },
    );
  }

  return (
    <Modal open onClose={onClose} ariaLabelledby={titleId} align="center" backdropClassName="bg-ui-dark-blue/50" zIndex={60}>
      <div
        data-modal-panel
        className="relative flex max-h-[90vh] w-[520px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <ModalHeader lang={lang} title={t(lang, "chatFindTitle")} titleId={titleId} onClose={onClose} />
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-6">
          <p className="text-sm text-muted-foreground">{t(lang, "chatFindHint")}</p>
          <form className="flex items-center gap-2" onSubmit={search}>
            <Input
              type="text"
              className="flex-1"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t(lang, "chatFindLabel")}
              placeholder={t(lang, "chatFindLabel")}
              autoComplete="off"
            />
            <Button type="submit" variant="secondary" size="sm" disabled={!canSearch}>
              {t(lang, "chatFindSearch")}
            </Button>
          </form>
          <p role="status" className="text-sm text-muted-foreground">
            {submitted === null
              ? t(lang, "chatFindIdle")
              : searchFailed || matches.length > 0
                ? ""
                : t(lang, "chatFindNoMatch", submitted)}
          </p>
          {matches.length > 0 && (
            <ul className="flex flex-col gap-1">
              {matches.map((th) => (
                <li key={th.id} className="flex items-start gap-2 text-sm">
                  <Checkbox
                    className="mt-0.5"
                    checked={ticked.has(th.id)}
                    onChange={(e) => toggle(th.id, e.target.checked)}
                    aria-label={t(lang, "chatFindSelect", tokens.get(th.id) ?? displayName(lang, th.name))}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-foreground">{displayName(lang, th.name)}</span>
                    <span className="text-xs text-muted-foreground">
                      {t(lang, "chatFindProject", projectNames?.get(th.projectId) ?? th.projectId)}
                      {" · "}
                      {t(lang, "chatFindUpdated", formatFetchedAt(th.updatedAt, lang))}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {searchFailed && <Banner severity="error" role="alert">{t(lang, "chatFindSearchFailed")}</Banner>}
          {failed && <Banner severity="error" role="alert">{t(lang, "chatFindDeleteFailed")}</Banner>}
          <div className="flex justify-end">
            <Button variant="destructive" size="sm" disabled={busy || selected.length === 0} onClick={deleteTicked}>
              {t(lang, "chatFindDeleteSelected")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
