import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { answerQuestion, isSameQuestion, normalizeQuestion } from "@/lib/claude";
import { logEvent } from "@/lib/events";
import { transcribe } from "@/lib/stt";
import { speechIdFor } from "@/lib/tts";
import { errorResponse, HttpError, readBytes, readJson } from "../_lib/http";

const REPEAT_WINDOW_MS = 2 * 60 * 60 * 1000;
const NOT_HEARD = "I didn't catch that. You can ask me again.";

/** Finds the answer given to a near-identical question in the last 2 hours. */
async function previousAnswer(patientId: string, normalized: string) {
  const since = new Date(Date.now() - REPEAT_WINDOW_MS);
  const questions = await prisma.event.findMany({
    where: { patientId, type: "QUESTION", createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, text: true, data: true },
  });
  for (const q of questions) {
    const data = (q.data ?? {}) as { normalized?: string };
    const norm = data.normalized ?? normalizeQuestion(q.text);
    if (!isSameQuestion(norm, normalized)) continue;
    const answer = await prisma.event.findFirst({
      where: { patientId, type: "ANSWER", data: { path: ["questionEventId"], equals: q.id } },
      select: { text: true },
    });
    if (answer) return { questionEventId: q.id, text: answer.text };
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const { patientId } = await requireSession(req);
    const contentType = req.headers.get("content-type") ?? "";

    let question: string;
    let source: "text" | "audio";
    if (contentType.includes("application/json")) {
      const body = await readJson<{ text?: unknown }>(req);
      if (typeof body.text !== "string" || !body.text.trim()) throw new HttpError(400, "text is required");
      question = body.text.trim();
      source = "text";
    } else {
      const wav = await readBytes(req, "audio/wav");
      question = await transcribe(wav);
      source = "audio";
    }

    if (!question) {
      // Nothing heard: answer gently, log nothing as a question.
      return Response.json({ question: "", answer: NOT_HEARD, speechId: speechIdFor(NOT_HEARD) });
    }

    const normalized = normalizeQuestion(question);
    const prior = await previousAnswer(patientId, normalized);
    const answer = prior ? prior.text : await answerQuestion(patientId, question);

    const qEvent = await logEvent(patientId, "QUESTION", question, {
      data: { normalized, source, repeat: Boolean(prior), ...(prior ? { repeatOf: prior.questionEventId } : {}) },
    });
    const speechId = speechIdFor(answer);
    await logEvent(patientId, "ANSWER", answer, { data: { questionEventId: qEvent.id, speechId, repeat: Boolean(prior) } });
    await logEvent(patientId, "SPOKEN", answer, { data: { speechId, source: "ask" } });

    return Response.json({ question, answer, speechId });
  } catch (error) {
    return errorResponse(error);
  }
}
