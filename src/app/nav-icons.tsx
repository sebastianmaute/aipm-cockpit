import type { ComponentType, SVGProps } from "react";
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
} from "@heroicons/react/24/outline";

import type { AppView } from "./nav-config";

interface NavIconProps {
  view: AppView;
  className?: string;
}

// Single 24x24 line-icon glyph per nav view (heroicons outline). Icons are
// decorative: the button carries the accessible name (visible label when
// expanded, aria-label when collapsed), so every glyph is aria-hidden.
const NAV_ICON: Record<AppView, ComponentType<SVGProps<SVGSVGElement>>> = {
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

export function NavIcon({ view, className = "h-5 w-5 shrink-0" }: NavIconProps) {
  const Icon = NAV_ICON[view];
  return <Icon aria-hidden="true" focusable="false" className={className} />;
}
