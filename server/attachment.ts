import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { htmlToText } from "./website.ts";

/** Shown to the user when an attached file can't be used; the drafts still go ahead without it. */
export class AttachmentError extends Error {}

// Matches the website limit so both fit a small local model's context window together.
export const MAX_ATTACHMENT_CHARS = 2500;

const TEXT_TYPES = new Set([".txt", ".md", ".csv", ".tsv", ".json", ".log"]);
export const SUPPORTED_EXTENSIONS = [...TEXT_TYPES, ".html", ".htm", ".pdf"];

/** Turns an uploaded file (base64) into plain text the model can use as context. */
export async function readAttachment(file: { name: string; data: string }): Promise<string> {
  const extension = path.extname(file.name).toLowerCase();
  const bytes = Buffer.from(file.data, "base64");
  if (bytes.length === 0) throw new AttachmentError(`${file.name} is empty.`);

  let text: string;
  if (TEXT_TYPES.has(extension)) {
    text = bytes.toString("utf8");
  } else if (extension === ".html" || extension === ".htm") {
    text = htmlToText(bytes.toString("utf8"));
  } else if (extension === ".pdf") {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      text = (await extractText(pdf, { mergePages: true })).text;
    } catch {
      throw new AttachmentError(`Couldn't read ${file.name} as a PDF.`);
    }
  } else {
    throw new AttachmentError(`${file.name} isn't a supported file type. Use a PDF or a text file (${SUPPORTED_EXTENSIONS.join(", ")}).`);
  }

  const cleaned = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!cleaned) throw new AttachmentError(`${file.name} has no readable text (scanned PDFs aren't supported).`);
  return cleaned.slice(0, MAX_ATTACHMENT_CHARS);
}
