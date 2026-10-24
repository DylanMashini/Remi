import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthHeading } from "../_components/heading";
import { LoginForm } from "../_components/forms";

export const metadata: Metadata = { title: "Sign in · Recall" };

export default function LoginPage() {
  return (
    <>
      <AuthHeading title="Welcome back" lead="Sign in to see today, the people you've added, and reminders." />
      <Suspense>
        <LoginForm />
      </Suspense>
    </>
  );
}
