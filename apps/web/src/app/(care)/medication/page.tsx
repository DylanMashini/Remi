import type { Metadata } from "next";
import { Suspense } from "react";
import { addMedication } from "../actions";
import { getCare } from "@/components/care";
import { PillIcon } from "@/components/icons";
import { DoseRow } from "@/components/medication/DoseRow";
import { MedicationForm } from "@/components/medication/MedicationForm";
import { MedicationRow } from "@/components/medication/MedicationRow";
import { Card, CardTitle, EmptyState, Group, PageHeader, PageSkeleton } from "@/components/ui";
import { ensureDoses, todaysDoses } from "@/lib/medications";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Medication" };

export default function MedicationPage() {
  return (
    <Suspense fallback={<PageSkeleton rows={2} />}>
      <Medication />
    </Suspense>
  );
}

async function Medication() {
  const { patientId, patientName, user } = await getCare();
  const self = user.role === "WEARER";
  const now = new Date();
  await ensureDoses(patientId, now);
  const [medications, doses] = await Promise.all([
    prisma.medication.findMany({ where: { patientId }, orderBy: [{ active: "desc" }, { createdAt: "asc" }] }),
    todaysDoses(patientId, now),
  ]);
  const who = self ? "you" : patientName;
  const nextIndex = doses.findIndex((d) => d.status === "upcoming" || d.status === "due");
  const taken = doses.filter((d) => d.status === "taken").length;
  const said = doses.filter((d) => d.status === "said" || d.status === "taken").length;

  return (
    <>
      <PageHeader
        title="Medication"
        lead={`Remi says each dose once, at its time, in the same calm words. You see here whether it was said, and you can note when ${who === "you" ? "you took" : `${patientName} took`} it.`}
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-8">
          <Group
            title="Today"
            action={
              doses.length ? (
                <span className="font-normal text-ink-mute">
                  {said} of {doses.length} said{taken ? `, ${taken} taken` : ""}
                </span>
              ) : null
            }
            footer={doses.length ? "The phone checks every 15 seconds. A dose added after its time is listed but not spoken today." : undefined}
          >
            {doses.length === 0 ? (
              <EmptyState icon={<PillIcon size={30} />} title="No doses today">
                {medications.length ? "Every medication is paused." : `Add a medication and its times. Remi takes it from there.`}
              </EmptyState>
            ) : (
              <ul className="hairline-rows m-0 list-none p-0">
                {doses.map((d, i) => (
                  <DoseRow key={d.key} dose={d} next={i === nextIndex} />
                ))}
              </ul>
            )}
          </Group>

          <Group title="Medications" action={medications.length ? <span className="font-normal text-ink-mute">{medications.length}</span> : null}>
            {medications.length === 0 ? (
              <EmptyState icon={<PillIcon size={30} />} title="Nothing on the list yet">
                Start with the one {who === "you" ? "you take" : `${patientName} takes`} most often.
              </EmptyState>
            ) : (
              <ul className="hairline-rows m-0 list-none p-0">
                {medications.map((m) => (
                  <MedicationRow key={m.id} medication={m} patientName={patientName} self={self} />
                ))}
              </ul>
            )}
          </Group>
        </div>

        <Card className="self-start">
          <CardTitle lead="Name, dose, one sentence of instructions, and the times of day.">Add a medication</CardTitle>
          <MedicationForm action={addMedication} patientName={patientName} self={self} />
        </Card>
      </div>
    </>
  );
}
