import Link from "next/link";
import { Suspense } from "react";
import { Avatar, fileIdFromUrl } from "@/components/Avatar";
import { getCare } from "@/components/care";
import { capitalize, formatAgo, formatWhenText } from "@/components/format";
import { ArrowLeftIcon, CheckIcon, HeartIcon, LockIcon, MemoryIcon, SpeakerIcon } from "@/components/icons";
import { AddMemoryForm } from "@/components/people/AddMemoryForm";
import { CalloutEditor } from "@/components/people/CalloutEditor";
import { DeletePersonButton } from "@/components/people/DeletePersonButton";
import { MemoryItem } from "@/components/people/MemoryItem";
import { Card, CardTitle, EmptyState, Group, PageSkeleton, Row, RowIcon } from "@/components/ui";
import { getPerson } from "@/lib/people";

export default function PersonPage({ params }: PageProps<"/people/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton rows={3} />}>
      <Person params={params} />
    </Suspense>
  );
}

async function Person({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { patientId, patientName, user } = await getCare();
  const self = user.role === "WEARER";
  const person = await getPerson(patientId, id);
  const back = (
    <Link href="/people" className="inline-flex w-fit items-center gap-1.5 text-[15px] font-bold">
      <ArrowLeftIcon size={16} />
      People
    </Link>
  );
  if (!person) {
    return (
      <div className="flex flex-col gap-5">
        {back}
        <Card>
          <CardTitle>This person is no longer in the roster</CardTitle>
          <p className="m-0 text-ink-soft">They may have been removed on the phone. Past moments stay in the log without a name.</p>
        </Card>
      </div>
    );
  }
  const now = new Date();
  const first = person.name.split(" ")[0];
  const spoken = person.memories.filter((m) => m.useInCallout);
  const newestSpokenId = spoken[0]?.id;
  const knew = person.visits.filter((v) => v.knew).length;
  const who = self ? "you" : patientName;

  return (
    <>
      <div className="flex flex-col gap-5">
        {back}
        <header className="flex flex-wrap items-center gap-5">
          <Avatar name={person.name} avatarFileId={fileIdFromUrl(person.avatarUrl)} size={96} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h1 className="m-0 font-display text-[32px] font-extrabold leading-tight tracking-[-0.6px] sm:text-[38px]">{person.name}</h1>
            <span className="text-[17px] text-ink-soft">
              {person.relationship ? (self ? `Your ${person.relationship}` : `${patientName}'s ${person.relationship}`) : "Relationship not set"}
              {person.lastSeenAt ? `. Seen ${formatWhenText(person.lastSeenAt, now).replace(/^\w/, (c) => c.toLowerCase())}.` : ". Not seen by the glasses yet."}
            </span>
          </div>
        </header>
      </div>

      <CalloutEditor person={person} patientName={patientName} self={self} />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Group
          title="Memories"
          action={<span className="font-normal text-ink-mute">{person.memories.length ? `${spoken.length} of ${person.memories.length} switched on` : ""}</span>}
          footer={
            person.memories.length
              ? "Switched on means the glasses can say it. The newest one that is on is spoken after the introduction. The pencil changes the words."
              : undefined
          }
        >
          {person.memories.length === 0 ? (
            <EmptyState icon={<MemoryIcon size={30} />} title="No memories yet">
              They arrive when {who === "you" ? "you say" : `${patientName} says`} &ldquo;Yes, I know them&rdquo; in Remember and {who === "you" ? "talk" : "talks"} about {first}. You can also add one below.
            </EmptyState>
          ) : (
            <ul className="hairline-rows m-0 list-none p-0">
              {person.memories.map((m) => (
                <MemoryItem key={m.id} memory={m} patientName={patientName} now={now.toISOString()} newestSpoken={m.id === newestSpokenId} />
              ))}
            </ul>
          )}
          <div className="bg-linen/60 px-4 py-5 sm:px-5">
            <AddMemoryForm personId={person.id} personName={person.name} />
          </div>
        </Group>

        <div className="flex flex-col gap-8">
          <Group
            title="Remember visits"
            action={<span className="font-normal text-ink-mute">{person.visits.length ? `${person.visits.length} total` : ""}</span>}
            footer={person.visits.length ? "Never scored, never corrected. When unsure, they heard the introduction above." : undefined}
          >
            {person.visits.length === 0 ? (
              <Row
                leading={
                  <RowIcon tone="apricot" size={40}>
                    <HeartIcon size={20} />
                  </RowIcon>
                }
                title="No visits yet"
                detail={`The phone's Remember tab shows ${who === "you" ? "you" : patientName} one face at a time and asks, gently, whether ${who === "you" ? "you know" : "they know"} who it is.`}
              />
            ) : (
              <>
                <Row
                  leading={
                    <RowIcon tone="apricot" size={40}>
                      <HeartIcon size={20} />
                    </RowIcon>
                  }
                  title={`Knew ${first} right away ${knew} of ${person.visits.length} ${person.visits.length === 1 ? "time" : "times"}`}
                  detail={knew === person.visits.length ? "Every time." : `Was reminded ${person.visits.length - knew} ${person.visits.length - knew === 1 ? "time" : "times"}.`}
                />
                {person.visits.slice(0, 8).map((v) => (
                  <Row
                    key={v.id}
                    leading={v.knew ? <CheckIcon size={18} className="shrink-0 text-harbor-deep" /> : <SpeakerIcon size={18} className="shrink-0 text-ink-mute" />}
                    title={<span className={v.knew ? "font-bold text-harbor-deep" : ""}>{v.knew ? "Knew right away" : "Heard the introduction"}</span>}
                    value={formatAgo(v.at, now)}
                    valueTone="mute"
                  />
                ))}
              </>
            )}
          </Group>

          <Group title="Photos and privacy">
            <Row
              leading={
                <RowIcon tone="harbor" size={40}>
                  <LockIcon size={20} />
                </RowIcon>
              }
              title={`${person.samples} enrollment ${person.samples === 1 ? "photo" : "photos"}`}
              detail={`${capitalize(first)}'s photos stay private to your family and are only used to recognize ${first}. Removing ${first} deletes them.`}
            />
            <div className="px-4 py-4">
              <DeletePersonButton id={person.id} name={person.name} />
            </div>
          </Group>
        </div>
      </div>
    </>
  );
}
