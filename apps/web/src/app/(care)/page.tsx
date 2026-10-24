import Link from "next/link";
import { Suspense } from "react";
import { deleteReminder } from "./actions";
import { Avatar } from "@/components/Avatar";
import { getCare } from "@/components/care";
import { dayKey, formatAgo, formatDayHeading, formatShortDay, formatTime, formatWhen, greeting } from "@/components/format";
import { BellIcon, GlassesIcon, MemoryIcon, PersonIcon, PlusIcon, SpeakerIcon, TrashIcon } from "@/components/icons";
import { Timeline } from "@/components/Timeline";
import {
  buttonPrimary,
  buttonSecondary,
  EmptyState,
  Group,
  iconButtonDanger,
  Notice,
  PageHeader,
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
      <PageHeader eyebrow={formatDayHeading(now)} title={`${greeting(now)}, ${user.name.split(" ")[0]}`}>
        {active ? (
          <StatusPill tone="good">Glasses active</StatusPill>
        ) : (
          <StatusPill tone="idle">{latest ? `Quiet since ${formatWhen(latest.createdAt, now)}` : "Glasses not heard from yet"}</StatusPill>
        )}
        <Link href="/people/new" className={buttonPrimary}>
          <PlusIcon size={18} />
          Add a person
        </Link>
      </PageHeader>

      {peopleCount === 0 ? (
        <Notice tone="info" icon={<PersonIcon size={20} />} title="Finish setting up" action={<Link href="/start/person" className={buttonSecondary}>Add the first person</Link>}>
          The glasses only recognize people you add. Start with the one or two people {who === "you" ? "you see" : `${patientName} sees`} most.
        </Notice>
      ) : null}

      {/* The one loud thing on the page: the last words the glasses said. */}
      <section aria-labelledby="heard" className="flex flex-col gap-4 rounded-lg bg-harbor p-6 text-white sm:p-8">
        <h2 id="heard" className="m-0 flex items-center gap-2.5 text-[15px] font-bold text-harbor-mist">
          <SpeakerIcon size={18} />
          {lastSpoken ? `${self ? "You" : patientName} last heard` : `What ${who} will hear`}
          {lastSpoken ? <span className="font-normal opacity-80">{formatWhen(lastSpoken.createdAt, now)}</span> : null}
        </h2>
        {lastSpoken ? (
          <p className="m-0 font-display text-[28px] font-extrabold leading-[1.2] tracking-[-0.5px] sm:text-[38px]">&ldquo;{lastSpoken.text}&rdquo;</p>
        ) : (
          <p className="m-0 font-display text-[24px] font-bold leading-snug tracking-[-0.3px] text-white/85 sm:text-[30px]">
            Nothing spoken yet. When someone you added walks up, the glasses will say their name, your relationship, and your note.
          </p>
        )}
        {lastSpoken ? null : (
          <Link href="/people" className="w-fit text-[15px] font-bold text-white underline-offset-4 hover:text-white hover:underline">
            See what each person&apos;s introduction sounds like
          </Link>
        )}
      </section>

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
          Recall did not recognize someone and said &ldquo;Someone new is here.&rdquo; If this is someone {who === "you" ? "you" : patientName} should know, add them with a photo.
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
          action={<Link href="/reminders">Add a reminder</Link>}
          footer={upcoming.length ? "The glasses say each one once, at its time." : undefined}
        >
          {upcoming.length === 0 ? (
            <div className="flex flex-col gap-1 px-5 py-5">
              <strong className="text-[17px]">Nothing scheduled</strong>
              <span className="text-[15px] text-ink-soft">Add a reminder and the glasses will say it to {who} at the right moment.</span>
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
                      <span className={`text-[15px] font-bold ${i === 0 ? "text-harbor-deep" : "text-ink-soft"}`}>{formatTime(r.dueAt)}</span>
                      <span className="text-[13px] text-ink-mute">{dayKey(r.dueAt) === dayKey(now) ? "Today" : formatShortDay(r.dueAt)}</span>
                    </span>
                  }
                  title={<span className={i === 0 ? "font-bold" : ""}>{r.text}</span>}
                  value={due ? "Due now" : i === 0 ? "Next" : undefined}
                  valueTone={due ? "attention" : "good"}
                  trailing={
                    <form action={deleteReminder.bind(null, r.id)}>
                      <button type="submit" className={iconButtonDanger} aria-label={`Remove reminder: ${r.text}`} title="Remove reminder">
                        <TrashIcon size={18} />
                      </button>
                    </form>
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
              <RowIcon tone="harbor" size={44}>
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
            Moments appear here as the glasses recognize people, answer questions, and speak reminders.
            {latest ? ` The last one was ${formatAgo(latest.createdAt, now).toLowerCase()}.` : ""}
          </EmptyState>
        ) : (
          <Timeline events={todayEvents} patientName={patientName} />
        )}
      </Group>
    </>
  );
}
