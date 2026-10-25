"use client";

import { useState } from "react";
import { deleteMedication, setMedicationActive, updateMedication } from "@/app/(care)/actions";
import { describeTimes, medicationLine } from "@/lib/medication-text";
import type { Medication } from "@/generated/prisma/client";
import { PencilIcon, PillIcon, TrashIcon } from "../icons";
import { MedicationForm } from "./MedicationForm";
import { buttonText, iconButton, iconButtonDanger, RowIcon, Spoken } from "../ui";

/** One medication on the list, with pause, edit (inline), and delete. */
export function MedicationRow({ medication, patientName, self }: { medication: Medication; patientName: string; self: boolean }) {
  const [editing, setEditing] = useState(false);
  const m = medication;
  const [confirming, setConfirming] = useState(false);

  if (editing) {
    return (
      <li className="flex flex-col gap-4 bg-linen/60 px-4 py-5 sm:px-5">
        <strong className="font-display text-[19px] tracking-[-0.2px]">Change {m.name}</strong>
        <MedicationForm
          mode="edit"
          action={updateMedication.bind(null, m.id)}
          initial={{ name: m.name, dose: m.dose ?? "", instructions: m.instructions ?? "", times: m.times }}
          patientName={patientName}
          self={self}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className={`flex flex-col gap-3 px-4 py-4 sm:px-5 ${m.active ? "" : "opacity-70"}`}>
      <div className="flex items-start gap-3.5">
        <RowIcon tone={m.active ? "dusk" : "sand"} size={44}>
          <PillIcon size={22} />
        </RowIcon>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <strong className="text-[17px]">{m.name}</strong>
            {m.dose ? <span className="text-[15px] text-ink-soft">{m.dose}</span> : null}
          </span>
          <span className="text-[15px] text-ink-soft">{m.active ? describeTimes(m.times) : `Paused. Was ${describeTimes(m.times)}.`}</span>
          <Spoken size="sm" className={`mt-1 ${m.active ? "" : "text-ink-soft"}`}>
            {medicationLine(m)}
          </Spoken>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={() => setEditing(true)} className={iconButton} aria-label={`Change ${m.name}`}>
            <PencilIcon size={18} />
          </button>
          {confirming ? (
            <form action={deleteMedication.bind(null, m.id)} className="flex items-center gap-1">
              <button type="submit" className={`${buttonText} text-urgent hover:text-urgent`}>
                Remove
              </button>
              <button type="button" onClick={() => setConfirming(false)} className={buttonText}>
                Keep
              </button>
            </form>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className={iconButtonDanger} aria-label={`Remove ${m.name}`} title="Remove">
              <TrashIcon size={18} />
            </button>
          )}
        </div>
      </div>
      <form action={setMedicationActive.bind(null, m.id, !m.active)} className="pl-[58px]">
        <button type="submit" className={`${buttonText} h-9 min-h-0`}>
          {m.active ? "Pause reminders" : "Resume reminders"}
        </button>
      </form>
    </li>
  );
}
