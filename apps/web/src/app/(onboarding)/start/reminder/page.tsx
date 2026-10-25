import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { addReminder } from "@/app/(care)/actions";
import { getCare } from "@/components/care";
import { formatWhenText } from "@/components/format";
import { BellIcon } from "@/components/icons";
import { ReminderForm } from "@/components/reminders/ReminderForm";
import { buttonSecondary, Card, PageHeader, PageSkeleton, RowIcon } from "@/components/ui";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Add the first reminder" };

export default function StartReminderPage() {
  return (
    <Suspense fallback={<PageSkeleton rows={1} />}>
      <StartReminder />
    </Suspense>
  );
}

async function StartReminder() {
  const { patientId, patientName, user } = await getCare();
  const self = user.role === "WEARER";
  const now = new Date();
  const upcoming = await prisma.reminder.findMany({ where: { patientId, firedAt: null }, orderBy: { dueAt: "asc" }, take: 5 });
  const who = self ? "you" : patientName;

  return (
    <>
      <PageHeader
        title={upcoming.length ? "Another reminder?" : "What should Remi remind them of?"}
        lead={
          upcoming.length
            ? `${upcoming.length === 1 ? "One reminder is" : `${upcoming.length} reminders are`} scheduled. Add another, or continue.`
            : `Remi says each reminder through the glasses at the time you choose, in one calm sentence. Try one for a few minutes from now so ${who} can hear how it sounds.`
        }
      >
        {upcoming.length ? (
          <Link href="/start/done" className={buttonSecondary}>
            Continue
          </Link>
        ) : (
          <Link href="/start/done" className="text-[15px] font-bold">
            Skip for now
          </Link>
        )}
      </PageHeader>

      {upcoming.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {upcoming.map((r) => (
            <li key={r.id} className="flex items-center gap-3.5 rounded-md bg-surface px-4 py-3">
              <RowIcon tone="dusk">
                <BellIcon size={18} />
              </RowIcon>
              <div className="flex min-w-0 flex-1 flex-col">
                <strong className="truncate text-[17px]">{r.text}</strong>
                <span className="text-[15px] text-ink-soft">{formatWhenText(r.dueAt, now)}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <Card>
        <ReminderForm action={addReminder} patientName={patientName} self={self} nextHref="/start/reminder" />
      </Card>
    </>
  );
}
