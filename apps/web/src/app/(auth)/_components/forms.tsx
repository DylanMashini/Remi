"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { buttonLarge, Field, FormStatus, inputClass, Notice } from "@/components/ui";

// ---------- shared bits ----------

function Input(props: {
  id: string;
  label: string;
  type?: string;
  autoComplete?: string;
  hint?: string;
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
  autoFocus?: boolean;
  required?: boolean;
}) {
  const { label, hint, ...rest } = props;
  return (
    <Field label={label} htmlFor={props.id} hint={hint}>
      <input
        {...rest}
        name={props.id}
        type={props.type ?? "text"}
        required={props.required ?? true}
        aria-describedby={hint ? `${props.id}-hint` : undefined}
        className={inputClass}
      />
    </Field>
  );
}

function Submit({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button type="submit" disabled={busy} className={`${buttonLarge} mt-1 w-full`}>
      {busy ? "One moment" : children}
    </button>
  );
}

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-11 items-center font-bold underline-offset-4 hover:underline">
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
    return { ok: false, status: res.status, error: data?.error ?? "Something went wrong. Try again." };
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

/** Only same-site paths, never "//host" or absolute URLs. */
function safeNext(next: string | null): string {
  if (!next) return "/";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

// ---------- forms ----------

export function LoginForm() {
  const params = useSearchParams();
  const router = useRouter();
  const { busy, error, onSubmit } = useSubmit(async (f) => {
    const r = await post("/api/auth/login", { email: val(f, "email"), password: val(f, "password") });
    if (!r.ok) return r.error!;
    router.replace(safeNext(params.get("next")));
    router.refresh();
    return null;
  });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {params.get("reset") === "1" ? <Notice tone="success">Your password is changed. Sign in with the new one.</Notice> : null}
      {params.get("verified") === "1" ? <Notice tone="success">Your email is verified. Sign in to continue.</Notice> : null}
      <FormStatus error={error} />
      <Input id="email" label="Email" type="email" autoComplete="email" autoFocus />
      <Input id="password" label="Password" type="password" autoComplete="current-password" />
      <Submit busy={busy}>Sign in</Submit>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[16px]">
        <FooterLink href="/forgot">Forgot password?</FooterLink>
        <FooterLink href="/signup">Set up Recall</FooterLink>
      </div>
    </form>
  );
}

/** Step 2 of sign-up: account details. Step 1 (who wears the glasses) is the page itself. */
export function SignupForm({ role }: { role: "caregiver" | "wearer" }) {
  const router = useRouter();
  const caregiver = role === "caregiver";
  const [patientName, setPatientName] = useState("");
  const { busy, error, onSubmit } = useSubmit(async (f) => {
    const r = await post("/api/auth/signup", {
      role,
      name: val(f, "name"),
      patientName: caregiver ? val(f, "patientName") : val(f, "name"),
      email: val(f, "email"),
      password: val(f, "password"),
    });
    if (!r.ok) return r.error!;
    router.replace("/start/person");
    router.refresh();
    return null;
  });
  const who = caregiver && patientName.trim() ? patientName.trim().split(/\s+/)[0] : null;
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <FormStatus error={error} />
      {caregiver ? (
        <Field label="Who will wear the glasses?" htmlFor="patientName" hint="Their first name is enough. This is how the glasses address them.">
          <input
            id="patientName"
            name="patientName"
            required
            autoFocus
            maxLength={100}
            autoComplete="off"
            placeholder="Their first name"
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            className={inputClass}
          />
        </Field>
      ) : null}
      <Input id="name" label="Your name" autoComplete="name" placeholder={caregiver ? "Your name" : "Your first name"} autoFocus={!caregiver} />
      <Input id="email" label="Email" type="email" autoComplete="email" placeholder="you@example.com" />
      <Input id="password" label="Password" type="password" autoComplete="new-password" minLength={8} hint="At least 8 characters." />
      <Submit busy={busy}>{who ? `Create account for ${who}` : "Create account"}</Submit>
      <p className="m-0 text-[16px] text-ink-soft">
        Already set up? <FooterLink href="/login">Sign in</FooterLink>
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
        <Notice tone="success">If that email has an account, a reset link is on its way. The link works for 30 minutes.</Notice>
        <FooterLink href="/login">Back to sign in</FooterLink>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <FormStatus error={error} />
      <Input id="email" label="Email" type="email" autoComplete="email" autoFocus />
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
        <Notice tone="attention">This reset link is incomplete. Ask for a new one.</Notice>
        <FooterLink href="/forgot">Request a new link</FooterLink>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <FormStatus error={error} />
      <Input id="password" label="New password" type="password" autoComplete="new-password" minLength={8} hint="At least 8 characters." autoFocus />
      <Input id="confirm" label="Type it again" type="password" autoComplete="new-password" minLength={8} />
      <Submit busy={busy}>Save new password</Submit>
      {error ? <FooterLink href="/forgot">Request a new link</FooterLink> : null}
    </form>
  );
}
