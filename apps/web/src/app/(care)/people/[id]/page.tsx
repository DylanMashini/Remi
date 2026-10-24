import Link from "next/link";
import { Suspense } from "react";
import { Avatar } from "@/components/Avatar";
import { getCare } from "@/components/care";
import { capitalize, formatAgo, formatWhen } from "@/components/format";
import { ArrowLeftIcon, CheckIcon, MemoryIcon, SpeakerIcon } from "@/components/icons";
import { AddMemoryForm } from "@/components/people/AddMemoryForm";
import { CalloutEditor } from "@/components/people/CalloutEditor";
import { DeletePersonButton } from "@/components/people/DeletePersonButton";
import { HearPreview } from "@/components/people/HearPreview";
import { MemoryItem } from "@/components/people/MemoryItem";
import { Card, CardTitle, Skeleton } from "@/components/ui";
import { getPerson } from "@/lib/people";

export default function PersonPage({ params }: PageProps<"/people/[id]">) {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-7">
          <Skeleton className="h-28 w-2/3" />
          <Skeleton className="h-64" />
          <Skeleton className="h-96" />
        </div>
      }
    >
      <Person params={params} />
    </Suspense>
  );
}

async function Person({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { patientId, patientName } = await getCare();
  const person = await getPerson(patientId, id);
  if (!person) {
    return (
      <div className="flex flex-col gap-5">
        <Link href="/people" className="inline-flex w-fit items-center gap-1.5 text-[15px] font-bold no-underline">
          <ArrowLeftIcon size={16} />
          People
        </Link>
        <Card>
          <CardTitle>This person is no longer in the roster</CardTitle>
          <p className="m-0 text-ink-soft">They may have been removed on the phone. Past moments stay in the log without a name.</p>
        </Card>
      </div>
    );
  }
  const now = new Date();
  const spoken = person.memories.filter((m) => m.useInCallout);
  const knew = person.visits.filter((v) => v.knew).length;

  return (
    <>
      <div className="flex flex-col gap-5">
        <Link href="/people" className="inline-flex w-fit items-center gap-1.5 text-[15px] font-bold no-underline">
          <ArrowLeftIcon size={16} />
          People
        </Link>
        <header className="flex flex-wrap items-center gap-5">
          <Avatar name={person.name} avatarFileId={person.avatarUrl?.split("/").pop()} size={88} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h1 className="m-0 font-display text-[32px] font-extrabold leading-tight sm:text-4xl">{person.name}</h1>
            <span className="text-[17px] text-ink-soft">
              {person.relationship ? `${patientName}'s ${person.relationship}` : "Relationship not set"}
              {person.lastSeenAt ? `. Seen ${formatWhen(person.lastSeenAt, now)}.` : ". Not seen yet."}
            </span>
          </div>
          <DeletePersonButton id={person.id} name={person.name} />
        </header>
      </div>

      <section className="flex flex-col gap-3 rounded-[24px] bg-harbor-mist p-5 sm:p-7">
        <div className="flex items-center gap-2 text-[15px] font-bold text-harbor-deep">
          <SpeakerIcon size={18} />
          What the glasses say when {person.name} walks up
        </div>
        <p className="m-0 font-display text-[22px] font-bold leading-snug text-ink sm:text-[26px]">&ldquo;{person.line}&rdquo;</p>
        <div className="flex flex-wrap items-center gap-3 text-sm text-ink-soft">
          <HearPreview text={person.line} />
          <span>
            Name, relationship, your note, then the newest memory marked &ldquo;say this&rdquo;. Change any part below and the
            glasses change with it.
          </span>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardTitle>Introduction</CardTitle>
          <p className="m-0 text-ink-soft">The first part of the line. Keep the note to one warm sentence.</p>
          <CalloutEditor person={person} patientName={patientName} />
        </Card>

        <Card>
          <CardTitle action={<span className="text-sm text-ink-soft">{person.visits.length} visits</span>}>
            Remember visits
          </CardTitle>
          {person.visits.length === 0 ? (
            <p className="m-0 text-ink-soft">
              {patientName} has not visited with {person.name} in Remember yet. The Remember tab on the phone shows one
              face at a time and asks, gently, whether they know who it is.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-3 rounded-2xl bg-linen px-4 py-3.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-sm bg-apricot-mist text-apricot-deep">
                  <CheckIcon size={20} />
                </div>
                <span className="text-[15px]">
                  Knew {person.name} right away <strong>{knew}</strong> of <strong>{person.visits.length}</strong> times.
                  {knew < person.visits.length
                    ? " When unsure, they were told the line above. Never corrected."
                    : " Every time."}
                </span>
              </div>
              <ul className="m-0 flex list-none flex-col p-0">
                {person.visits.slice(0, 10).map((v, i) => (
                  <li
                    key={v.id}
                    className={`flex items-center justify-between gap-3 py-2.5 text-[15px] ${i < Math.min(person.visits.length, 10) - 1 ? "border-b border-sand" : ""}`}
                  >
                    <span className={v.knew ? "font-bold text-harbor-deep" : "text-ink"}>
                      {v.knew ? "Knew right away" : "Was reminded"}
                    </span>
                    <span className="text-ink-soft">{formatAgo(v.at, now)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      <Card>
        <CardTitle
          action={
            <span className="text-sm text-ink-soft">
              {spoken.length} of {person.memories.length} spoken
            </span>
          }
        >
          Memories
        </CardTitle>
        <p className="m-0 text-ink-soft">
          Things {patientName} said about {person.name} during Remember, in their own words, plus anything you add. Each
          one is distilled into a sentence the glasses can say. The newest one marked &ldquo;say this&rdquo; is spoken.
        </p>
        {person.memories.length === 0 ? (
          <div className="flex items-center gap-3.5 rounded-2xl bg-linen px-5 py-5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm bg-apricot-mist text-apricot-deep">
              <MemoryIcon size={22} />
            </div>
            <span className="text-[15px] text-ink-soft">
              No memories yet. They arrive when {patientName} says &ldquo;Yes, I know them&rdquo; in Remember and talks about{" "}
              {person.name}. You can add one below.
            </span>
          </div>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {person.memories.map((m) => (
              <MemoryItem key={m.id} memory={m} patientName={patientName} now={now.toISOString()} />
            ))}
          </ul>
        )}
        <div className="border-t border-sand pt-5">
          <h3 className="m-0 mb-3 text-[17px] font-bold">Add a memory</h3>
          <AddMemoryForm personId={person.id} personName={person.name} />
        </div>
      </Card>

      <p className="m-0 text-sm text-ink-soft">
        {person.samples} enrollment {person.samples === 1 ? "photo" : "photos"}. {capitalize(person.name)}&apos;s photos stay
        private to your family and are only matched against people on this list.
      </p>
    </>
  );
}
