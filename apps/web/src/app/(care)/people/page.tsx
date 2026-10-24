import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Avatar, fileIdFromUrl } from "@/components/Avatar";
import { getCare } from "@/components/care";
import { capitalize, formatWhenText } from "@/components/format";
import { PeopleIcon, PlusIcon } from "@/components/icons";
import { HearPreview } from "@/components/people/HearPreview";
import { buttonPrimary, EmptyState, PageHeader, PageSkeleton, Spoken } from "@/components/ui";
import { listPeople } from "@/lib/people";

export const metadata: Metadata = { title: "People" };

export default function PeoplePage() {
  return (
    <Suspense fallback={<PageSkeleton rows={2} />}>
      <People />
    </Suspense>
  );
}

async function People() {
  const { patientId, patientName, user } = await getCare();
  const self = user.role === "WEARER";
  const now = new Date();
  const people = await listPeople(patientId);
  const who = self ? "you" : patientName;

  return (
    <>
      <PageHeader
        title="People"
        lead={
          people.length
            ? `Recall recognizes ${people.length === 1 ? "one person" : `these ${people.length} people`}, and no one else. Open someone to change what the glasses say about them.`
            : `The people ${who === "you" ? "you see" : `${patientName} sees`} most. The glasses only recognize who is on this list.`
        }
      >
        <Link href="/people/new" className={buttonPrimary}>
          <PlusIcon size={18} />
          Add a person
        </Link>
      </PageHeader>

      {people.length === 0 ? (
        <div className="rounded-md bg-surface">
          <EmptyState
            icon={<PeopleIcon size={30} />}
            title="No one yet"
            action={
              <Link href="/people/new" className={buttonPrimary}>
                <PlusIcon size={18} />
                Add a person
              </Link>
            }
          >
            Add the people {who === "you" ? "you see" : `${patientName} sees`} most. One to three photos and a name is all it takes.
          </EmptyState>
        </div>
      ) : (
        <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2">
          {people.map((p) => (
            <li key={p.id} className="flex flex-col overflow-hidden rounded-md bg-surface">
              <Link href={`/people/${p.id}`} className="flex items-center gap-4 p-5 text-ink no-underline hover:bg-linen hover:text-ink">
                <Avatar name={p.name} avatarFileId={fileIdFromUrl(p.avatarUrl)} size={64} />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <strong className="truncate font-display text-[22px] tracking-[-0.3px]">{p.name}</strong>
                  <span className="text-[15px] text-ink-soft">{p.relationship ? capitalize(p.relationship) : "No relationship set"}</span>
                  <span className="text-[13px] text-ink-mute">
                    {p.lastSeenAt ? `Seen ${formatWhenText(p.lastSeenAt, now).replace(/^\w/, (c) => c.toLowerCase())}` : "Not seen yet"}
                    {p.memoryCount ? ` · ${p.memoryCount} ${p.memoryCount === 1 ? "memory" : "memories"}` : ""}
                  </span>
                </div>
              </Link>
              <div className="flex items-start gap-3 border-t border-hairline bg-harbor-mist/60 px-5 py-4">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-[13px] font-bold text-harbor-deep">{who === "you" ? "You hear" : `${patientName} hears`}</span>
                  <Spoken size="sm">{p.line}</Spoken>
                </div>
                <HearPreview text={p.line} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
