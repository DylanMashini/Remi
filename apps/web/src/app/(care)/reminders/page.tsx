import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { addReminder, deleteReminder } from "../actions";
import { getCare } from "@/components/care";
import { dayKey, formatShortDay, formatTime, formatWhenText } from "@/components/format";
import { BellIcon, CheckIcon, PillIcon, TrashIcon } from "@/components/icons";
import { ReminderForm } from "@/components/reminders/ReminderForm";
import { ensureDoses } from "@/lib/medications";
import { Card, CardTitle, EmptyState, Group, iconButtonDanger, PageHeader, PageSkeleton, Row } from "@/components/ui";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Reminders" };

export default function RemindersPage() {
  return (
    <Suspense fallback={<PageSkeleton rows={2} />}>
      <Reminders />
    </Suspense>
  );
}

async function Reminders() {
  const { patientId, patientName, user } = await getCare();
  const self = user.role === "WEARER";
  const now = new Date();
  await ensureDoses(patientId, now);
  const reminders = await prisma.reminder.findMany({ where: { patientId }, orderBy: { dueAt: "asc" }, take: 200 });
  const upcoming = reminders.filter((r) => !r.firedAt);
  const fired = reminders.filter((r) => r.firedAt).reverse().slice(0, 30);
  const who = self ? "you" : patientName;

  return (
    <>
      <PageHeader
        title="Reminders"
        lead={`Remi says each one once, at its time, in one calm sentence. ${who === "you" ? "You hear" : `${patientName} hears`} it; you see it here and on the phone.`}
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardTitle>Add a reminder</CardTitle>
          <ReminderForm action={addReminder} patientName={patientName} self={self} />
        </Card>

        <div className="flex flex-col gap-8">
          <Group
            title="Coming up"
            action={<span className="font-normal text-ink-mute">{upcoming.length ? `${upcoming.length} scheduled` : ""}</span>}
            footer={upcoming.length ? "The phone checks every 15 seconds and Remi says each one once it is due. Doses come from Medication." : undefined}
          >
            {upcoming.length === 0 ? (
              <EmptyState icon={<BellIcon size={30} />} title="Nothing scheduled">
                Add a reminder and Remi will say it to {who} at the right moment.
              </EmptyState>
            ) : (
              upcoming.map((r, i) => {
                const due = r.dueAt.getTime() <= now.getTime();
                return (
                  <Row
                    key={r.id}
                    leading={
                      <span className="flex w-[72px] shrink-0 flex-col">
                        <span className={`text-[15px] font-bold ${i === 0 ? "text-dusk-deep" : "text-ink-soft"}`}>{formatTime(r.dueAt)}</span>
                        <span className="text-[13px] text-ink-mute">{dayKey(r.dueAt) === dayKey(now) ? "Today" : formatShortDay(r.dueAt)}</span>
                      </span>
                    }
                    title={
                      <span className={`inline-flex items-start gap-2 ${i === 0 ? "font-bold" : ""}`}>
                        {r.medicationId ? <PillIcon size={16} className="mt-1 shrink-0 text-dusk" aria-label="Medication" /> : null}
                        {r.text}
                      </span>
                    }
                    value={due ? "Due now" : i === 0 ? "Next" : undefined}
                    valueTone={due ? "attention" : "good"}
                    trailing={
                      r.medicationId ? (
                        <Link href="/medication" className="text-[15px] font-bold">
                          Doses
                        </Link>
                      ) : (
                        <form action={deleteReminder.bind(null, r.id)}>
                          <button type="submit" className={iconButtonDanger} aria-label={`Remove reminder: ${r.text}`} title="Remove reminder">
                            <TrashIcon size={18} />
                          </button>
                        </form>
                      )
                    }
                  />
                );
              })
            )}
          </Group>

          {fired.length > 0 ? (
            <Group title="Already said" footer="Remi said each of these; they are also in the moments log.">
              {fired.map((r) => (
                <Row
                  key={r.id}
                  leading={<CheckIcon size={18} className="shrink-0 text-dusk" />}
                  title={
                    <span className="inline-flex items-start gap-2 text-ink-soft">
                      {r.medicationId ? <PillIcon size={16} className="mt-1 shrink-0" aria-label="Medication" /> : null}
                      {r.text}
                    </span>
                  }
                  value={r.skippedAt ? "Skipped" : formatWhenText(r.firedAt!, now)}
                  valueTone="mute"
                  trailing={
                    <form action={deleteReminder.bind(null, r.id)}>
                      <button type="submit" className={iconButtonDanger} aria-label={`Delete reminder: ${r.text}`} title="Delete reminder">
                        <TrashIcon size={18} />
                      </button>
                    </form>
                  }
                />
              ))}
            </Group>
          ) : null}
        </div>
      </div>
    </>
  );
}
