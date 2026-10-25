"use client";

import { useActionState, useState } from "react";
import { changePassword, type FormState } from "@/app/(care)/actions";
import { buttonQuiet, buttonText, Field, FormStatus, inputClass } from "../ui";

/** Change password in place: current, new, again. Collapsed to one line until opened. */
export function PasswordForm() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(async (prev, fd) => {
    const r = await changePassword(prev, fd);
    if (r.ok) setOpen(false);
    return r;
  }, {});

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
        <span className="flex flex-col">
          <span className="text-[17px]">Password</span>
          {state.ok ? <span className="text-[15px] text-dusk-deep">Changed. Other sign-ins were ended.</span> : null}
        </span>
        <button type="button" onClick={() => setOpen(true)} className={buttonText}>
          Change password
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4 px-4 py-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Current password" htmlFor="pw-current">
          <input id="pw-current" name="current" type="password" autoComplete="current-password" required className={inputClass} autoFocus />
        </Field>
        <Field label="New password" htmlFor="pw-next" hint="At least 8 characters.">
          <input id="pw-next" name="next" type="password" autoComplete="new-password" minLength={8} required className={inputClass} />
        </Field>
        <Field label="New password again" htmlFor="pw-confirm">
          <input id="pw-confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} required className={inputClass} />
        </Field>
      </div>
      <FormStatus error={state.error} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={buttonQuiet}>
          {pending ? "Saving" : "Save new password"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={buttonText}>
          Cancel
        </button>
      </div>
    </form>
  );
}
