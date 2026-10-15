import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export const ProspectInput = z.object({
  prospectName: z.string().trim().min(1, "Prospect name is required"),
  prospectTitle: z.string().trim().min(1, "Prospect title is required"),
  company: z.string().trim().min(1, "Company is required"),
  industry: z.string().trim().default(""),
  notes: z.string().trim().default(""),
  yourName: z.string().trim().min(1, "Your name is required"),
  yourOffer: z.string().trim().min(1, "Describe what you sell"),
  goal: z.string().trim().default("Book a 15-minute intro call"),
  tone: z.enum(["friendly", "professional", "direct"]).default("friendly"),
});
export type ProspectInput = z.infer<typeof ProspectInput>;

const Why = z
  .string()
  .describe("One or two plain-language sentences a new SDR can learn from: why this draft is written the way it is.");

export const OutreachDrafts = z.object({
  linkedin: z.object({
    connectionNote: z.string().describe("LinkedIn connection request note, 300 characters or fewer"),
    followUpMessage: z.string().describe("Message to send after they accept the connection"),
    why: Why,
  }),
  email: z.object({
    subject: z.string(),
    body: z.string(),
    why: Why,
  }),
  phone: z.object({
    opener: z.string().describe("First 20-30 seconds of a cold call, written to be read aloud"),
    discoveryQuestions: z.array(z.string()).describe("Two or three open questions to ask if they engage"),
    voicemail: z.string().describe("Voicemail under 30 seconds"),
    why: Why,
  }),
  researchToDo: z
    .array(z.string())
    .describe("Two to four quick things to look up about this prospect that would make the outreach more personal"),
});
export type OutreachDrafts = z.infer<typeof OutreachDrafts>;

export const SYSTEM_PROMPT = `You are an experienced sales development coach helping an SDR write first-touch outreach.
The SDR may be brand new to prospecting, so every draft must be ready to send as written, and each "why" note should teach one principle in plain words (no jargon such as "pattern interrupt" without explaining it).

Write like a real person, not a marketer:
- Lead with something specific to the prospect or their role, then connect it to the offer.
- Keep it short: LinkedIn notes under 300 characters, emails under 120 words, a phone opener someone can say in one breath or two.
- Ask for one small, clear next step that matches the SDR's goal.
- Never invent facts about the prospect or their company. If the notes are thin, write around the role and industry instead, and list what to research in researchToDo.
- No placeholders like [Company] in the drafts; use the details given.`;

export function buildUserPrompt(input: ProspectInput): string {
  return [
    `Prospect: ${input.prospectName}, ${input.prospectTitle} at ${input.company}`,
    input.industry && `Industry: ${input.industry}`,
    `What the SDR knows about them: ${input.notes || "nothing beyond their name, title and company"}`,
    `SDR's name: ${input.yourName}`,
    `What the SDR sells: ${input.yourOffer}`,
    `Goal of the outreach: ${input.goal}`,
    `Tone: ${input.tone}`,
    "",
    "Draft the LinkedIn, email and phone outreach for this prospect.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Shown to the user as-is: the drafting request failed in a way they can act on. */
export class DraftError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

export type DraftGenerator = (input: ProspectInput) => Promise<OutreachDrafts>;

export function claudeGenerator(client: Anthropic): DraftGenerator {
  return async (input) => {
    try {
      return await generateWithClaude(client, input);
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) {
        throw new DraftError("The Anthropic API key is missing or invalid. Check ANTHROPIC_API_KEY in your .env file.", 500);
      }
      if (error instanceof Anthropic.RateLimitError) {
        throw new DraftError("Too many requests right now. Wait a minute and try again.", 429);
      }
      throw error;
    }
  };
}

async function generateWithClaude(client: Anthropic, input: ProspectInput): Promise<OutreachDrafts> {
  const response = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(OutreachDrafts) },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(input) }],
  });

  if (response.stop_reason === "refusal") {
    throw new DraftError("Claude declined to write this outreach. Try rewording the notes or offer.", 422);
  }
  if (!response.parsed_output) {
    throw new Error(`Claude returned no usable drafts (stop reason: ${response.stop_reason})`);
  }
  return response.parsed_output;
}
