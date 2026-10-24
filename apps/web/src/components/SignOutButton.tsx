"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOutIcon } from "./icons";
import { buttonQuiet } from "./ui";

export function SignOutButton({ className = buttonQuiet, compact = false }: { className?: string; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }
  return (
    <button type="button" onClick={signOut} disabled={busy} className={className} aria-label={compact ? "Sign out" : undefined}>
      <LogOutIcon size={18} />
      {compact ? null : busy ? "Signing out" : "Sign out"}
    </button>
  );
}
