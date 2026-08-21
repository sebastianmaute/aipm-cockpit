import { notFound } from "next/navigation";
import * as icons from "../icons";
import type { AppIcon } from "../icons";

// Dev-only gallery of every icon in `icons.ts`, rendered at the size the app
// uses most. It exists so glyph choices are reviewable by eye and so the
// stroke-weight pin in globals.css has something a browser test can measure —
// jsdom has no CSS, so no unit test can ever see it.
//
// ★ Guarded out of production. The repo ships three page routes; this is a
// deliberate fourth that must never reach a build users see.
//
// ★ Deliberately NOT in A11Y_VIEWS: 69 decorative aria-hidden glyphs scan clean
// and would prove nothing.
export default function IconGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const entries = Object.entries(icons as Record<string, AppIcon>).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <main className="p-8">
      <h1 className="mb-6 text-xl font-medium">Icon gallery</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        {entries.length} icons from <code>src/app/icons.ts</code>. Names are the app&apos;s;
        the glyph is lucide&apos;s.
      </p>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
        {entries.map(([name, Icon]) => (
          <li
            key={name}
            data-icon-cell={name}
            className="flex flex-col items-center gap-2 rounded border border-line p-3"
          >
            <Icon aria-hidden="true" className="h-6 w-6" />
            <span className="break-all text-center text-xs text-muted-foreground">{name}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
