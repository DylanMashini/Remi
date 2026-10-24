import Link from "next/link";
import { ShieldIcon } from "./icons";

export function PrivacyFooter() {
  return (
    <footer className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-sand pt-5 text-[15px] text-ink-soft">
      <ShieldIcon size={16} className="shrink-0 text-harbor" />
      <span>Faces are matched only against people you add. Camera frames are never stored.</span>
      <Link href="/privacy" className="font-bold">
        How privacy works
      </Link>
    </footer>
  );
}
