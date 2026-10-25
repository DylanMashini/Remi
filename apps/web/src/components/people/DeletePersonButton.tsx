"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TrashIcon } from "../icons";
import { buttonDestructive } from "../ui";

export function DeletePersonButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = name.split(" ")[0];

  async function onClick() {
    if (!window.confirm(`Remove ${first}? Remi will stop recognizing ${first} and delete their photos and memories. Past moments stay in the log without a name.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/people/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Could not remove (error ${res.status}).`);
        return;
      }
      router.replace("/people");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-3">
      {error ? <span className="text-[15px] font-bold text-urgent">{error}</span> : null}
      <button type="button" onClick={onClick} disabled={busy} className={buttonDestructive}>
        <TrashIcon size={18} />
        {busy ? "Removing" : `Remove ${first}`}
      </button>
    </span>
  );
}
