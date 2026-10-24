import Link from "next/link";
import { Suspense } from "react";
import { Avatar } from "@/components/Avatar";
import { getCare } from "@/components/care";
import { practiceKind } from "@/components/events";
import { formatAgo, formatWhen } from "@/components/format";
import { CheckIcon, MemoryIcon, SpeakerIcon } from "@/components/icons";
import { Card, CardTitle, PageHeader, Skeleton } from "@/components/ui";
import { prisma } from "@/lib/prisma";

export default function RememberPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-7">
          <Skeleton className="h-16 w-1/2" />
          <div className="grid gap-6 md:grid-cols-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
          <Skeleton className="h-96" />
        </div>
      }
    >
      <Remember />
    </Suspense>
  );
}

async function Remember() {
  const { patientId, patientName } = await getCare();
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

  return (
    <>
      <PageHeader eyebrow="REMEMBER" title={`${patientName} and the people they know`} />

      <p className="m-0 max-w-[70ch] text-[17px] text-ink-soft">
        Remember is the phone&apos;s gentle practice tab. It shows {patientName} one familiar face at a time and asks whether they
        know who it is. A yes becomes an invitation to share a memory; a &ldquo;tell me&rdquo; plays the introduction through the
        glasses. Nothing is scored and no one is corrected. You see the pattern here.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Visits this week"
          value={weekVisits.length}
          detail={lastVisit ? `Last ${formatAgo(lastVisit.createdAt, now)}` : people ? "None yet" : "Enroll someone first"}
        />
        <Stat
          label="Knew right away"
          value={weekVisits.length ? `${weekKnew} of ${weekVisits.length}` : "—"}
          detail={weekVisits.length ? "this week" : "no visits yet"}
          tone="harbor"
        />
        <Stat label="New memories" value={weekMemories} detail="this week" tone="apricot" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
        <Card>
          <CardTitle action={<span className="text-sm text-ink-soft">{onlyVisits.length} shown</span>}>Visits</CardTitle>
          {onlyVisits.length === 0 ? (
            <p className="m-0 text-ink-soft">
              No visits yet. Open the Remember tab on the phone with {patientName} and sit together for a few minutes.
            </p>
          ) : (
            <ol className="m-0 flex list-none flex-col p-0">
              {onlyVisits.map((v, i) => {
                const knew = practiceKind(v.data) === "knew";
                const name = v.person?.name ?? "Someone (removed)";
                return (
                  <li key={v.id} className={`flex items-center gap-3.5 py-3 ${i < onlyVisits.length - 1 ? "border-b border-sand" : ""}`}>
                    <Avatar name={name} avatarFileId={v.person?.avatarFileId} size={44} />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-[15px]">
                        {v.person ? (
                          <Link href={`/people/${v.person.id}`} className="font-bold text-ink no-underline hover:text-harbor-deep">
                            {name}
                          </Link>
                        ) : (
                          <strong>{name}</strong>
                        )}
                        {v.person?.relationship ? <span className="text-ink-soft">, {v.person.relationship}</span> : null}
                      </span>
                      <span className={`flex items-center gap-1.5 text-sm ${knew ? "font-bold text-harbor-deep" : "text-ink-soft"}`}>
                        {knew ? <CheckIcon size={14} /> : <SpeakerIcon size={14} />}
                        {knew ? "Knew right away" : "Heard the introduction"}
                      </span>
                    </div>
                    <span className="shrink-0 text-sm text-ink-soft">{formatWhen(v.createdAt, now)}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>

        <Card>
          <CardTitle>Newest memories</CardTitle>
          {memories.length === 0 ? (
            <p className="m-0 text-ink-soft">
              When {patientName} says &ldquo;Yes, I know them&rdquo; and talks about someone, their words land here and the
              glasses start saying the newest one.
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {memories.map((m) => (
                <li key={m.id} className={`flex flex-col gap-2 rounded-2xl p-4 ${m.useInCallout ? "bg-apricot-mist" : "bg-linen"}`}>
                  <div className="flex items-center gap-2.5">
                    <Avatar name={m.person.name} avatarFileId={m.person.avatarFileId} size={28} />
                    <Link href={`/people/${m.person.id}`} className="text-[15px] font-bold text-ink no-underline hover:text-harbor-deep">
                      {m.person.name}
                    </Link>
                    <span className="ml-auto text-sm text-ink-soft">{formatAgo(m.createdAt, now)}</span>
                  </div>
                  <p className="m-0 font-display text-[17px] font-bold leading-snug">&ldquo;{m.calloutText}&rdquo;</p>
                  <span className="flex items-center gap-1.5 text-sm text-ink-soft">
                    {m.useInCallout ? <SpeakerIcon size={14} /> : <MemoryIcon size={14} />}
                    {m.useInCallout ? "Spoken by the glasses" : "Kept, not spoken"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function Stat({ label, value, detail, tone = "sand" }: { label: string; value: string | number; detail: string; tone?: "sand" | "harbor" | "apricot" }) {
  const bg = { sand: "bg-surface", harbor: "bg-harbor-mist", apricot: "bg-apricot-mist" }[tone];
  return (
    <div className={`flex flex-col gap-1 rounded-[24px] px-6 py-5 ${bg}`}>
      <span className="text-[15px] text-ink-soft">{label}</span>
      <span className="font-display text-[34px] font-extrabold leading-none text-ink">{value}</span>
      <span className="text-sm text-ink-soft">{detail}</span>
    </div>
  );
}
