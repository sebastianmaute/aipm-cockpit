import type { AppIcon } from "./icons";
import {
  AcademicCapIcon,
  ArrowsRightLeftIcon,
  ArrowTrendingUpIcon,
  Bars3BottomLeftIcon,
  BellIcon,
  BoltIcon,
  BookOpenIcon,
  BriefcaseIcon,
  BuildingLibraryIcon,
  CalendarIcon,
  ChartBarIcon,
  ChartBarSquareIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
  Cog6ToothIcon,
  CurrencyDollarIcon,
  DocumentChartBarIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  FlagIcon,
  IdentificationIcon,
  LightBulbIcon,
  ListBulletIcon,
  PresentationChartLineIcon,
  QuestionMarkCircleIcon,
  ShieldCheckIcon,
  Squares2X2Icon,
  TableCellsIcon,
  UserGroupIcon,
  UsersIcon,
} from "./icons";

import type { AppView } from "./nav-config";

interface NavIconProps {
  view: AppView;
  className?: string;
}

// Single 24x24 line-icon glyph per nav view (sourced from the `icons.ts` barrel). Icons are
// decorative: the button carries the accessible name (visible label when
// expanded, aria-label when collapsed), so every glyph is aria-hidden.
const NAV_ICON: Record<AppView, AppIcon> = {
  projects: BriefcaseIcon,
  "portfolio-health": ChartBarSquareIcon,
  "open-points": ListBulletIcon,
  dashboard: Squares2X2Icon,
  actions: BellIcon,
  insights: LightBulbIcon,
  trends: ArrowTrendingUpIcon,
  history: ClockIcon,
  chat: ChatBubbleLeftRightIcon,
  gantt: Bars3BottomLeftIcon,
  milestones: FlagIcon,
  resources: UsersIcon,
  directory: IdentificationIcon,
  workload: ChartBarIcon,
  calendar: CalendarIcon,
  planning: Bars3BottomLeftIcon,
  "manage-roles": ShieldCheckIcon,
  budget: CurrencyDollarIcon,
  "budget-report": DocumentChartBarIcon,
  raid: ExclamationTriangleIcon,
  "raid-report": DocumentChartBarIcon,
  changes: ArrowsRightLeftIcon,
  "change-report": DocumentChartBarIcon,
  stakeholders: UserGroupIcon,
  raci: TableCellsIcon,
  "stakeholder-map": PresentationChartLineIcon,
  knowledge: BookOpenIcon,
  documents: DocumentTextIcon,
  reports: DocumentChartBarIcon,
  activity: BoltIcon,
  settings: Cog6ToothIcon,
  help: QuestionMarkCircleIcon,
  "learning-insights": AcademicCapIcon,
  "steering-committee": BuildingLibraryIcon,
  timelog: ClockIcon,
};

// The default sizing applied when a caller passes no className. EXPORTED so
// `nav-icons.test.tsx` can derive its "the custom class replaced the default"
// assertion from this string instead of restating the tokens — two successive
// revisions of that test hardcoded a subset and each missed a real leak.
export const NAV_ICON_CLASS = "h-5 w-5 shrink-0";

export function NavIcon({ view, className = NAV_ICON_CLASS }: NavIconProps) {
  const Icon = NAV_ICON[view];
  return <Icon aria-hidden="true" focusable="false" className={className} />;
}
