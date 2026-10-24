"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ReminderFormState } from "@/app/(care)/actions";
import { buttonLarge, Field, FormStatus, inputClass, Spoken } from "../ui";

type Action = (prev: ReminderFormState, formData: FormData) => Promise<ReminderFormState>;

const PRESETS: { label: string; minutes: number }[] = [
  { label: "In 1 minute", minutes: 1 },
  { label: "In 10 minutes", minutes: 10 },
  { label: "In 1 hour", minutes: 60 },
  { label: "Tomorrow morning", minutes: -1 },
];

const EXAMPLES = ["It is time for your afternoon tea.", "Sarah is coming to visit at four.", "Your pills are on the kitchen counter."];

/** Handlers must not read the clock inline (React Compiler purity rule); module helpers may. */
function fromNow(minutes: number): Date {
  const d = new Date();
  d.setMinutes(d.getMinutes() + minutes, 0, 0);
  return d;
}

function tomorrowAt9(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

/** Local datetime-local value (no zone) for a Date. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ReminderForm({ action, patientName, nextHref, self = false }: { action: Action; patientName: string; nextHref?: string; self?: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<ReminderFormState>({});
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const [picked, setPicked] = useState<number | null>(null);

  function submit(fd: FormData) {
    // datetime-local has no zone; send the browser's offset so the server stores the right instant.
    fd.set("tzOffset", String(new Date().getTimezoneOffset()));
    startTransition(async () => {
      const result = await action({}, fd);
      setState(result);
      if (!result.ok) return;
      setText("");
      setDue("");
      setPicked(null);
      if (nextHref) router.push(nextHref);
    });
  }

  function choose(minutes: number) {
    const d = minutes < 0 ? tomorrowAt9() : fromNow(minutes);
    setDue(toLocalInput(d));
    setPicked(minutes);
  }

  return (
    <form action={submit} className="flex flex-col gap-6">
      <Field label={self ? "What you will hear" : `What ${patientName} will hear`} htmlFor="rem-text" hint="Short and warm. One sentence. The glasses say it once, at that time.">
        <input
          id="rem-text"
          name="text"
          required
          maxLength={200}
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={EXAMPLES[0]}
          className={inputClass}
        />
      </Field>
      {!text ? (
        <div className="-mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => setText(ex)} className="cursor-pointer rounded-pill border-0 bg-sand px-3 py-1.5 text-[14px] font-bold text-ink hover:bg-line">
              {ex}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <span className="text-[15px] font-bold">When</span>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => choose(p.minutes)}
              aria-pressed={picked === p.minutes}
              className={`cursor-pointer rounded-pill border-[1.5px] px-4 py-2 text-[15px] font-bold ${
                picked === p.minutes ? "border-harbor bg-harbor-mist text-harbor-deep" : "border-line bg-surface text-ink hover:border-harbor"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <input
          id="rem-due"
          name="dueAt"
          type="datetime-local"
          required
          value={due}
          onChange={(e) => {
            setDue(e.target.value);
            setPicked(null);
          }}
          aria-label="Date and time"
          className={`${inputClass} sm:max-w-[280px]`}
        />
      </div>

      {text.trim() ? (
        <div className="flex flex-col gap-1.5 rounded-md bg-harbor-mist px-5 py-4">
          <span className="text-[15px] font-bold text-harbor-deep">{self ? "You will hear" : `${patientName} will hear`}</span>
          <Spoken size="sm">{text.trim()}</Spoken>
        </div>
      ) : null}

      <FormStatus error={state.error} ok={state.ok && !nextHref ? "Reminder added. The glasses will say it on time." : null} />
      <div>
        <button type="submit" disabled={pending} className={buttonLarge}>
          {pending ? "Adding" : nextHref ? "Add and continue" : "Add reminder"}
        </button>
      </div>
    </form>
  );
}
