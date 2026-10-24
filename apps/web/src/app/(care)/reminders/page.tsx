import { Suspense } from "react";
import { addReminder, deleteReminder } from "../actions";
import { getCare } from "@/components/care";
import { formatWhen } from "@/components/format";
import { BellIcon, CheckIcon, TrashIcon } from "@/components/icons";
import { ReminderForm } from "@/components/reminders/ReminderForm";
import { Card, CardTitle, iconButton, PageHeader, Skeleton } from "@/components/ui";
import { prisma } from "@/lib/prisma";

export default function RemindersPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-7">
          <Skeleton className="h-16 w-1/2" />
          <Skeleton className="h-56" />
          <Skeleton className="h-72" />
        </div>
      }
    >
      <Reminders />
    </Suspense>
  );
}

async function Reminders() {
  const { patientId, patientName } = await getCare();
  const now = new Date();
  const reminders = await prisma.reminder.findMany({
    where: { patientId },
    orderBy: { dueAt: "asc" },
    take: 200,
  });
  const upcoming = reminders.filter((r) => !r.firedAt);
  const fired = reminders.filter((r) => r.firedAt).reverse().slice(0, 30);

  return (
    <>
      <PageHeader eyebrow="REMINDERS" title={`${patientName}'s day`} />

      <Card>
        <CardTitle>Add a reminder</CardTitle>
        <ReminderForm action={addReminder} patientName={patientName} />
      </Card>

      <Card>
        <CardTitle action={<span className="text-sm text-ink-soft">{upcoming.length} scheduled</span>}>
          Coming up
        </CardTitle>
        {upcoming.length === 0 ? (
          <p className="m-0 text-ink-soft">Nothing scheduled.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {upcoming.map((r) => {
              const overdue = r.dueAt.getTime() < now.getTime();
              return (
                <li key={r.id} className="flex items-center gap-4 rounded-2xl bg-linen px-4 py-3">
                  <BellIcon size={18} className="shrink-0 text-harbor" />
                  <span className="w-[120px] shrink-0 text-[15px] font-bold text-ink-soft">{formatWhen(r.dueAt, now)}</span>
                  <span className="min-w-0 flex-1 break-words">{r.text}</span>
                  {overdue ? <span className="shrink-0 text-sm font-bold text-attention">Due now</span> : null}
                  <form action={deleteReminder.bind(null, r.id)}>
                    <button type="submit" className={iconButton} aria-label="Delete reminder" title="Delete reminder">
                      <TrashIcon size={18} />
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {fired.length > 0 ? (
        <Card>
          <CardTitle>Already said</CardTitle>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {fired.map((r) => (
              <li key={r.id} className="flex items-center gap-4 rounded-2xl px-4 py-3 text-ink-soft">
                <CheckIcon size={18} className="shrink-0 text-harbor" />
                <span className="w-[120px] shrink-0 text-[15px] font-bold">{formatWhen(r.firedAt!, now)}</span>
                <span className="min-w-0 flex-1 break-words">{r.text}</span>
                <form action={deleteReminder.bind(null, r.id)}>
                  <button type="submit" className={iconButton} aria-label="Delete reminder" title="Delete reminder">
                    <TrashIcon size={18} />
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
