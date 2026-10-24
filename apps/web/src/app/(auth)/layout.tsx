import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-[#F5F3EE] px-4 py-12 text-[#1E2B2F]">
      <Link
        href="/login"
        className="mb-8 font-[family-name:var(--font-nunito)] text-[32px] font-extrabold tracking-tight text-[#2C6E68] no-underline hover:text-[#1F524D]"
      >
        Recall
      </Link>
      <div className="w-full max-w-[440px] rounded-[28px] border border-[#D9D4C8] bg-white p-8 shadow-[0_1px_2px_rgba(30,43,47,0.04),0_8px_24px_rgba(30,43,47,0.06)]">
        {children}
      </div>
      <p className="mt-8 max-w-[440px] text-center text-[15px] leading-relaxed text-[#4F5D61]">
        Faces are matched only against the people your family enrolls. Glasses frames are never stored.
      </p>
    </main>
  );
}
