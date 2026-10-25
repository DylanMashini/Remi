"use client";

import { useActionState, useState } from "react";
import type { FormState } from "@/app/(care)/actions";
import { DOSE_PRESETS, formatClockTime, medicationLine } from "@/lib/medication-text";
import { PlusIcon, XIcon } from "../icons";
import { buttonLarge, buttonPrimary, buttonQuiet, Field, FormStatus, inputClass, Spoken } from "../ui";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

export type MedicationDraft = { name: string; dose: string; instructions: string; times: string[] };

const EMPTY: MedicationDraft = { name: "", dose: "", instructions: "", times: ["08:00"] };

/**
 * Add or edit a medication: what it is called, the dose, one sentence of instructions, and the
 * times of day. The preview shows the exact words Remi will say at each time.
 */
export function MedicationForm({
  action,
  initial,
  patientName,
  self = false,
  mode = "add",
  onDone,
}: {
  action: Action;
  initial?: MedicationDraft;
  patientName: string;
  self?: boolean;
  mode?: "add" | "edit";
  onDone?: () => void;
}) {
  const [draft, setDraft] = useState<MedicationDraft>(initial ?? EMPTY);
  const [custom, setCustom] = useState("");
  const [state, formAction, pending] = useActionState<FormState, FormData>(async (prev, fd) => {
    const r = await action(prev, fd);
    if (r.ok) {
      if (mode === "add") setDraft(EMPTY);
      onDone?.();
    }
    return r;
  }, {});

  const times = [...draft.times].sort();
  const toggle = (t: string) => setDraft((d) => ({ ...d, times: d.times.includes(t) ? d.times.filter((x) => x !== t) : [...d.times, t] }));
  const addCustom = () => {
    if (!/^\d{2}:\d{2}$/.test(custom)) return;
    if (!draft.times.includes(custom)) setDraft((d) => ({ ...d, times: [...d.times, custom] }));
    setCustom("");
  };
  const preview = draft.name.trim() ? medicationLine({ name: draft.name, dose: draft.dose, instructions: draft.instructions }) : null;
  const who = self ? "You" : patientName;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {times.map((t) => (
        <input key={t} type="hidden" name="times" value={t} />
      ))}
      <div className="grid gap-5 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Field label="Medication" htmlFor="med-name">
          <input
            id="med-name"
            name="name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            required
            maxLength={80}
            autoComplete="off"
            placeholder="Donepezil"
            className={inputClass}
          />
        </Field>
        <Field label="Dose" htmlFor="med-dose" hint="Said after the name, as words.">
          <input
            id="med-dose"
            name="dose"
            value={draft.dose}
            onChange={(e) => setDraft({ ...draft, dose: e.target.value })}
            maxLength={80}
            autoComplete="off"
            placeholder="one tablet"
            className={inputClass}
          />
        </Field>
      </div>
      <Field label="Instructions" htmlFor="med-instructions" hint="One sentence. Where the pills are, or what to take them with.">
        <input
          id="med-instructions"
          name="instructions"
          value={draft.instructions}
          onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
          maxLength={200}
          autoComplete="off"
          placeholder="It is in the blue box by the kettle."
          className={inputClass}
        />
      </Field>

      <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
        <legend className="mb-2 text-[15px] font-bold">Times of day</legend>
        <div className="flex flex-wrap gap-2">
          {DOSE_PRESETS.map((p) => {
            const on = draft.times.includes(p.time);
            return (
              <button
                key={p.time}
                type="button"
                onClick={() => toggle(p.time)}
                aria-pressed={on}
                className={`flex cursor-pointer flex-col items-start rounded-[14px] border-[1.5px] px-4 py-2 text-left ${
                  on ? "border-dusk bg-dusk-mist text-dusk-deep" : "border-line bg-surface text-ink hover:border-dusk"
                }`}
              >
                <span className="text-[15px] font-bold">{p.label}</span>
                <span className={`text-[13px] ${on ? "text-dusk-deep" : "text-ink-mute"}`}>{formatClockTime(p.time)}</span>
              </button>
            );
          })}
          {times
            .filter((t) => !DOSE_PRESETS.some((p) => p.time === t))
            .map((t) => (
              <span key={t} className="flex items-center gap-1 rounded-[14px] border-[1.5px] border-dusk bg-dusk-mist py-2 pl-4 pr-2 text-[15px] font-bold text-dusk-deep">
                {formatClockTime(t)}
                <button type="button" onClick={() => toggle(t)} aria-label={`Remove ${formatClockTime(t)}`} className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-pill border-0 bg-transparent text-dusk-deep hover:bg-dusk-mist-deep">
                  <XIcon size={14} />
                </button>
              </span>
            ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="med-custom" className="text-[15px] text-ink-soft">
            Another time
          </label>
          <input id="med-custom" type="time" value={custom} onChange={(e) => setCustom(e.target.value)} className={`${inputClass} min-h-[44px] w-auto`} />
          <button type="button" onClick={addCustom} disabled={!custom} className={`${buttonQuiet} h-11`}>
            <PlusIcon size={16} />
            Add time
          </button>
        </div>
      </fieldset>

      {preview ? (
        <div className="flex flex-col gap-1.5 rounded-md bg-dusk-mist px-5 py-4">
          <span className="text-[15px] font-bold text-dusk-deep">
            {who} will hear{times.length ? `, at ${times.map(formatClockTime).join(" and ")}` : ""}
          </span>
          <Spoken size="sm">{preview}</Spoken>
        </div>
      ) : null}

      <FormStatus error={state.error} ok={state.ok && mode === "add" ? "Added. Remi says each dose at its time." : null} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={mode === "add" ? buttonLarge : buttonPrimary}>
          {pending ? "Saving" : mode === "add" ? "Add medication" : "Save changes"}
        </button>
        {mode === "edit" && onDone ? (
          <button type="button" onClick={onDone} className={buttonQuiet}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
