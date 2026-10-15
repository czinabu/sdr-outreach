import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DraftRefusedError, ProspectInput, generateDrafts } from "./drafts.ts";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

export function createApp(client: Anthropic) {
  const app = express();
  app.use(express.json({ limit: "100kb" }));
  app.use(express.static(publicDir));

  app.post("/api/drafts", async (req, res) => {
    const parsed = ProspectInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(". ") });
      return;
    }
    try {
      res.json(await generateDrafts(client, parsed.data));
    } catch (error) {
      if (error instanceof DraftRefusedError) {
        res.status(422).json({ error: error.message });
      } else if (error instanceof Anthropic.AuthenticationError) {
        res.status(500).json({ error: "The Anthropic API key is missing or invalid. Check your .env file." });
      } else if (error instanceof Anthropic.RateLimitError) {
        res.status(429).json({ error: "Too many requests right now. Wait a minute and try again." });
      } else {
        console.error(error);
        res.status(502).json({ error: "Something went wrong while drafting. Try again." });
      }
    }
  });

  return app;
}
