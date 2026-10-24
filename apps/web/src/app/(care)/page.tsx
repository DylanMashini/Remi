import Link from "next/link";
import { Suspense } from "react";
import { deleteEvent } from "./actions";
import { Avatar } from "@/components/Avatar";
import { getCare } from "@/components/care";
import { EventIcon, eventTitle, isRepeat } from "@/components/events";
import { capitalize, formatDayHeading, formatTime, formatWhen } from "@/components/format";
import { CheckIcon, PersonIcon, TrashIcon } from "@/components/icons";
import { buttonPrimary, buttonSecondary, Card, CardTitle, Chip, iconButton, PageHeader, Skeleton } from "@/components/ui";
import { prisma } from "@/lib/prisma";

const ACTIVE_WINDOW_MS = 2 * 60 * 1000;

export default function OverviewPage() {
  return (
    <Suspense fallback={<OverviewSkeleton />}>
      <Overview />
    </Suspense>
  );
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-7">
      <Skeleton className="h-16 w-2/3" />
      <div className="grid gap-6 md:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
      <Skeleton className="h-96" />
    </div>
  );
}

async function Overview() {
  const { patientId, patientName } = await getCare();
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const [todayEvents, latest, recognitions, upcoming] = await Promise.all([
    prisma.event.findMany({
      where: { patientId, createdAt: { gte: startOfDay } },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { person: { select: { name: true } } },
    }),
    prisma.event.findFirst({ where: { patientId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.event.findMany({
      where: { patientId, type: "RECOGNITION" },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { person: { select: { name: true, relationship: true, avatarFileId: true } } },
    }),
    prisma.reminder.findMany({
      where: { patientId, firedAt: null, dueAt: { gte: now } },
      orderBy: { dueAt: "asc" },
      take: 5,
    }),
  ]);

  const active = latest ? now.getTime() - latest.createdAt.getTime() < ACTIVE_WINDOW_MS : false;
  const lastUnknown = todayEvents.find((e) => e.type === "UNKNOWN");

  return (
    <>
      <PageHeader eyebrow={formatDayHeading(now)} title={`${patientName} today`}>
        {active ? (
          <Chip tone="harbor">
            <CheckIcon size={16} />
            Glasses active
          </Chip>
        ) : (
          <Chip>
            <span className="h-2.5 w-2.5 rounded-pill bg-ink-soft/50" aria-hidden="true" />
            {latest ? `Glasses quiet since ${formatWhen(latest.createdAt, now)}` : "Glasses not seen yet"}
          </Chip>
        )}
        <Link href="/people#enroll" className={buttonPrimary}>
          Add a person
        </Link>
      </PageHeader>

      {lastUnknown ? (
        <div className="flex flex-wrap items-center gap-3.5 rounded-md border-[1.5px] border-attention-line bg-surface p-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm bg-attention-bg text-attention">
            <PersonIcon size={22} />
          </div>
          <div className="flex min-w-[240px] flex-1 flex-col gap-0.5">
            <strong className="text-[17px]">Someone new at {formatTime(lastUnknown.createdAt)}</strong>
            <span className="text-[15px] text-ink-soft">
              Recall did not recognize someone. {patientName} was told &ldquo;Someone new is here.&rdquo; If this is
              someone {patientName} should know, enroll them.
            </span>
          </div>
          <Link href="/people#enroll" className={buttonSecondary}>
            Enroll them
          </Link>
        </div>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardTitle action={<Link href="/people" className="text-[15px] font-bold">People</Link>}>
            Recent recognitions
          </CardTitle>
          {recognitions.length === 0 ? (
            <p className="m-0 text-ink-soft">No one recognized yet. Enroll family and friends on the People page.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {recognitions.map((e, i) => {
                const name = e.person?.name ?? "Someone (removed)";
                return (
                  <li
                    key={e.id}
                    className={`flex items-center gap-3.5 py-3 ${i < recognitions.length - 1 ? "border-b border-sand" : ""}`}
                  >
                    <Avatar name={name} avatarFileId={e.person?.avatarFileId} />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <strong className="truncate">
                        {name}
                        {e.person?.relationship ? ` · ${capitalize(e.person.relationship)}` : ""}
                      </strong>
                      <span className="truncate text-sm text-ink-soft">{e.text}</span>
                    </div>
                    <span className="shrink-0 text-sm text-ink-soft">{formatWhen(e.createdAt, now)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle action={<Link href="/reminders" className="text-[15px] font-bold">Add</Link>}>
            Coming up
          </CardTitle>
          {upcoming.length === 0 ? (
            <p className="m-0 text-ink-soft">No reminders scheduled. Add one and the glasses will say it on time.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {upcoming.map((r, i) => (
                <li
                  key={r.id}
                  className={`flex items-center gap-4 rounded-2xl px-4 py-3.5 ${i === 0 ? "bg-harbor-mist" : "bg-linen"}`}
                >
                  <span className={`w-[84px] shrink-0 text-[15px] font-bold ${i === 0 ? "text-harbor-deep" : "text-ink-soft"}`}>
                    {formatWhen(r.dueAt, now)}
                  </span>
                  <span className={`flex-1 ${i === 0 ? "font-bold" : ""}`}>{r.text}</span>
                  {i === 0 ? <span className="text-sm font-bold text-harbor-deep">Next</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardTitle action={<span className="text-sm text-ink-soft">{todayEvents.length} moments</span>}>
          Today
        </CardTitle>
        {todayEvents.length === 0 ? (
          <p className="m-0 text-ink-soft">
            Nothing yet today. When the glasses see, hear, or say something, it shows up here.
          </p>
        ) : (
          <ol className="m-0 flex list-none flex-col p-0">
            {todayEvents.map((e, i) => {
              const spoken = e.type === "SPOKEN";
              return (
                <li
                  key={e.id}
                  className={`flex items-start gap-3.5 py-3.5 ${i < todayEvents.length - 1 ? "border-b border-sand" : ""}`}
                >
                  <EventIcon type={e.type} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-[15px]">{eventTitle(e.type, patientName, e.person?.name)}</strong>
                      {e.type === "QUESTION" && isRepeat(e.data) ? (
                        <span className="rounded-pill bg-attention-bg px-2.5 py-0.5 text-xs font-bold text-attention">
                          Asked again
                        </span>
                      ) : null}
                    </div>
                    <p className={`m-0 break-words ${spoken ? "font-display text-[17px] font-bold text-harbor-deep" : "text-ink"}`}>
                      {spoken ? <>&ldquo;{e.text}&rdquo;</> : e.text}
                    </p>
                  </div>
                  <span className="shrink-0 pt-0.5 text-sm text-ink-soft">{formatTime(e.createdAt)}</span>
                  <form action={deleteEvent.bind(null, e.id)}>
                    <button type="submit" className={iconButton} aria-label="Delete this moment" title="Delete this moment">
                      <TrashIcon size={18} />
                    </button>
                  </form>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </>
  );
}
