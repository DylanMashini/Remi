import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Avatar } from "@/components/Avatar";
import { getCare } from "@/components/care";
import { practiceKind } from "@/components/events";
import { formatAgo, formatWhenText } from "@/components/format";
import { CheckIcon, HeartIcon, MemoryIcon, SpeakerIcon } from "@/components/icons";
import { EmptyState, Group, PageHeader, PageSkeleton, Row } from "@/components/ui";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Remember" };

export default function RememberPage() {
  return (
    <Suspense fallback={<PageSkeleton rows={2} />}>
      <Remember />
    </Suspense>
  );
}

async function Remember() {
  const { patientId, patientName, user } = await getCare();
  const self = user.role === "WEARER";
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [visits, memories, people] = await Promise.all([
    prisma.event.findMany({
      where: { patientId, type: "PRACTICE" },
      orderBy: { createdAt: "desc" },
      take: 60,
      include: { person: { select: { id: true, name: true, relationship: true, avatarFileId: true } } },
    }),
    prisma.memory.findMany({
      where: { patientId },
      orderBy: { createdAt: "desc" },
      take: 12,
      include: { person: { select: { id: true, name: true, avatarFileId: true } } },
    }),
    prisma.person.count({ where: { patientId } }),
  ]);

  const onlyVisits = visits.filter((v) => practiceKind(v.data) !== "memory");
  const weekVisits = onlyVisits.filter((v) => v.createdAt >= weekAgo);
  const weekKnew = weekVisits.filter((v) => practiceKind(v.data) === "knew").length;
  const weekMemories = memories.filter((m) => m.createdAt >= weekAgo).length;
  const lastVisit = onlyVisits[0];
  const who = self ? "you" : patientName;

  return (
    <>
      <PageHeader
        title="Remember"
        lead={`The phone's gentle practice tab. It shows ${who} one familiar face at a time and asks whether ${who === "you" ? "you know" : "they know"} who it is. A yes becomes an invitation to share a memory; "tell me" plays the introduction through the glasses. Nothing is scored and no one is corrected. You see the pattern here.`}
      />

      <dl className="m-0 grid gap-4 sm:grid-cols-3">
        <Stat label="Visits this week" value={weekVisits.length} detail={lastVisit ? `Last one ${formatAgo(lastVisit.createdAt, now).toLowerCase()}` : people ? "None yet" : "Add someone first"} />
        <Stat label="Knew right away" value={weekVisits.length ? `${weekKnew} of ${weekVisits.length}` : "—"} detail={weekVisits.length ? "this week" : "no visits yet"} tone="dusk" />
        <Stat label="New memories" value={weekMemories} detail="this week" tone="apricot" />
      </dl>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
        <Group title="Visits" action={<span className="font-normal text-ink-mute">{onlyVisits.length ? `${onlyVisits.length} shown` : ""}</span>}>
          {onlyVisits.length === 0 ? (
            <EmptyState icon={<HeartIcon size={30} />} title="No visits yet">
              Open the Remember tab on the phone {who === "you" ? "" : `with ${patientName} `}and sit together for a few minutes.
            </EmptyState>
          ) : (
            onlyVisits.map((v) => {
              const knew = practiceKind(v.data) === "knew";
              const name = v.person?.name ?? "Someone (removed)";
              return (
                <Row
                  key={v.id}
                  leading={<Avatar name={name} avatarFileId={v.person?.avatarFileId} size={44} />}
                  title={
                    <>
                      <span className="font-bold">{name}</span>
                      {v.person?.relationship ? <span className="text-ink-soft">, {v.person.relationship}</span> : null}
                    </>
                  }
                  detail={
                    <span className={`inline-flex items-center gap-1.5 ${knew ? "font-bold text-dusk-deep" : ""}`}>
                      {knew ? <CheckIcon size={14} /> : <SpeakerIcon size={14} />}
                      {knew ? "Knew right away" : "Heard the introduction"}
                    </span>
                  }
                  value={formatWhenText(v.createdAt, now)}
                  valueTone="mute"
                  href={v.person ? `/people/${v.person.id}` : undefined}
                />
              );
            })
          )}
        </Group>

        <Group title="Newest memories" footer={memories.length ? "Open a person to change a memory's words or switch it off." : undefined}>
          {memories.length === 0 ? (
            <EmptyState icon={<MemoryIcon size={30} />} title="No memories yet">
              When {who === "you" ? "you say" : `${patientName} says`} &ldquo;Yes, I know them&rdquo; and {who === "you" ? "talk" : "talks"} about someone, those words land here and Remi starts saying the newest one.
            </EmptyState>
          ) : (
            memories.map((m) => (
              <div key={m.id} className="flex flex-col gap-2 px-4 py-4">
                <div className="flex items-center gap-2.5">
                  <Avatar name={m.person.name} avatarFileId={m.person.avatarFileId} size={28} />
                  <Link href={`/people/${m.person.id}`} className="text-[15px] font-bold text-ink hover:text-dusk-deep">
                    {m.person.name}
                  </Link>
                  <span className="ml-auto text-[13px] text-ink-mute">{formatAgo(m.createdAt, now)}</span>
                </div>
                <p className={`m-0 font-display text-[18px] font-bold leading-snug tracking-[-0.2px] ${m.useInCallout ? "text-dusk-deep" : "text-ink-soft"}`}>&ldquo;{m.calloutText}&rdquo;</p>
                <span className="flex items-center gap-1.5 text-[13px] text-ink-mute">
                  {m.useInCallout ? <SpeakerIcon size={14} /> : <MemoryIcon size={14} />}
                  {m.useInCallout ? "Switched on" : "Kept, not spoken"}
                </span>
              </div>
            ))
          )}
        </Group>
      </div>
    </>
  );
}

function Stat({ label, value, detail, tone = "sand" }: { label: string; value: string | number; detail: string; tone?: "sand" | "dusk" | "apricot" }) {
  const bg = { sand: "bg-surface", dusk: "bg-dusk-mist", apricot: "bg-apricot-mist" }[tone];
  return (
    <div className={`flex flex-col gap-1 rounded-md px-6 py-5 ${bg}`}>
      <dt className="text-[15px] text-ink-soft">{label}</dt>
      <dd className="m-0 font-display text-[34px] font-extrabold leading-none tracking-[-0.6px] text-ink">{value}</dd>
      <dd className="m-0 text-[13px] text-ink-mute">{detail}</dd>
    </div>
  );
}
