import { Suspense } from "react";
import { getCare } from "@/components/care";
import { PrivacyFooter } from "@/components/Footer";
import { Wordmark } from "@/components/Logo";
import { NavLinks } from "@/components/NavLinks";

/** Reads the session (redirects to /login if missing) and shows who this dashboard is for. */
async function CaringFor() {
  const { patientName, user } = await getCare();
  return (
    <div className="hidden flex-col gap-0.5 rounded-md bg-linen px-3.5 py-3 text-sm md:flex">
      <span className="text-ink-soft">Caring for</span>
      <strong className="font-display text-lg">{patientName}</strong>
      <span className="text-ink-soft">Signed in as {user.name}</span>
    </div>
  );
}

export default function CareLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="sticky top-0 z-20 flex flex-col gap-3 border-b border-sand bg-surface px-4 py-3 md:h-dvh md:w-[260px] md:shrink-0 md:gap-7 md:border-r md:border-b-0 md:px-5 md:py-8">
        <Wordmark className="px-2" />
        {/* usePathname suspends while the shell for dynamic routes (/people/[id]) is prerendered. */}
        <Suspense fallback={<div className="h-11 md:h-[260px]" aria-hidden="true" />}>
          <NavLinks />
        </Suspense>
        <div className="mt-auto hidden md:block">
          <Suspense fallback={null}>
            <CaringFor />
          </Suspense>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-[clamp(20px,4vw,56px)] sm:py-10">
        <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-7">
          {children}
          <PrivacyFooter />
        </div>
      </main>
    </div>
  );
}
