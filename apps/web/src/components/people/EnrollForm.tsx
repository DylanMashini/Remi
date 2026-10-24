"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { buttonPrimary, inputClass, labelClass } from "../ui";

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "error"; message: string } | { kind: "done"; name: string };

/** Posts multipart to /api/people from the browser (photos never pass through a server action). */
export function EnrollForm({ patientName }: { patientName: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const raw = new FormData(form);
    const body = new FormData();
    const name = String(raw.get("name") ?? "").trim();
    if (!name) {
      setStatus({ kind: "error", message: "Add a name." });
      return;
    }
    body.set("name", name);
    const relationship = String(raw.get("relationship") ?? "").trim();
    const notes = String(raw.get("notes") ?? "").trim();
    if (relationship) body.set("relationship", relationship);
    if (notes) body.set("notes", notes);
    let photos = 0;
    for (const field of ["photo1", "photo2", "photo3"]) {
      const file = raw.get(field);
      if (file instanceof File && file.size > 0) {
        body.append("photos", file, file.name || `${field}.jpg`);
        photos++;
      }
    }
    if (photos === 0) {
      setStatus({ kind: "error", message: "Add at least one photo of their face." });
      return;
    }

    setStatus({ kind: "saving" });
    try {
      const res = await fetch("/api/people", { method: "POST", body });
      if (res.ok) {
        form.reset();
        setStatus({ kind: "done", name });
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string; index?: number };
      if (res.status === 422) {
        const which = typeof data.index === "number" ? `Photo ${data.index + 1}` : "One photo";
        setStatus({
          kind: "error",
          message: `${which} did not show a clear face${data.error ? ` (${data.error})` : ""}. Try a photo in good light, facing the camera. Nothing was saved.`,
        });
      } else if (res.status === 401) {
        setStatus({ kind: "error", message: "You were signed out. Sign in again and retry." });
      } else {
        setStatus({ kind: "error", message: data.error ?? `Could not save (error ${res.status}). Try again.` });
      }
    } catch {
      setStatus({ kind: "error", message: "Could not reach the server. Check the connection and try again." });
    }
  }

  const saving = status.kind === "saving";

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label htmlFor="enroll-name" className={labelClass}>Name</label>
          <input id="enroll-name" name="name" required autoComplete="off" placeholder="Sarah" className={inputClass} />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="enroll-rel" className={labelClass}>Relationship to {patientName}</label>
          <input id="enroll-rel" name="relationship" autoComplete="off" placeholder="daughter" className={inputClass} />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="enroll-notes" className={labelClass}>A warm note</label>
        <input
          id="enroll-notes"
          name="notes"
          maxLength={160}
          autoComplete="off"
          placeholder="She visits every Sunday."
          className={inputClass}
          aria-describedby="enroll-notes-help"
        />
        <span id="enroll-notes-help" className="text-sm text-ink-soft">
          Read aloud through the glasses. Keep it to one sentence.
        </span>
      </div>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className={`${labelClass} mb-2`}>Photos of their face (1 to 3)</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {["photo1", "photo2", "photo3"].map((field, i) => (
            <label
              key={field}
              className="flex cursor-pointer flex-col gap-1.5 rounded-sm border-[1.5px] border-dashed border-line bg-linen p-3 text-sm text-ink-soft hover:border-harbor"
            >
              <span className="font-bold text-ink">Photo {i + 1}{i === 0 ? "" : " (optional)"}</span>
              <input
                type="file"
                name={field}
                accept="image/jpeg"
                capture="user"
                className="w-full text-sm file:mr-3 file:cursor-pointer file:rounded-pill file:border-0 file:bg-sand file:px-3 file:py-1.5 file:font-bold file:text-ink"
              />
            </label>
          ))}
        </div>
        <span className="text-sm text-ink-soft">Clear, well-lit photos facing the camera work best. Photos stay private to your family.</span>
      </fieldset>

      <div role="status" aria-live="polite">
        {status.kind === "error" ? (
          <p className="m-0 rounded-sm bg-attention-bg px-4 py-3 font-bold text-attention">{status.message}</p>
        ) : null}
        {status.kind === "done" ? (
          <p className="m-0 rounded-sm bg-harbor-mist px-4 py-3 font-bold text-harbor-deep">
            {status.name} is enrolled. The glasses will introduce them next time.
          </p>
        ) : null}
      </div>

      <div>
        <button type="submit" disabled={saving} className={buttonPrimary}>
          {saving ? "Saving..." : "Enroll person"}
        </button>
      </div>
    </form>
  );
}
