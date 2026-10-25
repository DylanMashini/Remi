import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AuthHeading } from "../_components/heading";
import { JoinForm } from "../_components/forms";
import { Notice, Skeleton } from "@/components/ui";
import { findInvite } from "@/lib/invites";

export const metadata: Metadata = { title: "Join the family" };

export default function JoinPage({ searchParams }: PageProps<"/join">) {
  return (
    <Suspense fallback={<Skeleton className="h-80" />}>
      <Join searchParams={searchParams} />
    </Suspense>
  );
}

async function Join({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token } = await searchParams;
  const raw = typeof token === "string" ? token : "";
  const invite = await findInvite(raw);

  if (!invite) {
    return (
      <>
        <AuthHeading title="This invite is no longer open" />
        <div className="flex flex-col gap-5">
          <Notice tone="attention">Invite links work once and for seven days. Ask the person who sent it to make a new one.</Notice>
          <Link href="/login" className="inline-flex min-h-11 items-center font-bold underline-offset-4 hover:underline">
            Sign in instead
          </Link>
        </div>
      </>
    );
  }

  const by = invite.createdBy?.name ?? "Someone in the family";
  return (
    <>
      <AuthHeading
        title={`${by} invited you to help care for ${invite.patient.name}`}
        lead={`Create your own sign-in. You will see the same people, reminders, and moments ${by.split(" ")[0]} sees, and anything you add reaches Remi.`}
      />
      <JoinForm token={raw} patientName={invite.patient.name} />
    </>
  );
}
