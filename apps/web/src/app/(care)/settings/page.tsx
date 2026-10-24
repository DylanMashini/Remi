import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { updateAccountName, updatePatientName } from "../actions";
import { getCare } from "@/components/care";
import { formatShortDay } from "@/components/format";
import { GlassesIcon, LockIcon, PhoneIcon } from "@/components/icons";
import { NameForm } from "@/components/settings/NameForm";
import { SignOutButton } from "@/components/SignOutButton";
import { Group, PageHeader, PageSkeleton, Row, RowIcon } from "@/components/ui";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton rows={3} />}>
      <Settings />
    </Suspense>
  );
}

async function Settings() {
  const { patientId, patientName, user } = await getCare();
  const self = user.role === "WEARER";
  const [sessions, caregivers] = await Promise.all([
    prisma.session.count({ where: { userId: user.id, expiresAt: { gt: new Date() } } }),
    prisma.user.findMany({ where: { patientId }, select: { id: true, name: true, email: true, role: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
  ]);

  return (
    <>
      <PageHeader title="Settings" lead="Your account, the person the glasses speak to, and how the phone connects." />

      <Group title="Account" footer={user.emailVerifiedAt ? undefined : "Your email is not verified yet. The link in the welcome email works for 48 hours."}>
        <NameForm action={updateAccountName} id="account-name" label="Your name" defaultValue={user.name} savedText="Saved." />
        <Row title="Email" value={user.email} valueTone="mute" />
        <Row title="Account type" value={self ? "Wearer (set up for yourself)" : "Caregiver"} valueTone="mute" />
        <Row title="Member since" value={formatShortDay(user.createdAt)} valueTone="mute" />
      </Group>

      <Group
        title={self ? "The glasses speak to you" : "The person you care for"}
        footer={`This name is how the glasses address ${self ? "you" : "them"} and how this dashboard refers to ${self ? "you" : "them"}.`}
      >
        <NameForm
          action={updatePatientName}
          id="patient-name"
          label={self ? "What the glasses should call you" : "Their name"}
          defaultValue={patientName}
          hint="A first name is enough."
          savedText="Saved. The glasses use the new name from now on."
        />
      </Group>

      <Group title="Family on this account" footer="Everyone here signs in with their own email and sees the same roster, reminders and moments.">
        {caregivers.map((c) => (
          <Row
            key={c.id}
            title={c.id === user.id ? `${c.name} (you)` : c.name}
            detail={c.email}
            value={c.role === "WEARER" ? "Wearer" : "Caregiver"}
            valueTone="mute"
          />
        ))}
      </Group>

      <Group title="The phone and the glasses" footer="Pairing and the camera are managed in the Recall app on the phone; there is nothing to configure here.">
        <Row
          leading={
            <RowIcon tone="harbor" size={44}>
              <PhoneIcon size={22} />
            </RowIcon>
          }
          title="Sign in to the Recall app on the phone"
          detail={`Use ${user.email}. The phone keeps its own sign-in and relays between the glasses and this dashboard.`}
        />
        <Row
          leading={
            <RowIcon tone="harbor" size={44}>
              <GlassesIcon size={22} />
            </RowIcon>
          }
          title="Pair the Ray-Ban Meta glasses on the phone"
          detail="Settings, then Pair glasses. No glasses nearby? The Live tab can use the phone camera with the same voice."
        />
      </Group>

      <Group title="Security" footer={`${sessions} active ${sessions === 1 ? "sign-in" : "sign-ins"} for your account, including this one and any phones. Changing your password signs the others out.`}>
        <Row
          leading={
            <RowIcon tone="sand" size={44}>
              <LockIcon size={22} />
            </RowIcon>
          }
          title="Change password"
          detail="We email you a link that works for 30 minutes."
          value={<Link href="/forgot">Send link</Link>}
        />
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
          <span className="text-[17px]">Sign out of this browser</span>
          <SignOutButton />
        </div>
      </Group>
    </>
  );
}
