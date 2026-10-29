import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { DraftError, ProspectInput, claudeRequest, type DraftGenerator, type DraftRequest } from "./drafts.ts";
import { AttachmentError, readAttachment } from "./attachment.ts";
import { BAD_FORMAT, localChatRequest, parseDrafts } from "./local.ts";
import { PLAYBOOKS, playbookFor } from "./playbooks.ts";
import { WebsiteError, readWebsite } from "./website.ts";

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(rootDir, "public");
/** Where older versions saved contacts. They now live in each browser; this file is only read to move them there. */
export const LEGACY_CONTACTS_FILE = path.join(rootDir, "data", "contacts.json");

function issues(error: { issues: { message: string }[] }) {
  return error.issues.map((i) => i.message).join(". ");
}

/** What drafting on the server uses, from .env. The Model settings page shows it; no key is ever included. */
export type ServerModel = { provider: "claude"; hasApiKey: boolean } | { provider: "local"; baseUrl: string; model: string };

export type AppOptions = {
  serverModel?: ServerModel;
  /**
   * Running as a public website (Vercel) rather than on the user's own computer. Then any visitor can call the API,
   * so the host check is off, requests are rate limited, and old contact files are never served.
   */
  hosted?: boolean;
  legacyContactsFile?: string;
};

// Vercel functions refuse request bodies over 4.5 MB, so a hosted copy takes smaller files.
export const HOSTED_MAX_FILE_BYTES = 3 * 1024 * 1024;
export const LOCAL_MAX_FILE_BYTES = 10 * 1024 * 1024;

/** A rough per-visitor limit, so a public copy can't be used as a free website fetcher. */
function rateLimit(limit: number, windowMs: number): express.RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip ?? "unknown";
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      if (hits.size > 10_000) hits.clear();
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    if (++entry.count > limit) {
      res.status(429).json({ error: "Too many drafts in a short time. Wait a minute and try again." });
      return;
    }
    next();
  };
}

/** A model reply the browser got from Anthropic, LM Studio or Ollama, sent back here to be checked. */
const ModelReply = z.object({
  industry: z.string().default(""),
  content: z.string().max(200_000),
});

// The page talks to Anthropic and to model servers on this computer, and nothing else.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self' https://api.anthropic.com http://localhost:* http://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Reads the website and attached file for a draft. Either can fail; the drafts then go ahead without it. */
async function gatherContext(request: DraftRequest, fetchWebsite: typeof readWebsite) {
  let websiteNote: string | undefined;
  if (request.companyWebsite) {
    try {
      request.websiteText = await fetchWebsite(request.companyWebsite);
    } catch (error) {
      if (!(error instanceof WebsiteError)) console.error(error);
      const reason = error instanceof WebsiteError ? `${error.message} ` : "";
      websiteNote = `${reason}These drafts don't use the website, so check the opener before sending.`;
    }
  }

  let attachmentNote: string | undefined;
  if (request.attachment) {
    try {
      request.attachmentText = await readAttachment(request.attachment);
    } catch (error) {
      if (!(error instanceof AttachmentError)) console.error(error);
      const reason = error instanceof AttachmentError ? `${error.message} ` : `Couldn't read ${request.attachment.name}. `;
      attachmentNote = `${reason}These drafts don't use the file.`;
    }
  }
  return { websiteNote, attachmentNote };
}

function playbookExtras(industry: string) {
  const playbook = playbookFor(industry) ?? PLAYBOOKS.general;
  return { cadence: playbook.cadence, channelTip: playbook.channels };
}

export function createApp(generateDrafts: DraftGenerator, fetchWebsite: typeof readWebsite = readWebsite, options: AppOptions = {}) {
  const { serverModel = { provider: "claude", hasApiKey: false }, hosted = false, legacyContactsFile = LEGACY_CONTACTS_FILE } = options;
  const app = express();
  app.disable("x-powered-by");
  // Vercel sits in front of the app, so the visitor's address is in X-Forwarded-For.
  if (hosted) app.set("trust proxy", true);

  // On your own computer, only answer to this computer's own address. This stops a web page you visit from
  // reaching the app by pointing its own domain name at 127.0.0.1 (DNS rebinding).
  app.use((req, res, next) => {
    if (!hosted && !LOCAL_HOSTS.has(req.hostname)) {
      res.status(403).send("SDR Outreach only answers on localhost.");
      return;
    }
    res.set({
      "Content-Security-Policy": CONTENT_SECURITY_POLICY,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Opener-Policy": "same-origin",
    });
    next();
  });
  // Large enough for the biggest allowed attachment once base64-encoded.
  app.use(express.json({ limit: hosted ? "4.5mb" : "15mb" }));
  if (hosted) app.use("/api/drafts", rateLimit(20, 60_000));
  app.use(express.static(publicDir));

  app.get("/api/industries", (_req, res) => {
    res.json(Object.entries(PLAYBOOKS).map(([key, playbook]) => ({ key, label: playbook.label, angles: playbook.angles })));
  });

  app.get("/api/model", (_req, res) => {
    res.json({ ...serverModel, hosted, maxFileBytes: hosted ? HOSTED_MAX_FILE_BYTES : LOCAL_MAX_FILE_BYTES });
  });

  app.post("/api/drafts", async (req, res) => {
    const parsed = ProspectInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: issues(parsed.error) });
      return;
    }

    const request: DraftRequest = { ...parsed.data };
    const notes = await gatherContext(request, fetchWebsite);
    try {
      const drafts = await generateDrafts(request);
      res.json({ ...drafts, ...playbookExtras(request.industry), ...notes });
    } catch (error) {
      if (error instanceof DraftError) {
        res.status(error.status).json({ error: error.message });
      } else {
        console.error(error);
        res.status(502).json({ error: "Something went wrong while drafting. Try again." });
      }
    }
  });

  // When the browser calls the model itself: build the request bodies here, so the prompt lives in one place.
  app.post("/api/drafts/prompt", async (req, res) => {
    const parsed = ProspectInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: issues(parsed.error) });
      return;
    }
    const request: DraftRequest = { ...parsed.data };
    const notes = await gatherContext(request, fetchWebsite);
    res.json({ claude: claudeRequest(request), local: localChatRequest(request), ...notes });
  });

  // ...then check the model's reply and add the industry's follow-up sequence.
  app.post("/api/drafts/parse", (req, res) => {
    const parsed = ModelReply.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: issues(parsed.error) });
      return;
    }
    const drafts = parseDrafts(parsed.data.content);
    if (!drafts) {
      res.status(422).json({ error: BAD_FORMAT });
      return;
    }
    res.json({ ...drafts, ...playbookExtras(parsed.data.industry) });
  });

  // Contacts saved by older versions, so the page can move them into the browser once. Never on a public copy.
  app.get("/api/legacy-contacts", (_req, res) => {
    let contacts: unknown[] = [];
    if (!hosted) {
      try {
        contacts = JSON.parse(fs.readFileSync(legacyContactsFile, "utf8")).contacts ?? [];
      } catch {
        // No old file: nothing to move.
      }
    }
    res.json({ contacts });
  });

  return app;
}
