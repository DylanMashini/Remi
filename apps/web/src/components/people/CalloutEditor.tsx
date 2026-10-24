"use client";

import { useActionState, useState } from "react";
import { updateCallout, type FormState } from "@/app/(care)/actions";
import type { PersonJson } from "@/lib/people";
import { knownLine } from "../format";
import { PencilIcon, SpeakerIcon } from "../icons";
import { HearPreview } from "./HearPreview";
import { buttonPrimary, buttonQuiet, buttonText, Field, FormStatus, inputClass, Spoken } from "../ui";

/**
 * The introduction: the exact line the glasses say when this person walks up, with an inline
 * editor for name, relationship, and the note (the first part of the line).
 */
export function CalloutEditor({ person, patientName, self = false }: { person: PersonJson; patientName: string; self?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    async (prev, fd) => {
      const r = await updateCallout(person.id, prev, fd);
      if (r.ok) setEditing(false);
      return r;
    },
    {},
  );
  const [draft, setDraft] = useState({ name: person.name, relationship: person.relationship ?? "", notes: person.notes ?? "" });
  const memory = person.line.replace(knownLine({ name: person.name, relationship: person.relationship, notes: person.notes }), "").trim();
  const preview = knownLine({ name: draft.name.trim() || person.name, relationship: draft.relationship.trim() || null, notes: draft.notes.trim() || null, memory: memory || null });

  return (
    <section className="flex flex-col gap-4 rounded-lg bg-harbor-mist p-5 sm:p-7">
      <div className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-harbor-deep">
        <SpeakerIcon size={18} />
        What the glasses say when {person.name.split(" ")[0]} walks up
        <span className="ml-auto flex items-center gap-2">
          <HearPreview text={editing ? preview : person.line} />
          {!editing ? (
            <button type="button" onClick={() => setEditing(true)} className={`${buttonText} h-9 min-h-0`}>
              <PencilIcon size={16} />
              Edit
            </button>
          ) : null}
        </span>
      </div>
      <Spoken size="lg" className="text-ink">
        {editing ? preview : person.line}
      </Spoken>
      {!editing ? (
        <p className="m-0 text-[15px] text-ink-soft">Name, relationship, your note, then the newest memory switched on below. Change any part and the glasses change with it.</p>
      ) : (
        <form action={formAction} className="flex flex-col gap-5 rounded-md bg-surface p-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Name" htmlFor="callout-name">
              <input
                id="callout-name"
                name="name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                required
                maxLength={100}
                autoComplete="off"
                className={inputClass}
              />
            </Field>
            <Field label={self ? "Relationship to you" : `Relationship to ${patientName}`} htmlFor="callout-rel" hint="Spoken as “your daughter”, so keep it lowercase.">
              <input
                id="callout-rel"
                name="relationship"
                value={draft.relationship}
                onChange={(e) => setDraft({ ...draft, relationship: e.target.value })}
                maxLength={100}
                autoComplete="off"
                placeholder="daughter"
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="A warm note" htmlFor="callout-notes" hint="One sentence. Spoken right after the name.">
            <input
              id="callout-notes"
              name="notes"
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              maxLength={160}
              autoComplete="off"
              placeholder="She visits every Sunday."
              className={inputClass}
            />
          </Field>
          <FormStatus error={state.error} />
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pending} className={buttonPrimary}>
              {pending ? "Saving" : "Save introduction"}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft({ name: person.name, relationship: person.relationship ?? "", notes: person.notes ?? "" });
                setEditing(false);
              }}
              className={buttonQuiet}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
