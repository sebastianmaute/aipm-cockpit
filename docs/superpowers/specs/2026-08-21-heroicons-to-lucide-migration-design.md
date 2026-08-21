# heroicons → `lucide-react` — the app-wide icon migration

_Opened 2026-08-21 against `main` at `0ff948bb` (0.253.0 "Schroeder"). Closes the work decided in
`docs/open-followups.md` §145 and tracked as `docs/tech-debt-register.md` **TD-8**; carried as a
backlog row in `docs/work-inventory.md` §3._

**No behaviour change, but it ships a MINOR BUMP: 0.253.0 → `0.254.0 "Bisson"`.** The codename was
verified absent from both `CHANGELOG.md` and `src/app/version.ts` before being reserved here
(`grep -c '"Bisson"' CHANGELOG.md src/app/version.ts` → 0 in each; Clement · Hughart · Resnick · Gunn
· Emezi are the spare names checked in the same pass). ★★ A user-visible glyph changes on every
screen in the app, which is exactly what a version label is for — do not reason from "refactor" to
"no bump", and see §10 for the eight places the version actually lives.

---

## 0. Grounding — measured 2026-08-21, not assumed

Every row was reproduced against the tree at `0ff948bb`. Re-run before trusting any of them.

| Fact | Value | Reproduce |
|---|---|---|
| Files importing heroicons | **78** | `grep -rln "@heroicons/react" src/app \| wc -l` |
| Import paths in use | **`@heroicons/react/24/outline` only** — no `solid`, no `/20` | `grep -rhoE 'from "@heroicons/react/[^"]+"' src e2e scripts \| sort \| uniq -c` |
| Distinct **source** icon names | **69** | the import-scoped sweep in §1 below |
| Import specifiers | **150** · icon JSX call sites ~**141** | same sweep |
| lucide exports the same name | **25** of 69 | §5 |
| `lucide-react` installed | `^1.31.0`, one consumer (`rich-text-toolbar.tsx`) | `grep -rln "lucide-react" src/app` |
| heroicons referenced in tests | **zero** `*.test.tsx`, **zero** `e2e/` | `grep -rln "@heroicons" src --include=*.test.tsx; grep -rn "heroicons" e2e` |
| `data-slot="icon"` (heroicons emits it) | referenced **nowhere** in `src`/`e2e`/CSS | `grep -rn 'data-slot' src e2e --include=*.ts --include=*.tsx --include=*.css` |
| Call sites passing `aria-hidden` | **122** · passing `aria-label`/`role` **0** · passing `aria-hidden={false}` **0** | see §4.3 |
| Icon-typed props | **one** annotation repo-wide (`nav-icons.tsx`) | `grep -rln "SVGProps<SVGSVGElement>" src --include=*.tsx --include=*.ts` |
| Aliased imports | **one** — `PrinterIcon as PrinterHeroIcon` (`task-manager-ui.tsx`), dodging a local `PrinterIcon` wrapper in the same file | `grep -rn "PrinterHeroIcon" src` |

★ **TD-8 quotes 70 distinct names and this spec says 69. Both are right.** TD-8's command counts
identifiers inside the import braces, so the one alias contributes *two* (`PrinterIcon` **and**
`PrinterHeroIcon`). Mapping work needs distinct **source** icons, which is 69. Do not "correct"
either number into the other.

---

## 1. The command that yields the 69

Deliberately spelled out rather than described — TD-8 records a cold reviewer building the obvious
form of this sweep, getting a different answer, and correctly reporting the claim as unreproducible.
It is a throwaway probe, not a shipped script — the plan spells it out in full so it can be re-run:

- walk `src` for `.ts`/`.tsx`, skipping `node_modules` and `.next`;
- match `import { … } from "@heroicons/react/…"`;
- for each specifier take the part **before** any ` as `, and add it to a Set.

★★ That last step is the load-bearing one: it keeps the **imported** name and discards the local
alias. Drop it and you get TD-8's 70.

---

## 2. Scope

**In.** A barrel module owning all 69 mappings · the 78 files repointed at it · a stroke-weight pin
preserving today's line weight · `@heroicons/react` removed from `package.json` · an ESLint rule
forbidding its return · a kept icon-gallery route and its Playwright spec · the four doc updates ·
the `0.254.0 "Bisson"` release bump across all eight places (§10).

**Out.** Any glyph chosen for its own sake — the policy is fidelity to today's look (§3) · touching
`rich-text-toolbar.tsx`'s icon *choices* (it is already lucide; only its stroke weight changes,
§4.2) · adding icons for anything not already drawn · a `lucide-react` version bump (`^1.31.0` is
current for this work; 1.33.0 exists and is out of scope).

---

## 3. Decisions taken (2026-08-21)

| Question | Decision |
|---|---|
| Visual outcome | **Preserve today's look.** Nearest-glyph target for every icon; any visible change is a defect, not a refresh |
| Import shape | **Central barrel** `src/app/icons.ts`. The 78 files change their import line only; the 141 JSX call sites are untouched |
| Stroke-weight mechanism | **CSS rule on `.lucide`**, not `LucideProvider` — see §4.2 |
| Does the pin cover the existing rich-text toolbar? | **Yes.** It ships at lucide's default 2 today and gets lighter. Two stroke weights in one app is the inconsistency this slice exists to remove |
| Contact sheet | **Kept permanently** as a gallery route + spec, not deleted after the comparison |
| Version bump | **Yes — minor.** `0.254.0 "Bisson"`. Every icon in the app changes; the release label should say so. §10 owns the checklist |

---

## 4. Architecture

### 4.1 `src/app/icons.ts` — the barrel

A side-effect-free re-export module. One line per icon, `lucide → app name`, with a comment on
every non-obvious choice. It also exports the icon **type**, because the repo has no good one today:

- `nav-icons.tsx` types its map as `ComponentType<SVGProps<SVGSVGElement>>`;
- `rich-text-toolbar.tsx` — the one file already on lucide — reaches for bare `ElementType`.

★★ That second one is evidence, not an accident: a lucide icon is a `ForwardRefExoticComponent`
whose props omit `ref`, so it does not cleanly satisfy `ComponentType<SVGProps<SVGSVGElement>>`, and
`ElementType` is the escape hatch someone took. The barrel exports `AppIcon` (aliasing lucide's own
`LucideIcon`) and both call sites adopt it. **If `nav-icons.tsx` typechecks unchanged, that is a
finding to record, not a step to skip** — it would mean the assignability concern is wrong, and this
spec should be corrected rather than the annotation left straddling two types.

The barrel must stay **side-effect-free** (pure `export { X as Y } from "lucide-react"`) so
tree-shaking is unaffected. No default export, no runtime values, no wrapper components.

### 4.2 The stroke pin

heroicons `24/outline` renders `strokeWidth: 1.5`; lucide defaults **2**
(`node_modules/lucide-react/dist/esm/defaultAttributes.mjs`). One rule in `globals.css` targeting
lucide's always-present `lucide` class pins 1.5. CSS beats the SVG presentation attribute, so it
needs no provider and no per-call-site prop.

★★ **Chosen over `LucideProvider` deliberately.** A provider is React context, so every existing
unit test would render at stroke 2 while the app renders 1.5 — tests would stop reflecting the app.
jsdom sees no CSS either way, so **neither mechanism is unit-testable**; the difference is that CSS
does not manufacture a divergence. The pin is asserted in a real browser instead (§6).

★ Per-icon override stays available via a Tailwind arbitrary value where some future icon needs a
different weight. None does today.

### 4.3 Sizing and a11y — unchanged, and why

lucide sets `width`/`height` **attributes**; every call site sizes with Tailwind `h-*`/`w-*`, and
CSS beats presentation attributes, so rendered sizes do not move.

a11y is a no-op across all 141 call sites, which is a measured claim and not an optimistic one.
heroicons sets `aria-hidden="true"` unconditionally and spreads caller props after, so a caller can
override it. lucide sets it **conditionally** — its `Icon` component adds the attribute only when
the icon has no children and the caller passed no a11y prop of its own.

With **122** sites passing `aria-hidden` explicitly, **0** passing a name or `role`, and **0**
passing `aria-hidden={false}`, both packages produce `aria-hidden="true"` at every site. The
remaining sites relying on the implicit default keep getting it, because they pass no a11y prop and
no children. ★ lucide is the safer of the two here: pass `aria-label` to a heroicon and it stays
hidden anyway; pass one to a lucide icon and it is correctly exposed.

Reproduce the three counts with a sweep over icon JSX opening tags in `src/app`, extracting
`aria-*` and `role=` occurrences — the exact form is in the slice's plan, because the naive version
misses multi-line JSX and reports fewer sites than exist.

### 4.4 The gallery route

`src/app/icon-gallery/page.tsx` renders every barrel export at its real class size, with its app
name. Guarded with `notFound()` when `process.env.NODE_ENV === "production"`, so it exists in dev
and e2e (whose `webServer` is `npm run dev`) and never ships.

★ The repo has exactly three page routes today (`/`, `/recovery`, `/msal-redirect`), so this is a
deliberate fourth, added because a **kept** spec needs something durable to point at. It is not in
`A11Y_VIEWS` and does not belong there — 69 decorative `aria-hidden` glyphs scan clean and would
prove nothing.

---

## 5. The mapping

69 rows, machine-validated: every target resolves to a canonical icon file in
`node_modules/lucide-react/dist/esm/icons/`, every source name is covered exactly once, and no two
sources share a target. Counts are import specifiers, not JSX call sites.

### 5.1 Two name-identical traps — measured from glyph path data

★★★ **An exact name match is NOT a glyph match, and two of the 25 exact matches are wrong icons.**
Both were found by reading the path data, not by reasoning:

| Name | heroicons draws | lucide draws | Evidence | Target |
|---|---|---|---|---|
| `BoltIcon` | a lightning flash | a **hardware bolt/nut** | `bolt.mjs` opens with a `circle` at `cx 12 cy 12 r 4` | **`ZapIcon`** |
| `ChartBarIcon` | **vertical** columns | **horizontal** bars | `chart-bar.mjs` draws `M7 16h8` / `M7 11h12`; `chart-column.mjs` draws `M18 17V9` / `M13 17V5` | **`ChartColumnIcon`** |

They drive the **Activity** and **Workload** nav views. A name-for-name codemod ships both silently.

★ A third: `check-circle.mjs` does not exist while `circle-check.mjs` does, so `CheckCircleIcon` is
a back-compat alias. The barrel targets canonical names throughout.

### 5.2 Shortlist for the contact-sheet review

These six are judgment calls where fidelity and idiom disagree. Look at these first:

| Source | Chosen | Alternative considered | The tension |
|---|---|---|---|
| `Bars2Icon` (a Gantt **drag handle**) | `EqualIcon` | `GripHorizontalIcon` | `EqualIcon` reproduces today's two bars exactly; `GripHorizontalIcon` is lucide's idiomatic grip but draws dots. **Fidelity wins per §3** — flagged because the semantic name is odd for a grip |
| `ChartBarSquareIcon` (Portfolio health) | `SquareChartGanttIcon` | `ChartNoAxesCombinedIcon` | bars-inside-a-square is the shape being matched |
| `PresentationChartLineIcon` (Stakeholder map) | `PresentationIcon` | `MonitorPlayIcon` | lucide's `Presentation` drops the chart line inside the board |
| `IdentificationIcon` (Directory) | `IdCardIcon` | `ContactRoundIcon` | both plausible; `IdCard` matches the card outline |
| `UserGroupIcon` (Stakeholders) | `UsersRoundIcon` | — | **must stay distinct from `UsersIcon`**, which Resources uses. A shared target would merge two nav views' glyphs |
| `ArrowPathRoundedSquareIcon` (Jira/Timelog sync) | `RepeatIcon` | `RefreshCcwDotIcon` | both read as "sync"; `Repeat` keeps the squared loop |

### 5.3 Full table

| heroicons | lucide | uses |
|---|---|---|
| `AcademicCapIcon` | `GraduationCapIcon` | 1 |
| `AdjustmentsHorizontalIcon` | `SlidersHorizontalIcon` | 1 |
| `ArrowDownTrayIcon` | `DownloadIcon` | 5 |
| `ArrowLongRightIcon` | `MoveRightIcon` | 1 |
| `ArrowPathIcon` | `RefreshCwIcon` | 5 |
| `ArrowPathRoundedSquareIcon` | `RepeatIcon` | 2 |
| `ArrowRightIcon` | `ArrowRightIcon` | 1 |
| `ArrowTopRightOnSquareIcon` | `ExternalLinkIcon` | 1 |
| `ArrowTrendingUpIcon` | `TrendingUpIcon` | 1 |
| `ArrowUpTrayIcon` | `UploadIcon` | 2 |
| `ArrowUturnLeftIcon` | `Undo2Icon` | 1 |
| `ArrowUturnRightIcon` | `Redo2Icon` | 2 |
| `ArrowsPointingInIcon` | `MinimizeIcon` | 2 |
| `ArrowsRightLeftIcon` | `ArrowLeftRightIcon` | 1 |
| `BackspaceIcon` | `DeleteIcon` | 1 |
| `Bars2Icon` | `EqualIcon` | 1 |
| `Bars3BottomLeftIcon` | `AlignLeftIcon` | 1 |
| `Bars3Icon` | `MenuIcon` | 1 |
| `BellIcon` | `BellIcon` | 3 |
| `BoltIcon` | `ZapIcon` | 2 |
| `BookOpenIcon` | `BookOpenIcon` | 1 |
| `BookmarkIcon` | `BookmarkIcon` | 1 |
| `BriefcaseIcon` | `BriefcaseIcon` | 2 |
| `BuildingLibraryIcon` | `LandmarkIcon` | 1 |
| `CalendarDaysIcon` | `CalendarDaysIcon` | 3 |
| `CalendarIcon` | `CalendarIcon` | 1 |
| `ChartBarIcon` | `ChartColumnIcon` | 1 |
| `ChartBarSquareIcon` | `SquareChartGanttIcon` | 1 |
| `ChatBubbleLeftRightIcon` | `MessagesSquareIcon` | 3 |
| `CheckCircleIcon` | `CircleCheckIcon` | 1 |
| `CheckIcon` | `CheckIcon` | 2 |
| `ChevronDownIcon` | `ChevronDownIcon` | 7 |
| `ClockIcon` | `ClockIcon` | 1 |
| `Cog6ToothIcon` | `SettingsIcon` | 5 |
| `CurrencyDollarIcon` | `CircleDollarSignIcon` | 1 |
| `DocumentChartBarIcon` | `FileChartColumnIcon` | 1 |
| `DocumentTextIcon` | `FileTextIcon` | 4 |
| `EllipsisHorizontalIcon` | `EllipsisIcon` | 1 |
| `EllipsisVerticalIcon` | `EllipsisVerticalIcon` | 2 |
| `EnvelopeIcon` | `MailIcon` | 2 |
| `ExclamationTriangleIcon` | `TriangleAlertIcon` | 4 |
| `EyeSlashIcon` | `EyeOffIcon` | 3 |
| `FlagIcon` | `FlagIcon` | 2 |
| `IdentificationIcon` | `IdCardIcon` | 1 |
| `InformationCircleIcon` | `InfoIcon` | 2 |
| `LightBulbIcon` | `LightbulbIcon` | 1 |
| `ListBulletIcon` | `ListIcon` | 1 |
| `LockClosedIcon` | `LockIcon` | 1 |
| `MapPinIcon` | `MapPinIcon` | 1 |
| `MicrophoneIcon` | `MicIcon` | 2 |
| `PaperClipIcon` | `PaperclipIcon` | 1 |
| `PencilIcon` | `PencilIcon` | 1 |
| `PlusIcon` | `PlusIcon` | 5 |
| `PresentationChartLineIcon` | `PresentationIcon` | 1 |
| `PrinterIcon` | `PrinterIcon` | 1 |
| `QuestionMarkCircleIcon` | `CircleHelpIcon` | 2 |
| `RectangleStackIcon` | `LayersIcon` | 1 |
| `ShieldCheckIcon` | `ShieldCheckIcon` | 1 |
| `SparklesIcon` | `SparklesIcon` | 8 |
| `Squares2X2Icon` | `LayoutGridIcon` | 2 |
| `StopIcon` | `SquareIcon` | 1 |
| `SunIcon` | `SunIcon` | 1 |
| `TableCellsIcon` | `TableIcon` | 1 |
| `TrashIcon` | `TrashIcon` | 1 |
| `UserGroupIcon` | `UsersRoundIcon` | 1 |
| `UserMinusIcon` | `UserMinusIcon` | 1 |
| `UsersIcon` | `UsersIcon` | 1 |
| `ViewColumnsIcon` | `Columns3Icon` | 1 |
| `XMarkIcon` | `XIcon` | 25 |

### 5.4 The validation script, and the bug it already had

The table is emitted and checked by a script asserting four properties: every target has a canonical
`.mjs`, every source name is mapped, no mapping is orphaned, no target is used twice.

★★ **Its first run reported three targets missing — and the script was wrong, not the mapping.** Its
kebab-case helper had no digit boundary, so `Undo2Icon` was looked up as `undo2.mjs` when the file is
`undo-2.mjs` (likewise `redo-2`, `columns-3`). A reviewer who trusted that output would have replaced
three correct mappings. The fixed helper inserts a hyphen before a digit; re-verified, **all 69
resolve**. Recorded because the failure mode — a validator's own defect read as a finding about the
thing validated — is one this repo keeps paying for.

---

## 6. Verification

1. **Gallery + contact sheet (kept).** `e2e/icon-gallery.spec.ts` screenshots the route as a visual
   baseline and asserts the computed stroke width is `1.5` — the **only** place the §4.2 pin can be
   proved, since jsdom has no CSS. Captured once on `main` before the swap and once after; the pair
   is the glyph-fidelity review, and §5.2 is what to look at first.
   ★ A gallery is the most stable screenshot in the repo — no seeded data, no dates, no layout —
   which is why it is a reasonable permanent baseline where app-screen baselines have rotted.
2. **Barrel export test** pinning the exact export list, so a dropped icon is a red test rather than
   a blank space noticed weeks later.
3. **`no-restricted-imports`** on `@heroicons/react`. CI runs `--max-warnings=0`, so a reintroduction
   is fatal. ★ Locally `npm run lint` is bare `eslint` and exits 0 on warnings — check the real gate
   with `npx eslint --max-warnings=0 src/app`.
4. **Removing the dependency is itself the completeness gate** — any missed import then fails both
   `tsc` and `next build`.
5. Standard gates: `npx tsc --noEmit`, `npm run test:run`, `size:check`, `dup:check`, and an axe run
   over the scanned views.

★★ What none of this catches: a mapping that is plausible, renders fine, and means the wrong thing.
Only the §5.2 shortlist review does. Do not read a green pipeline as glyph correctness.

---

## 7. Risks

| Risk | Handling |
|---|---|
| A wrong-but-plausible glyph ships | §5.1 found two by reading path data; §5.2 shortlists the six judgment calls; the contact sheet is the human check |
| `AppIcon` does not typecheck at `nav-icons.tsx` | Expected per §4.1. If it typechecks unmodified, correct this spec — do not silently skip the step |
| The stroke rule is too broad | It is deliberately app-wide, including the rich-text toolbar (§3). Any icon needing another weight overrides per-call-site |
| Barrel defeats tree-shaking | Kept to pure re-exports, no runtime values. Bundle size measured before and after as a report, not a gate |
| The gallery route reaches production | `notFound()` under `NODE_ENV === "production"`; `prod-smoke` never sees it |
| Doc updates go stale | The four in §8 land in the same MR as the code |

---

## 8. Doc updates owed

- `docs/tech-debt-register.md` — **TD-8** moves to Resolved.
- `docs/CODEMAPS/dependencies.md` — both icon rows rewritten; `@heroicons/react` gone.
- `docs/work-inventory.md` §3 — drop the backlog row; §5 and §7 reference it too.
- `docs/open-followups.md` §145 — append the closure pointer (the entry is already CLOSED as a
  decision; this records that the decided work shipped).

★ Those four are inside `docs:claims:check`'s scope. This spec is not — the gate skips
`docs/superpowers/`.

★★ `AGENTS.md` gets **one** line, not a section: new icons come from `src/app/icons.ts`. Its own
header records that the file regrew 111% in fifteen days by accepting plausible additions; a mapping
table belongs here.

---

## 9. Sequence

1. Barrel + `AppIcon` + stroke pin + gallery route + spec; capture the **before** sheet on `main`
   first.
2. Convert the 78 files in reviewable batches.
3. Drop `@heroicons/react`; add the lint rule.
4. Capture the **after** sheet; review §5.2 against it.
5. Doc updates.
6. The release bump, §10 — **last**, so `APP_BUILD_DATE` is the date the work actually finished.

No golden regeneration and no migration: nothing persisted changes, so `sample-workspace-small.json`
and every `__fixtures__/golden-*` artifact stay byte-identical. A diff touching them means something
unintended reached a serializer.

---

## 10. The release bump — `0.254.0 "Bisson"`

★★★ **The version lives in EIGHT places and a gate checks exactly ONE group of them.** Five carry no
gate at all, and `AGENTS.md` records them drifting for six and eleven releases respectively before
anyone noticed. Bump them in the SAME commit or the drift restarts:

| # | Place | Gated? |
|---|---|---|
| 1 | `src/app/version.ts` — `APP_VERSION`, `APP_BUILD_DATE`, `APP_MILESTONE` | typecheck only |
| 2 | `CHANGELOG.md` — a `## [0.254.0] - <date> "Bisson"` entry | no |
| 3 | A new `versionHighlight*` key appended to `APP_HIGHLIGHT_KEYS`, with **EN and DE** strings | tsc enforces EN/DE key parity |
| 4 | `package.json` `version` | **no** |
| 5 | `package-lock.json` — **two** occurrences (root `version` and `packages[""]`) | **no** |
| 6 | `README.md` shields badge (line 5) — version **and** codename, the quotes **URL-encoded**: `version-v0.253.0_%22Schroeder%22-2e7d32`. Editing it as if it were plain text breaks the badge silently | **no** |
| 7 | `docs/CODEMAPS/*.md` — the `<!-- Generated: … | App <version> "<codename>" … -->` header on **all five** | **no** |

★★ The milestone belongs in `APP_BUILD_DATE`'s trailing comment too — `version.ts` carries a warning
about a release that shipped `APP_VERSION "0.248.0"` beside the previous series' `APP_MILESTONE`, so
`APP_VERSION_LABEL` rendered a version paired with the wrong name in Settings and the top bar.

★★★ **The DE highlight string is the landmine.** `i18n.de.ts` is CRLF and the Edit tool corrupts
umlauts in it (and curls double quotes, which bites umlaut-free strings too). Patch it with a Node
utf8 write matching `\r\n`, never a `\n` anchor — a `\n` anchor silently no-ops — and re-verify the
bytes. The `i18n-encoding` test BANS ASCII substitutes (`fuer`, `druecken`), so a "safe" workaround
is itself a red gate.

★ Interpolated i18n strings use 0-based positional placeholders (`{0}`, `{1}`), and `Lang` is
`"en-US" | "en-GB" | "de"` — there is no `"en"`.
