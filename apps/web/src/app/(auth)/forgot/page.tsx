import type { Metadata } from "next";
import { AuthHeading } from "../_components/heading";
import { ForgotForm } from "../_components/forms";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPage() {
  return (
    <>
      <AuthHeading title="Forgot your password?" lead="Enter your email and we'll send a link to choose a new one." />
      <ForgotForm />
    </>
  );
}
