// The app's icon vocabulary — the ONLY file that may import `lucide-react`
// directly (`rich-text-toolbar.tsx` is the one grandfathered exception; its
// icon set came from Tiptap's reference toolbar).
//
// ★★ Names on the LEFT are lucide's, names on the RIGHT are the app's. The app
// keeps the heroicons vocabulary on purpose: the migration is then 78 one-line
// import changes with zero JSX churn, and a later rename is one edit HERE plus
// a codemod. Do not "modernise" the right-hand names piecemeal.
//
// ★★★ A NAME MATCH IS NOT A GLYPH MATCH. Two icons carry the same name in both
// packages and DRAW DIFFERENT THINGS. Both are remapped below, and both drive a
// nav view, so a name-for-name codemod would have shipped the wrong glyph twice:
//   BoltIcon      heroicons: a lightning flash · lucide `Bolt`: a hardware nut
//                 (`bolt.mjs` opens with a circle at cx 12 cy 12 r 4) -> Zap
//   ChartBarIcon  heroicons: vertical columns · lucide `ChartBar`: HORIZONTAL
//                 bars (`M7 16h8`) -> ChartColumn (`M18 17V9`)
// Check a glyph at `/icon-gallery` in dev. Never conclude from the name.
//
// ★ Targets are lucide's CANONICAL names, never its back-compat aliases: there
// is no `check-circle.mjs`, only `circle-check.mjs`. `icons.test.ts` pins each
// row against the component's own `displayName`, so an alias fails the suite.
// ★ A `.mjs` file EXISTING does not prove its name is canonical — a shim is a
// file too. lucide-react 1.31 renamed `AlignLeft` to `TextAlignStart` and
// `CircleHelp` to `CircleQuestionMark`, keeping the old names as verbatim
// re-export shims (`align-left.mjs` / `circle-help.mjs`, identical SVG paths).
// Import the CANONICAL name, not the shim — `displayName` is the arbiter, and
// `icons.test.ts` pins it for every row.
//
// ★ Stroke weight is NOT set here. heroicons draws at 1.5 and lucide defaults to
// 2; `globals.css` pins 1.5 on the `.lucide` class that lucide always emits. A
// `LucideProvider` was rejected — it would leave every unit test rendering a
// different weight than the app.
//
// ★ Adding a 70th icon touches FOUR places, not one:
//   1. A row in the export block below, alphabetical by the APP-facing name
//      (the right-hand side, e.g. `AcademicCapIcon`).
//   2. The matching row in `EXPECTED` in `icons.test.ts` — its value is the
//      lucide component's own `displayName`, NOT the name you imported (see
//      the canonical-vs-shim note above).
//   3. The hardcoded count in `icons.test.ts`'s "exports N icons" ratchet.
//   4. An eye-check at `/icon-gallery` in dev — no test can tell you the
//      glyph MEANS the right thing, only that it resolves to what you typed.
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
  MinimizeIcon as ArrowsPointingInIcon,
  ArrowLeftRightIcon as ArrowsRightLeftIcon,
  DeleteIcon as BackspaceIcon,
  // A Gantt drag handle. `Equal` reproduces today's two bars exactly;
  // `GripHorizontal` is lucide's idiomatic grip but draws dots — fidelity wins.
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
  SquareChartGanttIcon as ChartBarSquareIcon,
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
  LayersIcon as RectangleStackIcon,
  ShieldCheckIcon,
  SparklesIcon,
  LayoutGridIcon as Squares2X2Icon,
  SquareIcon as StopIcon,
  SunIcon,
  TableIcon as TableCellsIcon,
  TrashIcon,
  // Stakeholders. MUST differ from `UsersIcon` (Resources) — pinned by a test.
  UsersRoundIcon as UserGroupIcon,
  UserMinusIcon,
  UsersIcon,
  Columns3Icon as ViewColumnsIcon,
  XIcon as XMarkIcon,
} from "lucide-react";
