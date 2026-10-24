"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/(care)/actions";
import { buttonQuiet, FormStatus, inputClass } from "../ui";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

/** One-field rename form used for the account name and the wearer's name. */
export function NameForm({ action, id, label, defaultValue, hint, savedText }: { action: Action; id: string; label: string; defaultValue: string; hint?: string; savedText: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-3 px-4 py-4">
      <label htmlFor={id} className="text-[15px] font-bold">
        {label}
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input id={id} name="name" defaultValue={defaultValue} required maxLength={100} autoComplete="off" className={`${inputClass} sm:max-w-[360px]`} />
        <button type="submit" disabled={pending} className={`${buttonQuiet} h-[52px] shrink-0`}>
          {pending ? "Saving" : "Save"}
        </button>
      </div>
      {hint ? <span className="text-[15px] text-ink-mute">{hint}</span> : null}
      <FormStatus error={state.error} ok={state.ok ? savedText : null} />
    </form>
  );
}
