import { z } from "zod";
import { DraftError, OutreachDrafts, SYSTEM_PROMPT, buildUserPrompt, type DraftGenerator, type DraftRequest } from "./drafts.ts";

export type LocalModelConfig = {
  /** Base URL of an OpenAI-compatible API, e.g. http://localhost:11434/v1 for Ollama. */
  baseUrl: string;
  model: string;
  apiKey?: string;
};

const draftsJsonSchema = z.toJSONSchema(OutreachDrafts);

// Small local models follow the schema more reliably when it is also spelled out in the prompt.
const LOCAL_SYSTEM_PROMPT = `${SYSTEM_PROMPT}

Reply with a single JSON object and nothing else. It must match this JSON schema:
${JSON.stringify(draftsJsonSchema)}`;

export const BAD_FORMAT = "The local model's reply wasn't in the expected format. Try again, or switch to a larger model.";

const ChatCompletion = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
});

/**
 * The chat completions request body for these drafts, without the model name. The server sends it itself,
 * and the Model settings page sends it straight from the browser to LM Studio or Ollama.
 */
export function localChatRequest(input: DraftRequest) {
  return {
    stream: false,
    messages: [
      { role: "system", content: LOCAL_SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(input) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "outreach_drafts", schema: draftsJsonSchema },
    },
  };
}

/** The drafts in a local model's reply, or null if the reply isn't valid drafts JSON. */
export function parseDrafts(content: string): OutreachDrafts | null {
  const drafts = OutreachDrafts.safeParse(parseJson(content));
  return drafts.success ? drafts.data : null;
}

/** Drafts outreach with a local or self-hosted model (Ollama, Open WebUI, LM Studio) over the OpenAI chat completions API. */
export function localModelGenerator(config: LocalModelConfig, fetchImpl: typeof fetch = fetch): DraftGenerator {
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  return async (input) => {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: config.model, ...localChatRequest(input) }),
      });
    } catch {
      throw new DraftError(`Couldn't reach your local AI at ${config.baseUrl}. Make sure Ollama (or your AI server) is running.`);
    }

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      if (response.status === 404 && /model/i.test(detail)) {
        throw new DraftError(`Your local AI doesn't have the model "${config.model}". Download it first (for Ollama: ollama pull ${config.model}).`);
      }
      if (response.status === 401 || response.status === 403) {
        throw new DraftError("Your local AI server rejected the request. Check LOCAL_AI_API_KEY in your .env file.");
      }
      throw new DraftError(`Your local AI returned an error (${response.status}): ${detail}`);
    }

    const completion = ChatCompletion.safeParse(await response.json());
    const content = completion.success ? completion.data.choices[0].message.content : null;
    const drafts = content ? parseDrafts(content) : null;
    if (!drafts) throw new DraftError(BAD_FORMAT);
    return drafts;
  };
}

function parseJson(text: string): unknown {
  // Some models wrap JSON in a ```json code fence despite instructions.
  const unfenced = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(unfenced);
  } catch {
    return null;
  }
}
