import { describe, it, expect } from "vitest";
import type { ComponentType } from "react";
import * as icons from "./icons";

/** app name -> the canonical lucide name it MUST resolve to.
 *
 *  ★★★ This is the mapping's only automated guard. A name-only test would pass
 *  while a row was repointed at the wrong glyph — which is the exact defect
 *  class this migration found twice by hand (BoltIcon, ChartBarIcon below). */
const EXPECTED: Record<string, string> = {
  AcademicCapIcon: "GraduationCap",
  AdjustmentsHorizontalIcon: "SlidersHorizontal",
  ArrowDownTrayIcon: "Download",
  ArrowLongRightIcon: "MoveRight",
  ArrowPathIcon: "RefreshCw",
  ArrowPathRoundedSquareIcon: "Repeat",
  ArrowRightIcon: "ArrowRight",
  ArrowTopRightOnSquareIcon: "ExternalLink",
  ArrowTrendingUpIcon: "TrendingUp",
  ArrowUpTrayIcon: "Upload",
  ArrowUturnLeftIcon: "Undo2",
  ArrowUturnRightIcon: "Redo2",
  ArrowsPointingInIcon: "Minimize",
  ArrowsRightLeftIcon: "ArrowLeftRight",
  BackspaceIcon: "Delete",
  Bars2Icon: "Equal",
  // lucide-react 1.31.0 renamed this icon; AlignLeft/AlignLeftIcon now
  // re-export TextAlignStart verbatim (identical SVG paths — a rename, not a
  // different glyph). Pin the canonical name, per the barrel's own rule.
  Bars3BottomLeftIcon: "TextAlignStart",
  Bars3Icon: "Menu",
  BellIcon: "Bell",
  BoltIcon: "Zap",
  BookOpenIcon: "BookOpen",
  BookmarkIcon: "Bookmark",
  BriefcaseIcon: "Briefcase",
  BuildingLibraryIcon: "Landmark",
  CalendarDaysIcon: "CalendarDays",
  CalendarIcon: "Calendar",
  ChartBarIcon: "ChartColumn",
  ChartBarSquareIcon: "SquareChartGantt",
  ChatBubbleLeftRightIcon: "MessagesSquare",
  CheckCircleIcon: "CircleCheck",
  CheckIcon: "Check",
  ChevronDownIcon: "ChevronDown",
  ClockIcon: "Clock",
  Cog6ToothIcon: "Settings",
  CurrencyDollarIcon: "CircleDollarSign",
  DocumentChartBarIcon: "FileChartColumn",
  DocumentTextIcon: "FileText",
  EllipsisHorizontalIcon: "Ellipsis",
  EllipsisVerticalIcon: "EllipsisVertical",
  EnvelopeIcon: "Mail",
  ExclamationTriangleIcon: "TriangleAlert",
  EyeSlashIcon: "EyeOff",
  FlagIcon: "Flag",
  IdentificationIcon: "IdCard",
  InformationCircleIcon: "Info",
  LightBulbIcon: "Lightbulb",
  ListBulletIcon: "List",
  LockClosedIcon: "Lock",
  MapPinIcon: "MapPin",
  MicrophoneIcon: "Mic",
  PaperClipIcon: "Paperclip",
  PencilIcon: "Pencil",
  PlusIcon: "Plus",
  PresentationChartLineIcon: "Presentation",
  PrinterIcon: "Printer",
  // Same rename class as Bars3BottomLeftIcon above: CircleHelp/CircleHelpIcon
  // now re-export CircleQuestionMark verbatim.
  QuestionMarkCircleIcon: "CircleQuestionMark",
  RectangleStackIcon: "Layers",
  ShieldCheckIcon: "ShieldCheck",
  SparklesIcon: "Sparkles",
  Squares2X2Icon: "LayoutGrid",
  StopIcon: "Square",
  SunIcon: "Sun",
  TableCellsIcon: "Table",
  TrashIcon: "Trash",
  UserGroupIcon: "UsersRound",
  UserMinusIcon: "UserMinus",
  UsersIcon: "Users",
  ViewColumnsIcon: "Columns3",
  XMarkIcon: "X",
};

describe("icons barrel", () => {
  it("exports exactly the expected icon set", () => {
    expect(Object.keys(icons).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  // ★ Deliberately redundant with the key-set test above, which already catches
  //   any drift with a better diff. This one exists as a RATCHET: adding a row
  //   to both the barrel and EXPECTED passes that test and fails only this one,
  //   so growing the icon set is always a conscious edit rather than a
  //   side-effect. Bump the literal only when you mean to.
  it("exports 69 icons", () => {
    expect(Object.keys(icons)).toHaveLength(69);
  });

  it.each(Object.entries(EXPECTED))(
    "%s resolves to the lucide %s glyph",
    (appName, lucideName) => {
      const icon = (icons as Record<string, ComponentType & { displayName?: string }>)[appName];
      expect(icon, `${appName} is not exported`).toBeDefined();
      expect(icon.displayName).toBe(lucideName);
    },
  );

  it("★★★ maps no two app names onto the same glyph", () => {
    const targets = Object.values(EXPECTED);
    expect(new Set(targets).size).toBe(targets.length);
  });

  it("★★ keeps UsersIcon and UserGroupIcon visually distinct", () => {
    // Resources uses one and Stakeholders the other; a shared target would
    // silently merge two nav views' glyphs.
    expect(icons.UsersIcon.displayName).not.toBe(icons.UserGroupIcon.displayName);
  });
});
