import { ChartPie, CirclePlay, CodeXml, LayoutGrid, Lightbulb, Menu, PanelLeft, Plug, Repeat, Scale, Scooter, Settings, Sparkles, Trophy, UserRound, Wallet, X, type LucideIcon } from "lucide-react";

/** The sidebar's icons (lucide-react), by name, so nav.ts can name them in plain data. */
const ICONS = {
  renter: UserRound,
  subscriptions: Repeat,
  owner: Scooter,
  shareholders: ChartPie,
  backoffice: LayoutGrid,
  dispute: Scale,
  play: CirclePlay,
  explain: Lightbulb,
  developers: CodeXml,
  integrations: Plug,
  sponsors: Trophy,
  settings: Settings,
  wallet: Wallet,
  rail: PanelLeft,
  ask: Sparkles,
  menu: Menu,
  close: X,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, className = "size-[18px]" }: { name: IconName; className?: string }) {
  const Svg = ICONS[name];
  return <Svg aria-hidden className={`shrink-0 ${className}`} strokeWidth={1.8} />;
}
