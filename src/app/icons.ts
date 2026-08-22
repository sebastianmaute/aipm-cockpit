// The app's icon vocabulary — the ONLY file that may import `lucide-react`
// directly (`rich-text-toolbar.tsx` is the one grandfathered exception; its
// icon set came from Tiptap's reference toolbar).
//
// ★★ Names on the LEFT are lucide's, names on the RIGHT are the app's. The app
// keeps the heroicons vocabulary on purpose: the migration is then 78 one-line
// import changes with zero JSX churn, and a later rename is one edit HERE plus
// a codemod. Do not "modernise" the right-hand names piecemeal.
//
// ★★★ A NAME MATCH IS NOT A GLYPH MATCH, AND NEITHER IS A PLAUSIBLE NAME. SIX
// rows below draw something other than what the heroicons name implies. An
// earlier revision of this block listed only the first two and called that the
// complete set; a cold review reading lucide's path data found four more, one of
// them on a nav view. Three of the six are same-name-different-glyph pairs, which
// a name-for-name codemod would have shipped silently:
//   BoltIcon      heroicons: a lightning flash · lucide `Bolt`: a hardware nut
//                 (a hexagon path, then a circle at cx 12 cy 12 r 4) -> Zap
//   ChartBarIcon  heroicons: vertical columns · lucide `ChartBar`: HORIZONTAL
//                 bars (`M7 16h8`) -> ChartColumn (`M18 17V9`)
//   TrashIcon     heroicons draws two inner strokes (`m14.74 9-.346 9`); lucide
//                 `Trash` draws none -> Trash2 (`M10 11v6` + `M14 11v6`)
// The other three differ by name as well as glyph, so only reading the path data
// finds them:
//   ChartBarSquareIcon  `SquareChartGantt` is three HORIZONTAL bars — a Gantt.
//                 heroicons draws four ascending VERTICAL columns in a rounded
//                 square -> SquareKanban, which is the CLOSEST available and still
//                 not exact: three bars, not four, and their heights (7/4/9) do not
//                 ascend. Vertical-in-a-square beats a Gantt; do not read it as a
//                 match. This drives the portfolio-health nav
//                 view, and it is the same trap as `ChartBarIcon`, which sits
//                 one row ABOVE it in the export block — caught there, missed here.
//   ArrowsPointingInIcon  `Minimize` is corner brackets only; heroicons also
//                 draws the diagonals into the corners -> Shrink, whose
//                 construction is identical to heroicons'.
//   RectangleStackIcon  `Layers` is three isometric diamonds; heroicons draws a
//                 FLAT stack of rounded rectangles -> SquareStack.
// ★★ Accepted losses, recorded so a gallery eye-check is not read as "identical":
// `PresentationChartLine` loses the rising line inside the screen (lucide 1.31 has
// no better target), `Bars3BottomLeft`'s stair pattern differs (long/long/half vs
// long/short/medium), and `StopIcon` -> `Square` renders ~33% larger (18 units
// full-bleed vs heroicons' 13.5 inset).
// Check a glyph at `/icon-gallery` in dev. Never conclude from the name.
//
// ★ Targets are lucide's CANONICAL names, never its back-compat aliases.
// lucide-react 1.31 renamed `AlignLeft` to `TextAlignStart` and `CircleHelp` to
// `CircleQuestionMark`, keeping the old names as verbatim re-export shims
// (`align-left.mjs` / `circle-help.mjs`). A `.mjs` file EXISTING does not prove
// its name is canonical — a shim is a file too.
// ★★★ BUT THIS IS AN UNENFORCED CONVENTION, AND THIS COMMENT USED TO CLAIM THE
// TEST PINNED IT. It does not, and no runtime test can. Importing from the
// package ROOT resolves every alias straight at the canonical module, so
// `AlignLeftIcon === TextAlignStartIcon` is literally `true` — same object, same
// `displayName`. Swapping either row for its alias leaves the suite fully green;
// both were measured as SURVIVING mutants. Only a source-text scan could catch
// it, and none exists. Verify with:
//   node -e "const l=require('lucide-react');console.log(l.AlignLeftIcon===l.TextAlignStartIcon)"
// ★ What `icons.test.ts` DOES pin is the `displayName` of whatever object the row
// resolves to — which catches a row pointed at a genuinely DIFFERENT icon, and is
// why `CheckCircleIcon` -> `CircleCheck` is safe. Note `check-circle.mjs` does
// exist (an earlier revision here said it did not) and aliases `circle-check-big`,
// a different glyph — so the name confusion this paragraph warns about is real.
//
// ★ Stroke weight is NOT set here. heroicons draws at 1.5 and lucide defaults to
// 2; `globals.css` pins 1.5 on the `.lucide` class that lucide always emits. A
// `LucideProvider` was rejected — it would leave every unit test rendering a
// different weight than the app.
//
// ★★★ Adding a 70th icon touches SIX places, not one — and this list said FOUR
// until a cold review found the two e2e counts and the committed screenshot:
//   1. A row in the export block below, alphabetical by the APP-facing name
//      (the right-hand side, e.g. `AcademicCapIcon`).
//   2. The matching row in `EXPECTED` in `icons.test.ts` — its value is the
//      lucide component's own `displayName`, NOT the name you imported (see
//      the canonical-vs-shim note above).
//   3. The hardcoded count in `icons.test.ts`'s "exports N icons" ratchet. This
//      is the AUTHORITATIVE one; 4 and 5 are downstream observations of it.
//   4. `e2e/icon-gallery.spec.ts`'s `toHaveCount(69)` — the chromium project, so
//      CI runs it and a stale number reds the pipeline.
//   5. `e2e/icon-gallery.visual.spec.ts`'s `toHaveCount(69)`, plus its committed
//      `icon-gallery-visual-win32.png` baseline, which the grid reflow invalidates
//      (`npm run e2e:visual:update`). Opt-in `visual` project — NOT run in CI, so
//      nothing will tell you it rotted.
//   6. An eye-check at `/icon-gallery` in dev — no test can tell you the glyph
//      MEANS the right thing, only that it resolves to what you typed. ★★ Nor
//      that it STAYED the same: nothing here reads path data, so a lucide upgrade
//      that redraws a glyph under a stable `displayName` is invisible to every
//      gate in this repo.
export type { LucideIcon as AppIcon } from "lucide-react";

export {
  GraduationCapIcon as AcademicCapIcon,
  SlidersHorizontalIcon as AdjustmentsHorizontalIcon,
  DownloadIcon as ArrowDownTrayIcon,
  MoveRightIcon as ArrowLongRightIcon,
  RefreshCwIcon as ArrowPathIcon,
  RepeatIcon as ArrowPathRoundedSquareIcon,
  ArrowRightIcon,
  ExternalLinkIcon as ArrowTopRightOnSquareIcon,
  TrendingUpIcon as ArrowTrendingUpIcon,
  UploadIcon as ArrowUpTrayIcon,
  Undo2Icon as ArrowUturnLeftIcon,
  Redo2Icon as ArrowUturnRightIcon,
  ShrinkIcon as ArrowsPointingInIcon,
  ArrowLeftRightIcon as ArrowsRightLeftIcon,
  DeleteIcon as BackspaceIcon,
  // A Gantt drag handle. `Equal` is the closest two-bar glyph — NOT exact, as an
  // earlier comment here claimed: heroicons spans x 3.75-20.25 with its lower bar
  // at y 15.75, `Equal` spans 5-19 at y 15, and draws `<line>` where heroicons
  // draws a `<path>`. `GripHorizontal` is lucide's idiomatic grip but draws dots,
  // so it is further away — fidelity wins.
  EqualIcon as Bars2Icon,
  TextAlignStartIcon as Bars3BottomLeftIcon,
  MenuIcon as Bars3Icon,
  BellIcon,
  ZapIcon as BoltIcon,
  BookOpenIcon,
  BookmarkIcon,
  BriefcaseIcon,
  LandmarkIcon as BuildingLibraryIcon,
  CalendarDaysIcon,
  CalendarIcon,
  ChartColumnIcon as ChartBarIcon,
  SquareKanbanIcon as ChartBarSquareIcon,
  MessagesSquareIcon as ChatBubbleLeftRightIcon,
  CircleCheckIcon as CheckCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  SettingsIcon as Cog6ToothIcon,
  CircleDollarSignIcon as CurrencyDollarIcon,
  FileChartColumnIcon as DocumentChartBarIcon,
  FileTextIcon as DocumentTextIcon,
  EllipsisIcon as EllipsisHorizontalIcon,
  EllipsisVerticalIcon,
  MailIcon as EnvelopeIcon,
  TriangleAlertIcon as ExclamationTriangleIcon,
  EyeOffIcon as EyeSlashIcon,
  FlagIcon,
  IdCardIcon as IdentificationIcon,
  InfoIcon as InformationCircleIcon,
  LightbulbIcon as LightBulbIcon,
  ListIcon as ListBulletIcon,
  LockIcon as LockClosedIcon,
  MapPinIcon,
  MicIcon as MicrophoneIcon,
  PaperclipIcon as PaperClipIcon,
  PencilIcon,
  PlusIcon,
  PresentationIcon as PresentationChartLineIcon,
  PrinterIcon,
  CircleQuestionMarkIcon as QuestionMarkCircleIcon,
  SquareStackIcon as RectangleStackIcon,
  ShieldCheckIcon,
  SparklesIcon,
  LayoutGridIcon as Squares2X2Icon,
  SquareIcon as StopIcon,
  SunIcon,
  TableIcon as TableCellsIcon,
  Trash2Icon as TrashIcon,
  // Stakeholders. MUST differ from `UsersIcon` (Resources) — pinned by a test.
  UsersRoundIcon as UserGroupIcon,
  UserMinusIcon,
  UsersIcon,
  Columns3Icon as ViewColumnsIcon,
  XIcon as XMarkIcon,
} from "lucide-react";
