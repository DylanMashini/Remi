"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

const INTERVAL_MS = 10_000;

/**
 * Re-fetches the current server component tree every ten seconds so pages like Today follow the
 * glasses without a reload. Paused while the tab is hidden. Does nothing on /live, which has its
 * own SSE stream and must not be re-rendered under it.
 */
export function AutoRefresh() {
  const router = useRouter();
  const pathname = usePathname();
  const live = pathname === "/live" || pathname.startsWith("/live/");

  useEffect(() => {
    if (live) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      router.refresh();
    }, INTERVAL_MS);
    return () => clearInterval(id);
  }, [live, router]);

  return null;
}
