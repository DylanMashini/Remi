"use client";

import { usePathname } from "next/navigation";
import { CheckIcon } from "@/components/icons";

const STEPS = [
  { href: "/start/person", label: "Add a person" },
  { href: "/start/reminder", label: "Add a reminder" },
  { href: "/start/done", label: "Set up the phone" },
];

/** The first-run sequence. Numbered because it really is a sequence. */
export function Steps() {
  const pathname = usePathname();
  const current = Math.max(
    0,
    STEPS.findIndex((s) => pathname.startsWith(s.href)),
  );
  return (
    <ol className="m-0 flex list-none items-center gap-2 p-0 text-[15px] font-bold sm:gap-3" aria-label="Setup steps">
      {STEPS.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s.href} className="flex items-center gap-2 sm:gap-3">
            <span
              aria-current={active ? "step" : undefined}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-pill text-[14px] ${
                done ? "bg-harbor text-white" : active ? "bg-harbor-mist text-harbor-deep" : "bg-sand text-ink-mute"
              }`}
            >
              {done ? <CheckIcon size={16} /> : i + 1}
            </span>
            <span className={`${active ? "text-ink" : "text-ink-mute"} ${i === current ? "" : "hidden sm:inline"}`}>{s.label}</span>
            {i < STEPS.length - 1 ? <span className="h-px w-5 bg-line sm:w-8" aria-hidden="true" /> : null}
          </li>
        );
      })}
    </ol>
  );
}
