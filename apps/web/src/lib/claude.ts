import Anthropic from "@anthropic-ai/sdk";
import { buildContext } from "@/lib/context";

const MODEL = "claude-sonnet-5-5";

export class ClaudeError extends Error {
  name = "ClaudeError";
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Tone rules from CLAUDE.md "Voice and tone rules". Kept byte-stable so the prefix caches.
export const TONE_RULES = `You are the quiet voice in a pair of audio glasses worn by an older person living with dementia. Your words are spoken aloud into their ear. You help them answer three questions: who is this, what were we talking about, and where am I / what's next.

How to speak:
- Short, warm, declarative. One fact per sentence. Two or three sentences at most.
- When naming someone: name, relationship, then one note.
- Never correct, quiz, or test the wearer. Never say "you already asked that" or "as I said".
- If the same question comes again, give the same answer in the same words. Consistency is comfort.
- Never guess a name. Only name people from the enrolled list in the context. If you are not sure who someone is, say "Someone new is here."
- If the context does not contain the answer, say so gently and offer what you do know. Do not invent events, people, or plans.
- Plain spoken English only: no lists, no markdown, no emoji, no stage directions.
- Speak to the wearer directly as "you".`;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new ClaudeError(503, "ANTHROPIC_API_KEY is not set; cannot answer questions");
  return (client ??= new Anthropic({ timeout: 20_000, maxRetries: 1 }));
}

const GENTLE_FALLBACK = "I'm not sure right now. Let's ask your family together.";

/** Answers a wearer's question from the context packet. Returns plain text for speech. */
export async function answerQuestion(patientId: string, question: string): Promise<string> {
  const anthropic = getClient();
  const context = await buildContext(patientId);
  let response: Anthropic.Message;
  try {
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 200,
      // Short spoken answers: no reasoning pass, lowest latency.
      thinking: { type: "between_tools" },
      output_config: { effort: "low" },
      system: [
        { type: "text", text: TONE_RULES, cache_control: { type: "ephemeral" } },
        { type: "text", text: `Context right now:\n${context}` },
      ],
      messages: [{ role: "user", content: question }],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new ClaudeError(503, "Anthropic rejected the API key");
    if (error instanceof Anthropic.RateLimitError) throw new ClaudeError(503, "Anthropic rate limit hit; try again shortly");
    if (error instanceof Anthropic.APIError) throw new ClaudeError(502, `Claude API error ${error.status}: ${error.message}`);
    throw new ClaudeError(502, `Claude request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (response.stop_reason === "refusal") {
    console.warn("[claude] refusal", response.stop_details);
    return GENTLE_FALLBACK;
  }
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text || GENTLE_FALLBACK;
}

/** Normalizes a question for repeat detection. */
export function normalizeQuestion(q: string): string {
  return q
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when two normalized questions are near-identical (same words, small differences). */
export function isSameQuestion(a: string, b: string): boolean {
  if (a === b) return true;
  const wa = new Set(a.split(" ").filter(Boolean));
  const wb = new Set(b.split(" ").filter(Boolean));
  if (wa.size === 0 || wb.size === 0) return false;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / (wa.size + wb.size - inter) >= 0.8;
}
