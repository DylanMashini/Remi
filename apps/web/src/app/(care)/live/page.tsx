import { Suspense } from "react";
import { getCare } from "@/components/care";
import { LiveView } from "@/components/live/LiveView";

export default function LivePage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 z-50 bg-linen" />}>
      <Live />
    </Suspense>
  );
}

async function Live() {
  const { patientName } = await getCare();
  return <LiveView patientName={patientName} />;
}
