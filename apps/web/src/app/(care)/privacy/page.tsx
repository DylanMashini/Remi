import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { clearAllEvents } from "../actions";
import { getCare } from "@/components/care";
import { EyeOffIcon, LockIcon, PeopleIcon, ShieldIcon, TrashIcon } from "@/components/icons";
import { buttonDestructive, Group, PageHeader, PageSkeleton, Row, RowIcon } from "@/components/ui";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <Suspense fallback={<PageSkeleton rows={3} />}>
      <Privacy />
    </Suspense>
  );
}

async function Privacy() {
  const { patientId, patientName, user } = await getCare();
  const self = user.role === "WEARER";
  const [people, photos, events, memories] = await Promise.all([
    prisma.person.count({ where: { patientId } }),
    prisma.file.count({ where: { patientId, kind: "FACE_PHOTO" } }),
    prisma.event.count({ where: { patientId } }),
    prisma.memory.count({ where: { patientId } }),
  ]);
  const who = self ? "you" : patientName;

  return (
    <>
      <PageHeader
        title="Privacy"
        lead="These are built in, not settings. They cannot be turned off, and this page shows exactly what Remi keeps so you can check it yourself."
      />

      <Group title="How recognition works">
        <Row
          leading={
            <RowIcon tone="dusk" size={44}>
              <PeopleIcon size={22} />
            </RowIcon>
          }
          title="Only the people you add are recognized"
          detail={`Faces are compared against ${people === 0 ? "the people on the roster" : people === 1 ? "the one person on the roster" : `the ${people} people on the roster`}, and no one else. There is no search of strangers. An unknown face is announced as “Someone new is here” and no name is ever guessed.`}
          href="/people"
        />
        <Row
          leading={
            <RowIcon tone="dusk" size={44}>
              <EyeOffIcon size={22} />
            </RowIcon>
          }
          title="Camera frames are never stored"
          detail="Each frame from the glasses is matched on the phone, against the family's roster only, and discarded there. No frame leaves the phone; the server only ever learns who was recognized and when. There is no video, no gallery, and no live feed for caregivers to watch. Only moments (who, when, what was said) are kept."
        />
        <Row
          leading={
            <RowIcon tone="dusk" size={44}>
              <TrashIcon size={22} />
            </RowIcon>
          }
          title="You can delete any moment"
          detail="Every row on Today has a bin. Deleting is permanent and happens right away. Removing a person deletes their photos, face data and memories; their past moments stay without a name."
          href="/"
        />
      </Group>

      <Group title={`What Remi keeps for ${who === "you" ? "you" : patientName}`} footer="Counts are live. Nothing else is stored: no frames, no audio recordings, no location.">
        <Row title="People on the roster" value={String(people)} valueTone="mute" href="/people" />
        <Row
          title="Enrollment photos"
          detail="Re-encoded on upload so camera metadata, including location, is stripped. Served only to signed-in family through an authenticated route."
          value={String(photos)}
          valueTone="mute"
        />
        <Row title="Memories" detail="Kept in the speaker's own words, plus the one sentence Remi may say." value={String(memories)} valueTone="mute" href="/remember" />
        <Row
          title="Moments in the log"
          detail="Recognitions, questions, answers, reminders and every spoken line, each with a timestamp. Also short ambient transcripts of nearby conversation, kept so Remi can answer “What were we talking about?”; the audio itself is not kept."
          value={String(events)}
          valueTone="mute"
          href="/insights"
        />
      </Group>

      <Group title="Voice and conversation">
        <Row
          leading={
            <RowIcon tone="dusk" size={44}>
              <ShieldIcon size={22} />
            </RowIcon>
          }
          title="Questions are answered from the day's moments"
          detail={`When ${who === "you" ? "you ask" : `${patientName} asks`} “What were we talking about?”, the answer is built from the last few minutes of transcript and today's moments, then spoken once. The audio clip is transcribed and not kept.`}
        />
        <Row
          leading={
            <RowIcon tone="dusk" size={44}>
              <LockIcon size={22} />
            </RowIcon>
          }
          title="Accounts"
          detail="Passwords are hashed. Sign-in tokens are stored only as hashes, on this server. Signing out on any device ends that device's session."
          href="/settings"
        />
      </Group>

      <Group title="Clear the log" footer="Removes every moment for this account. People, their photos, memories, and reminders stay.">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
          <span className="text-[17px]">
            {events === 0 ? "The log is empty." : `${events} ${events === 1 ? "moment" : "moments"} in the log.`}
          </span>
          {events > 0 ? (
            <form action={clearAllEvents}>
              <button type="submit" className={buttonDestructive}>
                <TrashIcon size={18} />
                Delete all moments
              </button>
            </form>
          ) : null}
        </div>
      </Group>

      <p className="m-0 text-[15px] text-ink-mute">
        Questions about any of this? The same promises are shown on the phone under Settings, so {who === "you" ? "you" : patientName} and your family see the same words. <Link href="/settings">Account settings</Link>
      </p>
    </>
  );
}
