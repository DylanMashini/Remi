import type { Metadata } from "next";
import { AuthHeading } from "../_components/heading";
import { SignupForm } from "../_components/forms";

export const metadata: Metadata = { title: "Create account · Recall" };

export default function SignupPage() {
  return (
    <>
      <AuthHeading title="Set up Recall" lead="One account for the family. You can add people and reminders next." />
      <SignupForm />
    </>
  );
}
