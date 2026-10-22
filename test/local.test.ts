import assert from "node:assert/strict";
import { test } from "node:test";
import { DraftError, type OutreachDrafts, type ProspectInput } from "../server/drafts.ts";
import { localModelGenerator } from "../server/local.ts";

const drafts: OutreachDrafts = {
  websiteHook: "",
  linkedin: { connectionNote: "Hi Dana", followUpMessage: "Thanks for connecting", why: "Short." },
  email: { subject: "Second location", body: "Hi Dana,", why: "Specific." },
  phone: { opener: "Hi Dana", discoveryQuestions: ["How do you handle no-shows?"], voicemail: "Hi Dana", why: "Polite." },
  researchToDo: ["Check their posts"],
};

const input: ProspectInput = {
  prospectName: "Dana Lee",
  prospectTitle: "Office Manager",
  company: "Bright Smiles Dental",
  industry: "",
  notes: "",
  yourName: "Caleb",
  yourOffer: "Scheduling software",
  goal: "Book a call",
  tone: "friendly",
  companyWebsite: "",
  attachmentDescription: "",
};

const config = { baseUrl: "http://localhost:11434/v1/", model: "llama3.1:8b", apiKey: "secret" };

function replyWith(content: string, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const body = status === 200 ? JSON.stringify({ choices: [{ message: { content } }] }) : content;
    return new Response(body, { status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

test("sends an OpenAI-style request and returns validated drafts", async () => {
  const { calls, fetchImpl } = replyWith(JSON.stringify(drafts));
  assert.deepEqual(await localModelGenerator(config, fetchImpl)(input), drafts);
  assert.equal(calls[0].url, "http://localhost:11434/v1/chat/completions");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer secret");
  const body = JSON.parse(calls[0].init.body as string);
  assert.equal(body.model, "llama3.1:8b");
  assert.equal(body.response_format.type, "json_schema");
});

test("accepts JSON wrapped in a code fence", async () => {
  const { fetchImpl } = replyWith("```json\n" + JSON.stringify(drafts) + "\n```");
  assert.deepEqual(await localModelGenerator(config, fetchImpl)(input), drafts);
});

test("explains a reply in the wrong shape", async () => {
  const { fetchImpl } = replyWith(JSON.stringify({ linkedin: "hi" }));
  await assert.rejects(localModelGenerator(config, fetchImpl)(input), (e) => e instanceof DraftError && /expected format/.test(e.message));
});

test("explains a missing model", async () => {
  const { fetchImpl } = replyWith('{"error":{"message":"model \\"llama3.1:8b\\" not found, try pulling it first"}}', 404);
  await assert.rejects(localModelGenerator(config, fetchImpl)(input), (e) => e instanceof DraftError && /ollama pull llama3.1:8b/.test(e.message));
});

test("explains when the local server is not running", async () => {
  const fetchImpl = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  await assert.rejects(localModelGenerator(config, fetchImpl)(input), (e) => e instanceof DraftError && /Couldn't reach/.test(e.message));
});
