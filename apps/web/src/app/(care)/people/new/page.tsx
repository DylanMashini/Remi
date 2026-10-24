import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getCare } from "@/components/care";
import { ArrowLeftIcon } from "@/components/icons";
import { EnrollForm } from "@/components/people/EnrollForm";
import { Card, PageHeader, PageSkeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Add a person" };

export default function NewPersonPage() {
  return (
    <Suspense fallback={<PageSkeleton rows={1} />}>
      <NewPerson />
    </Suspense>
  );
}

async function NewPerson() {
  const { patientName, user } = await getCare();
  const self = user.role === "WEARER";
  return (
    <>
      <div className="flex flex-col gap-5">
        <Link href="/people" className="inline-flex w-fit items-center gap-1.5 text-[15px] font-bold">
          <ArrowLeftIcon size={16} />
          People
        </Link>
        <PageHeader
          title="Add a person"
          lead={`The glasses introduce people by name, then relationship, then your note, then the newest memory ${self ? "you share" : `${patientName} shares`} about them. Faces are matched only against the people you add here.`}
        />
      </div>
      <Card>
        <EnrollForm patientName={patientName} self={self} />
      </Card>
    </>
  );
}
