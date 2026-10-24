import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import type { Memory, MemorySource } from "@/generated/prisma/client";

/**
 * Memories: what the wearer says about a person during a Remember visit (or what a caregiver
 * types). Each one is kept in the speaker's own words and distilled into one short sentence the
 * glasses can say after the introduction. See CONTRACT.md "Remember".
 */

const MODEL = "claude-sonnet-5-5";
const MAX_TEXT = 1000;
const MAX_CALLOUT = 160;

export type MemoryJson = {
  id: string;
  personId: string;
  text: string;
  calloutText: string;
  useInCallout: boolean;
  source: MemorySource;
  createdAt: string;
  updatedAt: string;
};

export function serializeMemory(m: Memory): MemoryJson {
  return {
    id: m.id,
    personId: m.personId,
    text: m.text,
    calloutText: m.calloutText,
    useInCallout: m.useInCallout,
    source: m.source,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

const DISTILL_RULES = `You turn something an older person with memory loss said about a friend or relative into one short sentence that a pair of audio glasses will say to them later, right after "This is Sarah, your daughter."

Rules:
- Second person, present or past tense as fits: "She taught you to bake bread." "You two walked the dog every morning."
- One sentence, at most 15 words, plain spoken English. No quotation marks, no emoji, no preamble.
- Keep their facts; do not add any. Keep their warmth.
- If what they said is not a usable memory (empty, "I don't know", confused, a question, about someone else, or unkind), set usable to false and give your best gentle sentence anyway.

Reply with JSON only: {"callout": "...", "usable": true|false}`;

let client: Anthropic | null = null;

/** Plain fallback when no key is set: first sentence, trimmed, ending in a period. */
export function distillLocally(text: string): { callout: string; usable: boolean } {
  const first = text
    .trim()
    .split(/(?<=[.!?])\s+/)[0]
    ?.trim()
    .replace(/^["'“”]+|["'“”]+$/g, "");
  const cased = first ? first.charAt(0).toUpperCase() + first.slice(1) : "";
  const callout = cased ? (/[.!?]$/.test(cased) ? cased : `${cased}.`) : "";
  const words = callout.split(/\s+/).filter(Boolean).length;
  const vague = /^(i\s+)?(don'?t|do not|can'?t|cannot)\s+(know|remember|recall)/i.test(callout);
  return { callout: callout.slice(0, MAX_CALLOUT), usable: words >= 4 && !vague };
}

/** Distills raw words into a callout sentence. Falls back to local trimming without a key. */
export async function distill(text: string, person: { name: string; relationship: string | null }): Promise<{ callout: string; usable: boolean }> {
  if (!process.env.ANTHROPIC_API_KEY) return distillLocally(text);
  client ??= new Anthropic({ timeout: 15_000, maxRetries: 1 });
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 120,
      thinking: { type: "between_tools" },
      output_config: { effort: "low" },
      system: [{ type: "text", text: DISTILL_RULES, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: `The person: ${person.name}${person.relationship ? `, their ${person.relationship}` : ""}.\nWhat they said: """${text.trim()}"""`,
        },
      ],
    });
    const raw = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { callout?: unknown; usable?: unknown };
    const callout = typeof json.callout === "string" ? json.callout.trim().slice(0, MAX_CALLOUT) : "";
    if (!callout) return distillLocally(text);
    return { callout, usable: json.usable !== false };
  } catch (error) {
    console.error("[memories] distill failed, using local fallback:", error instanceof Error ? error.message : error);
    return distillLocally(text);
  }
}

export function cleanMemoryText(input: unknown, max = MAX_TEXT): string {
  if (typeof input !== "string") return "";
  return input.replace(/\s+/g, " ").trim().slice(0, max);
}

export function cleanCallout(input: unknown): string {
  return cleanMemoryText(input, MAX_CALLOUT);
}

/** Newest memory the glasses should say for this person, or null. */
export async function calloutFor(personId: string): Promise<string | null> {
  const m = await prisma.memory.findFirst({
    where: { personId, useInCallout: true },
    orderBy: { createdAt: "desc" },
    select: { calloutText: true },
  });
  return m?.calloutText ?? null;
}
