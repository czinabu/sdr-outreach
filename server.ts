// Entry point for the public copy on Vercel, which serves public/ itself and runs this app for /api.
// Each visitor brings their own model: an API key or a local model, called from their browser. So this copy never
// drafts with a key of its own, even if ANTHROPIC_API_KEY is set in the Vercel project, and it stores nothing.
import { createApp } from "./server/app.ts";
import { DraftError } from "./server/drafts.ts";

const noServerModel = async () => {
  throw new DraftError("Pick a model first: open Model settings and add your Anthropic API key, or choose LM Studio or Ollama.", 400);
};

export default createApp(noServerModel, undefined, { hosted: true, serverModel: { provider: "claude", hasApiKey: false } });
