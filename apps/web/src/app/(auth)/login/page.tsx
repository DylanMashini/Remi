import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthHeading } from "../_components/heading";
import { LoginForm } from "../_components/forms";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <>
      <AuthHeading title="Welcome back" lead="Sign in to see today, the people you have added, and what comes next." />
      <Suspense>
        <LoginForm />
      </Suspense>
    </>
  );
}
