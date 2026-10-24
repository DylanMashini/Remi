"use client";

import { useActionState } from "react";
import { updateCallout, type FormState } from "@/app/(care)/actions";
import type { PersonJson } from "@/lib/people";
import { buttonPrimary, inputClass, labelClass } from "../ui";

export function CalloutEditor({ person, patientName }: { person: PersonJson; patientName: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(updateCallout.bind(null, person.id), {});

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label htmlFor="callout-name" className={labelClass}>Name</label>
          <input id="callout-name" name="name" defaultValue={person.name} required maxLength={100} autoComplete="off" className={inputClass} />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="callout-rel" className={labelClass}>Relationship to {patientName}</label>
          <input
            id="callout-rel"
            name="relationship"
            defaultValue={person.relationship ?? ""}
            maxLength={100}
            autoComplete="off"
            placeholder="daughter"
            className={inputClass}
            aria-describedby="callout-rel-help"
          />
          <span id="callout-rel-help" className="text-sm text-ink-soft">Spoken as &ldquo;your daughter&rdquo;, so keep it lowercase.</span>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="callout-notes" className={labelClass}>A warm note</label>
        <input
          id="callout-notes"
          name="notes"
          defaultValue={person.notes ?? ""}
          maxLength={160}
          autoComplete="off"
          placeholder="She visits every Sunday."
          className={inputClass}
        />
      </div>
      <div role="status" aria-live="polite">
        {state.error ? <p className="m-0 rounded-sm bg-attention-bg px-4 py-3 font-bold text-attention">{state.error}</p> : null}
        {state.ok ? <p className="m-0 rounded-sm bg-harbor-mist px-4 py-3 font-bold text-harbor-deep">Saved. The glasses say the new line from now on.</p> : null}
      </div>
      <div>
        <button type="submit" disabled={pending} className={buttonPrimary}>
          {pending ? "Saving..." : "Save introduction"}
        </button>
      </div>
    </form>
  );
}
