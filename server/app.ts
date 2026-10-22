import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DraftError, ProspectInput, type DraftGenerator, type DraftRequest } from "./drafts.ts";
import { AttachmentError, readAttachment } from "./attachment.ts";
import { PLAYBOOKS, playbookFor } from "./playbooks.ts";
import { WebsiteError, readWebsite } from "./website.ts";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

export function createApp(generateDrafts: DraftGenerator, fetchWebsite: typeof readWebsite = readWebsite) {
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
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(". ") });
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

  return app;
}
