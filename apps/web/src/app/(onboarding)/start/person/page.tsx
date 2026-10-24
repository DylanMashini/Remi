import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Avatar } from "@/components/Avatar";
import { getCare } from "@/components/care";
import { EnrollForm } from "@/components/people/EnrollForm";
import { buttonSecondary, Card, PageHeader, PageSkeleton, Spoken } from "@/components/ui";
import { listPeople } from "@/lib/people";

export const metadata: Metadata = { title: "Add the first person" };

export default function StartPersonPage() {
  return (
    <Suspense fallback={<PageSkeleton rows={1} />}>
      <StartPerson />
    </Suspense>
  );
}

async function StartPerson() {
  const { patientId, patientName, user } = await getCare();
  const self = user.role === "WEARER";
  const people = await listPeople(patientId);
  const who = self ? "you" : patientName;

  return (
    <>
      <PageHeader
        title={people.length ? "Add someone else?" : `Who should the glasses know first?`}
        lead={
          people.length
            ? `${people.length === 1 ? "One person is" : `${people.length} people are`} added. Add another, or continue to reminders.`
            : `Start with the person ${who === "you" ? "you see" : `${patientName} sees`} most. One to three photos and a name is all it takes. The glasses will only ever recognize the people on this list.`
        }
      >
        {people.length ? (
          <Link href="/start/reminder" className={buttonSecondary}>
            Continue
          </Link>
        ) : (
          <Link href="/start/reminder" className="text-[15px] font-bold">
            Skip for now
          </Link>
        )}
      </PageHeader>

      {people.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {people.map((p) => (
            <li key={p.id} className="flex items-center gap-3.5 rounded-md bg-surface px-4 py-3">
              <Avatar name={p.name} avatarFileId={p.avatarUrl?.split("/").pop()} size={44} />
              <div className="flex min-w-0 flex-1 flex-col">
                <strong className="truncate text-[17px]">{p.name}</strong>
                <Spoken size="sm" className="truncate text-[15px]">
                  {p.line}
                </Spoken>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <Card>
        <EnrollForm patientName={patientName} self={self} nextHref="/start/person" />
      </Card>
    </>
  );
}
