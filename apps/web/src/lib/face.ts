/** Client for the local InsightFace sidecar (apps/face). */

export type DetectedFace = {
  box: [number, number, number, number];
  det_score: number;
  embedding: number[];
};

export class FaceServiceError extends Error {
  status = 503;
  name = "FaceServiceError";
}

const FACE_URL = () => (process.env.FACE_URL || "http://127.0.0.1:8001").replace(/\/$/, "");
const TIMEOUT_MS = 3000;

/** Detects and embeds faces in a JPEG. Faces come back largest first. */
export async function embedFaces(jpeg: Buffer | Uint8Array): Promise<DetectedFace[]> {
  const url = `${FACE_URL()}/embed`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "image/jpeg" },
      body: new Uint8Array(jpeg),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out after 3 s" : "is not reachable";
    throw new FaceServiceError(`Face service at ${FACE_URL()} ${reason}. Start it with apps/face (uv run ...).`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new FaceServiceError(`Face service returned ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { faces?: DetectedFace[] };
  return json.faces ?? [];
}
