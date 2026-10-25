"use client";

import { useActionState, useOptimistic, useState, useTransition } from "react";
import { deleteMemory, setMemorySpoken, updateMemoryCallout, type FormState } from "@/app/(care)/actions";
import { formatAgo } from "@/components/format";
import type { MemoryJson } from "@/lib/memories";
import { MicIcon, PencilIcon, TrashIcon } from "../icons";
import { buttonPrimary, buttonQuiet, FormStatus, iconButton, iconButtonDanger, inputClass } from "../ui";

const SOURCE: Record<MemoryJson["source"], (patient: string) => string> = {
  WEARER_VOICE: (p) => `${p} said`,
  WEARER_TYPED: (p) => `${p} wrote`,
  CAREGIVER: () => "Added by family",
};

/** The "say this" control: a real switch, flipped optimistically. */
export function SaySwitch({ memory, label }: { memory: MemoryJson; label?: string }) {
  const [on, setOn] = useOptimistic(memory.useInCallout);
  const [, start] = useTransition();
  return (
    <label className="flex cursor-pointer items-center gap-3 text-[15px] font-bold">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label ?? `Have Remi say this: ${memory.calloutText}`}
        onClick={() =>
          start(async () => {
            setOn(!on);
            await setMemorySpoken(memory.id, !on);
          })
        }
        className={`relative h-8 w-[52px] shrink-0 cursor-pointer rounded-pill border-0 transition-colors ${on ? "bg-dusk" : "bg-line"}`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-1 h-6 w-6 rounded-pill bg-surface shadow-[0_1px_3px_rgba(30,43,47,0.3)] transition-[left] ${on ? "left-[24px]" : "left-1"}`}
        />
      </button>
      <span className={on ? "text-dusk-deep" : "text-ink-soft"}>{on ? "Spoken" : "Kept, not spoken"}</span>
    </label>
  );
}

export function MemoryItem({ memory, patientName, now, newestSpoken }: { memory: MemoryJson; patientName: string; now: string; newestSpoken: boolean }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(updateMemoryCallout.bind(null, memory.id), {});
  const on = memory.useInCallout;

  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:px-5">
      <div className="flex items-start gap-3.5">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className={`m-0 font-display text-[19px] font-bold leading-snug tracking-[-0.2px] ${on ? "text-dusk-deep" : "text-ink-soft"}`}>
            &ldquo;{memory.calloutText}&rdquo;
            {newestSpoken ? <span className="ml-2 align-middle rounded-pill bg-apricot-mist px-2 py-0.5 font-body text-[12px] text-apricot-deep">Said now</span> : null}
          </p>
          <p className="m-0 flex items-start gap-1.5 text-[15px] leading-snug text-ink-soft">
            {memory.source === "WEARER_VOICE" ? <MicIcon size={16} className="mt-0.5 shrink-0" /> : null}
            <span>
              {SOURCE[memory.source](patientName)}: &ldquo;{memory.text}&rdquo;
            </span>
          </p>
          <span className="text-[13px] text-ink-mute">{formatAgo(memory.createdAt, new Date(now))}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={() => setEditing((e) => !e)} className={iconButton} aria-label="Change the spoken sentence" aria-expanded={editing}>
            <PencilIcon size={18} />
          </button>
          <form action={deleteMemory.bind(null, memory.id)}>
            <button type="submit" className={iconButtonDanger} aria-label="Delete this memory" title="Delete this memory">
              <TrashIcon size={18} />
            </button>
          </form>
        </div>
      </div>

      <SaySwitch memory={memory} />

      {editing ? (
        <form action={formAction} className="flex flex-col gap-3 border-t border-hairline pt-3">
          <label htmlFor={`callout-${memory.id}`} className="text-[15px] font-bold">
            The sentence Remi says
          </label>
          <input id={`callout-${memory.id}`} name="calloutText" defaultValue={memory.calloutText} maxLength={160} required autoComplete="off" className={inputClass} />
          <FormStatus error={state.error} ok={state.ok ? "Saved." : null} />
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className={buttonPrimary}>
              {pending ? "Saving" : "Save sentence"}
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
