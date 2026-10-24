"use client";

import { useActionState, useEffect, useRef } from "react";
import { addMemory, type FormState } from "@/app/(care)/actions";
import { buttonSecondary, inputClass, labelClass } from "../ui";

export function AddMemoryForm({ personId, personName }: { personId: string; personName: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(addMemory.bind(null, personId), {});
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <label htmlFor="memory-text" className={labelClass}>Something to remember about {personName}</label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          id="memory-text"
          name="text"
          required
          maxLength={1000}
          autoComplete="off"
          placeholder="You two used to walk the dog along the river every morning."
          className={inputClass}
        />
        <button type="submit" disabled={pending} className={`${buttonSecondary} shrink-0`}>
          {pending ? "Adding..." : "Add memory"}
        </button>
      </div>
      <span className="text-sm text-ink-soft">Write it the way you would say it to them. It is turned into one short spoken sentence you can edit.</span>
      <div role="status" aria-live="polite">
        {state.error ? <p className="m-0 rounded-sm bg-attention-bg px-4 py-3 font-bold text-attention">{state.error}</p> : null}
        {state.ok ? <p className="m-0 rounded-sm bg-harbor-mist px-4 py-3 font-bold text-harbor-deep">Memory added.</p> : null}
      </div>
    </form>
  );
}
