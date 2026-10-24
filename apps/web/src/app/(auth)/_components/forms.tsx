"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

// ---------- shared bits ----------

function Field(props: {
  id: string;
  label: string;
  type?: string;
  autoComplete?: string;
  hint?: string;
  minLength?: number;
  autoFocus?: boolean;
}) {
  const hintId = props.hint ? `${props.id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={props.id} className="text-[16px] font-bold text-[#1E2B2F]">
        {props.label}
      </label>
      <input
        id={props.id}
        name={props.id}
        type={props.type ?? "text"}
        autoComplete={props.autoComplete}
        minLength={props.minLength}
        autoFocus={props.autoFocus}
        required
        aria-describedby={hintId}
        className="min-h-12 rounded-[12px] border border-[#D9D4C8] bg-white px-4 text-[17px] text-[#1E2B2F] outline-none transition-shadow placeholder:text-[#4F5D61] focus:border-[#2C6E68] focus:shadow-[0_0_0_3px_#DCEBE7]"
      />
      {props.hint ? (
        <p id={hintId} className="text-[14px] text-[#4F5D61]">
          {props.hint}
        </p>
      ) : null}
    </div>
  );
}

function Submit({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="mt-2 min-h-12 w-full cursor-pointer rounded-full bg-[#2C6E68] px-6 font-[family-name:var(--font-nunito)] text-[17px] font-bold text-white transition-colors hover:bg-[#1F524D] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#2C6E68] disabled:cursor-wait disabled:opacity-70"
    >
      {busy ? "One moment…" : children}
    </button>
  );
}

function Notice({ tone, children }: { tone: "error" | "ok"; children: ReactNode }) {
  const cls =
    tone === "error"
      ? "border-[#F3D3A3] bg-[#FCEBD0] text-[#8A4B00]"
      : "border-[#DCEBE7] bg-[#DCEBE7] text-[#1F524D]";
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`rounded-[12px] border px-4 py-3 text-[16px] leading-snug ${cls}`}>
      {children}
    </p>
  );
}

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-11 items-center font-bold text-[#2C6E68] underline-offset-4 hover:text-[#1F524D] hover:underline">
      {children}
    </Link>
  );
}

async function post(url: string, body: unknown): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true, status: res.status };
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, status: res.status, error: data?.error ?? "Something went wrong. Please try again." };
  } catch {
    return { ok: false, status: 0, error: "Could not reach Recall. Check your connection and try again." };
  }
}

function useSubmit(handler: (form: FormData) => Promise<string | null>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = await handler(new FormData(e.currentTarget));
    if (err) {
      setError(err);
      setBusy(false);
    }
  }
  return { busy, error, onSubmit };
}

const val = (f: FormData, k: string) => String(f.get(k) ?? "");

// ---------- forms ----------

export function LoginForm() {
  const params = useSearchParams();
  const router = useRouter();
  const { busy, error, onSubmit } = useSubmit(async (f) => {
    const r = await post("/api/auth/login", { email: val(f, "email"), password: val(f, "password") });
    if (!r.ok) return r.error!;
    // Only same-site paths, never "//host" or absolute URLs.
    const next = params.get("next") ?? "/";
    router.replace(next.startsWith("/") && !next.startsWith("//") ? next : "/");
    router.refresh();
    return null;
  });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {params.get("reset") === "1" ? <Notice tone="ok">Your password is changed. Sign in with the new one.</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Field id="email" label="Email" type="email" autoComplete="email" autoFocus />
      <Field id="password" label="Password" type="password" autoComplete="current-password" />
      <Submit busy={busy}>Sign in</Submit>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[16px]">
        <FooterLink href="/forgot">Forgot password?</FooterLink>
        <FooterLink href="/signup">Create an account</FooterLink>
      </div>
    </form>
  );
}

export function SignupForm() {
  const router = useRouter();
  const { busy, error, onSubmit } = useSubmit(async (f) => {
    const r = await post("/api/auth/signup", {
      name: val(f, "name"),
      patientName: val(f, "patientName"),
      email: val(f, "email"),
      password: val(f, "password"),
    });
    if (!r.ok) return r.error!;
    router.replace("/");
    router.refresh();
    return null;
  });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Field id="name" label="Your name" autoComplete="name" autoFocus />
      <Field id="patientName" label="Who are you caring for?" hint="Their first name is enough. Recall uses it when it speaks." />
      <Field id="email" label="Email" type="email" autoComplete="email" />
      <Field id="password" label="Password" type="password" autoComplete="new-password" minLength={8} hint="At least 8 characters." />
      <Submit busy={busy}>Create account</Submit>
      <p className="text-[16px] text-[#4F5D61]">
        Already have an account? <FooterLink href="/login">Sign in</FooterLink>
      </p>
    </form>
  );
}

export function ForgotForm() {
  const [sent, setSent] = useState(false);
  const { busy, error, onSubmit } = useSubmit(async (f) => {
    const r = await post("/api/auth/forgot", { email: val(f, "email") });
    if (!r.ok) return r.error!;
    setSent(true);
    return null;
  });
  if (sent) {
    return (
      <div className="flex flex-col gap-5">
        <Notice tone="ok">If that email has an account, a reset link is on its way. The link works for 30 minutes.</Notice>
        <FooterLink href="/login">Back to sign in</FooterLink>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Field id="email" label="Email" type="email" autoComplete="email" autoFocus />
      <Submit busy={busy}>Send reset link</Submit>
      <FooterLink href="/login">Back to sign in</FooterLink>
    </form>
  );
}

export function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const { busy, error, onSubmit } = useSubmit(async (f) => {
    const password = val(f, "password");
    if (password !== val(f, "confirm")) return "The two passwords do not match.";
    const r = await post("/api/auth/reset", { token, password });
    if (!r.ok) return r.error!;
    router.replace("/login?reset=1");
    return null;
  });
  if (!token) {
    return (
      <div className="flex flex-col gap-5">
        <Notice tone="error">This reset link is incomplete. Ask for a new one.</Notice>
        <FooterLink href="/forgot">Request a new link</FooterLink>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Field id="password" label="New password" type="password" autoComplete="new-password" minLength={8} hint="At least 8 characters." autoFocus />
      <Field id="confirm" label="Type it again" type="password" autoComplete="new-password" minLength={8} />
      <Submit busy={busy}>Save new password</Submit>
      {error ? <FooterLink href="/forgot">Request a new link</FooterLink> : null}
    </form>
  );
}
