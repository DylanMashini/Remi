"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { knownLine } from "../format";
import { CameraIcon, CheckIcon, XIcon } from "../icons";
import { buttonLarge, buttonQuiet, buttonSecondary, Field, FormStatus, inputClass, Spoken } from "../ui";

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "error"; message: string } | { kind: "done"; name: string; id: string };

const MAX_PHOTOS = 3;

/**
 * Enrolls a person: name, relationship, a note, and 1 to 3 photos. Posts multipart to
 * POST /api/people from the browser (photos never pass through a server action).
 * `nextHref` sends the caregiver somewhere after saving (onboarding); otherwise the form
 * shows a done state with links.
 */
export function EnrollForm({
  patientName,
  nextHref,
  self = false,
  submitLabel,
}: {
  patientName: string;
  nextHref?: string;
  self?: boolean;
  submitLabel?: string;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  // Each photo keeps its own object URL for the thumbnail; revoked on remove and unmount.
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list)
      .filter((f) => f.type.startsWith("image/"))
      .map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPhotos((prev) => {
      const next = [...prev, ...incoming];
      next.slice(MAX_PHOTOS).forEach((p) => URL.revokeObjectURL(p.url));
      return next.slice(0, MAX_PHOTOS);
    });
    setStatus({ kind: "idle" });
  }

  function removePhoto(i: number) {
    setPhotos((prev) => {
      const gone = prev[i];
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((_, idx) => idx !== i);
    });
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.replace(/\s+/g, " ").trim();
    if (!trimmed) return setStatus({ kind: "error", message: "Add their name." });
    if (photos.length === 0) return setStatus({ kind: "error", message: "Add at least one photo of their face." });

    const body = new FormData();
    body.set("name", trimmed);
    if (relationship.trim()) body.set("relationship", relationship.trim());
    if (notes.trim()) body.set("notes", notes.trim());
    photos.forEach((p, i) => body.append("photos", p.file, p.file.name || `photo${i + 1}.jpg`));

    setStatus({ kind: "saving" });
    try {
      const res = await fetch("/api/people", { method: "POST", body });
      if (res.ok) {
        const data = (await res.json()) as { person: { id: string } };
        router.refresh();
        if (nextHref) {
          reset();
          router.push(nextHref);
          return;
        }
        setStatus({ kind: "done", name: trimmed, id: data.person.id });
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string; index?: number };
      if (res.status === 422) {
        const which = typeof data.index === "number" ? `Photo ${data.index + 1}` : "One photo";
        setStatus({ kind: "error", message: `${which} did not show a clear face. Try one in good light, facing the camera. Nothing was saved.` });
      } else if (res.status === 401) {
        setStatus({ kind: "error", message: "You were signed out. Sign in again and retry." });
      } else if (res.status === 503) {
        setStatus({ kind: "error", message: "The face service is not running, so photos cannot be checked right now." });
      } else {
        setStatus({ kind: "error", message: data.error ?? `Could not save (error ${res.status}). Try again.` });
      }
    } catch {
      setStatus({ kind: "error", message: "Could not reach the server. Check the connection and try again." });
    }
  }

  function reset() {
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    setPhotos([]);
    setName("");
    setRelationship("");
    setNotes("");
    setStatus({ kind: "idle" });
  }

  if (status.kind === "done") {
    return (
      <div className="flex flex-col gap-5 rounded-md bg-dusk-mist p-6" role="status">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-pill bg-dusk text-white">
            <CheckIcon size={22} />
          </span>
          <strong className="font-display text-[22px] tracking-[-0.3px]">{status.name} is added</strong>
        </div>
        <p className="m-0 text-[17px] text-ink">Remi will introduce them the next time they walk up.</p>
        <div className="flex flex-wrap gap-3">
          <Link href={`/people/${status.id}`} className={buttonSecondary}>
            Open {status.name.split(" ")[0]}
          </Link>
          <button type="button" onClick={reset} className={buttonQuiet}>
            Add someone else
          </button>
        </div>
      </div>
    );
  }

  const saving = status.kind === "saving";
  const preview = name.trim() ? knownLine({ name: name.trim(), relationship: relationship.trim() || null, notes: notes.trim() || null }) : null;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
        <legend className="mb-2 text-[15px] font-bold">Photos of their face</legend>
        <div className="grid grid-cols-3 gap-3">
          {photos.map((p, i) => (
            <div key={p.url} className="relative aspect-square overflow-hidden rounded-md bg-sand">
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
              <img src={p.url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removePhoto(i)}
                className="absolute right-2 top-2 flex h-8 w-8 cursor-pointer items-center justify-center rounded-pill border-0 bg-ink/70 text-white hover:bg-ink"
                aria-label={`Remove photo ${i + 1}`}
              >
                <XIcon size={14} />
              </button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS ? (
            <label
              className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-[1.5px] border-dashed border-line bg-linen text-center text-[14px] font-bold text-ink-soft hover:border-dusk hover:text-dusk-deep"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                addFiles(e.dataTransfer.files);
              }}
            >
              <CameraIcon size={24} />
              {photos.length === 0 ? "Add photos" : "Add another"}
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          ) : null}
        </div>
        <span className="text-[15px] leading-snug text-ink-mute">
          One to three clear photos, facing the camera, in good light. They stay private to your family.
        </span>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Name" htmlFor="enroll-name">
          <input id="enroll-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} autoComplete="off" placeholder="Sarah" className={inputClass} />
        </Field>
        <Field label={self ? "Relationship to you" : `Relationship to ${patientName}`} htmlFor="enroll-rel" hint="Spoken as “your daughter”, so keep it lowercase.">
          <input id="enroll-rel" value={relationship} onChange={(e) => setRelationship(e.target.value)} maxLength={100} autoComplete="off" placeholder="daughter" className={inputClass} />
        </Field>
      </div>
      <Field label="A warm note" htmlFor="enroll-notes" hint="Remi reads it aloud after the name. One short sentence.">
        <input id="enroll-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={160} autoComplete="off" placeholder="She visits every Sunday." className={inputClass} />
      </Field>

      {preview ? (
        <div className="flex flex-col gap-1.5 rounded-md bg-dusk-mist px-5 py-4">
          <span className="text-[15px] font-bold text-dusk-deep">{self ? "You will hear" : `${patientName} will hear`}</span>
          <Spoken size="sm">{preview}</Spoken>
        </div>
      ) : null}

      <FormStatus error={status.kind === "error" ? status.message : null} />

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving} className={buttonLarge}>
          {saving ? "Checking the photos" : submitLabel ?? "Add this person"}
        </button>
        {saving ? <span className="text-[15px] text-ink-soft">Finding the face in each photo takes a moment.</span> : null}
      </div>
    </form>
  );
}
