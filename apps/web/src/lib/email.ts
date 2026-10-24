import { Resend } from "resend";

// Sends Recall's two transactional emails. With no RESEND_API_KEY (local dev), the link is
// printed to the server console instead so the flow can still be completed by hand.

const DEFAULT_FROM = "Recall <onboarding@resend.dev>";

let client: Resend | null = null;
function resend(): Resend | null {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return null;
  client ??= new Resend(key);
  return client;
}

/** Base URL for links in emails. Falls back to the request origin, then localhost. */
export function appUrl(origin?: string): string {
  const base = process.env.APP_URL?.trim() || origin || "http://localhost:3000";
  return base.replace(/\/+$/, "");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function layout(opts: { heading: string; body: string; button: string; url: string; footer: string }): string {
  const url = escapeHtml(opts.url);
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#F5F3EE;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3EE;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border:1px solid #D9D4C8;border-radius:20px;">
<tr><td style="padding:32px 32px 8px 32px;font-family:Nunito,'Segoe UI',Arial,sans-serif;font-weight:800;font-size:24px;color:#2C6E68;">Recall</td></tr>
<tr><td style="padding:8px 32px 0 32px;font-family:Nunito,'Segoe UI',Arial,sans-serif;font-weight:700;font-size:22px;line-height:1.3;color:#1E2B2F;">${escapeHtml(opts.heading)}</td></tr>
<tr><td style="padding:12px 32px 0 32px;font-family:'Atkinson Hyperlegible',Verdana,Arial,sans-serif;font-size:17px;line-height:1.55;color:#4F5D61;">${opts.body}</td></tr>
<tr><td style="padding:24px 32px 8px 32px;">
<a href="${url}" style="display:inline-block;background:#2C6E68;color:#FFFFFF;text-decoration:none;font-family:Nunito,'Segoe UI',Arial,sans-serif;font-weight:700;font-size:17px;padding:14px 28px;border-radius:999px;">${escapeHtml(opts.button)}</a>
</td></tr>
<tr><td style="padding:16px 32px 32px 32px;font-family:'Atkinson Hyperlegible',Verdana,Arial,sans-serif;font-size:14px;line-height:1.5;color:#4F5D61;">${escapeHtml(opts.footer)}<br><span style="word-break:break-all;color:#1F524D;">${url}</span></td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

async function send(to: string, subject: string, html: string, link: string, label: string): Promise<void> {
  const r = resend();
  if (!r) {
    console.log(`[email] RESEND_API_KEY is not set; ${label} link for ${to}: ${link}`);
    return;
  }
  const from = process.env.EMAIL_FROM?.trim() || DEFAULT_FROM;
  const { error } = await r.emails.send({ from, to, subject, html });
  if (error) throw new Error(`Resend failed to send ${label} email: ${error.message}`);
}

export async function sendVerifyEmail(to: string, name: string, url: string): Promise<void> {
  const html = layout({
    heading: `Welcome, ${name}.`,
    body: "You are setting up Recall for someone you care for. Please confirm this is your email address.",
    button: "Confirm my email",
    url,
    footer: "If the button does not work, open this link:",
  });
  await send(to, "Confirm your email for Recall", html, url, "verify");
}

export async function sendResetEmail(to: string, name: string, url: string): Promise<void> {
  const html = layout({
    heading: `Hello, ${name}.`,
    body: "Someone asked to reset your Recall password. The link works once and expires in 30 minutes. If this was not you, you can ignore this email.",
    button: "Choose a new password",
    url,
    footer: "If the button does not work, open this link:",
  });
  await send(to, "Reset your Recall password", html, url, "reset");
}
