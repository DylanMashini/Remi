import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { removeFamilyMember, revokeInvite, updateAccountName, updatePatientName } from "../actions";
import { getCare } from "@/components/care";
import { formatShortDay } from "@/components/format";
import { GlassesIcon, InsightsIcon, LinkIcon, LockIcon, MemoryIcon, PhoneIcon, ShieldIcon, TrashIcon } from "@/components/icons";
import { InviteFamily } from "@/components/settings/InviteFamily";
import { NameForm } from "@/components/settings/NameForm";
import { PasswordForm } from "@/components/settings/PasswordForm";
import { SignOutButton } from "@/components/SignOutButton";
import { buttonText, Group, iconButtonDanger, PageHeader, PageSkeleton, Row, RowIcon } from "@/components/ui";
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
  const now = new Date();
  const [sessions, caregivers, invites] = await Promise.all([
    prisma.session.count({ where: { userId: user.id, expiresAt: { gt: now } } }),
    prisma.user.findMany({ where: { patientId }, select: { id: true, name: true, email: true, role: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
    prisma.invite.findMany({ where: { patientId, usedAt: null, expiresAt: { gt: now } }, orderBy: { createdAt: "desc" } }),
  ]);

  return (
    <>
      <PageHeader title="Settings" lead="Your account, the person Remi speaks to, and how the phone connects." />

      <Group title="Account" footer={user.emailVerifiedAt ? undefined : "Your email is not verified yet. The link in the welcome email works for 48 hours."}>
        <NameForm action={updateAccountName} id="account-name" label="Your name" defaultValue={user.name} savedText="Saved." />
        <Row title="Email" value={user.email} valueTone="mute" />
        <Row title="Account type" value={self ? "Wearer (set up for yourself)" : "Caregiver"} valueTone="mute" />
        <Row title="Member since" value={formatShortDay(user.createdAt)} valueTone="mute" />
      </Group>

      <Group
        title={self ? "Remi speaks to you" : "The person you care for"}
        footer={`This name is how Remi addresses ${self ? "you" : "them"} and how this dashboard refers to ${self ? "you" : "them"}.`}
      >
        <NameForm
          action={updatePatientName}
          id="patient-name"
          label={self ? "What Remi should call you" : "Their name"}
          defaultValue={patientName}
          hint="A first name is enough."
          savedText="Saved. Remi uses the new name from now on."
        />
      </Group>

      <Group title="Family on this account" footer="Everyone here signs in with their own email and sees the same people, reminders and moments.">
        {caregivers.map((c) => (
          <Row
            key={c.id}
            title={c.id === user.id ? `${c.name} (you)` : c.name}
            detail={c.email}
            value={c.role === "WEARER" ? "Wearer" : "Caregiver"}
            valueTone="mute"
            trailing={
              c.id !== user.id && c.role !== "WEARER" ? (
                <form action={removeFamilyMember.bind(null, c.id)}>
                  <button type="submit" className={iconButtonDanger} aria-label={`Remove ${c.name}'s sign-in`} title="Remove sign-in">
                    <TrashIcon size={18} />
                  </button>
                </form>
              ) : null
            }
          />
        ))}
        {invites.map((i) => (
          <Row
            key={i.id}
            leading={<LinkIcon size={18} className="shrink-0 text-ink-mute" />}
            title={<span className="text-ink-soft">Invite link, not used yet</span>}
            detail={`Works until ${formatShortDay(i.expiresAt)}`}
            trailing={
              <form action={revokeInvite.bind(null, i.id)}>
                <button type="submit" className={buttonText}>
                  Cancel link
                </button>
              </form>
            }
          />
        ))}
        <InviteFamily patientName={self ? "you" : patientName} />
      </Group>

      <Group title="More" footer="Remember, Insights and Privacy also live in the sidebar on a larger screen.">
        <Row leading={<RowIcon tone="apricot" size={40}><MemoryIcon size={20} /></RowIcon>} title="Remember" detail="Gentle practice visits and the memories they produced." href="/remember" />
        <Row leading={<RowIcon tone="dusk" size={40}><InsightsIcon size={20} /></RowIcon>} title="Insights" detail="Who was seen, what was asked, and when." href="/insights" />
        <Row leading={<RowIcon tone="dusk" size={40}><ShieldIcon size={20} /></RowIcon>} title="Privacy" detail="What Remi keeps, and what it never does." href="/privacy" />
      </Group>

      <Group title="The phone and the glasses" footer="Pairing and the camera are managed in the Remi app on the phone; there is nothing to configure here.">
        <Row
          leading={
            <RowIcon tone="dusk" size={44}>
              <PhoneIcon size={22} />
            </RowIcon>
          }
          title="Sign in to the Remi app on the phone"
          detail={`Use ${user.email}. The phone keeps its own sign-in and relays between the glasses and this dashboard.`}
        />
        <Row
          leading={
            <RowIcon tone="dusk" size={44}>
              <GlassesIcon size={22} />
            </RowIcon>
          }
          title="Pair the Ray-Ban Meta glasses on the phone"
          detail="Settings, then Pair glasses. No glasses nearby? The Live tab can use the phone camera with the same voice."
        />
      </Group>

      <Group title="Security" footer={`${sessions} active ${sessions === 1 ? "sign-in" : "sign-ins"} for your account, including this one and any phones. Changing your password signs the others out.`}>
        <PasswordForm />
        <Row
          leading={
            <RowIcon tone="sand" size={44}>
              <LockIcon size={22} />
            </RowIcon>
          }
          title="Forgot it?"
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
