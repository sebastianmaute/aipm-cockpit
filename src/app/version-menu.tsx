"use client";

import { useCallback, useRef, useState } from "react";
import { InformationCircleIcon } from "./icons";
import { IconButton } from "./icon-button";
import { PopoverPanel } from "./popover-panel";
import { type Lang, t } from "./i18n";
import { VersionInfo } from "./version-info";

export function VersionMenu({ lang }: { lang: Lang }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  return (
    <div className="relative">
      <IconButton
        ref={triggerRef}
        size="md"
        onClick={() => setOpen((o) => !o)}
        label={t(lang, "version")}
        aria-expanded={open}
        title={t(lang, "version")}
      >
        <InformationCircleIcon aria-hidden="true" className="h-5 w-5" />
      </IconButton>

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
