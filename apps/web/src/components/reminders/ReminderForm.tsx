"use client";

import { useActionState, useEffect, useRef } from "react";
import type { ReminderFormState } from "@/app/(care)/actions";
import { buttonPrimary, inputClass, labelClass } from "../ui";

type Action = (prev: ReminderFormState, formData: FormData) => Promise<ReminderFormState>;

export function ReminderForm({ action, patientName }: { action: Action; patientName: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={(fd: FormData) => {
        // datetime-local has no zone; send the browser's offset so the server stores the right instant.
        fd.set("tzOffset", String(new Date().getTimezoneOffset()));
        formAction(fd);
      }}
      className="flex flex-col gap-5"
    >
      <div className="grid gap-5 sm:grid-cols-[1fr_240px]">
        <div className="flex flex-col gap-2">
          <label htmlFor="rem-text" className={labelClass}>What {patientName} will hear</label>
          <input
            id="rem-text"
            name="text"
            required
            maxLength={200}
            autoComplete="off"
            placeholder="It is time for your afternoon tea."
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="rem-due" className={labelClass}>When</label>
          <input id="rem-due" name="dueAt" type="datetime-local" required className={inputClass} />
        </div>
      </div>
      <span className="-mt-2 text-sm text-ink-soft">Short and warm. One sentence. The glasses say it once at that time.</span>
      <div role="status" aria-live="polite">
        {state.error ? (
          <p className="m-0 rounded-sm bg-attention-bg px-4 py-3 font-bold text-attention">{state.error}</p>
        ) : null}
        {state.ok ? (
          <p className="m-0 rounded-sm bg-harbor-mist px-4 py-3 font-bold text-harbor-deep">Reminder added.</p>
        ) : null}
      </div>
      <div>
        <button type="submit" disabled={pending} className={buttonPrimary}>
          {pending ? "Adding..." : "Add reminder"}
        </button>
      </div>
    </form>
  );
}
