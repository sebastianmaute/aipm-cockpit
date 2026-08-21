import { notFound } from "next/navigation";
import * as hero from "@heroicons/react/24/outline";
import * as lucide from "../../icons";
import type { AppIcon } from "../../icons";

// TEMPORARY migration scaffolding — deleted in the same commit that drops
// @heroicons/react. Renders each icon's OLD and NEW glyph side by side so the
// mapping can be reviewed by eye in one pass.
//
// Start at these six, where fidelity and lucide idiom disagree:
//   Bars2Icon · ChartBarSquareIcon · PresentationChartLineIcon
//   IdentificationIcon · UserGroupIcon · ArrowPathRoundedSquareIcon
// and at the two glyph traps a name-for-name codemod would have shipped:
//   BoltIcon (lucide's Bolt is a hardware nut) · ChartBarIcon (horizontal)
export default function IconComparePage() {
  if (process.env.NODE_ENV === "production") notFound();

  const heroIcons = hero as unknown as Record<string, AppIcon>;
  const names = Object.keys(lucide as Record<string, AppIcon>).sort((a, b) => a.localeCompare(b));

  return (
    <main className="p-8">
      <h1 className="mb-6 text-xl font-medium">heroicons (left) vs lucide (right)</h1>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {names.map((name) => {
          const Old = heroIcons[name];
          const New = (lucide as unknown as Record<string, AppIcon>)[name];
          return (
            <li
              key={name}
              data-compare-cell={name}
              className="flex flex-col items-center gap-2 rounded border border-line p-3"
            >
              <div className="flex items-center gap-4">
                {Old ? <Old aria-hidden="true" className="h-6 w-6" /> : <span>—</span>}
                <span className="text-muted-foreground">→</span>
                <New aria-hidden="true" className="h-6 w-6" />
              </div>
              <span className="break-all text-center text-xs text-muted-foreground">{name}</span>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
