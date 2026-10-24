"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarIcon, HomeIcon, LiveIcon, MemoryIcon, PeopleIcon } from "./icons";

const LINKS = [
  { href: "/", label: "Overview", Icon: HomeIcon },
  { href: "/people", label: "People", Icon: PeopleIcon },
  { href: "/remember", label: "Remember", Icon: MemoryIcon },
  { href: "/reminders", label: "Reminders", Icon: CalendarIcon },
  { href: "/live", label: "Live", Icon: LiveIcon },
] as const;

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex gap-1 overflow-x-auto md:flex-col">
      {LINKS.map(({ href, label, Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex h-11 shrink-0 items-center gap-2.5 rounded-[14px] px-3.5 text-[15px] font-bold no-underline md:h-12 md:gap-3 md:text-base ${
              active ? "bg-harbor-mist text-harbor-deep hover:text-harbor-deep" : "text-ink-soft hover:bg-linen hover:text-ink"
            }`}
          >
            <Icon />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
