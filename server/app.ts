import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { DraftError, ProspectInput, claudeRequest, type DraftGenerator, type DraftRequest } from "./drafts.ts";
import { AttachmentError, readAttachment } from "./attachment.ts";
import { ContactNotFound, ContactStore, ContactUpdate, NewContact, STATUSES, contactsCsv, nextFollowUp, stepDue, today, type Contact } from "./contacts.ts";
import { BAD_FORMAT, localChatRequest, parseDrafts } from "./local.ts";
import { PLAYBOOKS, playbookFor } from "./playbooks.ts";
import { WebsiteError, readWebsite } from "./website.ts";

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(rootDir, "public");
export const DEFAULT_CONTACTS_FILE = path.join(rootDir, "data", "contacts.json");

/** A contact plus what the page needs to show it: its next follow-up and each step's due date. */
function withSchedule(contact: Contact) {
  const done = contact.sequence.filter((s) => s.doneAt).length;
  return {
    ...contact,
    nextFollowUp: nextFollowUp(contact),
    sequence: contact.sequence.map((step) => ({ ...step, due: stepDue(contact, step) })),
    progress: `${done} of ${contact.sequence.length}`,
  };
}

function issues(error: { issues: { message: string }[] }) {
  return error.issues.map((i) => i.message).join(". ");
}

/** What drafting on the server uses, from .env. The Model settings page shows it; no key is ever included. */
export type ServerModel = { provider: "claude"; hasApiKey: boolean } | { provider: "local"; baseUrl: string; model: string };

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

export function createApp(
  generateDrafts: DraftGenerator,
  fetchWebsite: typeof readWebsite = readWebsite,
  contacts = new ContactStore(DEFAULT_CONTACTS_FILE),
  serverModel: ServerModel = { provider: "claude", hasApiKey: false },
) {
  const app = express();
  app.disable("x-powered-by");

  // Only answer to this computer's own address. This stops a web page you visit from reaching your contacts
  // by pointing its own domain name at 127.0.0.1 (DNS rebinding).
  app.use((req, res, next) => {
    if (!LOCAL_HOSTS.has(req.hostname)) {
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
  // Large enough for a 10 MB attachment once base64-encoded.
  app.use(express.json({ limit: "15mb" }));
  app.use(express.static(publicDir));

  app.get("/api/industries", (_req, res) => {
    res.json(Object.entries(PLAYBOOKS).map(([key, playbook]) => ({ key, label: playbook.label, angles: playbook.angles })));
  });

  app.get("/api/model", (_req, res) => {
    res.json(serverModel);
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

  // --- Contacts --------------------------------------------------------------

  app.get("/api/contacts", (_req, res) => {
    res.json({ today: today(), statuses: STATUSES, contacts: contacts.list().map(withSchedule) });
  });

  app.get("/api/contacts.csv", (_req, res) => {
    res.attachment(`sdr-contacts-${today()}.csv`).type("text/csv").send(contactsCsv(contacts.list()));
  });

  app.post("/api/contacts", (req, res) => {
    const parsed = NewContact.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: issues(parsed.error) });
      return;
    }
    const { contact, created } = contacts.save(parsed.data);
    res.status(created ? 201 : 200).json(withSchedule(contact));
  });

  app.patch("/api/contacts/:id", (req, res) => {
    const parsed = ContactUpdate.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: issues(parsed.error) });
      return;
    }
    res.json(withSchedule(contacts.update(req.params.id, parsed.data)));
  });

  app.delete("/api/contacts/:id", (req, res) => {
    contacts.delete(req.params.id);
    res.status(204).end();
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!(error instanceof ContactNotFound)) return next(error);
    res.status(404).json({ error: error.message });
  });

  return app;
}
