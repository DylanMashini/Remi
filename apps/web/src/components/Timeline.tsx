import { deleteEvent } from "@/app/(care)/actions";
import { EventIcon, eventTitle, isRepeat } from "./events";
import { formatTime } from "./format";
import { TrashIcon } from "./icons";
import { Chip, iconButtonDanger } from "./ui";

export type TimelineEvent = {
  id: string;
  type: string;
  text: string;
  data: unknown;
  createdAt: Date;
  person: { name: string } | null;
};

/**
 * The memory log as a list of moments with a time rail. Every row can be deleted: only moments
 * are kept (never frames), and the caregiver decides which moments stay.
 */
export function Timeline({ events, patientName, deletable = true }: { events: TimelineEvent[]; patientName: string; deletable?: boolean }) {
  return (
    <ol className="hairline-rows m-0 list-none p-0">
      {events.map((e) => {
        const spoken = e.type === "SPOKEN";
        return (
          <li key={e.id} className="flex items-start gap-3 px-4 py-3.5 sm:gap-4">
            <time dateTime={e.createdAt.toISOString()} className="w-[64px] shrink-0 pt-2 text-[15px] font-bold tabular-nums text-harbor-deep sm:w-[76px]">
              {formatTime(e.createdAt)}
            </time>
            <EventIcon type={e.type} size={36} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-bold text-ink-soft">{eventTitle(e.type, patientName, e.person?.name, e.data)}</span>
                {e.type === "QUESTION" && isRepeat(e.data) ? <Chip tone="attention">Asked again</Chip> : null}
              </div>
              <p className={`m-0 break-words ${spoken ? "font-display text-[18px] font-bold leading-snug text-harbor-deep" : "text-[17px] leading-snug text-ink"}`}>
                {spoken ? <>&ldquo;{e.text}&rdquo;</> : e.text}
              </p>
            </div>
            {deletable ? (
              <form action={deleteEvent.bind(null, e.id)} className="shrink-0">
                <button type="submit" className={iconButtonDanger} aria-label="Delete this moment" title="Delete this moment">
                  <TrashIcon size={18} />
                </button>
              </form>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
