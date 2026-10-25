import Link from "next/link";
import { Suspense } from "react";
import { deleteReminder } from "./actions";
import { Avatar } from "@/components/Avatar";
import { getCare } from "@/components/care";
import { dayKey, formatAgo, formatDayHeading, formatShortDay, formatTime, formatWhen, greeting } from "@/components/format";
import { BellIcon, GlassesIcon, LiveIcon, MemoryIcon, PersonIcon, PillIcon, TrashIcon } from "@/components/icons";
import { HorizonMark } from "@/components/Logo";
import { Timeline } from "@/components/Timeline";
import { ensureDoses } from "@/lib/medications";
import {
  buttonSecondary,
  EmptyState,
  Group,
  iconButtonDanger,
  Notice,
  PageSkeleton,
  Row,
  RowIcon,
  StatusPill,
} from "@/components/ui";
import { prisma } from "@/lib/prisma";

const ACTIVE_WINDOW_MS = 2 * 60 * 1000;

export default function TodayPage() {
  return (
    <Suspense fallback={<PageSkeleton rows={3} />}>
      <Today />
    </Suspense>
  );
}

async function Today() {
  const { patientId, patientName, user } = await getCare();
  const self = user.role === "WEARER";
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  await ensureDoses(patientId, now);

  const [todayEvents, latest, lastSpoken, upcoming, peopleCount, recentFaces] = await Promise.all([
    prisma.event.findMany({
      where: { patientId, createdAt: { gte: startOfDay } },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { person: { select: { name: true } } },
    }),
    prisma.event.findFirst({ where: { patientId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.event.findFirst({ where: { patientId, type: "SPOKEN" }, orderBy: { createdAt: "desc" } }),
    prisma.reminder.findMany({ where: { patientId, firedAt: null }, orderBy: { dueAt: "asc" }, take: 6 }),
    prisma.person.count({ where: { patientId } }),
    prisma.event.findMany({
      where: { patientId, type: "RECOGNITION", createdAt: { gte: startOfDay }, personId: { not: null } },
      orderBy: { createdAt: "desc" },
      distinct: ["personId"],
      take: 8,
      include: { person: { select: { id: true, name: true, relationship: true, avatarFileId: true } } },
    }),
  ]);

  const active = latest ? now.getTime() - latest.createdAt.getTime() < ACTIVE_WINDOW_MS : false;
  const lastUnknown = todayEvents.find((e) => e.type === "UNKNOWN");
  const practicedToday = todayEvents.some((e) => e.type === "PRACTICE");
  const who = self ? "you" : patientName;

  return (
    <>
      {/*
       * The Today header is the sky of the hour, ending in the horizon. The greeting sits in the
       * high sky; the last words Remi said sit just above the horizon line, with the sun on it.
       * This is the one place on the dashboard that carries the gradient.
       */}
      <header className="relative -mx-4 -mt-6 overflow-hidden bg-sky px-4 pb-0 pt-7 text-ink sm:-mx-[clamp(20px,4vw,56px)] sm:px-[clamp(20px,4vw,56px)] md:-mt-10 md:rounded-b-[28px] md:pt-10">
        <div className="mx-auto flex w-full max-w-[960px] flex-col gap-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-[15px] text-ink-soft">{formatDayHeading(now)}</span>
              <h1 className="m-0 font-display text-[30px] font-extrabold leading-[1.1] tracking-[-0.6px] sm:text-[36px]">
                {greeting(now)}, {user.name.split(" ")[0]}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2.5 sm:pt-1">
              {active ? (
                <StatusPill tone="good">Glasses active</StatusPill>
              ) : (
                <StatusPill tone="idle">{latest ? `Quiet since ${formatWhen(latest.createdAt, now)}` : "Glasses not heard from yet"}</StatusPill>
              )}
              <Link href="/live" className={`${buttonSecondary} bg-surface/70`}>
                <LiveIcon size={18} />
                Live
              </Link>
            </div>
          </div>

          <section aria-labelledby="heard" className="flex flex-col gap-3 pb-7 sm:pb-9">
            <h2 id="heard" className="m-0 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[15px] font-bold text-dusk-deep">
              {lastSpoken ? `Remi said to ${self ? "you" : patientName}` : `What Remi will say to ${who}`}
              {lastSpoken ? <span className="font-normal text-ink-soft">{formatWhen(lastSpoken.createdAt, now)}</span> : null}
            </h2>
            {lastSpoken ? (
              <p className="m-0 max-w-[26ch] text-balance font-display text-[28px] font-extrabold leading-[1.15] tracking-[-0.5px] sm:text-[40px]">
                &ldquo;{lastSpoken.text}&rdquo;
              </p>
            ) : (
              <p className="m-0 max-w-[40ch] font-display text-[24px] font-bold leading-snug tracking-[-0.3px] text-ink-soft sm:text-[30px]">
                Nothing yet. When someone you added walks up, Remi says their name, your relationship, and your note.
              </p>
            )}
            {lastSpoken ? null : (
              <Link href="/people" className="w-fit text-[15px] font-bold text-dusk-deep underline-offset-4 hover:underline">
                Hear what each introduction sounds like
              </Link>
            )}
          </section>
        </div>
        {/* The horizon: the sun sits on the line that closes the sky. */}
        <div className="pointer-events-none absolute inset-x-0 -bottom-[3px] flex items-end">
          <div className="mx-auto flex w-full max-w-[960px] justify-end px-2">
            <HorizonMark size={64} line="transparent" />
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-dusk" aria-hidden="true" />
      </header>

      {peopleCount === 0 ? (
        <Notice tone="info" icon={<PersonIcon size={20} />} title="Finish setting up" action={<Link href="/start/person" className={buttonSecondary}>Add the first person</Link>}>
          Remi only recognizes people you add. Start with the one or two people {who === "you" ? "you see" : `${patientName} sees`} most.
        </Notice>
      ) : null}

      {lastUnknown ? (
        <Notice
          tone="attention"
          icon={<PersonIcon size={20} />}
          title={`Someone new at ${formatTime(lastUnknown.createdAt)}`}
          action={
            <Link href="/people/new" className={buttonSecondary}>
              Add them
            </Link>
          }
        >
          Remi did not recognize someone and said &ldquo;Someone new is here.&rdquo; If this is someone {who === "you" ? "you" : patientName} should know, add them with a photo.
        </Notice>
      ) : null}

      {recentFaces.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="m-0 px-1 text-[15px] font-bold text-ink-soft">Seen today</h2>
          <ul className="m-0 flex list-none gap-3 overflow-x-auto p-0 pb-1">
            {recentFaces.map((e) =>
              e.person ? (
                <li key={e.id} className="shrink-0">
                  <Link href={`/people/${e.person.id}`} className="flex w-[112px] flex-col items-center gap-2 rounded-md bg-surface px-3 py-4 text-center text-ink no-underline hover:bg-apricot-mist hover:text-ink">
                    <Avatar name={e.person.name} avatarFileId={e.person.avatarFileId} size={56} />
                    <span className="w-full truncate text-[15px] font-bold">{e.person.name}</span>
                    <span className="text-[13px] text-ink-mute">{formatTime(e.createdAt)}</span>
                  </Link>
                </li>
              ) : null,
            )}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Group
          title="Coming up"
          action={
            <span className="flex gap-4">
              <Link href="/medication">Medication</Link>
              <Link href="/reminders">Add a reminder</Link>
            </span>
          }
          footer={upcoming.length ? "Remi says each one once, at its time." : undefined}
        >
          {upcoming.length === 0 ? (
            <div className="flex flex-col gap-1 px-5 py-5">
              <strong className="text-[17px]">Nothing scheduled</strong>
              <span className="text-[15px] text-ink-soft">Add a reminder and Remi will say it to {who} at the right moment.</span>
              <Link href="/reminders" className={`${buttonSecondary} mt-3 w-fit`}>
                <BellIcon size={18} />
                Add a reminder
              </Link>
            </div>
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

        <Group title="Remember" action={<Link href="/remember">See the pattern</Link>}>
          {practicedToday ? (
            <Row
              leading={
                <RowIcon tone="apricot" size={44}>
                  <MemoryIcon size={22} />
                </RowIcon>
              }
              title={`${self ? "You" : patientName} spent time in Remember today`}
              detail="Visits and any new memories are in the moments below."
              href="/remember"
            />
          ) : (
            <Row
              leading={
                <RowIcon tone="apricot" size={44}>
                  <MemoryIcon size={22} />
                </RowIcon>
              }
              title="A few minutes to remember"
              detail={`The phone's Remember tab shows ${who === "you" ? "you" : patientName} one familiar face at a time. Never a quiz; a yes becomes a memory.`}
              href="/remember"
            />
          )}
          <Row
            leading={
              <RowIcon tone="dusk" size={44}>
                <GlassesIcon size={22} />
              </RowIcon>
            }
            title={peopleCount === 1 ? "1 person recognized" : `${peopleCount} people recognized`}
            detail="And no one else. Faces are matched only against this list."
            href="/people"
          />
        </Group>
      </div>

      <Group
        title="Moments"
        action={<span className="font-normal text-ink-mute">{todayEvents.length === 0 ? "" : `${todayEvents.length} today`}</span>}
        footer={todayEvents.length ? "Only moments are kept; camera frames are never saved. Delete any moment with the bin." : undefined}
      >
        {todayEvents.length === 0 ? (
          <EmptyState icon={<GlassesIcon size={30} />} title="A quiet day so far">
            Moments appear here as Remi recognizes people, answers questions, and speaks reminders.
            {latest ? ` The last one was ${formatAgo(latest.createdAt, now).toLowerCase()}.` : ""}
          </EmptyState>
        ) : (
          <Timeline events={todayEvents} patientName={patientName} />
        )}
      </Group>
    </>
  );
}
