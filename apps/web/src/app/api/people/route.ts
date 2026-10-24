import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { embedFaces, FaceServiceError, type DetectedFace } from "@/lib/face";
import { invalidateRoster, knownLine } from "@/lib/match";
import { deleteBlobs, saveFile } from "@/lib/storage";
import { listPeople } from "@/lib/people";
import type { File as FileRow } from "@/generated/prisma/client";
import { errorResponse, HttpError } from "../_lib/http";

const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const AVATAR_SIZE = 160;

export async function GET(req: Request) {
  try {
    const { patientId } = await requireSession(req);
    return Response.json({ people: await listPeople(patientId) });
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

/** Square crop around the face, padded 30%, clamped to the image, resized to 160x160 JPEG. */
async function avatarFrom(jpeg: Buffer, box: [number, number, number, number]): Promise<Buffer> {
  const meta = await sharp(jpeg).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const [x, y, w, h] = box;
  const side = Math.min(Math.round(Math.max(w, h) * 1.3), W, H);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const left = Math.max(0, Math.min(W - side, Math.round(cx - side / 2)));
  const top = Math.max(0, Math.min(H - side, Math.round(cy - side / 2)));
  return sharp(jpeg)
    .extract({ left, top, width: Math.max(1, side), height: Math.max(1, side) })
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover" })
    .jpeg({ quality: 85 })
    .toBuffer();
}

/** `faces` form field: JSON `[[x, y, w, h], ...]`, one box per photo, in pixels of the uploaded JPEG. */
function parsePhoneBoxes(raw: FormDataEntryValue | null, count: number): [number, number, number, number][] | null {
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
    return b.map((v) => Math.max(0, Math.round(v))) as [number, number, number, number];
  });
}

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

    // Face boxes the phone found itself (on-device recognition). Used only if the sidecar is down.
    const phoneBoxes = parsePhoneBoxes(form.get("faces"), photos.length);

    // 1. Validate every photo has a face before saving anything.
    const prepared: { jpeg: Buffer; face: DetectedFace | null; box: [number, number, number, number] }[] = [];
    for (let index = 0; index < photos.length; index++) {
      const photo = photos[index];
      if (photo.size > MAX_PHOTO_BYTES) throw new HttpError(413, "Photo is too large", { index });
      let jpeg: Buffer;
      try {
        // Apply EXIF rotation and strip metadata (including GPS) before anything else sees it.
        jpeg = await sharp(Buffer.from(await photo.arrayBuffer())).rotate().jpeg({ quality: 90 }).toBuffer();
      } catch {
        throw new HttpError(422, "Photo is not a readable image", { index });
      }
      let faces: DetectedFace[];
      try {
        faces = await embedFaces(jpeg);
      } catch (error) {
        // The phone already checked for a face and will match on-device; store the photo without a
        // server embedding rather than failing enrollment because the Python sidecar is offline.
        if (!(error instanceof FaceServiceError) || !phoneBoxes) throw error;
        console.warn(`[people] face sidecar unavailable; trusting phone box for photo ${index}`);
        prepared.push({ jpeg, face: null, box: phoneBoxes[index] });
        continue;
      }
      if (faces.length === 0) throw new HttpError(422, "No face found in photo", { index });
      prepared.push({ jpeg, face: faces[0], box: faces[0].box }); // largest face first
    }

    // 2. Save. On any failure, roll back the person and blobs.
    const person = await prisma.person.create({ data: { patientId, name, relationship, notes } });
    const saved: FileRow[] = [];
    try {
      const samples = [];
      for (const p of prepared) {
        const file = await saveFile({ patientId, personId: person.id, kind: "FACE_PHOTO", bytes: p.jpeg, contentType: "image/jpeg" });
        saved.push(file);
        if (p.face) {
          samples.push(
            await prisma.faceSample.create({ data: { personId: person.id, fileId: file.id, embedding: p.face.embedding } }),
          );
        }
      }
      const avatar = await saveFile({
        patientId,
        personId: person.id,
        kind: "AVATAR",
        bytes: await avatarFrom(prepared[0].jpeg, prepared[0].box),
        contentType: "image/jpeg",
      });
      saved.push(avatar);
      const updated = await prisma.person.update({ where: { id: person.id }, data: { avatarFileId: avatar.id } });
      invalidateRoster(patientId);
      return Response.json(
        {
          person: {
            id: updated.id,
            name: updated.name,
            relationship: updated.relationship,
            notes: updated.notes,
            avatarUrl: `/api/files/${avatar.id}`,
            photoUrl: `/api/files/${saved[0].id}`,
            photoUrls: saved.filter((f) => f.kind === "FACE_PHOTO").map((f) => `/api/files/${f.id}`),
            samples: samples.length,
            lastSeenAt: null,
            line: knownLine({ ...updated, memory: null }),
            memoryCount: 0,
            lastRememberedAt: null,
          },
          samples: samples.length,
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
