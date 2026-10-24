import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { del, get, put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import type { File as FileRow, FileKind } from "@/generated/prisma/client";

/**
 * Enrollment photos and avatars. Uses Vercel Blob (private access) when BLOB_READ_WRITE_TOKEN
 * is set; otherwise falls back to local disk under apps/web/.cache/blobs so dev works offline.
 * Files are only ever served through /api/files/[id]; raw URLs never leave the server.
 */

const LOCAL_PREFIX = "local:";
const LOCAL_ROOT = path.join(process.cwd(), ".cache", "blobs");

function blobToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || undefined;
}

function localPath(pathname: string): string {
  const full = path.resolve(LOCAL_ROOT, pathname);
  if (!full.startsWith(LOCAL_ROOT + path.sep)) throw new Error("Invalid local blob path");
  return full;
}

export async function saveFile(opts: {
  patientId: string;
  personId: string;
  kind: FileKind;
  bytes: Buffer;
  contentType: string;
}): Promise<FileRow> {
  const ext = opts.contentType === "image/jpeg" ? "jpg" : "bin";
  // Unguessable pathname even though access is private.
  const pathname = `patients/${opts.patientId}/people/${opts.personId}/${opts.kind.toLowerCase()}-${randomBytes(16).toString("hex")}.${ext}`;
  let url: string;
  const token = blobToken();
  if (token) {
    const result = await put(pathname, opts.bytes, {
      access: "private",
      contentType: opts.contentType,
      addRandomSuffix: false,
      token,
    });
    url = result.url;
  } else {
    const full = localPath(pathname);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, opts.bytes);
    url = `${LOCAL_PREFIX}${pathname}`;
  }
  return prisma.file.create({
    data: {
      patientId: opts.patientId,
      personId: opts.personId,
      kind: opts.kind,
      url,
      pathname,
      contentType: opts.contentType,
      size: opts.bytes.length,
    },
  });
}

/** Returns the file body as a stream or buffer, or null if the object is gone. */
export async function openFile(file: Pick<FileRow, "url" | "pathname">): Promise<ReadableStream | Buffer | null> {
  if (file.url.startsWith(LOCAL_PREFIX)) {
    try {
      return await readFile(localPath(file.pathname));
    } catch {
      return null;
    }
  }
  const token = blobToken();
  if (!token) throw Object.assign(new Error("BLOB_READ_WRITE_TOKEN is not set; cannot read Vercel Blob file"), { status: 503 });
  const result = await get(file.url, { access: "private", token });
  return result?.stream ?? null;
}

/** Deletes blob objects. Best effort: logs and continues on failure. */
export async function deleteBlobs(files: Pick<FileRow, "url" | "pathname">[]) {
  const remote = files.filter((f) => !f.url.startsWith(LOCAL_PREFIX)).map((f) => f.url);
  const local = files.filter((f) => f.url.startsWith(LOCAL_PREFIX));
  await Promise.all(local.map((f) => rm(localPath(f.pathname), { force: true }).catch((e) => console.error("[storage] local delete failed", e))));
  if (remote.length) {
    const token = blobToken();
    if (!token) {
      console.error(`[storage] cannot delete ${remote.length} Vercel Blob objects: BLOB_READ_WRITE_TOKEN is not set`);
      return;
    }
    await del(remote, { token }).catch((e) => console.error("[storage] blob delete failed", e));
  }
}
