import Link from "next/link";
import { ShieldIcon } from "@/components/icons";
import { Wordmark } from "@/components/Logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <Link href="/login" className="mb-8 flex items-center no-underline" aria-label="Remi home">
        <Wordmark size={40} />
      </Link>
      <div className="w-full max-w-[460px] rounded-lg bg-surface p-7 shadow-float sm:p-9">{children}</div>
      <p className="mt-8 flex max-w-[460px] items-center gap-2 text-center text-[15px] leading-relaxed text-ink-soft">
        <ShieldIcon size={16} className="shrink-0 text-dusk" />
        Faces are matched only against the people your family adds. Glasses frames are never stored.
      </p>
    </main>
  );
}
