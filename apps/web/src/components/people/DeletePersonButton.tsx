"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TrashIcon } from "../icons";
import { iconButton } from "../ui";

export function DeletePersonButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (!window.confirm(`Remove ${name}? Their photos and face data are deleted. Past moments stay in the log.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/people/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Could not remove (error ${res.status}).`);
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      {error ? <span className="text-sm font-bold text-urgent">{error}</span> : null}
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className={iconButton}
        aria-label={`Remove ${name}`}
        title={`Remove ${name}`}
      >
        <TrashIcon size={18} />
      </button>
    </span>
  );
}
