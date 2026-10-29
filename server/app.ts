import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DraftError, ProspectInput, type DraftGenerator, type DraftRequest } from "./drafts.ts";
import { AttachmentError, readAttachment } from "./attachment.ts";
import { ContactNotFound, ContactStore, ContactUpdate, NewContact, STATUSES, contactsCsv, nextFollowUp, stepDue, today, type Contact } from "./contacts.ts";
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

export function createApp(
  generateDrafts: DraftGenerator,
  fetchWebsite: typeof readWebsite = readWebsite,
  contacts = new ContactStore(DEFAULT_CONTACTS_FILE),
) {
  const app = express();
  // Large enough for a 10 MB attachment once base64-encoded.
  app.use(express.json({ limit: "15mb" }));
  app.use(express.static(publicDir));

  app.get("/api/industries", (_req, res) => {
    res.json(Object.entries(PLAYBOOKS).map(([key, playbook]) => ({ key, label: playbook.label, angles: playbook.angles })));
  });

  app.post("/api/drafts", async (req, res) => {
    const parsed = ProspectInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: issues(parsed.error) });
      return;
    }

    const request: DraftRequest = { ...parsed.data };
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

    try {
      const drafts = await generateDrafts(request);
      const playbook = playbookFor(request.industry) ?? PLAYBOOKS.general;
      res.json({ ...drafts, cadence: playbook.cadence, channelTip: playbook.channels, websiteNote, attachmentNote });
    } catch (error) {
      if (error instanceof DraftError) {
        res.status(error.status).json({ error: error.message });
      } else {
        console.error(error);
        res.status(502).json({ error: "Something went wrong while drafting. Try again." });
      }
    }
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
