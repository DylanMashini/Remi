import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getCare } from "@/components/care";
import { BellIcon, CheckIcon, GlassesIcon, PeopleIcon, PhoneIcon, ShieldIcon } from "@/components/icons";
import { buttonLarge, Group, PageHeader, PageSkeleton, Row, RowIcon } from "@/components/ui";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "You are set up" };

export default function StartDonePage() {
  return (
    <Suspense fallback={<PageSkeleton rows={2} />}>
      <StartDone />
    </Suspense>
  );
}

async function StartDone() {
  const { patientId, patientName, user } = await getCare();
  const self = user.role === "WEARER";
  const [people, reminders] = await Promise.all([
    prisma.person.count({ where: { patientId } }),
    prisma.reminder.count({ where: { patientId, firedAt: null } }),
  ]);
  const who = self ? "you" : patientName;

  return (
    <>
      <PageHeader
        title="Remi is ready for the phone"
        lead={`Everything you add here reaches the glasses through the Remi app on ${who === "you" ? "your" : `${patientName}'s`} phone. Sign in there with the same email and password.`}
      />

      <Group title="What is set up">
        <Row
          leading={
            <RowIcon tone={people ? "dusk" : "sand"}>
              <PeopleIcon size={18} />
            </RowIcon>
          }
          title={people === 0 ? "No one added yet" : people === 1 ? "1 person Remi will recognize" : `${people} people Remi will recognize`}
          detail={people === 0 ? "Without anyone on the list, Remi can only say “Someone new is here.”" : "Each one is introduced by name, relationship, and your note."}
          href={people === 0 ? "/start/person" : "/people"}
        />
        <Row
          leading={
            <RowIcon tone={reminders ? "dusk" : "sand"}>
              <BellIcon size={18} />
            </RowIcon>
          }
          title={reminders === 0 ? "No reminders yet" : reminders === 1 ? "1 reminder scheduled" : `${reminders} reminders scheduled`}
          detail="Spoken once, at the time you chose."
          href={reminders === 0 ? "/start/reminder" : "/reminders"}
        />
      </Group>

      <Group title="On the phone" footer="The phone relays between the glasses and this dashboard. Everything Remi says also appears here, on Today.">
        <Row
          leading={
            <RowIcon tone="dusk">
              <PhoneIcon size={18} />
            </RowIcon>
          }
          title="Open Remi on the phone and sign in"
          detail={`Use ${user.email}. The phone keeps the sign-in; ${who === "you" ? "you" : patientName} never touch${who === "you" ? "" : "es"} a screen after that.`}
        />
        <Row
          leading={
            <RowIcon tone="dusk">
              <GlassesIcon size={18} />
            </RowIcon>
          }
          title="Pair the Ray-Ban Meta glasses"
          detail="Settings, then Pair glasses. Pairing opens the Meta AI app once; Developer Mode must be on there."
        />
        <Row
          leading={
            <RowIcon tone="dusk">
              <CheckIcon size={18} />
            </RowIcon>
          }
          title="Start the glasses from the Live tab"
          detail="No glasses nearby? The Live tab can use the phone camera instead, with the same voice."
        />
      </Group>

      <Group title="Built in, not settings">
        <Row
          leading={
            <RowIcon tone="dusk">
              <ShieldIcon size={18} />
            </RowIcon>
          }
          title="Only the people you add are recognized"
          detail="No search of strangers. Camera frames are matched in memory and discarded. You can delete any moment."
          href="/privacy"
        />
      </Group>

      <div>
        <Link href="/" className={buttonLarge}>
          Go to Today
        </Link>
      </div>
    </>
  );
}
