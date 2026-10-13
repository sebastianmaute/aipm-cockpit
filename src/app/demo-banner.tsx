"use client";

// The dashboard's one-time suggestion to open the demo project (§712). Shown on any project
// until dismissed or until the demo has been opened once on this device; `loadDemo` itself marks
// it done (demo-project.ts), so the banner never appears on the demo either.
import { useState } from "react";
import { Banner } from "./banner";
import { Button } from "./button";
import { IconButton } from "./icon-button";
import { XMarkIcon } from "./icons";
import { type Lang, t } from "./i18n";
import { markDemoBannerDone, readDemoBannerDone } from "./demo-banner-state";

export function DemoBanner({ lang, onExplore }: { lang: Lang; onExplore: () => void }) {
  const [hidden, setHidden] = useState(false);
  // Read at render, not seeded once: the demo can be opened from Help while this is mounted.
  if (hidden || readDemoBannerDone()) return null;
  const done = (): void => {
    markDemoBannerDone();
    setHidden(true);
  };
  return (
    <Banner severity="info" className="mb-3 flex items-center gap-3">
      <p className="min-w-0 flex-1">{t(lang, "demoBannerText")}</p>
      <Button
        variant="secondary"
        size="xs"
        onClick={() => {
          done();
          onExplore();
        }}
      >
        {t(lang, "demoBannerExplore")}
      </Button>
      <IconButton onClick={done} label={t(lang, "demoBannerDismiss")} title={t(lang, "demoBannerDismiss")}>
        <XMarkIcon aria-hidden="true" className="h-4 w-4" />
      </IconButton>
    </Banner>
  );
}
