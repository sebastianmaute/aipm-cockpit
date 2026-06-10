"use client";

import { useState } from "react";
import { type Lang, t } from "./i18n";
import { isSafeHttpUrl, type DocumentLink } from "./document-link";
import { SharePointPickerModal } from "./sharepoint-picker-modal";
import type { AcquireToken } from "./use-sharepoint-browser";

export interface DocumentLinksFieldProps {
  value: DocumentLink[];
  onChange: (next: DocumentLink[]) => void;
  lang: Lang;
  acquireToken: AcquireToken;
  onLog?: (action: "added" | "removed", name: string) => void;
}

export function DocumentLinksField({ value, onChange, lang, acquireToken, onLog }: DocumentLinksFieldProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  function add(link: DocumentLink) {
    if (value.some((l) => l.url === link.url)) return;
    onChange([...value, link]);
    onLog?.("added", link.name);
  }

  function remove(url: string) {
    const removed = value.find((l) => l.url === url);
    onChange(value.filter((l) => l.url !== url));
    if (removed) onLog?.("removed", removed.name);
  }

  return (
    <div className="flex flex-col gap-2">
      {value.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t(lang, "documentsEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {value.map((link) => (
            <li key={link.url} className="flex items-center gap-2 rounded border border-line bg-surface px-2 py-1 text-sm">
              <span aria-hidden className="text-muted-foreground">{link.kind === "folder" ? "📁" : "📄"}</span>
              {isSafeHttpUrl(link.url) ? (
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t(lang, "documentsOpen")}
                  className="flex-1 truncate text-AIPM-dark-blue underline hover:opacity-80 dark:text-AIPM-light-grey"
                >
                  {link.name}
                </a>
              ) : (
                <span className="flex-1 truncate text-foreground">{link.name}</span>
              )}
              <button
                type="button"
                onClick={() => remove(link.url)}
                aria-label={t(lang, "documentsRemove")}
                className="rounded px-1 text-AIPM-pink hover:bg-surface-muted"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted"
        >
          {t(lang, "documentsAdd")}
        </button>
      </div>
      {pickerOpen && (
        <SharePointPickerModal
          mode="link"
          lang={lang}
          acquireToken={acquireToken}
          onSelect={(link) => { add(link); setPickerOpen(false); }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
