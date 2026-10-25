import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { knownLine, NOBODY_LINE, UNKNOWN_LINE } from "@/lib/line";
import { deleteBlobs, saveFile } from "@/lib/storage";
import { listPeople } from "@/lib/people";
import { speechIdFor, withoutAudioTags } from "@/lib/tts";
import type { File as FileRow } from "@/generated/prisma/client";
import { errorResponse, HttpError } from "../_lib/http";

const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const AVATAR_SIZE = 160;

export async function GET(req: Request) {
  try {
    const { patientId } = await requireSession(req);
    // Every person's `speechId` (and the stranger line) is minted here, which starts ElevenLabs
    // generation on the server; the phone then downloads the audio while it syncs the roster, so
    // the moment someone walks up the words are already on the device.
    return Response.json({
      people: await listPeople(patientId),
      unknown: { line: UNKNOWN_LINE, speechId: speechIdFor(UNKNOWN_LINE) },
      // Glasses button with nobody in view; cached on the phone like the roster lines.
      nobody: { line: NOBODY_LINE, speechId: speechIdFor(NOBODY_LINE) },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function optionalText(form: FormData, key: string, max: number): string | null {
  const v = form.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t.length > max) throw new HttpError(400, `${key} is too long (max ${max} characters)`);
  return t || null;
}

type Box = [number, number, number, number];

/**
 * 160x160 JPEG avatar. With a face box (from the phone's on-device detector) it is a square crop
 * around the face padded 30%; without one (web enrollment) it is the centre square of the photo.
 */
async function avatarFrom(jpeg: Buffer, box: Box | null): Promise<Buffer> {
  const meta = await sharp(jpeg).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  let side: number;
  let cx: number;
  let cy: number;
  if (box) {
    const [x, y, w, h] = box;
    side = Math.min(Math.round(Math.max(w, h) * 1.3), W, H);
    cx = x + w / 2;
    cy = y + h / 2;
  } else {
    side = Math.min(W, H);
    cx = W / 2;
    cy = H / 2;
  }
  const left = Math.max(0, Math.min(W - side, Math.round(cx - side / 2)));
  const top = Math.max(0, Math.min(H - side, Math.round(cy - side / 2)));
  return sharp(jpeg)
    .extract({ left, top, width: Math.max(1, side), height: Math.max(1, side) })
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover" })
    .jpeg({ quality: 85 })
    .toBuffer();
}

/** `faces` form field: JSON `[[x, y, w, h], ...]`, one box per photo, in pixels of the uploaded JPEG. */
function parseBoxes(raw: FormDataEntryValue | null, count: number): Box[] | null {
  if (typeof raw !== "string" || !raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "faces must be JSON");
  }
  if (!Array.isArray(parsed) || parsed.length !== count) throw new HttpError(400, "faces must have one box per photo");
  return parsed.map((b) => {
    if (!Array.isArray(b) || b.length !== 4 || !b.every((v) => Number.isFinite(v))) throw new HttpError(400, "faces boxes must be [x, y, w, h]");
    return b.map((v) => Math.max(0, Math.round(v))) as Box;
  });
}

/**
 * Enroll a person. Photos are stored (for the caregiver dashboard, Remember portraits and so the
 * phone can build its on-device roster); no face embedding is computed or kept on the server.
 * The phone sends `faces` (boxes it detected itself) so the avatar is cropped around the face.
 */
export async function POST(req: Request) {
  try {
    const { patientId } = await requireSession(req);
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new HttpError(400, "Body must be multipart/form-data");
    }
    const name = optionalText(form, "name", 100);
    if (!name) throw new HttpError(400, "name is required");
    const relationship = optionalText(form, "relationship", 100);
    const notes = optionalText(form, "notes", 500);
    const photos = form.getAll("photos").filter((p): p is File => typeof p !== "string");
    if (photos.length < 1 || photos.length > MAX_PHOTOS) throw new HttpError(400, `Send 1 to ${MAX_PHOTOS} photos in the "photos" field`);
    const boxes = parseBoxes(form.get("faces"), photos.length);

    // 1. Decode and clean every photo before saving anything.
    const prepared: Buffer[] = [];
    for (let index = 0; index < photos.length; index++) {
      const photo = photos[index];
      if (photo.size > MAX_PHOTO_BYTES) throw new HttpError(413, "Photo is too large", { index });
      try {
        // Apply EXIF rotation and strip metadata (including GPS) before anything else sees it.
        prepared.push(await sharp(Buffer.from(await photo.arrayBuffer())).rotate().jpeg({ quality: 90 }).toBuffer());
      } catch {
        throw new HttpError(422, "Photo is not a readable image", { index });
      }
    }

    // 2. Save. On any failure, roll back the person and blobs.
    const person = await prisma.person.create({ data: { patientId, name, relationship, notes } });
    const saved: FileRow[] = [];
    try {
      for (const jpeg of prepared) {
        saved.push(await saveFile({ patientId, personId: person.id, kind: "FACE_PHOTO", bytes: jpeg, contentType: "image/jpeg" }));
      }
      const avatar = await saveFile({
        patientId,
        personId: person.id,
        kind: "AVATAR",
        bytes: await avatarFrom(prepared[0], boxes ? boxes[0] : null),
        contentType: "image/jpeg",
      });
      saved.push(avatar);
      const updated = await prisma.person.update({ where: { id: person.id }, data: { avatarFileId: avatar.id } });
      const photoFiles = saved.filter((f) => f.kind === "FACE_PHOTO");
      return Response.json(
        {
          person: {
            id: updated.id,
            name: updated.name,
            relationship: updated.relationship,
            notes: updated.notes,
            avatarUrl: `/api/files/${avatar.id}`,
            photoUrl: `/api/files/${photoFiles[0].id}`,
            photoUrls: photoFiles.map((f) => `/api/files/${f.id}`),
            photoCount: photoFiles.length,
            lastSeenAt: null,
            line: withoutAudioTags(knownLine({ ...updated, memory: null })),
            speechId: speechIdFor(knownLine({ ...updated, memory: null })),
            memoryCount: 0,
            lastRememberedAt: null,
          },
        },
        { status: 201 },
      );
    } catch (error) {
      await deleteBlobs(saved);
      await prisma.person.delete({ where: { id: person.id } }).catch(() => {});
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
