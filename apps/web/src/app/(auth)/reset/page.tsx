import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthHeading } from "../_components/heading";
import { ResetForm } from "../_components/forms";

export const metadata: Metadata = { title: "Choose a new password · Recall" };

export default function ResetPage() {
  return (
    <>
      <AuthHeading title="Choose a new password" lead="After this, you'll sign in again on every device." />
      <Suspense>
        <ResetForm />
      </Suspense>
    </>
  );
}
