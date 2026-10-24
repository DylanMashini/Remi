import Link from "next/link";
import { Suspense } from "react";
import { Avatar } from "@/components/Avatar";
import { getCare } from "@/components/care";
import { capitalize, formatWhen } from "@/components/format";
import { ChevronRightIcon, SpeakerIcon } from "@/components/icons";
import { EnrollForm } from "@/components/people/EnrollForm";
import { HearPreview } from "@/components/people/HearPreview";
import { Card, CardTitle, PageHeader, Skeleton } from "@/components/ui";
import { listPeople } from "@/lib/people";

export default function PeoplePage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-7">
          <Skeleton className="h-16 w-1/2" />
          <Skeleton className="h-72" />
          <Skeleton className="h-96" />
        </div>
      }
    >
      <People />
    </Suspense>
  );
}

async function People() {
  const { patientId, patientName } = await getCare();
  const now = new Date();
  const people = await listPeople(patientId);

  return (
    <>
      <PageHeader eyebrow="PEOPLE" title={`Who ${patientName} knows`} />

      <Card>
        <CardTitle action={<span className="text-sm text-ink-soft">{people.length} enrolled</span>}>
          Roster
        </CardTitle>
        {people.length === 0 ? (
          <p className="m-0 text-ink-soft">
            No one yet. Enroll family and friends below, and the glasses will introduce them when they walk up.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {people.map((p, i) => (
              <li key={p.id} className={`flex flex-col gap-3 py-4 ${i < people.length - 1 ? "border-b border-sand" : ""}`}>
                <Link
                  href={`/people/${p.id}`}
                  className="-mx-3 flex items-center gap-3.5 rounded-[14px] px-3 py-1.5 text-ink no-underline hover:bg-linen hover:text-ink"
                >
                  <Avatar name={p.name} avatarFileId={p.avatarUrl?.split("/").pop()} size={52} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <strong className="truncate text-[17px]">{p.name}</strong>
                    <span className="text-sm text-ink-soft">
                      {[
                        p.relationship ? capitalize(p.relationship) : null,
                        `${p.memoryCount} ${p.memoryCount === 1 ? "memory" : "memories"}`,
                        p.lastSeenAt ? `Seen ${formatWhen(p.lastSeenAt, now)}` : "Not seen yet",
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  </div>
                  <ChevronRightIcon size={18} className="shrink-0 text-ink-soft" />
                </Link>
                <div className="flex items-center gap-3 rounded-sm bg-linen px-3.5 py-2.5 sm:ml-[66px]">
                  <SpeakerIcon size={16} className="shrink-0 text-harbor" />
                  <span className="min-w-0 flex-1 text-[15px]">
                    <span className="text-ink-soft">{patientName} hears: </span>
                    <span className="font-bold text-harbor-deep">&ldquo;{p.line}&rdquo;</span>
                  </span>
                  <HearPreview text={p.line} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <div id="enroll" className="scroll-mt-24" />
        <CardTitle>Enroll someone</CardTitle>
        <p className="m-0 text-ink-soft">
          The glasses introduce people by name, then relationship, then your note, then the newest memory {patientName}{" "}
          shared about them. Faces are matched only against the people you enroll here.
        </p>
        <EnrollForm patientName={patientName} />
      </Card>
    </>
  );
}
