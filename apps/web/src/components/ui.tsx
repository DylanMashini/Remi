import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRightIcon } from "./icons";

/*
 * Recall web UI kit. Small, boring, consistent, and shaped like the phone app's kit
 * (apps/mobile/src/components/ui.tsx): one type scale, one radius hierarchy, one way to
 * show status. Server-safe: no hooks in this file.
 */

// ---------- Page chrome ----------

/** Large left-aligned title, optional lead sentence, optional actions on the right. */
export function PageHeader({
  title,
  lead,
  eyebrow,
  children,
}: {
  title: ReactNode;
  lead?: ReactNode;
  eyebrow?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        {eyebrow ? <span className="text-[15px] text-ink-soft">{eyebrow}</span> : null}
        <h1 className="m-0 font-display text-[30px] font-extrabold leading-[1.1] tracking-[-0.6px] sm:text-[36px]">{title}</h1>
        {lead ? <p className="m-0 mt-1 max-w-[62ch] text-[17px] leading-relaxed text-ink-soft">{lead}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2.5 sm:pt-1">{children}</div> : null}
    </header>
  );
}

/** Section title used above a Group or Card, with an optional right-aligned action. */
export function SectionTitle({ children, action, as: Tag = "h2" }: { children: ReactNode; action?: ReactNode; as?: "h2" | "h3" }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-1">
      <Tag className="m-0 text-[15px] font-bold text-ink-soft">{children}</Tag>
      {action ? <div className="text-[15px] font-bold">{action}</div> : null}
    </div>
  );
}

// ---------- Surfaces ----------

/** A white surface that holds rows separated by hairlines, like a settings group. */
export function Group({
  title,
  action,
  footer,
  children,
  className = "",
  id,
}: {
  title?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`flex flex-col gap-2 ${className}`}>
      {title ? <SectionTitle action={action}>{title}</SectionTitle> : null}
      <div className="hairline-rows overflow-hidden rounded-md bg-surface">{children}</div>
      {footer ? <p className="m-0 px-1 text-[15px] leading-snug text-ink-mute">{footer}</p> : null}
    </section>
  );
}

/** A padded white surface for forms and prose. */
export function Card({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`flex flex-col gap-4 rounded-md bg-surface p-5 sm:p-6 ${className}`}>
      {children}
    </section>
  );
}

export function CardTitle({ children, action, lead }: { children: ReactNode; action?: ReactNode; lead?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="m-0 font-display text-[22px] font-bold tracking-[-0.3px]">{children}</h2>
        {action}
      </div>
      {lead ? <p className="m-0 text-[15px] leading-snug text-ink-soft">{lead}</p> : null}
    </div>
  );
}

// ---------- Rows ----------

type RowTone = "harbor" | "apricot" | "sand" | "attention";

const rowIconTones: Record<RowTone, string> = {
  harbor: "bg-harbor-mist text-harbor-deep",
  apricot: "bg-apricot-mist text-apricot-deep",
  sand: "bg-sand text-ink",
  attention: "bg-attention-bg text-attention",
};

export function RowIcon({ tone = "sand", children, size = 36 }: { tone?: RowTone; children: ReactNode; size?: number }) {
  return (
    <span
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }}
      className={`flex shrink-0 items-center justify-center ${rowIconTones[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * One row in a Group: optional leading element or icon, a title and detail, an optional
 * right-aligned value, trailing controls, and a chevron when it links somewhere.
 */
export function Row({
  title,
  detail,
  value,
  valueTone = "default",
  leading,
  trailing,
  href,
  className = "",
}: {
  title: ReactNode;
  detail?: ReactNode;
  value?: ReactNode;
  valueTone?: "default" | "good" | "attention" | "mute";
  leading?: ReactNode;
  trailing?: ReactNode;
  href?: string;
  className?: string;
}) {
  const valueColor = {
    default: "text-ink",
    good: "text-harbor-deep",
    attention: "text-attention",
    mute: "text-ink-mute",
  }[valueTone];
  const inner = (
    <>
      {leading}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[17px] leading-snug text-ink">{title}</span>
        {detail ? <span className="text-[15px] leading-snug text-ink-soft">{detail}</span> : null}
      </span>
      {value ? <span className={`shrink-0 text-right text-[15px] font-bold ${valueColor}`}>{value}</span> : null}
      {trailing}
      {href ? <ChevronRightIcon size={16} className="shrink-0 text-ink-mute" /> : null}
    </>
  );
  const base = `flex min-h-14 items-center gap-3.5 px-4 py-3 ${className}`;
  if (href) {
    return (
      <Link href={href} className={`${base} text-ink hover:bg-linen hover:text-ink`}>
        {inner}
      </Link>
    );
  }
  return <div className={base}>{inner}</div>;
}

// ---------- Status ----------

export function StatusPill({ tone, children }: { tone: "good" | "idle" | "attention"; children: ReactNode }) {
  const fg = { good: "text-harbor-deep", idle: "text-ink-soft", attention: "text-attention" }[tone];
  const bg = { good: "bg-harbor-mist", idle: "bg-sand", attention: "bg-attention-bg" }[tone];
  const dot = { good: "bg-harbor animate-pulse-dot", idle: "bg-ink-mute", attention: "bg-attention" }[tone];
  return (
    <span className={`inline-flex min-h-9 items-center gap-2 rounded-pill px-3.5 py-1.5 text-[15px] font-bold ${bg} ${fg}`}>
      <span className={`h-2 w-2 rounded-pill ${dot}`} aria-hidden="true" />
      {children}
    </span>
  );
}

export function Chip({ children, tone = "sand" }: { children: ReactNode; tone?: "harbor" | "attention" | "sand" | "apricot" }) {
  const tones = {
    harbor: "bg-harbor-mist text-harbor-deep",
    attention: "bg-attention-bg text-attention",
    apricot: "bg-apricot-mist text-apricot-deep",
    sand: "bg-sand text-ink",
  };
  return <span className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[13px] font-bold ${tones[tone]}`}>{children}</span>;
}

// ---------- Feedback ----------

export function Notice({
  tone = "info",
  title,
  children,
  action,
  icon,
}: {
  tone?: "info" | "success" | "attention";
  title?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  const cls = {
    info: "bg-harbor-mist border-harbor-mist text-ink",
    success: "bg-harbor-mist border-harbor-mist text-ink",
    attention: "bg-attention-bg border-attention-line text-attention",
  }[tone];
  return (
    <div role={tone === "attention" ? "alert" : "status"} className={`flex items-start gap-3 rounded-md border-[1.5px] p-4 ${cls}`}>
      {icon ? <span className={`mt-0.5 shrink-0 ${tone === "attention" ? "text-attention" : "text-harbor-deep"}`}>{icon}</span> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title ? <strong className="text-[17px] leading-snug">{title}</strong> : null}
        <div className="text-[15px] leading-snug">{children}</div>
        {action ? <div className="mt-1.5">{action}</div> : null}
      </div>
    </div>
  );
}

/** Inline form feedback under a submit button. */
export function FormStatus({ error, ok }: { error?: string | null; ok?: string | null }) {
  return (
    <div role="status" aria-live="polite" className="empty:hidden">
      {error ? <p className="m-0 rounded-sm bg-attention-bg px-4 py-3 text-[15px] font-bold text-attention">{error}</p> : null}
      {!error && ok ? <p className="m-0 rounded-sm bg-harbor-mist px-4 py-3 text-[15px] font-bold text-harbor-deep">{ok}</p> : null}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      {icon ? <span className="flex h-16 w-16 items-center justify-center rounded-pill bg-sand text-ink-soft">{icon}</span> : null}
      <h3 className="m-0 font-display text-[22px] font-bold tracking-[-0.3px]">{title}</h3>
      {children ? <p className="m-0 max-w-[38ch] text-[17px] leading-relaxed text-ink-soft">{children}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

// ---------- The spoken word ----------

/** The exact words the glasses say, always shown the same way: Nunito, quoted, harbor. */
export function Spoken({ children, size = "md", className = "" }: { children: ReactNode; size?: "sm" | "md" | "lg"; className?: string }) {
  const sz = { sm: "text-[17px] leading-snug", md: "text-[22px] leading-snug sm:text-[24px]", lg: "text-[26px] leading-[1.25] sm:text-[34px]" }[size];
  return (
    <p className={`m-0 font-display font-bold tracking-[-0.3px] text-harbor-deep ${sz} ${className}`}>
      &ldquo;{children}&rdquo;
    </p>
  );
}

// ---------- Buttons and inputs (class strings so forms and links can share them) ----------

const btnBase = "inline-flex items-center justify-center gap-2 rounded-pill border-0 font-bold no-underline transition-colors cursor-pointer disabled:cursor-not-allowed";
export const buttonPrimary = `${btnBase} h-12 bg-harbor px-5 text-[17px] text-white hover:bg-harbor-deep hover:text-white disabled:opacity-50`;
export const buttonLarge = `${btnBase} h-14 bg-harbor px-7 font-display text-[19px] text-white hover:bg-harbor-deep hover:text-white disabled:opacity-50`;
export const buttonSecondary = `${btnBase} h-12 border-[1.5px] border-harbor bg-surface px-5 text-[17px] text-harbor-deep hover:bg-harbor-mist hover:text-harbor-deep disabled:opacity-50`;
export const buttonQuiet = `${btnBase} h-11 bg-sand px-4 text-[15px] text-ink hover:bg-line hover:text-ink disabled:opacity-50`;
export const buttonDestructive = `${btnBase} h-11 bg-urgent-bg px-4 text-[15px] text-urgent hover:bg-[#f5cfca] hover:text-urgent disabled:opacity-50`;
export const buttonText = "inline-flex min-h-11 items-center gap-1.5 text-[15px] font-bold text-harbor-deep hover:text-harbor cursor-pointer border-0 bg-transparent px-1";
export const iconButton = "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-pill border-0 bg-transparent text-ink-soft hover:bg-sand hover:text-ink cursor-pointer disabled:opacity-50";
export const iconButtonDanger = "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-pill border-0 bg-transparent text-ink-soft hover:bg-urgent-bg hover:text-urgent cursor-pointer disabled:opacity-50";
export const inputClass =
  "min-h-[52px] w-full rounded-sm border-[1.5px] border-line bg-surface px-4 text-[17px] text-ink focus:border-harbor focus:outline-none focus:shadow-[0_0_0_3px_var(--color-harbor-mist)] disabled:opacity-60";
export const textareaClass = `${inputClass} py-3 leading-snug resize-y`;
export const labelClass = "text-[15px] font-bold text-ink";

/** Label + control + hint/error, stacked. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className = "",
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <label htmlFor={htmlFor} className={labelClass}>
        {label}
      </label>
      {children}
      {error ? (
        <span className="text-[15px] text-attention">{error}</span>
      ) : hint ? (
        <span id={`${htmlFor}-hint`} className="text-[15px] leading-snug text-ink-mute">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

// ---------- Loading ----------

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-sand ${className}`} />;
}

/** Default page fallback: a title, then two surfaces. */
export function PageSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-7" aria-busy="true" aria-label="Loading">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-10 w-2/3 max-w-[420px]" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={i === 0 ? "h-40" : "h-64"} />
      ))}
    </div>
  );
}

// ---------- Choice (onboarding) ----------

export function ChoiceCard({ href, icon, title, children }: { href: string; icon: ReactNode; title: ReactNode; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-4 rounded-md border-[1.5px] border-surface bg-surface p-5 text-ink no-underline hover:border-harbor hover:bg-harbor-mist hover:text-ink"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-pill bg-harbor-mist text-harbor-deep">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-display text-[20px] font-bold tracking-[-0.3px]">{title}</span>
        <span className="text-[15px] leading-snug text-ink-soft">{children}</span>
      </span>
      <ChevronRightIcon size={18} className="shrink-0 text-harbor-deep" />
    </Link>
  );
}
