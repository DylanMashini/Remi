"use client";

import { useState, useTransition } from "react";
import { createInvite, type InviteState } from "@/app/(care)/actions";
import { CheckIcon, CopyIcon, LinkIcon } from "../icons";
import { buttonQuiet, buttonText } from "../ui";

/**
 * Invite another family member: one click mints a link that works for a week and creates one
 * caregiver login on this account. Shown inline so the caregiver can copy it into a text message.
 */
export function InviteFamily({ patientName }: { patientName: string }) {
  const [state, setState] = useState<InviteState>({});
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  function make() {
    start(async () => {
      setCopied(false);
      setState(await createInvite());
    });
  }

  async function copy() {
    if (!state.url) return;
    try {
      await navigator.clipboard.writeText(state.url);
      setCopied(true);
    } catch {
      // The field below is selectable; the caregiver can copy by hand.
    }
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex min-w-0 flex-col">
          <span className="text-[17px]">Invite a family member</span>
          <span className="text-[15px] text-ink-soft">They get their own sign-in and see the same people, reminders, and moments for {patientName}.</span>
        </span>
        <button type="button" onClick={make} disabled={pending} className={buttonQuiet}>
          <LinkIcon size={18} />
          {pending ? "Making the link" : state.url ? "Make another link" : "Make an invite link"}
        </button>
      </div>
      {state.error ? <span className="text-[15px] text-attention">{state.error}</span> : null}
      {state.url ? (
        <div className="flex flex-col gap-2 rounded-md bg-linen p-4" role="status">
          <span className="text-[15px] font-bold">Send this link. It works once, for 7 days.</span>
          <div className="flex flex-wrap items-center gap-2">
            <input readOnly value={state.url} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" className="min-h-11 min-w-0 flex-1 rounded-sm border-[1.5px] border-line bg-surface px-3 text-[15px] text-ink" />
            <button type="button" onClick={copy} className={`${buttonText} h-11`}>
              {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
