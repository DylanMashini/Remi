import { randomUUID } from "node:crypto";
import { requireSession } from "@/lib/auth";
import { recentExchanges } from "@/lib/asks";
import { buildContext } from "@/lib/context";
import { createChatSession } from "@/lib/realtime";
import { errorResponse } from "../../_lib/http";

/**
 * POST /api/realtime/session: a short-lived client secret for one live conversation. The phone
 * opens its own WebSocket to OpenAI with it; audio never touches this server. The session config
 * (tone rules, context packet, recent answers, turn detection) is baked into the secret.
 */
export async function POST(req: Request) {
  try {
    const { patientId } = await requireSession(req);
    const [context, exchanges] = await Promise.all([buildContext(patientId), recentExchanges(patientId)]);
    const session = await createChatSession({ patientId, context, exchanges });
    const sessionId = randomUUID();
    const td = session.turnDetection;
    console.log(
      `[realtime] chat session ${sessionId} for patient ${patientId}: ${session.model}, voice ${session.voice}, ` +
        (td.type === "server_vad" ? `server_vad silence ${td.silence_duration_ms} ms` : `semantic_vad eagerness ${td.eagerness}`) +
        `, barge-in ${session.bargeIn ? "on" : "off"}`,
    );
    return Response.json({ sessionId, ...session });
  } catch (error) {
    return errorResponse(error);
  }
}
