import Link from "next/link";
import { Suspense } from "react";
import { Steps } from "./Steps";
import { LogoMark } from "@/components/Logo";
import { PrivacyFooter } from "@/components/Footer";

/** Focused first-run flow: no sidebar, one task per page, a step rail at the top. */
export default function StartLayout({ children }: LayoutProps<"/start">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-5 py-4 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5 text-ink no-underline hover:text-ink">
          <LogoMark size={32} />
          <span className="font-display text-[22px] font-extrabold tracking-tight">Recall</span>
        </Link>
        <Link href="/" className="text-[15px] font-bold">
          Skip to the dashboard
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-8 px-4 pb-16 pt-4 sm:px-6">
        <Suspense fallback={<div className="h-10" aria-hidden="true" />}>
          <Steps />
        </Suspense>
        {children}
        <PrivacyFooter />
      </main>
    </div>
  );
}
