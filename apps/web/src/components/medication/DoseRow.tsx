import { setDoseTaken, skipDose } from "@/app/(care)/actions";
import { formatTime } from "@/components/format";
import { DOSE_STATUS_LABEL } from "@/lib/medication-text";
import type { Dose } from "@/lib/medications";
import { CheckIcon } from "../icons";
import { buttonText } from "../ui";

const DOT: Record<Dose["status"], string> = {
  upcoming: "bg-ink-mute",
  due: "bg-attention",
  said: "bg-dusk",
  taken: "bg-dusk",
  skipped: "bg-ink-mute",
  "missed-setup": "bg-line",
};

const TEXT: Record<Dose["status"], string> = {
  upcoming: "text-ink-soft",
  due: "text-attention",
  said: "text-dusk-deep",
  taken: "text-dusk-deep",
  skipped: "text-ink-mute",
  "missed-setup": "text-ink-mute",
};

/** One dose in today's schedule: time, medication, a status word next to a dot, and the caregiver's note of taken or skipped. */
export function DoseRow({ dose, next }: { dose: Dose; next: boolean }) {
  const r = dose.reminder;
  const detail =
    dose.status === "said" && r?.firedAt
      ? `Said at ${formatTime(r.firedAt)}`
      : dose.status === "taken" && r?.takenAt
        ? `Noted at ${formatTime(r.takenAt)}`
        : dose.status === "missed-setup"
          ? "Not spoken today"
          : null;
  return (
    <li className={`flex flex-wrap items-center gap-x-3.5 gap-y-1 px-4 py-3 sm:flex-nowrap sm:px-5 ${next ? "bg-dusk-mist/50" : ""}`}>
      <time dateTime={dose.dueAt.toISOString()} className={`w-[76px] shrink-0 text-[15px] font-bold tabular-nums ${next ? "text-dusk-deep" : "text-ink-soft"}`}>
        {formatTime(dose.dueAt)}
      </time>
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-pill ${
          dose.status === "taken" ? "bg-dusk text-white" : dose.status === "said" ? "bg-dusk-mist text-dusk-deep" : "bg-sand text-ink-mute"
        }`}
        aria-hidden="true"
      >
        {dose.status === "taken" ? <CheckIcon size={18} /> : <span className={`h-2.5 w-2.5 rounded-pill ${DOT[dose.status]}`} />}
      </span>
      <span className="flex min-w-[150px] flex-1 flex-col">
        <span className="text-[17px] leading-snug">
          <span className={next ? "font-bold" : ""}>{dose.medication.name}</span>
          {dose.medication.dose ? <span className="text-ink-soft">, {dose.medication.dose}</span> : null}
        </span>
        <span className={`text-[15px] leading-snug ${TEXT[dose.status]}`}>
          {DOSE_STATUS_LABEL[dose.status]}
          {detail ? ` · ${detail}` : ""}
        </span>
      </span>
      {r ? (
        <span className="ml-auto flex shrink-0 items-center gap-1 sm:ml-0">
          {dose.status === "taken" ? (
            <form action={setDoseTaken.bind(null, r.id, false)}>
              <button type="submit" className={`${buttonText} h-9 min-h-0 text-ink-soft hover:text-ink`}>
                Undo
              </button>
            </form>
          ) : (
            <>
              {dose.status !== "skipped" ? (
                <form action={setDoseTaken.bind(null, r.id, true)}>
                  <button type="submit" className={`${buttonText} h-9 min-h-0`}>
                    Mark taken
                  </button>
                </form>
              ) : null}
              {dose.status === "upcoming" || dose.status === "due" ? (
                <form action={skipDose.bind(null, r.id)}>
                  <button type="submit" className={`${buttonText} h-9 min-h-0 text-ink-soft hover:text-ink`}>
                    Skip
                  </button>
                </form>
              ) : null}
            </>
          )}
        </span>
      ) : null}
    </li>
  );
}
