import { prisma } from "@/lib/prisma";
import { isSameQuestion, normalizeQuestion } from "@/lib/claude";
import { logEvent } from "@/lib/events";
import { speechIdFor } from "@/lib/tts";

/** Questions asked in this window get the same answer in the same words (see CLAUDE.md tone rules). */
export const REPEAT_WINDOW_MS = 2 * 60 * 60 * 1000;

export type Exchange = { questionEventId: string; question: string; answer: string; at: Date };

/** Every question of the last 2 h with the answer that was given, newest first. */
export async function recentExchanges(patientId: string, limit = 50): Promise<Exchange[]> {
  const since = new Date(Date.now() - REPEAT_WINDOW_MS);
  const questions = await prisma.event.findMany({
    where: { patientId, type: "QUESTION", createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, text: true, createdAt: true },
  });
  if (questions.length === 0) return [];
  const answers = await prisma.event.findMany({
    where: { patientId, type: "ANSWER", createdAt: { gte: since } },
    select: { text: true, data: true },
  });
  const byQuestion = new Map<string, string>();
  for (const a of answers) {
    const qid = (a.data as { questionEventId?: string } | null)?.questionEventId;
    if (qid && !byQuestion.has(qid)) byQuestion.set(qid, a.text);
  }
  return questions.flatMap((q) => {
    const answer = byQuestion.get(q.id);
    return answer ? [{ questionEventId: q.id, question: q.text, answer, at: q.createdAt }] : [];
  });
}

/** Finds the answer given to a near-identical question in the last 2 hours. */
export async function previousAnswer(patientId: string, normalized: string) {
  for (const x of await recentExchanges(patientId)) {
    if (isSameQuestion(normalizeQuestion(x.question), normalized)) {
      return { questionEventId: x.questionEventId, text: x.answer };
    }
  }
  return null;
}

export type ExchangeLog = {
  question: string;
  answer: string;
  /** "ask" for tap-to-ask, "chat" for the live conversation. */
  source: "ask" | "chat";
  /** Extra fields for the QUESTION row (`frame`, `model`, `sessionId`, ...). */
  data?: Record<string, string | number | boolean | null>;
  /** Set when the words were already spoken by the model's own voice (chat); no speechId is minted. */
  spokenByModel?: boolean;
  /** Skip repeat detection (the question text is a placeholder, not the wearer's words). */
  skipRepeat?: boolean;
};

/**
 * Writes one question and its answer to the memory log: QUESTION (with repeat detection), ANSWER
 * and SPOKEN. Returns the repeat verdict so callers can tell the caregiver.
 */
export async function logExchange(patientId: string, x: ExchangeLog) {
  const normalized = normalizeQuestion(x.question);
  const prior = x.question && !x.skipRepeat ? await previousAnswer(patientId, normalized) : null;
  const qEvent = await logEvent(patientId, "QUESTION", x.question, {
    data: {
      normalized,
      source: x.source,
      repeat: Boolean(prior),
      ...(prior ? { repeatOf: prior.questionEventId } : {}),
      ...(x.data ?? {}),
    },
  });
  const speechId = x.spokenByModel ? null : speechIdFor(x.answer);
  await logEvent(patientId, "ANSWER", x.answer, {
    data: { questionEventId: qEvent.id, speechId, repeat: Boolean(prior), source: x.source, ...(x.data?.model ? { model: x.data.model } : {}) },
  });
  await logEvent(patientId, "SPOKEN", x.answer, { data: { speechId, source: x.source } });
  return { questionEventId: qEvent.id, repeat: Boolean(prior), prior, speechId };
}
