import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AuthHeading } from "../_components/heading";
import { SignupForm } from "../_components/forms";
import { ArrowLeftIcon, PeopleIcon, PersonIcon } from "@/components/icons";
import { ChoiceCard, Skeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Set up Remi" };

export default function SignupPage({ searchParams }: PageProps<"/signup">) {
  return (
    <Suspense fallback={<Skeleton className="h-80" />}>
      <Signup searchParams={searchParams} />
    </Suspense>
  );
}

async function Signup({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { role } = await searchParams;
  const picked = role === "wearer" ? "wearer" : role === "caregiver" ? "caregiver" : null;

  if (!picked) {
    return (
      <>
        <AuthHeading
          title="Who will wear the glasses?"
          lead="This shapes how Remi speaks and what you see here. You can add family later."
        />
        <div className="flex flex-col gap-3">
          <ChoiceCard href="/signup?role=caregiver" icon={<PeopleIcon size={24} />} title="Someone I care for">
            I am a family member or caregiver. I will manage people and reminders for them.
          </ChoiceCard>
          <ChoiceCard href="/signup?role=wearer" icon={<PersonIcon size={24} />} title="I will">
            I am setting Remi up for myself.
          </ChoiceCard>
        </div>
        <p className="m-0 mt-6 text-[16px] text-ink-soft">
          Already set up?{" "}
          <Link href="/login" className="font-bold underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <Link href="/signup" className="mb-4 inline-flex min-h-10 items-center gap-1.5 text-[15px] font-bold">
        <ArrowLeftIcon size={16} />
        Back
      </Link>
      <AuthHeading
        title={picked === "caregiver" ? "Set up for someone" : "Set up for yourself"}
        lead={
          picked === "caregiver"
            ? "You get a caregiver account. Remi speaks to them; this dashboard and the phone are yours."
            : "Your account is for you. Remi will speak to you, and this dashboard shows what it says."
        }
      />
      <SignupForm role={picked} />
    </>
  );
}
