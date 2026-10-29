import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_CONTACTS_FILE, createApp } from "./app.ts";
import { claudeGenerator, type DraftGenerator } from "./drafts.ts";
import { localModelGenerator } from "./local.ts";

// 3000 is often taken by other local tools (Open WebUI, React dev servers), so default to 3005.
const port = Number(process.env.PORT || 3005);
const provider = (process.env.AI_PROVIDER || "claude").toLowerCase();

let generateDrafts: DraftGenerator;
let providerLabel: string;
if (provider === "local") {
  const baseUrl = process.env.LOCAL_AI_URL || "http://localhost:11434/v1";
  const model = process.env.LOCAL_AI_MODEL || "llama3.1:8b";
  generateDrafts = localModelGenerator({ baseUrl, model, apiKey: process.env.LOCAL_AI_API_KEY });
  providerLabel = `local model ${model} at ${baseUrl}`;
} else if (provider === "claude") {
  generateDrafts = claudeGenerator(new Anthropic());
  providerLabel = "Claude";
} else {
  console.error(`AI_PROVIDER must be "claude" or "local", not "${provider}". Fix it in your .env file.`);
  process.exit(1);
}

const server = createApp(generateDrafts).listen(port, () => {
  console.log(`SDR Outreach is running at http://localhost:${port} (drafting with ${providerLabel})`);
  console.log(`Saved contacts live in ${DEFAULT_CONTACTS_FILE}`);
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use by another program. Set PORT to a different number in your .env file and run npm start again.`);
    process.exit(1);
  }
  throw error;
});
