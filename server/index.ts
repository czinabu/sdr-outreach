import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import { LEGACY_CONTACTS_FILE, createApp, type ServerModel } from "./app.ts";
import { DraftError, claudeGenerator, type DraftGenerator } from "./drafts.ts";
import { localModelGenerator } from "./local.ts";

// 3000 is often taken by other local tools (Open WebUI, React dev servers), so default to 3005.
const port = Number(process.env.PORT || 3005);
const provider = (process.env.AI_PROVIDER || "claude").toLowerCase();

let generateDrafts: DraftGenerator;
let providerLabel: string;
let serverModel: ServerModel;
if (provider === "local") {
  const baseUrl = process.env.LOCAL_AI_URL || "http://localhost:11434/v1";
  const model = process.env.LOCAL_AI_MODEL || "llama3.1:8b";
  generateDrafts = localModelGenerator({ baseUrl, model, apiKey: process.env.LOCAL_AI_API_KEY });
  providerLabel = `local model ${model} at ${baseUrl}`;
  serverModel = { provider: "local", baseUrl, model };
} else if (provider === "claude") {
  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
  // Without a key in .env, drafting goes through the Model settings page (a key kept in the browser, or a local model).
  generateDrafts = hasApiKey
    ? claudeGenerator(new Anthropic())
    : async () => {
        throw new DraftError("Pick a model first: open Model settings and add your Anthropic API key, or choose LM Studio or Ollama.", 400);
      };
  providerLabel = hasApiKey ? "Claude" : "the model chosen on the Model settings page";
  serverModel = { provider: "claude", hasApiKey };
} else {
  console.error(`AI_PROVIDER must be "claude" or "local", not "${provider}". Fix it in your .env file.`);
  process.exit(1);
}

// Listen on this computer only, so nobody else on your network can open the app or your contacts.
const server = createApp(generateDrafts, undefined, { serverModel }).listen(port, "127.0.0.1", () => {
  console.log(`SDR Outreach is running at http://localhost:${port} (drafting with ${providerLabel})`);
  console.log("Saved contacts live in your browser. Use Back up on the Contacts page to keep a copy.");
  if (fs.existsSync(LEGACY_CONTACTS_FILE)) {
    console.log(`Contacts from ${LEGACY_CONTACTS_FILE} are copied into your browser the first time you open the app.`);
  }
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use by another program. Set PORT to a different number in your .env file and run npm start again.`);
    process.exit(1);
  }
  throw error;
});
