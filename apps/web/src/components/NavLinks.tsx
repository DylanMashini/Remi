"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarIcon, InsightsIcon, LiveIcon, MemoryIcon, PeopleIcon, SettingsIcon, ShieldIcon, SunriseIcon } from "./icons";

const PRIMARY = [
  { href: "/", label: "Today", Icon: SunriseIcon },
  { href: "/people", label: "People", Icon: PeopleIcon },
  { href: "/remember", label: "Remember", Icon: MemoryIcon },
  { href: "/reminders", label: "Reminders", Icon: CalendarIcon },
  { href: "/insights", label: "Insights", Icon: InsightsIcon },
] as const;

const SECONDARY = [
  { href: "/live", label: "Live view", Icon: LiveIcon },
  { href: "/privacy", label: "Privacy", Icon: ShieldIcon },
  { href: "/settings", label: "Settings", Icon: SettingsIcon },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Desktop sidebar navigation. */
export function SideNav() {
  const pathname = usePathname();
  const item = (href: string, label: string, Icon: typeof SunriseIcon) => {
    const active = isActive(pathname, href);
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        className={`flex h-12 items-center gap-3 rounded-[14px] px-3.5 text-[16px] font-bold no-underline ${
          active ? "bg-dusk-mist text-dusk-deep hover:text-dusk-deep" : "text-ink-soft hover:bg-linen hover:text-ink"
        }`}
      >
        <Icon size={20} />
        {label}
      </Link>
    );
  };
  return (
    <nav aria-label="Main" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">{PRIMARY.map((l) => item(l.href, l.label, l.Icon))}</div>
      <div className="flex flex-col gap-1">{SECONDARY.map((l) => item(l.href, l.label, l.Icon))}</div>
    </nav>
  );
}

/** Phone-width tab bar: the same tabs as the mobile app. */
export function TabBar() {
  const pathname = usePathname();
  const tabs = [PRIMARY[0], PRIMARY[1], PRIMARY[2], PRIMARY[3], SECONDARY[2]];
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {tabs.map(({ href, label, Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-[60px] flex-1 flex-col items-center justify-center gap-1 text-[12px] font-bold no-underline ${
              active ? "text-dusk-deep" : "text-ink-mute hover:text-ink"
            }`}
          >
            <Icon size={22} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
