import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Avatar } from "@/components/Avatar";
import { getCare } from "@/components/care";
import { isRepeat } from "@/components/events";
import { dayKey, formatAgo, formatShortDay, formatTime, TIME_ZONE, weekdayShort } from "@/components/format";
import { ClockIcon, PersonIcon, QuestionIcon, RepeatIcon } from "@/components/icons";
import { EmptyState, Group, PageHeader, PageSkeleton, Row, RowIcon } from "@/components/ui";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Insights" };

const DAYS = 7;

export default function InsightsPage() {
  return (
    <Suspense fallback={<PageSkeleton rows={3} />}>
      <Insights />
    </Suspense>
  );
}

async function Insights() {
  const { patientId, patientName, user } = await getCare();
  const self = user.role === "WEARER";
  const now = new Date();
  const since = new Date(now.getTime() - DAYS * 24 * 60 * 60 * 1000);
  since.setHours(0, 0, 0, 0);

  const [events, people] = await Promise.all([
    prisma.event.findMany({
      where: { patientId, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      select: { id: true, type: true, text: true, data: true, personId: true, createdAt: true },
    }),
    prisma.person.findMany({ where: { patientId }, select: { id: true, name: true, relationship: true, avatarFileId: true } }),
  ]);
  const personById = new Map(people.map((p) => [p.id, p]));
  const who = self ? "you" : patientName;

  // Days, oldest first, with recognitions and spoken counts per day.
  const days: { key: string; date: Date; recognitions: number; spoken: number; unknown: number }[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    days.push({ key: dayKey(d), date: d, recognitions: 0, spoken: 0, unknown: 0 });
  }
  const byDay = new Map(days.map((d) => [d.key, d]));
  const seenPerPerson = new Map<string, { count: number; last: Date }>();
  const hours = new Array<number>(24).fill(0);
  const questions: { text: string; at: Date; repeat: boolean }[] = [];
  let unknown = 0;
  let reminders = 0;

  for (const e of events) {
    const day = byDay.get(dayKey(e.createdAt));
    if (e.type === "RECOGNITION") {
      if (day) day.recognitions++;
      if (e.personId) {
        const cur = seenPerPerson.get(e.personId);
        seenPerPerson.set(e.personId, { count: (cur?.count ?? 0) + 1, last: e.createdAt });
      }
      hours[Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: TIME_ZONE }).format(e.createdAt)) % 24]++;
    } else if (e.type === "UNKNOWN") {
      unknown++;
      if (day) day.unknown++;
    } else if (e.type === "SPOKEN") {
      if (day) day.spoken++;
    } else if (e.type === "QUESTION") {
      questions.push({ text: e.text, at: e.createdAt, repeat: isRepeat(e.data) });
    } else if (e.type === "REMINDER") {
      reminders++;
    }
  }

  const totalRecognitions = days.reduce((n, d) => n + d.recognitions, 0);
  const repeats = questions.filter((q) => q.repeat).length;
  const mostSeen = [...seenPerPerson.entries()]
    .map(([id, v]) => ({ person: personById.get(id), ...v }))
    .filter((x) => x.person)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const busiestHour = hours.reduce((best, n, h) => (n > hours[best] ? h : best), 0);
  const hourLabel = (h: number) => {
    const d = new Date(2000, 0, 1, h);
    return new Intl.DateTimeFormat("en-US", { hour: "numeric" }).format(d);
  };
  // Repeated questions grouped by wording.
  const repeated = new Map<string, number>();
  for (const q of questions) repeated.set(q.text, (repeated.get(q.text) ?? 0) + 1);
  const askedMost = [...repeated.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const quiet = events.length === 0;

  return (
    <>
      <PageHeader
        title="Insights"
        lead={`Patterns from the last seven days: who ${who === "you" ? "you" : patientName} saw, what was asked, and when the glasses were busiest. Built from moments only; nothing here comes from stored video.`}
      />

      {quiet ? (
        <div className="rounded-md bg-surface">
          <EmptyState icon={<ClockIcon size={30} />} title="Nothing to show yet">
            Patterns appear after the glasses have recognized a few people or answered a few questions. Come back after a day of use.
          </EmptyState>
        </div>
      ) : (
        <>
          <dl className="m-0 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="People recognized" value={totalRecognitions} detail={`${seenPerPerson.size} different ${seenPerPerson.size === 1 ? "person" : "people"}`} />
            <Stat label="Someone new" value={unknown} detail={unknown ? "times, not on the roster" : "no strangers announced"} tone={unknown ? "attention" : "sand"} />
            <Stat label="Questions asked" value={questions.length} detail={repeats ? `${repeats} asked again` : "none repeated"} />
            <Stat label="Reminders spoken" value={reminders} detail="in the last seven days" />
          </dl>

          <section className="flex flex-col gap-3 rounded-md bg-surface p-5 sm:p-6" aria-labelledby="chart-title">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="chart-title" className="m-0 font-display text-[20px] font-bold tracking-[-0.3px]">
                Faces recognized each day
              </h2>
              <span className="text-[15px] text-ink-soft">{totalRecognitions} in seven days</span>
            </div>
            <DayBars days={days} />
            <table className="sr-only">
              <caption>Faces recognized each day</caption>
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Recognized</th>
                  <th>Someone new</th>
                  <th>Spoken lines</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.key}>
                    <td>{formatShortDay(d.date)}</td>
                    <td>{d.recognitions}</td>
                    <td>{d.unknown}</td>
                    <td>{d.spoken}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <div className="grid gap-8 lg:grid-cols-2">
            <Group title="Seen most often" footer={mostSeen.length ? "Announced at most once per person every five minutes, so counts are visits, not frames." : undefined}>
              {mostSeen.length === 0 ? (
                <Row
                  leading={
                    <RowIcon tone="sand" size={40}>
                      <PersonIcon size={20} />
                    </RowIcon>
                  }
                  title="No one recognized this week"
                  detail="When someone on the roster walks up, they appear here."
                />
              ) : (
                mostSeen.map(({ person, count, last }) => (
                  <Row
                    key={person!.id}
                    leading={<Avatar name={person!.name} avatarFileId={person!.avatarFileId} size={44} />}
                    title={<span className="font-bold">{person!.name}</span>}
                    detail={`${person!.relationship ? `${person!.relationship[0].toUpperCase()}${person!.relationship.slice(1)}. ` : ""}Last ${formatAgo(last, now).toLowerCase()}`}
                    value={`${count} ${count === 1 ? "time" : "times"}`}
                    href={`/people/${person!.id}`}
                  />
                ))
              )}
            </Group>

            <Group
              title="Asked more than once"
              footer="Repeated questions get the same answer in the same words. Consistency is comfort; the pattern is for you."
            >
              {askedMost.length === 0 ? (
                <Row
                  leading={
                    <RowIcon tone="sand" size={40}>
                      <QuestionIcon size={20} />
                    </RowIcon>
                  }
                  title={questions.length ? "No question was repeated" : "No questions this week"}
                  detail={questions.length ? `${questions.length} ${questions.length === 1 ? "question" : "questions"} asked, each once.` : `${who === "you" ? "Tap the phone" : `${patientName} taps the phone`} to ask the glasses something.`}
                />
              ) : (
                askedMost.map(([text, n]) => (
                  <Row
                    key={text}
                    leading={
                      <RowIcon tone="attention" size={40}>
                        <RepeatIcon size={20} />
                      </RowIcon>
                    }
                    title={<>&ldquo;{text}&rdquo;</>}
                    value={`${n} times`}
                    valueTone="attention"
                  />
                ))
              )}
            </Group>
          </div>

          <Group title="When the glasses were busiest" footer="Hours with the most recognitions. Useful for planning visits and reminders.">
            <Row
              leading={
                <RowIcon tone="harbor" size={40}>
                  <ClockIcon size={20} />
                </RowIcon>
              }
              title={hours[busiestHour] ? `Most faces around ${hourLabel(busiestHour)}` : "No recognitions yet"}
              detail={hours[busiestHour] ? `${hours[busiestHour]} ${hours[busiestHour] === 1 ? "recognition" : "recognitions"} in that hour this week.` : "Hours fill in as people are recognized."}
            />
            {days.some((d) => d.spoken) ? (
              <Row
                title={`${days.reduce((n, d) => n + d.spoken, 0)} lines spoken this week`}
                detail={`Every line is also in the moments log. The latest day with speech was ${weekdayShort([...days].reverse().find((d) => d.spoken)!.date)}.`}
                value={<Link href="/">Today</Link>}
              />
            ) : null}
          </Group>

          <p className="m-0 text-[15px] text-ink-mute">
            Times shown in {TIME_ZONE.replace("_", " ")}. Latest moment {events.length ? `at ${formatTime(events[events.length - 1].createdAt)} on ${formatShortDay(events[events.length - 1].createdAt)}` : "none"}.
          </p>
        </>
      )}
    </>
  );
}

/**
 * Single-series bar chart: one hue (harbor), thin marks, rounded tops anchored to the baseline,
 * a 2px gap between bars, labels only on the max. Native tooltips carry the exact value.
 */
function DayBars({ days }: { days: { key: string; date: Date; recognitions: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.recognitions));
  const W = 560;
  const H = 160;
  const pad = { l: 4, r: 4, t: 18, b: 26 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const slot = innerW / days.length;
  const barW = Math.min(36, slot - 8);
  const todayKey = days[days.length - 1].key;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Bar chart of faces recognized each day for the last seven days" className="h-auto w-full">
      <line x1={pad.l} x2={W - pad.r} y1={pad.t + innerH + 0.5} y2={pad.t + innerH + 0.5} stroke="var(--color-line)" />
      {days.map((d, i) => {
        const h = d.recognitions === 0 ? 0 : Math.max(3, (d.recognitions / max) * innerH);
        const x = pad.l + i * slot + (slot - barW) / 2;
        const y = pad.t + innerH - h;
        const isMax = d.recognitions === max && max > 0;
        const today = d.key === todayKey;
        return (
          <g key={d.key}>
            <title>{`${weekdayShort(d.date)} ${formatShortDay(d.date)}: ${d.recognitions} recognized`}</title>
            <rect x={pad.l + i * slot} y={pad.t} width={slot} height={innerH} fill="transparent" />
            {h > 0 ? (
              <path
                d={`M${x} ${pad.t + innerH} V${y + 4} a4 4 0 0 1 4 -4 h${barW - 8} a4 4 0 0 1 4 4 V${pad.t + innerH} Z`}
                fill={today ? "var(--color-harbor)" : "var(--color-harbor-mist-deep)"}
              />
            ) : (
              <rect x={x} y={pad.t + innerH - 2} width={barW} height={2} rx={1} fill="var(--color-sand)" />
            )}
            {isMax ? (
              <text x={x + barW / 2} y={y - 6} textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--color-ink-soft)">
                {d.recognitions}
              </text>
            ) : null}
            <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize="13" fontWeight={today ? 700 : 400} fill={today ? "var(--color-ink)" : "var(--color-ink-mute)"}>
              {today ? "Today" : weekdayShort(d.date)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Stat({ label, value, detail, tone = "sand" }: { label: string; value: string | number; detail: string; tone?: "sand" | "attention" }) {
  const bg = tone === "attention" ? "bg-attention-bg" : "bg-surface";
  return (
    <div className={`flex flex-col gap-1 rounded-md px-5 py-4 ${bg}`}>
      <dt className="text-[15px] text-ink-soft">{label}</dt>
      <dd className="m-0 font-display text-[32px] font-extrabold leading-none tracking-[-0.6px] text-ink">{value}</dd>
      <dd className="m-0 text-[13px] text-ink-mute">{detail}</dd>
    </div>
  );
}
