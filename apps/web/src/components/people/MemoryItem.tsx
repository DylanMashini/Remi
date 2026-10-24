"use client";

import { useActionState, useState } from "react";
import { deleteMemory, setMemorySpoken, updateMemoryCallout, type FormState } from "@/app/(care)/actions";
import { formatAgo } from "@/components/format";
import type { MemoryJson } from "@/lib/memories";
import { MicIcon, PencilIcon, TrashIcon } from "../icons";
import { buttonPrimary, buttonQuiet, iconButton, inputClass } from "../ui";

const SOURCE: Record<MemoryJson["source"], (patient: string) => string> = {
  WEARER_VOICE: (p) => `${p} said`,
  WEARER_TYPED: (p) => `${p} wrote`,
  CAREGIVER: () => "Added by family",
};

export function MemoryItem({ memory, patientName, now }: { memory: MemoryJson; patientName: string; now: string }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(updateMemoryCallout.bind(null, memory.id), {});
  const on = memory.useInCallout;

  return (
    <li className={`flex flex-col gap-3 rounded-2xl border-[1.5px] p-4 sm:p-5 ${on ? "border-apricot bg-surface" : "border-sand bg-linen"}`}>
      <div className="flex items-start gap-3.5">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className={`m-0 font-display text-[19px] font-bold leading-snug ${on ? "text-ink" : "text-ink-soft"}`}>
            &ldquo;{memory.calloutText}&rdquo;
          </p>
          <p className="m-0 flex items-start gap-1.5 text-[15px] text-ink-soft">
            {memory.source === "WEARER_VOICE" ? <MicIcon size={16} className="mt-0.5 shrink-0" /> : null}
            <span>
              {SOURCE[memory.source](patientName)}: &ldquo;{memory.text}&rdquo;
            </span>
          </p>
          <span className="text-sm text-ink-soft">{formatAgo(memory.createdAt, new Date(now))}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            className={`${iconButton} hover:bg-sand hover:text-ink`}
            aria-label="Edit the spoken sentence"
            aria-expanded={editing}
          >
            <PencilIcon size={18} />
          </button>
          <form action={deleteMemory.bind(null, memory.id)}>
            <button type="submit" className={iconButton} aria-label="Delete this memory" title="Delete this memory">
              <TrashIcon size={18} />
            </button>
          </form>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-sand pt-3">
        <label className="flex cursor-pointer items-center gap-2.5 text-[15px] font-bold">
          <input
            type="checkbox"
            className="h-5 w-5 accent-harbor"
            checked={on}
            onChange={(e) => setMemorySpoken(memory.id, e.target.checked)}
          />
          Say this through the glasses
        </label>
        <span className="text-sm text-ink-soft">{on ? "Spoken when newest" : "Kept, not spoken"}</span>
      </div>

      {editing ? (
        <form action={formAction} className="flex flex-col gap-3 border-t border-sand pt-3">
          <label htmlFor={`callout-${memory.id}`} className="text-[15px] font-bold">
            The sentence the glasses say
          </label>
          <input
            id={`callout-${memory.id}`}
            name="calloutText"
            defaultValue={memory.calloutText}
            maxLength={160}
            required
            autoComplete="off"
            className={inputClass}
          />
          <div role="status" aria-live="polite">
            {state.error ? <p className="m-0 rounded-sm bg-attention-bg px-4 py-3 font-bold text-attention">{state.error}</p> : null}
            {state.ok ? <p className="m-0 rounded-sm bg-harbor-mist px-4 py-3 font-bold text-harbor-deep">Saved.</p> : null}
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className={buttonPrimary}>
              {pending ? "Saving..." : "Save sentence"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className={buttonQuiet}>
              Close
            </button>
          </div>
        </form>
      ) : null}
    </li>
  );
}
