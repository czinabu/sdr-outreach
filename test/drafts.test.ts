import type Anthropic from "@anthropic-ai/sdk";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { createApp } from "../server/app.ts";
import { buildUserPrompt, type OutreachDrafts } from "../server/drafts.ts";

const sampleDrafts: OutreachDrafts = {
  linkedin: { connectionNote: "Hi Dana", followUpMessage: "Thanks for connecting", why: "Short and specific." },
  email: { subject: "Second location", body: "Hi Dana,", why: "Leads with their news." },
  phone: { opener: "Hi Dana, it's Caleb", discoveryQuestions: ["How do you handle no-shows?"], voicemail: "Hi Dana", why: "Asks permission." },
  researchToDo: ["Check their recent posts"],
};

let nextResponse: { stop_reason: string; parsed_output: OutreachDrafts | null };
let lastParams: Record<string, unknown> | undefined;

const fakeClient = {
  beta: {
    messages: {
      parse: async (params: Record<string, unknown>) => {
        lastParams = params;
        return nextResponse;
      },
    },
  },
} as unknown as Anthropic;

const validBody = {
  prospectName: "Dana Lee",
  prospectTitle: "Office Manager",
  company: "Bright Smiles Dental",
  notes: "Just opened a second location",
  yourName: "Caleb",
  yourOffer: "Scheduling software that cuts no-shows",
  tone: "friendly",
};

let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
let baseUrl: string;

before(async () => {
  server = createApp(fakeClient).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

function postDrafts(body: unknown) {
  return fetch(`${baseUrl}/api/drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("returns drafts for a valid prospect", async () => {
  nextResponse = { stop_reason: "end_turn", parsed_output: sampleDrafts };
  const response = await postDrafts(validBody);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), sampleDrafts);
  assert.equal(lastParams?.model, "claude-opus-5-5");
  assert.equal(lastParams?.fallbacks, "default");
});

test("rejects a request missing required fields", async () => {
  const response = await postDrafts({ ...validBody, company: "" });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Company is required/);
});

test("reports a refusal as a readable error", async () => {
  nextResponse = { stop_reason: "refusal", parsed_output: null };
  const response = await postDrafts(validBody);
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /declined/);
});

test("serves the page", async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Draft my outreach/);
});

test("prompt falls back gracefully when notes are empty", () => {
  const prompt = buildUserPrompt({ ...validBody, industry: "", notes: "", goal: "Book a call", tone: "direct" });
  assert.match(prompt, /nothing beyond their name, title and company/);
  assert.doesNotMatch(prompt, /Industry:/);
});
