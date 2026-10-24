import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`flex flex-col gap-4 rounded-[24px] bg-surface p-5 sm:p-7 ${className}`}>{children}</section>;
}

export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="m-0 font-display text-[22px] font-bold sm:text-2xl">{children}</h2>
      {action}
    </div>
  );
}

export function Chip({ children, tone = "sand" }: { children: ReactNode; tone?: "harbor" | "attention" | "sand" | "urgent" }) {
  const tones = {
    harbor: "bg-harbor-mist text-harbor-deep",
    attention: "bg-attention-bg text-attention",
    urgent: "bg-urgent-bg text-urgent",
    sand: "bg-sand text-ink",
  };
  return (
    <span className={`inline-flex items-center gap-2 rounded-pill px-3.5 py-2 text-[15px] font-bold ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function PageHeader({ eyebrow, title, children }: { eyebrow?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1.5">
        {eyebrow ? <span className="text-sm font-bold tracking-[0.4px] text-ink-soft">{eyebrow}</span> : null}
        <h1 className="m-0 font-display text-[28px] font-extrabold leading-tight sm:text-4xl">{title}</h1>
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2.5">{children}</div> : null}
    </header>
  );
}

export const buttonPrimary =
  "inline-flex h-12 items-center justify-center gap-2 rounded-pill border-0 bg-harbor px-5 text-base font-bold text-white no-underline hover:bg-harbor-deep hover:text-white disabled:opacity-60 cursor-pointer";
export const buttonSecondary =
  "inline-flex h-12 items-center justify-center gap-2 rounded-pill border-[1.5px] border-harbor bg-surface px-5 text-base font-bold text-harbor-deep no-underline hover:bg-harbor-mist cursor-pointer";
export const buttonQuiet =
  "inline-flex h-11 items-center justify-center gap-2 rounded-pill border-0 bg-sand px-4 text-[15px] font-bold text-ink hover:bg-line cursor-pointer";
export const iconButton =
  "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-pill border-0 bg-transparent text-ink-soft hover:bg-urgent-bg hover:text-urgent cursor-pointer";
export const inputClass =
  "h-12 w-full rounded-sm border-[1.5px] border-line bg-surface px-3.5 text-base text-ink placeholder:text-ink-soft/70 focus:border-harbor focus:outline-none";
export const labelClass = "text-[15px] font-bold";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-sand ${className}`} />;
}
