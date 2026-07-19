"use client";

import { useCallback, useRef, useState } from "react";
import { InformationCircleIcon } from "@heroicons/react/24/outline";
import { PopoverPanel } from "./popover-panel";
import { type Lang, t } from "./i18n";
import { VersionInfo } from "./version-info";

export function VersionMenu({ lang }: { lang: Lang }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t(lang, "version")}
        aria-expanded={open}
        title={t(lang, "version")}
        className="rounded-md p-2 text-foreground hover:bg-surface-muted hover:text-ui-dark-blue focus:outline-none focus:ring-2 focus:ring-ui-green dark:text-muted-foreground dark:hover:text-ui-light-grey"
      >
        <InformationCircleIcon aria-hidden="true" className="h-5 w-5" />
      </button>

      <PopoverPanel
        open={open}
        anchorRef={triggerRef}
        onClose={close}
        role="dialog"
        ariaLabel={t(lang, "version")}
        className="max-h-[80vh] w-80 overflow-y-auto p-4"
      >
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t(lang, "version")}
        </h3>
        <VersionInfo lang={lang} />
      </PopoverPanel>
    </div>
  );
}
