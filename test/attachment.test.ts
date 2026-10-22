import assert from "node:assert/strict";
import { test } from "node:test";
import { AttachmentError, MAX_ATTACHMENT_CHARS, readAttachment } from "../server/attachment.ts";

// A one-page PDF containing "Case study: Acme cut no-shows by 30 percent".
const PDF_BASE64 = "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAzMDAgMTQ0XSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA3NCA+PgpzdHJlYW0KQlQgL0YxIDEyIFRmIDIwIDEwMCBUZCAoQ2FzZSBzdHVkeTogQWNtZSBjdXQgbm8tc2hvd3MgYnkgMzAgcGVyY2VudCkgVGogRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDAzNjUgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo0MzUKJSVFT0YK";

const encode = (text: string) => Buffer.from(text).toString("base64");

test("reads text files", async () => {
  assert.equal(await readAttachment({ name: "notes.TXT", data: encode("Budget  approved\n\n\n\nfor Q3") }), "Budget approved\n\nfor Q3");
});

test("reads text from PDFs", async () => {
  assert.match(await readAttachment({ name: "case-study.pdf", data: PDF_BASE64 }), /Acme cut no-shows by 30 percent/);
});

test("trims long files to fit small models", async () => {
  const text = await readAttachment({ name: "big.csv", data: encode("a,b\n".repeat(5000)) });
  assert.ok(text.length <= MAX_ATTACHMENT_CHARS);
});

test("explains unsupported, empty and broken files", async () => {
  await assert.rejects(readAttachment({ name: "deck.pptx", data: encode("x") }), (e) => e instanceof AttachmentError && /PDF or a text file/.test(e.message));
  await assert.rejects(readAttachment({ name: "empty.txt", data: "" }), /is empty/);
  await assert.rejects(readAttachment({ name: "fake.pdf", data: encode("not a pdf") }), /Couldn't read fake\.pdf/);
});
