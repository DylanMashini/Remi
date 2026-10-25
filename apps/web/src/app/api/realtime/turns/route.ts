import { requireSession } from "@/lib/auth";
import { logExchange } from "@/lib/asks";
import { errorResponse, HttpError, readJson } from "../../_lib/http";

const NOT_TRANSCRIBED = "(not transcribed)";
const MAX_LEN = 4000;

type Body = { sessionId?: unknown; question?: unknown; answer?: unknown; frame?: unknown; model?: unknown };

/**
 * POST /api/realtime/turns: one finished turn of a live conversation (the phone heard the wearer,
 * the model answered in its own voice). Logs QUESTION, ANSWER and SPOKEN like tap-to-ask does, so
 * the caregiver timeline and the repeat rule see conversations too.
 */
export async function POST(req: Request) {
  try {
    const { patientId } = await requireSession(req);
    const body = await readJson<Body>(req);
    const answer = typeof body.answer === "string" ? body.answer.replace(/\s+/g, " ").trim().slice(0, MAX_LEN) : "";
    if (!answer) throw new HttpError(400, "answer is required");
    const heard = typeof body.question === "string" ? body.question.replace(/\s+/g, " ").trim().slice(0, MAX_LEN) : "";
    const question = heard || NOT_TRANSCRIBED;
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.slice(0, 64) : null;
    const model = typeof body.model === "string" ? body.model.slice(0, 64) : null;

    const r = await logExchange(patientId, {
      question,
      answer,
      source: "chat",
      spokenByModel: true,
      skipRepeat: !heard,
      data: { frame: body.frame === true, sessionId, model, transcribed: Boolean(heard) },
    });
    return Response.json({ ok: true, questionEventId: r.questionEventId, repeat: r.repeat });
  } catch (error) {
    return errorResponse(error);
  }
}
