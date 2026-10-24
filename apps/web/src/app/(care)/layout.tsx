import Link from "next/link";
import { Suspense } from "react";
import { getCare } from "@/components/care";
import { PrivacyFooter } from "@/components/Footer";
import { LogoMark, Wordmark } from "@/components/Logo";
import { SideNav, TabBar } from "@/components/NavLinks";
import { SignOutButton } from "@/components/SignOutButton";
import { buttonText } from "@/components/ui";

/** Reads the session (redirects to /login if missing) and shows who this dashboard is for. */
async function CaringFor() {
  const { patientName, user } = await getCare();
  const self = user.role === "WEARER";
  return (
    <div className="flex flex-col gap-3 rounded-md bg-linen px-4 py-3.5">
      <div className="flex flex-col gap-0.5 text-[15px]">
        <span className="text-ink-soft">{self ? "Set up for" : "Caring for"}</span>
        <strong className="font-display text-[19px] tracking-[-0.2px]">{self ? "Yourself" : patientName}</strong>
        <span className="truncate text-ink-mute">{user.email}</span>
      </div>
      <SignOutButton className={`${buttonText} -ml-1 h-9 min-h-0`} />
    </div>
  );
}

export default function CareLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Phone: slim top bar. Desktop: sidebar. */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-sand bg-surface px-4 py-2.5 md:hidden">
        <Link href="/" className="flex items-center gap-2.5 text-ink no-underline hover:text-ink">
          <LogoMark size={30} />
          <span className="font-display text-[20px] font-extrabold tracking-tight">Recall</span>
        </Link>
        <Link href="/live" className="text-[15px] font-bold">
          Live view
        </Link>
      </header>
      <aside className="hidden md:sticky md:top-0 md:flex md:h-dvh md:w-[248px] md:shrink-0 md:flex-col md:gap-7 md:border-r md:border-sand md:bg-surface md:px-4 md:py-7">
        <Link href="/" className="px-3 no-underline">
          <Wordmark />
        </Link>
        {/* usePathname suspends while the shell for dynamic routes (/people/[id]) is prerendered. */}
        <Suspense fallback={<div className="h-[380px]" aria-hidden="true" />}>
          <SideNav />
        </Suspense>
        <div className="mt-auto">
          <Suspense fallback={<div className="h-[116px] rounded-md bg-linen" aria-hidden="true" />}>
            <CaringFor />
          </Suspense>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 pb-[88px] pt-6 sm:px-[clamp(20px,4vw,56px)] md:pb-10 md:pt-10">
        <div className="mx-auto flex w-full max-w-[960px] flex-col gap-8">
          {children}
          <PrivacyFooter />
        </div>
      </main>
      <Suspense fallback={null}>
        <TabBar />
      </Suspense>
    </div>
  );
}
